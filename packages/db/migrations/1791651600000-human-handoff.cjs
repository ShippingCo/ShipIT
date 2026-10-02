// #50: additive case ownership and private history. No implicit customer grants.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.support_cases (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 conversation_id uuid NOT NULL, installation_id uuid NOT NULL, contact_key text NOT NULL,
 inbox_id uuid NOT NULL, parcel_id uuid, reason text NOT NULL CHECK(reason IN ('human_requested','unknown_intent')),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','claimed','resolved')),
 assigned_staff_id uuid REFERENCES shipit.auth_users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,conversation_id) REFERENCES shipit.customer_conversations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id),
 CHECK(contact_key~'^[a-f0-9]{64}$'), CHECK(state<>'claimed' OR assigned_staff_id IS NOT NULL)
);
CREATE UNIQUE INDEX support_one_active ON shipit.support_cases(conversation_id) WHERE state<>'resolved';
CREATE INDEX support_queue ON shipit.support_cases(organization_id,franchise_id,state,updated_at,id);
CREATE TABLE shipit.support_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,case_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('opened','claimed','assigned','responded','noted','resolved','reopened')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 64),version integer NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN ('user','service')),actor_id text NOT NULL,correlation_id uuid NOT NULL,
 sealed_payload text,key_version text,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id), UNIQUE(case_id,version),
 FOREIGN KEY(organization_id,franchise_id,case_id) REFERENCES shipit.support_cases(organization_id,franchise_id,id),
 CHECK((sealed_payload IS NULL)=(key_version IS NULL)), CHECK(sealed_payload IS NULL OR length(sealed_payload)<=12000)
);
CREATE TABLE shipit.support_commands (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id text NOT NULL,key_digest text NOT NULL,fingerprint text NOT NULL,
 case_id uuid NOT NULL,result jsonb NOT NULL,PRIMARY KEY(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,case_id) REFERENCES shipit.support_cases(organization_id,franchise_id,id)
);
CREATE TRIGGER support_events_immutable BEFORE UPDATE OR DELETE ON shipit.support_events FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER support_commands_immutable BEFORE UPDATE OR DELETE ON shipit.support_commands FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE FUNCTION shipit.guard_support_case() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CASE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.state<>'open' OR NEW.version<>1 OR NEW.assigned_staff_id IS NOT NULL)
 THEN RAISE EXCEPTION 'CASE_INITIAL' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.customer_conversations c WHERE c.id=NEW.conversation_id AND c.organization_id=NEW.organization_id
  AND c.franchise_id=NEW.franchise_id AND c.installation_id=NEW.installation_id AND c.contact_key=NEW.contact_key)
 THEN RAISE EXCEPTION 'CASE_CHANNEL_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox j WHERE j.id=NEW.inbox_id AND j.organization_id=NEW.organization_id AND j.franchise_id=NEW.franchise_id
  AND j.installation_id=NEW.installation_id AND j.kind='inbound' AND j.state='completed')
 THEN RAISE EXCEPTION 'CASE_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NOT (NEW.state=OLD.state OR (OLD.state='open' AND NEW.state='claimed') OR (OLD.state='claimed' AND NEW.state='resolved') OR (OLD.state='resolved' AND NEW.state='open')) OR
     (NEW.state='open' AND NEW.assigned_staff_id IS NOT NULL) OR
     (to_jsonb(NEW)-ARRAY['state','assigned_staff_id','version','updated_at','inbox_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','assigned_staff_id','version','updated_at','inbox_id']) OR
     NEW.version NOT IN (OLD.version,OLD.version+1) OR (NEW.version=OLD.version AND
      (NEW.state,NEW.assigned_staff_id) IS DISTINCT FROM (OLD.state,OLD.assigned_staff_id))
  THEN RAISE EXCEPTION 'CASE_TRANSITION' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $fn$;
CREATE TRIGGER support_case_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.support_cases FOR EACH ROW EXECUTE FUNCTION shipit.guard_support_case();
ALTER TABLE shipit.whatsapp_outbound ADD COLUMN support_event_id uuid;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT outbound_support_fk FOREIGN KEY(organization_id,franchise_id,support_event_id) REFERENCES shipit.support_events(organization_id,franchise_id,id);
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_source_kind_check;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_source_kind_check CHECK(source_kind IN ('event','inbox','delivery_challenge','conversation','pickup','support'));
DO $shape$ DECLARE source text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO source FROM pg_constraint WHERE conrelid='shipit.whatsapp_outbound'::regclass AND conname='whatsapp_outbound_recipient_shape';
 ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_recipient_shape;
 EXECUTE 'ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_recipient_shape CHECK (('||substring(source FROM 7)||') AND support_event_id IS NULL OR
 (source_kind=''support'' AND purpose=''requested_assistance'' AND customer_id IS NULL AND delivery_recipient_ref IS NULL AND conversation_inbox_id IS NULL AND pickup_event_id IS NULL
 AND support_event_id IS NOT NULL AND support_event_id=source_id AND contact_version=source_id))';
END $shape$;
CREATE UNIQUE INDEX outbound_support_identity ON shipit.whatsapp_outbound(support_event_id) WHERE support_event_id IS NOT NULL;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_functiondef('shipit.guard_whatsapp_outbound()'::regprocedure) INTO source;
 source:=replace(source,'ELSIF NEW.source_kind=''pickup'' THEN','ELSIF NEW.source_kind=''support'' THEN
  IF NOT EXISTS(SELECT 1 FROM shipit.support_events e JOIN shipit.support_cases c ON c.id=e.case_id
   WHERE e.id=NEW.source_id AND e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.event_type=''responded''
    AND c.id=NEW.affected_entity_id AND c.installation_id=NEW.installation_id AND c.contact_key=NEW.contact_key)
  THEN RAISE EXCEPTION ''OUTBOUND_SOURCE_INVALID'' USING ERRCODE=''23514''; END IF;
 ELSIF NEW.source_kind=''pickup'' THEN'); EXECUTE source;
END $extend$;
DO $audit$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'support:'||id::text,organization_id,ARRAY[franchise_id],actor_type,actor_id,'support.'||event_type,'support',case_id,
 'success',reason,correlation_id,occurred_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.support_events$view$;
END $audit$;
REVOKE ALL ON shipit.support_cases,shipit.support_events,shipit.support_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_support_case() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only migration');};
