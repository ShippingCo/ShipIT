// Forward-only #138: configured receiving evidence. No legacy payment backfill.
exports.up = pgm => {
  pgm.sql(String.raw`
CREATE FUNCTION shipit.valid_receiving_methods(methods text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT (array_ndims(methods)=1 AND array_lower(methods,1)=1 AND cardinality(methods) BETWEEN 1 AND 4
  AND methods <@ ARRAY['cash','upi','card','bank_transfer','other']::text[]
  AND methods=ARRAY(SELECT DISTINCT m FROM unnest(methods) m ORDER BY m)
  AND (NOT ('cash'=ANY(methods)) OR methods=ARRAY['cash']::text[])) IS TRUE
$fn$;
CREATE TABLE shipit.receiving_accounts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.receiving_account_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name)
  AND name !~ '[\x01-\x1f\x7f-\x9f]'),
 methods text[] NOT NULL CHECK(shipit.valid_receiving_methods(methods)),other_method_name text,
 active boolean NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,account_id,version),
 UNIQUE(organization_id,franchise_id,account_id,id),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK((CASE WHEN 'other'=ANY(methods) THEN other_method_name IS NOT NULL
  AND char_length(other_method_name) BETWEEN 1 AND 60 AND other_method_name=btrim(other_method_name)
  AND other_method_name !~ '[\x01-\x1f\x7f-\x9f]' ELSE other_method_name IS NULL END) IS TRUE)
);
CREATE INDEX receiving_account_current_idx ON shipit.receiving_account_revisions(organization_id,franchise_id,account_id,version DESC);
CREATE TRIGGER receiving_account_immutable BEFORE UPDATE OR DELETE ON shipit.receiving_accounts
 FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_receiving_account_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE parent uuid;previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'RECEIVING_ACCOUNT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'RECEIVING_ACCOUNT_GENERATED_FIELDS' USING ERRCODE='23514'; END IF;
 SELECT id INTO parent FROM shipit.receiving_accounts
  WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT COALESCE(max(version),0) INTO previous FROM shipit.receiving_account_revisions
  WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
 IF parent IS NULL OR NEW.version::bigint<>previous::bigint+1
 THEN RAISE EXCEPTION 'RECEIVING_ACCOUNT_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());
 RETURN NEW;
END $fn$;
CREATE TRIGGER receiving_account_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.receiving_account_revisions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_receiving_account_revision();
CREATE FUNCTION shipit.check_receiving_account_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions
  WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.id AND version=1)
 THEN RAISE EXCEPTION 'RECEIVING_ACCOUNT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER receiving_account_complete AFTER INSERT ON shipit.receiving_accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_receiving_account_complete();
CREATE TABLE shipit.receiving_account_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 FOREIGN KEY(organization_id,franchise_id,account_id,id)
  REFERENCES shipit.receiving_account_revisions(organization_id,franchise_id,account_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER receiving_account_audit_immutable BEFORE UPDATE OR DELETE ON shipit.receiving_account_audit_events
 FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.audit_receiving_account_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.receiving_account_audit_events(id,organization_id,franchise_id,account_id,version,actor_id,correlation_id,occurred_at)
 VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.account_id,NEW.version,NEW.actor_id,NEW.correlation_id,NEW.recorded_at);
 RETURN NULL;
END $fn$;
CREATE TRIGGER receiving_account_revision_audit AFTER INSERT ON shipit.receiving_account_revisions
 FOR EACH ROW EXECUTE FUNCTION shipit.audit_receiving_account_revision();
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'receiving-account:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'receiving_accounts.configure','financial_account',account_id,'success','account_configured',correlation_id,occurred_at,
 NULL,NULL,version,NULL FROM shipit.receiving_account_audit_events$view$;
END $extend$;
REVOKE ALL ON shipit.receiving_accounts,shipit.receiving_account_revisions,shipit.receiving_account_audit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.valid_receiving_methods(text[]),shipit.guard_receiving_account_revision(),
 shipit.check_receiving_account_complete(),shipit.audit_receiving_account_revision() FROM PUBLIC;
-- One receipt is one actual inflow. Existing payment entries remain the sole bill effects.
CREATE TABLE shipit.money_receipt_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,
 principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation_id text NOT NULL CHECK(operation_id IN ('api.v1.money_receipts.record','api.v1.money_receipts.allocate','api.v1.money_receipts.correct')),
 version integer NOT NULL CHECK(version>0),key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),input jsonb NOT NULL,
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 state text NOT NULL DEFAULT 'reserved',result jsonb,committed_at timestamptz,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,receipt_id,id),
 UNIQUE(organization_id,franchise_id,receipt_id,version),UNIQUE(organization_id,franchise_id,principal_id,operation_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 CHECK((jsonb_typeof(input)='object' AND octet_length(input::text)<=32768 AND
  CASE operation_id WHEN 'api.v1.money_receipts.record' THEN version=1
   AND input ?& ARRAY['customer_id','account_id','expected_account_version','method','amount_paise','currency','receiver_id','custodian_id','occurred_at','external_reference','allocations']
   AND jsonb_typeof(input->'amount_paise')='number' AND jsonb_typeof(input->'expected_account_version')='number'
   AND input-ARRAY['customer_id','account_id','expected_account_version','method','amount_paise','currency','receiver_id','custodian_id','occurred_at','external_reference','allocations']='{}'::jsonb
   AND jsonb_typeof(input->'allocations')='array' AND jsonb_array_length(input->'allocations') BETWEEN 0 AND 50
  WHEN 'api.v1.money_receipts.allocate' THEN version>1 AND input-ARRAY['expected_version','allocations']='{}'::jsonb
   AND (input->>'expected_version')::numeric=version-1 AND jsonb_typeof(input->'allocations')='array' AND jsonb_array_length(input->'allocations') BETWEEN 1 AND 50
  ELSE version>1 AND jsonb_typeof(input->'amount_paise')='number' AND input-ARRAY['expected_version','allocation_id','amount_paise','currency','reason_code']='{}'::jsonb
   AND (input->>'expected_version')::numeric=version-1 AND input->>'currency'='INR'
   AND input->>'reason_code' IN ('duplicate_recording','incorrect_amount','collection_not_received') END) IS TRUE),
 CHECK(((state='reserved' AND result IS NULL AND committed_at IS NULL) OR
  (state='committed' AND jsonb_typeof(result)='object' AND octet_length(result::text)<=32768 AND isfinite(committed_at))) IS TRUE)
);
CREATE TABLE shipit.money_receipts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,command_id uuid NOT NULL,
 customer_id uuid NOT NULL,account_id uuid NOT NULL,account_revision_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 method text NOT NULL CHECK(method IN ('cash','upi','card','bank_transfer','other')),
 receiver_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 initial_custodian_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 external_reference text CHECK(external_reference IS NULL OR (char_length(external_reference) BETWEEN 1 AND 128
  AND external_reference=btrim(external_reference) AND external_reference !~ '[\x01-\x1f\x7f-\x9f]')),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,id,command_id) REFERENCES shipit.money_receipt_commands(organization_id,franchise_id,receipt_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,account_id,account_revision_id) REFERENCES shipit.receiving_account_revisions(organization_id,franchise_id,account_id,id) ON DELETE RESTRICT,
 -- A later custody transfer belongs to its own source; never rewrite original custody.
 CHECK(initial_custodian_id=receiver_id)
);
CREATE INDEX money_receipts_customer_page_idx ON shipit.money_receipts(organization_id,franchise_id,customer_id,id);
ALTER TABLE shipit.money_receipt_commands ADD FOREIGN KEY(organization_id,franchise_id,receipt_id)
 REFERENCES shipit.money_receipts(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX money_receipts_customer_idx ON shipit.money_receipts(organization_id,franchise_id,customer_id,recorded_at,id);
CREATE FUNCTION shipit.guard_money_receipt_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;receipt uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'reserved' OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'MONEY_RECEIPT_COMMAND_INVALID' USING ERRCODE='23514'; END IF;
  SELECT id INTO receipt FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.money_receipt_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
  IF NEW.version::bigint<>previous::bigint+1 OR (NEW.operation_id='api.v1.money_receipts.record') IS DISTINCT FROM (receipt IS NULL)
  THEN RAISE EXCEPTION 'MONEY_RECEIPT_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
  NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());
 ELSIF TG_OP='DELETE' OR OLD.state<>'reserved' OR NEW.state<>'committed' OR
  (to_jsonb(NEW)-ARRAY['state','result','committed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','committed_at'])
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER money_receipt_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.money_receipt_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_money_receipt_command();
CREATE FUNCTION shipit.guard_money_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.money_receipt_commands;a shipit.receiving_account_revisions;current_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MONEY_RECEIPT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM shipit.money_receipt_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.id AND id=NEW.command_id AND state='reserved' AND operation_id='api.v1.money_receipts.record';
 PERFORM id FROM shipit.receiving_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO a FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id AND id=NEW.account_revision_id;
 SELECT max(version) INTO current_version FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
 IF c.id IS NULL OR a.id IS NULL OR NOT a.active OR a.version IS DISTINCT FROM current_version OR NOT (NEW.method=ANY(a.methods))
  OR NEW.recorded_at IS NOT NULL OR NEW.customer_id IS DISTINCT FROM (c.input->>'customer_id')::uuid
  OR NEW.account_id IS DISTINCT FROM (c.input->>'account_id')::uuid OR a.version IS DISTINCT FROM (c.input->>'expected_account_version')::integer
  OR NEW.amount_paise IS DISTINCT FROM (c.input->>'amount_paise')::numeric OR NEW.currency IS DISTINCT FROM c.input->>'currency'
  OR NEW.method IS DISTINCT FROM c.input->>'method' OR NEW.receiver_id IS DISTINCT FROM (c.input->>'receiver_id')::uuid
  OR NEW.initial_custodian_id IS DISTINCT FROM (c.input->>'custodian_id')::uuid OR NEW.occurred_at IS DISTINCT FROM (c.input->>'occurred_at')::timestamptz
  OR NEW.occurred_at>c.recorded_at OR NEW.external_reference IS DISTINCT FROM c.input->>'external_reference'
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
  JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
  WHERE m.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.receiver_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin'))
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_RECEIVER_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=c.recorded_at;RETURN NEW;
END $fn$;
CREATE TRIGGER money_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.money_receipts FOR EACH ROW EXECUTE FUNCTION shipit.guard_money_receipt();
ALTER TABLE shipit.payment_commands ADD COLUMN receipt_command_id uuid;
ALTER TABLE shipit.payment_commands ADD FOREIGN KEY(organization_id,franchise_id,receipt_command_id) REFERENCES shipit.money_receipt_commands(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.payment_entries DROP CONSTRAINT payment_entries_method_check;
ALTER TABLE shipit.payment_entries ADD CONSTRAINT payment_entries_method_check CHECK(method IN ('cash','upi','card','bank_transfer','other'));
-- Preserve the complete old validation expression and add a strictly scoped new-method branch.
DO $extend$
DECLARE constraint_name text;expression text;
BEGIN
 SELECT conname,pg_get_expr(conbin,conrelid) INTO constraint_name,expression FROM pg_constraint
  WHERE conrelid='shipit.payment_commands'::regclass AND contype='c' AND pg_get_expr(conbin,conrelid) LIKE '%collection_reference%';
 IF constraint_name IS NULL THEN RAISE EXCEPTION 'PAYMENT_INPUT_CONSTRAINT_MISSING'; END IF;
 EXECUTE format('ALTER TABLE shipit.payment_commands DROP CONSTRAINT %I',constraint_name);
 EXECUTE format('ALTER TABLE shipit.payment_commands ADD CONSTRAINT %I CHECK ((%s) OR ((receipt_command_id IS NOT NULL
  AND operation_id=''api.v1.payments.collect'' AND reversal_of IS NULL AND jsonb_typeof(input)=''object'' AND octet_length(input::text)<=1024
  AND input->>''currency''=''INR'' AND jsonb_typeof(input->''amount_paise'')=''number'' AND (input->>''amount_paise'')::numeric BETWEEN 1 AND 9007199254740991
  AND trunc((input->>''amount_paise'')::numeric)=(input->>''amount_paise'')::numeric AND input->>''context'' IN (''paid_counter'',''to_pay'')
  AND input->>''method'' IN (''card'',''bank_transfer'',''other'') AND (input->>''collection_reference'')::uuid IS NOT NULL
  AND input-ARRAY[''amount_paise'',''currency'',''context'',''method'',''collection_reference'']=''{}''::jsonb) IS TRUE))',constraint_name,expression);
END $extend$;
CREATE TABLE shipit.money_receipt_allocations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,command_id uuid NOT NULL,
 command_version integer NOT NULL CHECK(command_version>0),booking_id uuid NOT NULL,obligation_id uuid NOT NULL,payment_entry_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('allocation','release')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 release_of uuid,UNIQUE(payment_entry_id),UNIQUE(organization_id,franchise_id,receipt_id,id),UNIQUE(command_id,booking_id),
 FOREIGN KEY(organization_id,franchise_id,receipt_id,command_id) REFERENCES shipit.money_receipt_commands(organization_id,franchise_id,receipt_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,payment_entry_id) REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,receipt_id,release_of) REFERENCES shipit.money_receipt_allocations(organization_id,franchise_id,receipt_id,id) ON DELETE RESTRICT,
 CHECK((kind='allocation')=(release_of IS NULL))
);
CREATE INDEX money_receipt_allocations_balance_idx ON shipit.money_receipt_allocations(organization_id,franchise_id,receipt_id,command_version);
CREATE INDEX money_receipt_allocations_release_idx ON shipit.money_receipt_allocations(organization_id,franchise_id,receipt_id,release_of) WHERE release_of IS NOT NULL;
CREATE FUNCTION shipit.guard_money_receipt_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r shipit.money_receipts;c shipit.money_receipt_commands;e shipit.payment_entries;p shipit.payment_commands;original shipit.money_receipt_allocations;net numeric;released numeric;customer uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MONEY_RECEIPT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
 SELECT * INTO c FROM shipit.money_receipt_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id AND receipt_id=NEW.receipt_id AND state='reserved';
 SELECT * INTO e FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND obligation_id=NEW.obligation_id AND id=NEW.payment_entry_id;
 SELECT * INTO p FROM shipit.payment_commands WHERE id=e.command_id;
 SELECT customer_id INTO customer FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 IF r.id IS NULL OR c.id IS NULL OR e.id IS NULL OR p.receipt_command_id IS DISTINCT FROM c.id OR NEW.command_version<>c.version
  OR customer IS DISTINCT FROM r.customer_id OR e.amount_paise<>NEW.amount_paise OR e.method<>r.method OR p.principal_id<>c.principal_id
  OR p.correlation_id<>c.correlation_id OR e.occurred_at<>c.recorded_at OR (e.kind='collection') IS DISTINCT FROM (NEW.kind='allocation')
  OR (c.operation_id='api.v1.money_receipts.correct') IS DISTINCT FROM (NEW.kind='release')
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_ALLOCATION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO net
  FROM shipit.money_receipt_allocations WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND receipt_id=r.id;
 IF NEW.kind='allocation' THEN
  IF net+NEW.amount_paise>r.amount_paise THEN RAISE EXCEPTION 'MONEY_RECEIPT_AVAILABILITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO original FROM shipit.money_receipt_allocations WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND receipt_id=r.id AND id=NEW.release_of AND kind='allocation';
  SELECT COALESCE(sum(amount_paise::numeric),0) INTO released FROM shipit.money_receipt_allocations WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND receipt_id=r.id AND release_of=NEW.release_of;
  IF original.id IS NULL OR e.reversal_of IS DISTINCT FROM original.payment_entry_id OR original.booking_id<>NEW.booking_id OR original.obligation_id<>NEW.obligation_id
   OR released+NEW.amount_paise>original.amount_paise OR net-NEW.amount_paise<0 OR NEW.release_of IS DISTINCT FROM (c.input->>'allocation_id')::uuid
   OR NEW.amount_paise IS DISTINCT FROM (c.input->>'amount_paise')::numeric OR e.reason_code IS DISTINCT FROM c.input->>'reason_code'
  THEN RAISE EXCEPTION 'MONEY_RECEIPT_RELEASE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER money_receipt_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.money_receipt_allocations FOR EACH ROW EXECUTE FUNCTION shipit.guard_money_receipt_allocation();
CREATE FUNCTION shipit.check_money_receipt_payment_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE p shipit.payment_commands;linked boolean;
BEGIN
 SELECT * INTO p FROM shipit.payment_commands WHERE id=NEW.command_id;
 SELECT EXISTS(SELECT 1 FROM shipit.money_receipt_allocations WHERE payment_entry_id=NEW.reversal_of) INTO linked;
 IF (p.receipt_command_id IS NOT NULL OR linked) AND NOT EXISTS(SELECT 1 FROM shipit.money_receipt_allocations a
  WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.payment_entry_id=NEW.id AND a.command_id=p.receipt_command_id)
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_PAYMENT_LINK_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF p.receipt_command_id IS NULL AND NEW.method NOT IN ('cash','upi') THEN RAISE EXCEPTION 'MONEY_RECEIPT_PAYMENT_LINK_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER money_receipt_payment_link AFTER INSERT ON shipit.payment_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_money_receipt_payment_link();
CREATE FUNCTION shipit.money_receipt_result(org uuid,franchise uuid,command uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('receipt_id',r.id,'customer_id',r.customer_id,'version',c.version,'currency','INR','received_paise',r.amount_paise,
 'allocated_paise',n.net,'unallocated_paise',r.amount_paise-n.net,'allocations',COALESCE(items.rows,'[]'::jsonb))
 FROM shipit.money_receipt_commands c JOIN shipit.money_receipts r ON r.organization_id=c.organization_id AND r.franchise_id=c.franchise_id AND r.id=c.receipt_id
 CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END),0) net
  FROM shipit.money_receipt_allocations a WHERE a.organization_id=org AND a.franchise_id=franchise AND a.receipt_id=r.id AND a.command_version<=c.version) n
 CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',a.id,'booking_id',a.booking_id,'payment_entry_id',a.payment_entry_id,'kind',a.kind,'amount_paise',a.amount_paise,'release_of',a.release_of) ORDER BY a.booking_id) rows
  FROM shipit.money_receipt_allocations a WHERE a.organization_id=org AND a.franchise_id=franchise AND a.command_id=c.id) items
 WHERE c.organization_id=org AND c.franchise_id=franchise AND c.id=command
$fn$;
CREATE TABLE shipit.money_receipt_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('money_receipts.record','money_receipts.allocate','money_receipts.correct')),
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 FOREIGN KEY(organization_id,franchise_id,receipt_id,id) REFERENCES shipit.money_receipt_commands(organization_id,franchise_id,receipt_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER money_receipt_audit_immutable BEFORE UPDATE OR DELETE ON shipit.money_receipt_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.check_money_receipt_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.money_receipt_commands;item jsonb;a shipit.money_receipt_allocations;n integer;expected jsonb;
BEGIN
 SELECT * INTO c FROM shipit.money_receipt_commands WHERE id=NEW.id;
 expected=shipit.money_receipt_result(c.organization_id,c.franchise_id,c.id);
 IF c.state<>'committed' OR expected IS NULL OR c.result IS DISTINCT FROM expected
  OR (expected->>'allocated_paise')::numeric NOT BETWEEN 0 AND (expected->>'received_paise')::numeric
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO n FROM shipit.money_receipt_allocations WHERE command_id=c.id;
 IF c.operation_id='api.v1.money_receipts.correct' THEN
  IF n<>1 THEN RAISE EXCEPTION 'MONEY_RECEIPT_CORRECTION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 ELSE
  IF n<>jsonb_array_length(c.input->'allocations') THEN RAISE EXCEPTION 'MONEY_RECEIPT_ALLOCATIONS_INCOMPLETE' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(c.input->'allocations') LOOP
   SELECT * INTO a FROM shipit.money_receipt_allocations WHERE command_id=c.id AND booking_id=(item->>'booking_id')::uuid AND kind='allocation';
   IF a.id IS NULL OR item-ARRAY['booking_id','amount_paise','context','expected_payment_version']<>'{}'::jsonb
    OR a.amount_paise IS DISTINCT FROM (item->>'amount_paise')::numeric OR NOT EXISTS(SELECT 1 FROM shipit.payment_entries e
     WHERE e.id=a.payment_entry_id AND e.context=item->>'context' AND e.sequence::bigint=(item->>'expected_payment_version')::numeric+1)
   THEN RAISE EXCEPTION 'MONEY_RECEIPT_ALLOCATION_INTENT_INVALID' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.money_receipt_audit_events WHERE id=c.id AND actor_id=c.principal_id AND correlation_id=c.correlation_id AND version=c.version
  AND receipt_id=c.receipt_id AND occurred_at=c.recorded_at AND action=substring(c.operation_id from 8))
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_AUDIT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM shipit.payment_commands p WHERE p.receipt_command_id=c.id AND
  (p.state<>'committed' OR NOT EXISTS(SELECT 1 FROM shipit.money_receipt_allocations linked WHERE linked.command_id=c.id AND linked.payment_entry_id=p.entry_id)))
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_CHILD_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER money_receipt_command_complete AFTER INSERT OR UPDATE ON shipit.money_receipt_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_money_receipt_complete();
CREATE FUNCTION shipit.audit_money_receipt_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.state='committed' THEN
  INSERT INTO shipit.money_receipt_audit_events(id,organization_id,franchise_id,receipt_id,version,actor_id,action,correlation_id,occurred_at)
  VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.receipt_id,NEW.version,NEW.principal_id,substring(NEW.operation_id from 8),NEW.correlation_id,NEW.recorded_at);
 END IF;RETURN NULL;
END $fn$;
CREATE TRIGGER money_receipt_command_audit AFTER UPDATE ON shipit.money_receipt_commands FOR EACH ROW EXECUTE FUNCTION shipit.audit_money_receipt_command();
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'money-receipt:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'money_receipt',receipt_id,'success',
 CASE action WHEN 'money_receipts.record' THEN 'receipt_recorded' WHEN 'money_receipts.allocate' THEN 'receipt_allocated' ELSE 'allocation_corrected' END,
 correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.money_receipt_audit_events$view$;
END $extend$;
REVOKE ALL ON shipit.money_receipts,shipit.money_receipt_commands,shipit.money_receipt_allocations,shipit.money_receipt_audit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_money_receipt_command(),shipit.guard_money_receipt(),shipit.guard_money_receipt_allocation(),
 shipit.check_money_receipt_payment_link(),shipit.money_receipt_result(uuid,uuid,uuid),shipit.check_money_receipt_complete(),shipit.audit_money_receipt_command() FROM PUBLIC;

-- Receipt commands publish a separate aggregate, including advances with no booking.
ALTER TABLE shipit.domain_events ADD COLUMN money_receipt_id uuid,ADD COLUMN money_receipt_command_id uuid;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,money_receipt_id)
 REFERENCES shipit.money_receipts(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,money_receipt_id,money_receipt_command_id)
 REFERENCES shipit.money_receipt_commands(organization_id,franchise_id,receipt_id,id) ON DELETE RESTRICT;
DO $extend$
DECLARE n text;expr text;source text;
BEGIN
 FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check','domain_events_envelope_check'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
  -- The released delivery-proof migration removes the separate command-owner check.
  -- Preserve every constraint that is actually present; receipt ownership remains closed below.
  IF expr IS NULL AND n='domain_events_command_owner_check' THEN CONTINUE; END IF;
  IF expr IS NULL THEN RAISE EXCEPTION 'MONEY_RECEIPT_EVENT_UPGRADE_MISMATCH'; END IF;
  EXECUTE format('ALTER TABLE shipit.domain_events DROP CONSTRAINT %I',n);
  EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK ((money_receipt_id IS NULL AND money_receipt_command_id IS NULL AND (%s)) OR (money_receipt_id IS NOT NULL AND money_receipt_command_id IS NOT NULL))',n,expr);
 END LOOP;
 SELECT pg_get_functiondef('shipit.fill_domain_event_ordering()'::regprocedure) INTO source;
 IF position(' ELSIF NEW.obligation_id IS NOT NULL' in source)=0 THEN RAISE EXCEPTION 'MONEY_RECEIPT_EVENT_UPGRADE_MISMATCH'; END IF;
 EXECUTE replace(source,' ELSIF NEW.obligation_id IS NOT NULL',' ELSIF NEW.money_receipt_id IS NOT NULL THEN NEW.money_receipt_command_id=COALESCE(NEW.money_receipt_command_id,NEW.command_id); ELSIF NEW.obligation_id IS NOT NULL');
 SELECT pg_get_functiondef('shipit.guard_domain_event_creation()'::regprocedure) INTO source;
 IF position(' IF NEW.payment_command_id IS NOT NULL' in source)=0 THEN RAISE EXCEPTION 'MONEY_RECEIPT_EVENT_UPGRADE_MISMATCH'; END IF;
 EXECUTE replace(source,' IF NEW.payment_command_id IS NOT NULL',
  ' IF NEW.money_receipt_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.money_receipt_commands WHERE id=NEW.money_receipt_command_id AND state=''reserved'') OR NEW.payment_command_id IS NOT NULL');
END $extend$;
ALTER TABLE shipit.domain_events ADD CONSTRAINT domain_events_money_receipt_shape_check CHECK(money_receipt_id IS NULL OR (
 booking_id IS NULL AND parcel_id IS NULL AND lot_id IS NULL AND route_id IS NULL AND obligation_id IS NULL
 AND booking_command_id IS NULL AND parcel_command_id IS NULL AND lot_command_id IS NULL AND route_command_id IS NULL AND payment_command_id IS NULL
 AND money_receipt_command_id=command_id AND aggregate_id=money_receipt_id
 AND event_type IN ('money_receipt.recorded','money_receipt.allocated','money_receipt.allocation_released')
 AND jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=2048
 AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text AND envelope->>'franchise_id'=franchise_id::text
 AND envelope->>'event_type'=event_type AND envelope->>'aggregate_id'=money_receipt_id::text AND envelope->>'aggregate_type'='money_receipt' AND envelope->>'schema_version'='1'
 AND (envelope->>'aggregate_version')::bigint=aggregate_sequence AND envelope->>'command_id'=command_id::text AND envelope->>'causation_id'=command_id::text
 AND envelope-ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE);
CREATE UNIQUE INDEX domain_events_money_receipt_command_idx ON shipit.domain_events(money_receipt_command_id) WHERE money_receipt_command_id IS NOT NULL;
CREATE FUNCTION shipit.publish_money_receipt_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE kind text;
BEGIN
 IF NEW.state='committed' THEN
  kind=CASE NEW.operation_id WHEN 'api.v1.money_receipts.record' THEN 'money_receipt.recorded' WHEN 'api.v1.money_receipts.allocate' THEN 'money_receipt.allocated' ELSE 'money_receipt.allocation_released' END;
  INSERT INTO shipit.domain_events(event_id,organization_id,franchise_id,command_id,money_receipt_id,money_receipt_command_id,event_type,aggregate_id,envelope)
  VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.id,NEW.receipt_id,NEW.id,kind,NEW.receipt_id,
   jsonb_build_object('event_id',NEW.id,'event_type',kind,'schema_version',1,'organization_id',NEW.organization_id,'franchise_id',NEW.franchise_id,
    'aggregate_type','money_receipt','aggregate_id',NEW.receipt_id,'aggregate_version',NEW.version,'occurred_at',shipit.lot_wire_time(NEW.recorded_at),
    'actor',jsonb_build_object('type','user','id',NEW.principal_id),'correlation_id',NEW.correlation_id,'causation_id',NEW.id,'command_id',NEW.id,
    'payload',jsonb_build_object('receipt_id',NEW.receipt_id)));
 END IF;RETURN NEW;
END $fn$;
-- BEFORE UPDATE sees the still-reserved command, while deferred completion validates the exact event.
CREATE TRIGGER money_receipt_command_publish BEFORE UPDATE ON shipit.money_receipt_commands FOR EACH ROW EXECUTE FUNCTION shipit.publish_money_receipt_command();
CREATE FUNCTION shipit.check_money_receipt_event_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.money_receipt_commands;e shipit.domain_events;kind text;
BEGIN
 SELECT * INTO c FROM shipit.money_receipt_commands WHERE id=NEW.id;
 SELECT * INTO e FROM shipit.domain_events WHERE money_receipt_command_id=c.id;
 kind=CASE c.operation_id WHEN 'api.v1.money_receipts.record' THEN 'money_receipt.recorded' WHEN 'api.v1.money_receipts.allocate' THEN 'money_receipt.allocated' ELSE 'money_receipt.allocation_released' END;
 IF c.state<>'committed' OR e.event_id IS DISTINCT FROM c.id OR e.event_type IS DISTINCT FROM kind
  OR e.money_receipt_id IS DISTINCT FROM c.receipt_id OR e.aggregate_sequence IS DISTINCT FROM c.version OR e.occurred_at IS DISTINCT FROM c.recorded_at
  OR e.envelope->'actor' IS DISTINCT FROM jsonb_build_object('type','user','id',c.principal_id)
  OR e.envelope->>'correlation_id' IS DISTINCT FROM c.correlation_id::text
  OR e.envelope->>'occurred_at' IS DISTINCT FROM shipit.lot_wire_time(c.recorded_at)
  OR e.envelope->'payload' IS DISTINCT FROM jsonb_build_object('receipt_id',c.receipt_id)
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_EVENT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER money_receipt_event_complete AFTER INSERT OR UPDATE ON shipit.money_receipt_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_money_receipt_event_complete();
REVOKE ALL ON FUNCTION shipit.publish_money_receipt_command(),shipit.check_money_receipt_event_complete() FROM PUBLIC;

-- Freeze minimal allocation provenance only for newly issued receipt-backed entries.
ALTER TABLE shipit.issued_receipts DROP CONSTRAINT issued_receipts_schema_version_check;
ALTER TABLE shipit.issued_receipts ADD CONSTRAINT issued_receipts_schema_version_check CHECK(schema_version IN (1,2));
CREATE FUNCTION shipit.freeze_receipt_allocation_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE evidence jsonb;
BEGIN
 IF NEW.payment_entry_id IS NOT NULL THEN
  SELECT jsonb_build_object('receipt_id',r.id,'allocation_id',a.id,'kind',a.kind,
   'receipt_occurred_at',shipit.lot_wire_time(r.occurred_at),'receipt_recorded_at',shipit.lot_wire_time(r.recorded_at)) INTO evidence
  FROM shipit.money_receipt_allocations a JOIN shipit.money_receipts r ON r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.id=a.receipt_id
  WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.booking_id=NEW.booking_id AND a.payment_entry_id=NEW.payment_entry_id;
  IF evidence IS NOT NULL THEN NEW.schema_version=2;NEW.snapshot=NEW.snapshot||jsonb_build_object('allocation_source',evidence);END IF;
 END IF;RETURN NEW;
END $fn$;
-- The original authoritative snapshot trigger runs first; issued documents stay immutable.
CREATE TRIGGER zz_receipt_allocation_source BEFORE INSERT ON shipit.issued_receipts FOR EACH ROW EXECUTE FUNCTION shipit.freeze_receipt_allocation_source();
REVOKE ALL ON FUNCTION shipit.freeze_receipt_allocation_source() FROM PUBLIC;

`);
};
