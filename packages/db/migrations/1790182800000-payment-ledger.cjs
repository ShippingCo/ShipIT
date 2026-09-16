// Forward-only Issue #29. The #22 opening obligation and historical amounts stay immutable.
exports.up = pgm => {
  pgm.sql(String.raw`
ALTER TABLE shipit.booking_obligations ADD UNIQUE(organization_id,franchise_id,booking_id,id);
CREATE TABLE shipit.payment_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,obligation_id uuid NOT NULL,
 principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation_id text NOT NULL CHECK(operation_id IN ('api.v1.payments.collect','api.v1.payments.reverse')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 normalization_version integer NOT NULL DEFAULT 1 CHECK(normalization_version=1),input jsonb NOT NULL,reversal_of uuid,
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 state text NOT NULL DEFAULT 'reserved',entry_id uuid,http_status integer,result jsonb,committed_at timestamptz,retain_until timestamptz,
 UNIQUE(organization_id,franchise_id,booking_id,obligation_id,id),
 UNIQUE(principal_id,organization_id,franchise_id,operation_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id) REFERENCES shipit.booking_obligations(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 CHECK((jsonb_typeof(input)='object' AND octet_length(input::text)<=1024 AND input->>'currency'='INR'
   AND jsonb_typeof(input->'amount_paise')='number' AND (input->>'amount_paise')::numeric BETWEEN 1 AND 9007199254740991
   AND trunc((input->>'amount_paise')::numeric)=(input->>'amount_paise')::numeric
   AND CASE WHEN operation_id='api.v1.payments.collect' THEN reversal_of IS NULL
     AND input->>'context' IN ('paid_counter','to_pay') AND input->>'method' IN ('cash','upi') AND (input->>'collection_reference')::uuid IS NOT NULL
     AND input-ARRAY['amount_paise','currency','context','method','collection_reference']='{}'::jsonb
   ELSE reversal_of IS NOT NULL AND input->>'reason_code' IN ('duplicate_recording','incorrect_amount','collection_not_received')
     AND input-ARRAY['amount_paise','currency','reason_code']='{}'::jsonb END) IS TRUE),
 CHECK(((state='reserved' AND entry_id IS NULL AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL) OR
   (state='committed' AND entry_id IS NOT NULL AND http_status=200 AND jsonb_typeof(result)='object' AND octet_length(result::text)<=4096
    AND isfinite(committed_at) AND retain_until='infinity'::timestamptz)) IS TRUE)
);
CREATE TABLE shipit.payment_entries (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,obligation_id uuid NOT NULL,command_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('collection','reversal')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 currency text NOT NULL CHECK(currency='INR'),context text NOT NULL CHECK(context IN ('paid_counter','to_pay')),method text NOT NULL CHECK(method IN ('cash','upi')),
 collection_reference uuid,reversal_of uuid,reason_code text,sequence integer NOT NULL CHECK(sequence>0),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 reversal_target_kind text GENERATED ALWAYS AS (CASE WHEN kind='reversal' THEN 'collection' END) STORED,
 UNIQUE(organization_id,franchise_id,booking_id,obligation_id,id),UNIQUE(organization_id,franchise_id,booking_id,obligation_id,id,kind),
 UNIQUE(organization_id,franchise_id,obligation_id,sequence),UNIQUE(command_id),
 UNIQUE(organization_id,franchise_id,collection_reference),
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id) REFERENCES shipit.booking_obligations(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,command_id) REFERENCES shipit.payment_commands(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,reversal_of,reversal_target_kind) REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id,kind) ON DELETE RESTRICT,
 CHECK(((kind='collection' AND collection_reference IS NOT NULL AND reversal_of IS NULL AND reason_code IS NULL) OR
   (kind='reversal' AND collection_reference IS NULL AND reversal_of IS NOT NULL AND reason_code IN ('duplicate_recording','incorrect_amount','collection_not_received'))) IS TRUE)
);
CREATE INDEX payment_entries_balance_idx ON shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,sequence);
CREATE INDEX payment_entries_reversals_idx ON shipit.payment_entries(organization_id,franchise_id,obligation_id,reversal_of) WHERE reversal_of IS NOT NULL;
ALTER TABLE shipit.payment_commands ADD FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,entry_id)
 REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.payment_commands ADD FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,reversal_of)
 REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT;

CREATE FUNCTION shipit.guard_payment_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'reserved' THEN RAISE EXCEPTION 'PAYMENT_COMMAND_INVALID' USING ERRCODE='23514'; END IF;
 ELSIF TG_OP='DELETE' THEN RAISE EXCEPTION 'PAYMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514';
 ELSIF OLD.state<>'reserved' OR NEW.state<>'committed' OR
   (to_jsonb(NEW)-ARRAY['state','entry_id','http_status','result','committed_at','retain_until']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','entry_id','http_status','result','committed_at','retain_until'])
 THEN RAISE EXCEPTION 'PAYMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER payment_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.payment_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_payment_command();
CREATE FUNCTION shipit.guard_payment_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o shipit.booking_obligations;c shipit.payment_commands;target shipit.payment_entries;net numeric;revision integer;reversed numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PAYMENT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 -- All ledger writers serialize on the immutable opening row; no cached balance is mutated.
 SELECT * INTO o FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.obligation_id FOR UPDATE;
 SELECT * INTO c FROM shipit.payment_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND obligation_id=NEW.obligation_id AND id=NEW.command_id AND state='reserved';
 SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0),COALESCE(max(sequence),0)
 INTO net,revision FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id;
 IF o.id IS NULL OR c.id IS NULL OR NEW.sequence::bigint<>revision::bigint+1 OR NEW.actor_id<>c.principal_id OR NEW.correlation_id<>c.correlation_id OR NEW.occurred_at<>c.occurred_at
 OR NEW.amount_paise IS DISTINCT FROM (c.input->>'amount_paise')::numeric OR NEW.currency IS DISTINCT FROM c.input->>'currency'
 OR NEW.reversal_of IS DISTINCT FROM c.reversal_of
 OR NEW.kind<>(CASE c.operation_id WHEN 'api.v1.payments.collect' THEN 'collection' ELSE 'reversal' END)
 THEN RAISE EXCEPTION 'PAYMENT_ENTRY_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.kind='collection' THEN
  IF NEW.context IS DISTINCT FROM c.input->>'context' OR NEW.method IS DISTINCT FROM c.input->>'method' OR NEW.collection_reference IS DISTINCT FROM (c.input->>'collection_reference')::uuid
   OR net+NEW.amount_paise>o.total_paise THEN RAISE EXCEPTION 'PAYMENT_COLLECTION_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO target FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND obligation_id=NEW.obligation_id AND id=NEW.reversal_of AND kind='collection';
  SELECT COALESCE(sum(amount_paise::numeric),0) INTO reversed FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id AND reversal_of=NEW.reversal_of;
  IF target.id IS NULL OR NEW.method<>target.method OR NEW.context<>target.context OR NEW.reason_code IS DISTINCT FROM c.input->>'reason_code'
   OR reversed+NEW.amount_paise>target.amount_paise OR net-NEW.amount_paise<0 THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER payment_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.payment_entries FOR EACH ROW EXECUTE FUNCTION shipit.guard_payment_entry();

CREATE TABLE shipit.payment_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,obligation_id uuid NOT NULL,entry_id uuid NOT NULL,command_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,action text NOT NULL CHECK(action IN ('payments.collect','payments.reverse')),
 reason_code text NOT NULL CHECK(reason_code IN ('collection_recorded','duplicate_recording','incorrect_amount','collection_not_received')),
 committed_version integer NOT NULL CHECK(committed_version>0),correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 UNIQUE(command_id),UNIQUE(entry_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,entry_id) REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,command_id) REFERENCES shipit.payment_commands(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT
);
CREATE INDEX payment_audit_owner_idx ON shipit.payment_audit_events(organization_id,franchise_id,obligation_id,committed_version);
CREATE TRIGGER payment_audit_immutable BEFORE UPDATE OR DELETE ON shipit.payment_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.append_payment_audit(org uuid,franchise uuid,booking uuid,command uuid,entry uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE e shipit.payment_entries;c shipit.payment_commands;
BEGIN
 SELECT * INTO e FROM shipit.payment_entries WHERE organization_id=org AND franchise_id=franchise AND booking_id=booking AND id=entry AND command_id=command;
 SELECT * INTO c FROM shipit.payment_commands WHERE organization_id=org AND franchise_id=franchise AND booking_id=booking AND id=command AND state='reserved';
 IF e.id IS NULL OR c.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_AUDIT_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO shipit.payment_audit_events(id,organization_id,franchise_id,booking_id,obligation_id,entry_id,command_id,actor_id,action,reason_code,committed_version,correlation_id,occurred_at)
 VALUES(e.id,org,franchise,booking,e.obligation_id,e.id,c.id,c.principal_id,substring(c.operation_id from 8),COALESCE(e.reason_code,'collection_recorded'),e.sequence,c.correlation_id,c.occurred_at);
END $fn$;

ALTER TABLE shipit.domain_events ADD COLUMN obligation_id uuid,ADD COLUMN payment_command_id uuid;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id)
 REFERENCES shipit.booking_obligations(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,payment_command_id)
 REFERENCES shipit.payment_commands(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT;
DO $extend$
DECLARE n text;expr text;source text;
BEGIN
 FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check','domain_events_envelope_check'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
  EXECUTE format('ALTER TABLE shipit.domain_events DROP CONSTRAINT %I',n);
  EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK ((obligation_id IS NULL AND payment_command_id IS NULL AND (%s)) OR (obligation_id IS NOT NULL AND payment_command_id IS NOT NULL))',n,expr);
 END LOOP;
 SELECT pg_get_functiondef('shipit.fill_domain_event_ordering()'::regprocedure) INTO source;
 IF position(' ELSIF NEW.route_id IS NOT NULL' in source)=0 THEN RAISE EXCEPTION 'PAYMENT_EVENT_UPGRADE_MISMATCH'; END IF;
 EXECUTE replace(source,' ELSIF NEW.route_id IS NOT NULL',' ELSIF NEW.obligation_id IS NOT NULL THEN NEW.payment_command_id=COALESCE(NEW.payment_command_id,NEW.command_id); ELSIF NEW.route_id IS NOT NULL');
 SELECT pg_get_functiondef('shipit.guard_domain_event_creation()'::regprocedure) INTO source;
 IF position(' IF NEW.booking_command_id IS NOT NULL' in source)=0 THEN RAISE EXCEPTION 'PAYMENT_EVENT_UPGRADE_MISMATCH'; END IF;
 EXECUTE replace(source,' IF NEW.booking_command_id IS NOT NULL',
  ' IF NEW.payment_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.payment_commands WHERE id=NEW.payment_command_id AND state=''reserved'') OR NEW.booking_command_id IS NOT NULL');
 -- Preserve the canonical audit view and its existing grants without copying old producers.
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'payment:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'payment_obligation',obligation_id,'success',reason_code,correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.payment_audit_events$view$;
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_action_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK ((%s) OR action IN (''payments.read'',''payments.collect'',''payments.reverse''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_resource_type_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check CHECK ((%s) OR resource_type=''payment_obligation'')',expr);
END $extend$;
ALTER TABLE shipit.domain_events ADD CONSTRAINT domain_events_payment_shape_check CHECK(obligation_id IS NULL OR (
 booking_id IS NOT NULL AND parcel_id IS NULL AND lot_id IS NULL AND route_id IS NULL AND lot_command_id IS NULL AND route_command_id IS NULL AND booking_command_id IS NULL AND parcel_command_id IS NULL
 AND payment_command_id=command_id AND aggregate_id=obligation_id AND octet_length(envelope::text)<=2048 AND event_type='payment.settled'
 AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text AND envelope->>'franchise_id'=franchise_id::text
 AND envelope->>'event_type'=event_type AND envelope->>'aggregate_id'=obligation_id::text AND envelope->>'aggregate_type'='payment_obligation' AND envelope->>'schema_version'='1'
 AND (envelope->>'aggregate_version')::bigint=aggregate_sequence AND envelope->>'command_id'=command_id::text AND envelope->>'causation_id'=command_id::text
 AND envelope-ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE);
CREATE UNIQUE INDEX domain_events_payment_revision_idx ON shipit.domain_events(organization_id,franchise_id,obligation_id,aggregate_sequence) WHERE obligation_id IS NOT NULL;
CREATE UNIQUE INDEX domain_events_payment_command_idx ON shipit.domain_events(payment_command_id) WHERE payment_command_id IS NOT NULL;

-- A prefix projection reconstructs the original result even after later corrections.
CREATE FUNCTION shipit.payment_result(org uuid,franchise uuid,entry uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('payment',jsonb_build_object('booking_id',e.booking_id,'obligation_id',e.obligation_id,'currency','INR',
  'gross_paise',o.total_paise,'collected_paise',n.collected,'outstanding_paise',o.total_paise-n.collected,'version',e.sequence,
  'state',CASE WHEN n.collected=o.total_paise THEN 'settled' WHEN n.collected=0 THEN 'uncollected' ELSE 'partially_collected' END),
  'entry',jsonb_build_object('id',e.id,'kind',e.kind,'amount_paise',e.amount_paise,'currency',e.currency,'context',e.context,'method',e.method,
    'collection_reference',e.collection_reference,'reversal_of',e.reversal_of,'reason_code',e.reason_code,'version',e.sequence,'occurred_at',shipit.lot_wire_time(e.occurred_at)))
 FROM shipit.payment_entries e JOIN shipit.booking_obligations o ON o.organization_id=e.organization_id AND o.franchise_id=e.franchise_id AND o.booking_id=e.booking_id AND o.id=e.obligation_id
 CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN x.kind='collection' THEN x.amount_paise::numeric ELSE -x.amount_paise::numeric END),0) AS collected
   FROM shipit.payment_entries x WHERE x.organization_id=e.organization_id AND x.franchise_id=e.franchise_id AND x.obligation_id=e.obligation_id AND x.sequence<=e.sequence) n
 WHERE e.organization_id=org AND e.franchise_id=franchise AND e.id=entry
$fn$;
CREATE FUNCTION shipit.check_payment_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.payment_commands;original shipit.payment_commands;e shipit.payment_entries;a shipit.payment_audit_events;v shipit.domain_events;expected jsonb;settles boolean;
BEGIN
 SELECT * INTO c FROM shipit.payment_commands WHERE id=NEW.id;
 SELECT * INTO e FROM shipit.payment_entries WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND booking_id=c.booking_id AND obligation_id=c.obligation_id AND id=c.entry_id;
 expected=shipit.payment_result(c.organization_id,c.franchise_id,c.entry_id);
 IF c.state<>'committed' OR e.id IS NULL OR expected IS NULL OR c.result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PAYMENT_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF e.command_id<>c.id THEN
  SELECT * INTO original FROM shipit.payment_commands WHERE id=e.command_id;
  IF c.operation_id<>'api.v1.payments.collect' OR e.kind<>'collection' OR original.state<>'committed' OR c.fingerprint<>original.fingerprint
    OR c.input IS DISTINCT FROM original.input OR c.reversal_of IS NOT NULL
    OR EXISTS(SELECT 1 FROM shipit.payment_entries WHERE command_id=c.id) OR EXISTS(SELECT 1 FROM shipit.payment_audit_events WHERE command_id=c.id)
    OR EXISTS(SELECT 1 FROM shipit.domain_events WHERE payment_command_id=c.id)
  THEN RAISE EXCEPTION 'PAYMENT_REPLAY_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO a FROM shipit.payment_audit_events WHERE command_id=c.id;
 IF a.id IS NULL OR a.id<>e.id OR a.entry_id<>e.id OR a.actor_id<>c.principal_id OR a.correlation_id<>c.correlation_id OR a.occurred_at<>c.occurred_at
   OR a.committed_version<>e.sequence OR a.action<>substring(c.operation_id from 8) OR a.reason_code<>COALESCE(e.reason_code,'collection_recorded')
 THEN RAISE EXCEPTION 'PAYMENT_AUDIT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 settles=e.kind='collection' AND (expected->'payment'->>'outstanding_paise')::numeric=0;
 SELECT * INTO v FROM shipit.domain_events WHERE payment_command_id=c.id;
 IF settles THEN
  IF v.event_id IS NULL OR v.obligation_id<>e.obligation_id OR v.booking_id<>e.booking_id OR v.aggregate_sequence<>e.sequence OR v.occurred_at<>e.occurred_at
   OR v.envelope->'actor' IS DISTINCT FROM jsonb_build_object('type','user','id',c.principal_id)
   OR v.envelope->>'correlation_id' IS DISTINCT FROM c.correlation_id::text OR v.envelope->>'occurred_at' IS DISTINCT FROM shipit.lot_wire_time(c.occurred_at)
   OR v.envelope->'payload' IS DISTINCT FROM jsonb_build_object('booking_id',e.booking_id,'settlement_ref',e.id)
  THEN RAISE EXCEPTION 'PAYMENT_SETTLEMENT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 ELSIF v.event_id IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_SETTLEMENT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER payment_command_complete AFTER INSERT OR UPDATE ON shipit.payment_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_payment_complete();
REVOKE ALL ON shipit.payment_commands,shipit.payment_entries,shipit.payment_audit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_payment_command(),shipit.guard_payment_entry(),shipit.append_payment_audit(uuid,uuid,uuid,uuid,uuid),
 shipit.payment_result(uuid,uuid,uuid),shipit.check_payment_complete() FROM PUBLIC;
`);
};
