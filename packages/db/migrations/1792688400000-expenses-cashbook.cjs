// Additive #140: explicit custody identity and source versions; no historical financial seed.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.cashbook_source_versions (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,franchise_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION shipit.guard_cashbook_source_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'CASHBOOK_VERSION_SERVER_OWNED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.franchise_id,NEW.version) IS DISTINCT FROM (OLD.organization_id,OLD.franchise_id,OLD.version+1)
 THEN RAISE EXCEPTION 'CASHBOOK_VERSION_INVALID' USING ERRCODE='23514'; END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER cashbook_source_version_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cashbook_source_versions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_cashbook_source_version();
CREATE FUNCTION shipit.bump_cashbook_source_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' OR TG_TABLE_SCHEMA<>'shipit' OR TG_TABLE_NAME NOT IN ('money_receipts','financial_changes','cash_location_revisions','cashbook_effects','payment_entries','cash_handovers','cash_handover_commands')
 THEN RAISE EXCEPTION 'CASHBOOK_VERSION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payment_entries' THEN
  IF EXISTS(SELECT 1 FROM shipit.payment_commands c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.command_id AND c.receipt_command_id IS NOT NULL) THEN RETURN NEW;END IF;
 END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 INSERT INTO shipit.cashbook_source_versions(organization_id,franchise_id,version) VALUES(NEW.organization_id,NEW.franchise_id,1)
 ON CONFLICT(organization_id,franchise_id) DO UPDATE SET version=shipit.cashbook_source_versions.version+1;
 RETURN NEW;
END $fn$;
-- Before existing source guards: preserve a consistent franchise-first money lock order.
CREATE TRIGGER cashbook_receipt_source_version BEFORE INSERT ON shipit.money_receipts
 FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();
CREATE TRIGGER cashbook_financial_source_version BEFORE INSERT ON shipit.financial_changes
 FOR EACH ROW WHEN(NEW.kind IN ('refund','refund_correction')) EXECUTE FUNCTION shipit.bump_cashbook_source_version();

CREATE TRIGGER cashbook_payment_source_version BEFORE INSERT ON shipit.payment_entries FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();

CREATE TABLE shipit.cash_locations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('cash','noncash')),custodian_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,account_id,id),
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,account_id,custodian_id),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK((kind='cash')=(custodian_id IS NOT NULL))
);
CREATE TABLE shipit.cash_location_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,location_id uuid NOT NULL,
 account_id uuid NOT NULL,account_revision_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name) AND name !~ '[\x01-\x1f\x7f-\x9f]'),
 active boolean NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,location_id,id),UNIQUE(organization_id,franchise_id,location_id,version),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id,location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,account_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,account_id,account_revision_id) REFERENCES shipit.receiving_account_revisions(organization_id,franchise_id,account_id,id) ON DELETE RESTRICT
);
CREATE INDEX cash_locations_owner_idx ON shipit.cash_locations(organization_id,franchise_id,custodian_id,id);
CREATE INDEX cash_location_latest_idx ON shipit.cash_location_revisions(organization_id,franchise_id,location_id,version DESC);
CREATE TRIGGER cash_location_immutable BEFORE UPDATE OR DELETE ON shipit.cash_locations
 FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_cash_location_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE location shipit.cash_locations;account shipit.receiving_account_revisions;previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_LOCATION_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_LOCATION_GENERATED_FIELDS' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASH_LOCATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_ACTOR_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO location FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.location_id FOR UPDATE;
 SELECT * INTO account FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT COALESCE(max(version),0) INTO previous FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.location_id;
 IF location.id IS NULL OR account.id IS NULL OR account.id<>NEW.account_revision_id OR ((NEW.active OR previous=0) AND NOT account.active) OR previous::bigint+1<>NEW.version::bigint
  OR ((NEW.active OR previous=0) AND (location.kind='cash') IS DISTINCT FROM (account.methods=ARRAY['cash']::text[]))
 THEN RAISE EXCEPTION 'CASH_LOCATION_SOURCE_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 IF (NEW.active OR previous=0) AND location.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=location.custodian_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_CUSTODIAN_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cash_location_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_location_revisions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_location_revision();
CREATE TRIGGER cash_location_source_version AFTER INSERT ON shipit.cash_location_revisions
 FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();
CREATE FUNCTION shipit.check_cash_location_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_REVISION_REQUIRED' USING ERRCODE='23514'; END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER cash_location_complete AFTER INSERT ON shipit.cash_locations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cash_location_complete();

-- Requests and decisions retain the exact proposal; neither records an actual money effect.
CREATE TABLE shipit.cashbook_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('expense','opening_float','owner_funds','deposit','withdrawal')),
 source_location_id uuid NOT NULL,source_revision_id uuid NOT NULL,
 target_location_id uuid,target_revision_id uuid,
 expected_source_version bigint NOT NULL CHECK(expected_source_version BETWEEN 0 AND 9007199254740991),
 correction_of uuid,amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 payment_method text CHECK(payment_method IN ('cash','upi','card','bank_transfer','other')),
 category text CHECK(category IN ('rent','utilities','supplies','transport','maintenance','other')),
 payee text CHECK(char_length(payee) BETWEEN 1 AND 120 AND payee=btrim(payee) AND payee !~ '[\x01-\x1f\x7f-\x9f]'),
 responsible_employee_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,source_location_id,source_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,target_location_id,target_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id) ON DELETE RESTRICT,
 CHECK((target_location_id IS NULL)=(target_revision_id IS NULL)),
 CHECK((kind IN ('deposit','withdrawal'))=(target_location_id IS NOT NULL)),
 CHECK(source_location_id IS DISTINCT FROM target_location_id),
 CHECK((kind='expense')=(payment_method IS NOT NULL)),CHECK((kind='expense')=(category IS NOT NULL)),CHECK((kind='expense')=(payee IS NOT NULL)),
 CHECK(correction_of IS NOT NULL OR amount_paise>0),
 FOREIGN KEY(organization_id,franchise_id,correction_of) REFERENCES shipit.cashbook_requests(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cashbook_request_decisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,request_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,request_id),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.cashbook_requests(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX cashbook_correction_predecessor_idx ON shipit.cashbook_requests(organization_id,franchise_id,correction_of) WHERE correction_of IS NOT NULL;
CREATE INDEX cashbook_request_owner_idx ON shipit.cashbook_requests(organization_id,franchise_id,actor_id,id);
CREATE FUNCTION shipit.check_cashbook_request_sources(request shipit.cashbook_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.cash_locations;target shipit.cash_locations;source_revision shipit.cash_location_revisions;
 target_revision shipit.cash_location_revisions;source_account shipit.receiving_account_revisions;target_account shipit.receiving_account_revisions;method_account shipit.receiving_account_revisions;previous shipit.cashbook_requests;
BEGIN
 IF request.correction_of IS NOT NULL THEN
  SELECT * INTO previous FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of;
  IF previous.id IS NULL OR previous.kind<>request.kind OR previous.source_location_id<>request.source_location_id OR previous.target_location_id IS DISTINCT FROM request.target_location_id OR previous.occurred_at<>request.occurred_at
  OR NOT EXISTS(SELECT 1 FROM shipit.cashbook_effects e WHERE e.organization_id=request.organization_id AND e.franchise_id=request.franchise_id AND e.request_id=previous.id)
  OR EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.request_id=c.id WHERE c.organization_id=request.organization_id AND c.franchise_id=request.franchise_id AND c.correction_of=previous.id AND c.id<>request.id)
  THEN RAISE EXCEPTION 'CASHBOOK_CORRECTION_TARGET_STALE' USING ERRCODE='23514';END IF;
 END IF;
 SELECT * INTO source FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.source_location_id;
 SELECT * INTO source_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.source_location_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO source_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=source.account_id ORDER BY version DESC LIMIT 1;
 IF source.id IS NULL OR source_revision.id IS DISTINCT FROM request.source_revision_id OR (request.correction_of IS NULL AND (NOT source_revision.active OR NOT source_account.active OR source_account.id IS DISTINCT FROM source_revision.account_revision_id))
 OR COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id),0)<>request.expected_source_version
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_SOURCE_STALE' USING ERRCODE='23514';END IF;
 IF request.correction_of IS NULL AND source.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=source.custodian_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODIAN_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO method_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=source.account_id AND id=source_revision.account_revision_id;
 IF request.kind='expense' AND ((source.kind='cash') IS DISTINCT FROM (request.payment_method='cash') OR (request.correction_of IS NULL OR previous.payment_method IS DISTINCT FROM request.payment_method) AND NOT COALESCE(request.payment_method=ANY(method_account.methods),false))
 THEN RAISE EXCEPTION 'CASHBOOK_EXPENSE_METHOD_INVALID' USING ERRCODE='23514';END IF;
 IF request.kind='opening_float' AND source.kind<>'cash' THEN RAISE EXCEPTION 'CASHBOOK_FLOAT_REQUIRES_CASH' USING ERRCODE='23514';END IF;
 IF request.target_location_id IS NOT NULL THEN
  SELECT * INTO target FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.target_location_id;
  SELECT * INTO target_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.target_location_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO target_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=target.account_id ORDER BY version DESC LIMIT 1;
  IF target.id IS NULL OR target_revision.id IS DISTINCT FROM request.target_revision_id OR (request.correction_of IS NULL AND (NOT target_revision.active OR NOT target_account.active OR target_account.id IS DISTINCT FROM target_revision.account_revision_id))
   OR (request.kind='deposit' AND (source.kind<>'cash' OR target.kind<>'noncash')) OR (request.kind='withdrawal' AND (source.kind<>'noncash' OR target.kind<>'cash'))
  THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_TARGET_STALE' USING ERRCODE='23514';END IF;
  IF request.correction_of IS NULL AND target.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=target.custodian_id)
  THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODIAN_INVALID' USING ERRCODE='23514';END IF;
 END IF;
END $fn$;
CREATE FUNCTION shipit.guard_cashbook_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=NEW.responsible_employee_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_EMPLOYEE_INVALID' USING ERRCODE='23514';END IF;
 -- Operators may propose only their own cash location; noncash choices reveal no balances.
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 AND EXISTS(SELECT 1 FROM shipit.cash_locations l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id AND l.id IN (NEW.source_location_id,NEW.target_location_id) AND l.kind='cash' AND l.custodian_id<>NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODY_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF NEW.correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND m.role='franchise_admin')
 AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.id=NEW.correction_of AND p.actor_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASHBOOK_CORRECTION_OWNER_FORBIDDEN' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cashbook_request_sources(NEW);
 IF NEW.occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_TIME_INVALID' USING ERRCODE='23514';END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cashbook_request_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cashbook_requests
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_cashbook_request();
CREATE FUNCTION shipit.guard_cashbook_request_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_DECISION_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASHBOOK_DECISION_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_DECISION_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id FOR UPDATE;
 IF request.id IS NULL OR request.actor_id=NEW.actor_id OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_DIFFERENT_ADMIN_REQUIRED' USING ERRCODE='23514';END IF;
 -- A different admin can reject a stale proposal without changing its original evidence.
 IF NEW.decision='approved' THEN PERFORM shipit.check_cashbook_request_sources(request);END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cashbook_request_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cashbook_request_decisions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_cashbook_request_decision();
REVOKE ALL ON shipit.cashbook_requests,shipit.cashbook_request_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.check_cashbook_request_sources(shipit.cashbook_requests),shipit.guard_cashbook_request(),shipit.guard_cashbook_request_decision() FROM PUBLIC;


CREATE TABLE shipit.cashbook_effects (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,request_id uuid NOT NULL,decision_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz CHECK(isfinite(recorded_at)),creation_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,request_id),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.cashbook_requests(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,decision_id) REFERENCES shipit.cashbook_request_decisions(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cashbook_effect_legs (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,effect_id uuid NOT NULL,location_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('in','out')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,franchise_id,effect_id,location_id),
 FOREIGN KEY(organization_id,franchise_id,effect_id) REFERENCES shipit.cashbook_effects(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX cashbook_effect_location_idx ON shipit.cashbook_effect_legs(organization_id,franchise_id,location_id,effect_id);

CREATE FUNCTION shipit.cashbook_intended_legs(request shipit.cashbook_requests)
RETURNS TABLE(location_id uuid,direction text,amount_paise bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE delta numeric:=request.amount_paise;previous bigint;source_direction text;
BEGIN
 IF request.correction_of IS NOT NULL THEN SELECT r.amount_paise INTO previous FROM shipit.cashbook_requests r WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.id=request.correction_of;delta:=delta-previous;END IF;
 IF delta=0 THEN RETURN;END IF;
 source_direction:=CASE WHEN (request.kind IN ('opening_float','owner_funds'))=(delta>0) THEN 'in' ELSE 'out' END;
 RETURN QUERY SELECT request.source_location_id,source_direction,abs(delta)::bigint;
 IF request.target_location_id IS NOT NULL THEN RETURN QUERY SELECT request.target_location_id,CASE WHEN source_direction='in' THEN 'out' ELSE 'in' END,abs(delta)::bigint;END IF;
END $fn$;
REVOKE ALL ON FUNCTION shipit.cashbook_intended_legs(shipit.cashbook_requests) FROM PUBLIC;

-- A request reserves sender custody. Only named-recipient acceptance produces paired money legs.
CREATE TABLE shipit.cash_handovers (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 source_location_id uuid NOT NULL,source_revision_id uuid NOT NULL,target_location_id uuid NOT NULL,target_revision_id uuid NOT NULL,
 expected_source_version bigint NOT NULL CHECK(expected_source_version BETWEEN 0 AND 9007199254740991),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),CHECK(source_location_id<>target_location_id),
 FOREIGN KEY(organization_id,franchise_id,source_location_id,source_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,target_location_id,target_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id) ON DELETE RESTRICT
);
CREATE INDEX cash_handover_source_idx ON shipit.cash_handovers(organization_id,franchise_id,source_location_id,id);
CREATE INDEX cash_handover_target_idx ON shipit.cash_handovers(organization_id,franchise_id,target_location_id,id);
CREATE TABLE shipit.cash_handover_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,handover_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 2 AND 2147483646),expected_source_version bigint NOT NULL CHECK(expected_source_version BETWEEN 0 AND 9007199254740991),
 kind text NOT NULL CHECK(kind IN ('accept','reject','cancel')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 accepted_paise bigint NOT NULL CHECK(accepted_paise BETWEEN 0 AND 9007199254740991),remaining_paise bigint NOT NULL CHECK(remaining_paise BETWEEN 0 AND 9007199254740991),ended_paise bigint NOT NULL CHECK(ended_paise BETWEEN 0 AND 9007199254740991),
 state text NOT NULL CHECK(state IN ('partially_accepted','accepted','rejected','cancelled')),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),creation_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,handover_id,version),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 CHECK((kind='accept')=(amount_paise>0)),FOREIGN KEY(organization_id,franchise_id,handover_id) REFERENCES shipit.cash_handovers(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cash_handover_legs (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,command_id uuid NOT NULL,location_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('in','out')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,franchise_id,command_id,location_id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.cash_handover_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX cash_handover_leg_location_idx ON shipit.cash_handover_legs(organization_id,franchise_id,location_id,command_id);
CREATE VIEW shipit.cash_handover_positions AS
 SELECT h.organization_id,h.franchise_id,h.id,h.source_location_id,h.target_location_id,COALESCE(c.version,1) version,
 COALESCE(c.accepted_paise,0) accepted_paise,COALESCE(c.remaining_paise,h.amount_paise) remaining_paise,COALESCE(c.ended_paise,0) ended_paise,COALESCE(c.state,'requested') state
 FROM shipit.cash_handovers h LEFT JOIN LATERAL(SELECT * FROM shipit.cash_handover_commands c WHERE c.organization_id=h.organization_id AND c.franchise_id=h.franchise_id AND c.handover_id=h.id ORDER BY version DESC LIMIT 1) c ON true;
CREATE FUNCTION shipit.check_cash_handover_sources(request shipit.cash_handovers) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE found integer;
BEGIN
 SELECT count(*) INTO found FROM shipit.cash_locations l
 JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions r WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions a WHERE a.organization_id=l.organization_id AND a.franchise_id=l.franchise_id AND a.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
 WHERE l.organization_id=request.organization_id AND l.franchise_id=request.franchise_id AND l.kind='cash' AND l.id IN(request.source_location_id,request.target_location_id)
 AND r.id=CASE WHEN l.id=request.source_location_id THEN request.source_revision_id ELSE request.target_revision_id END AND r.active AND a.active AND r.account_revision_id=a.id
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin') AND m.user_id=l.custodian_id);
 IF found<>2 THEN RAISE EXCEPTION 'CASH_HANDOVER_SOURCE_STALE' USING ERRCODE='23514';END IF;
END $fn$;
CREATE FUNCTION shipit.guard_cash_handover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE capacity record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_HANDOVER_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE) THEN RAISE EXCEPTION 'CASH_HANDOVER_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin') AND m.user_id=NEW.actor_id
 AND (m.role='franchise_admin' OR EXISTS(SELECT 1 FROM shipit.cash_locations l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id AND l.id=NEW.source_location_id AND l.custodian_id=NEW.actor_id))) THEN RAISE EXCEPTION 'CASH_HANDOVER_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id),0)<>NEW.expected_source_version OR NEW.occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'CASH_HANDOVER_VERSION_TIME_INVALID' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cash_handover_sources(NEW);
 SELECT * INTO capacity FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,NEW.source_location_id,NULL);
 IF capacity.recorded-capacity.reserved<NEW.amount_paise OR capacity.unknown_refund>0 OR abs(capacity.recorded)>9007199254740991 THEN RAISE EXCEPTION 'CASH_HANDOVER_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cash_handover_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_handovers FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_handover();
CREATE TRIGGER cash_handover_source_version AFTER INSERT ON shipit.cash_handovers FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();
CREATE FUNCTION shipit.guard_cash_handover_command() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cash_handovers;position record;capacity record;target_total numeric;source_custodian uuid;target_custodian uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.accepted_paise IS NOT NULL OR NEW.remaining_paise IS NOT NULL OR NEW.ended_paise IS NOT NULL OR NEW.state IS NOT NULL OR NEW.creation_xid<>pg_current_xact_id() THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE) THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cash_handovers WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.handover_id FOR UPDATE;
 SELECT * INTO position FROM shipit.cash_handover_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.handover_id;
 IF request.id IS NULL OR NEW.version<>position.version+1 OR position.remaining_paise=0 OR COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id),0)<>NEW.expected_source_version THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_STALE' USING ERRCODE='23514';END IF;
 SELECT custodian_id INTO source_custodian FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=request.source_location_id;
 SELECT custodian_id INTO target_custodian FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=request.target_location_id;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin') AND m.user_id=NEW.actor_id
 AND CASE WHEN NEW.kind='cancel' THEN m.role='franchise_admin' OR NEW.actor_id=source_custodian ELSE NEW.actor_id=target_custodian END) THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 NEW.accepted_paise=position.accepted_paise;NEW.ended_paise=position.ended_paise;
 IF NEW.kind='accept' THEN
  PERFORM shipit.check_cash_handover_sources(request);
  SELECT * INTO capacity FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.source_location_id,request.id);
  SELECT recorded INTO target_total FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.target_location_id,NULL);
  IF NEW.amount_paise>position.remaining_paise OR NEW.amount_paise>capacity.recorded-capacity.reserved OR capacity.unknown_refund>0 OR target_total+NEW.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
  NEW.accepted_paise=position.accepted_paise+NEW.amount_paise;NEW.remaining_paise=position.remaining_paise-NEW.amount_paise;NEW.state=CASE WHEN NEW.remaining_paise=0 THEN 'accepted' ELSE 'partially_accepted' END;
 ELSE NEW.remaining_paise=0;NEW.ended_paise=position.ended_paise+position.remaining_paise;NEW.state=CASE WHEN NEW.kind='reject' THEN 'rejected' ELSE 'cancelled' END;
 END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cash_handover_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_handover_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_handover_command();
CREATE TRIGGER cash_handover_command_source_version AFTER INSERT ON shipit.cash_handover_commands FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();
CREATE FUNCTION shipit.guard_cash_handover_leg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE command shipit.cash_handover_commands;request shipit.cash_handovers;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_LEG_IMMUTABLE' USING ERRCODE='23514';END IF;
 SELECT * INTO command FROM shipit.cash_handover_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id;
 SELECT * INTO request FROM shipit.cash_handovers WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=command.handover_id;
 IF command.id IS NULL OR command.kind<>'accept' OR command.creation_xid<>pg_current_xact_id() OR NEW.amount_paise<>command.amount_paise
 OR NOT COALESCE((NEW.location_id=request.source_location_id AND NEW.direction='out') OR (NEW.location_id=request.target_location_id AND NEW.direction='in'),false) THEN RAISE EXCEPTION 'CASH_HANDOVER_LEG_INTENT_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER cash_handover_leg_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_handover_legs FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_handover_leg();
CREATE FUNCTION shipit.check_cash_handover_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF (SELECT count(*) FROM shipit.cash_handover_legs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.id)<>(CASE WHEN NEW.kind='accept' THEN 2 ELSE 0 END) THEN RAISE EXCEPTION 'CASH_HANDOVER_LEGS_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER cash_handover_complete AFTER INSERT ON shipit.cash_handover_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cash_handover_complete();
REVOKE ALL ON shipit.cash_handovers,shipit.cash_handover_commands,shipit.cash_handover_legs,shipit.cash_handover_positions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.check_cash_handover_sources(shipit.cash_handovers),shipit.guard_cash_handover(),shipit.guard_cash_handover_command(),shipit.guard_cash_handover_leg(),shipit.check_cash_handover_complete() FROM PUBLIC;

-- Nullable additive ownership references: existing refunds remain explicitly unattributed.
ALTER TABLE shipit.financial_refund_evidence ADD COLUMN cash_location_id uuid,ADD COLUMN cash_location_revision_id uuid;
ALTER TABLE shipit.financial_refund_evidence ADD CONSTRAINT refund_cash_location_pair CHECK((cash_location_id IS NULL)=(cash_location_revision_id IS NULL)),
 ADD CONSTRAINT refund_cash_location_method CHECK(cash_location_id IS NULL OR method='cash'),
 ADD CONSTRAINT refund_cash_location_account FOREIGN KEY(organization_id,franchise_id,source_account_id,cash_location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,account_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT refund_cash_location_revision FOREIGN KEY(organization_id,franchise_id,cash_location_id,cash_location_revision_id) REFERENCES shipit.cash_location_revisions(organization_id,franchise_id,location_id,id) ON DELETE RESTRICT;
CREATE FUNCTION shipit.guard_refund_cash_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE location shipit.cash_locations;revision shipit.cash_location_revisions;
BEGIN
 IF NEW.cash_location_id IS NULL THEN RETURN NEW;END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT * INTO location FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.cash_location_id;
 SELECT * INTO revision FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.cash_location_id ORDER BY version DESC LIMIT 1;
 IF NEW.method<>'cash' OR location.id IS NULL OR location.kind<>'cash' OR location.account_id<>NEW.source_account_id OR revision.id IS DISTINCT FROM NEW.cash_location_revision_id OR NOT revision.active OR revision.account_revision_id IS DISTINCT FROM NEW.source_revision_id
 OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=location.custodian_id)
 THEN RAISE EXCEPTION 'REFUND_CASH_LOCATION_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER refund_cash_location_guard BEFORE INSERT ON shipit.financial_refund_evidence FOR EACH ROW EXECUTE FUNCTION shipit.guard_refund_cash_location();
REVOKE ALL ON FUNCTION shipit.guard_refund_cash_location() FROM PUBLIC;

-- One actual receipt, not one inflow per booking allocation. No private beneficiary/reference fields.
CREATE VIEW shipit.cashbook_source_facts AS
 SELECT r.organization_id,r.franchise_id,'receipt'::text source_kind,r.id source_id,l.id location_id,r.account_id,
 'in'::text direction,r.amount_paise,r.occurred_at,r.recorded_at,r.receiver_id actor_id,NULL::uuid request_id,NULL::uuid correction_of,
 CASE WHEN l.id IS NULL THEN 'unassigned_receipt_location'::text ELSE NULL::text END unknown_reason,r.method payment_method
 FROM shipit.money_receipts r LEFT JOIN shipit.cash_locations l ON l.organization_id=r.organization_id AND l.franchise_id=r.franchise_id AND l.account_id=r.account_id
 AND ((r.method='cash' AND l.kind='cash' AND l.custodian_id=r.initial_custodian_id) OR (r.method<>'cash' AND l.kind='noncash'))
 UNION ALL
 SELECT c.organization_id,c.franchise_id,c.kind,c.id,l.id,e.source_account_id,
 CASE WHEN c.kind='refund' THEN 'out' ELSE 'in' END,c.refund,COALESCE(e.occurred_at,c.occurred_at),c.occurred_at,c.actor_id,NULL::uuid,c.refund_correction_of,
 CASE WHEN e.id IS NULL THEN 'legacy_refund_account_unknown' WHEN e.method='cash' AND e.cash_location_id IS NULL THEN 'cash_refund_custody_unknown' WHEN l.id IS NULL THEN 'unassigned_refund_account' ELSE NULL END,e.method
 FROM shipit.financial_changes c LEFT JOIN shipit.financial_refund_evidence e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.id=CASE WHEN c.kind='refund' THEN c.id ELSE c.refund_correction_of END
 LEFT JOIN shipit.cash_locations l ON l.organization_id=e.organization_id AND l.franchise_id=e.franchise_id AND l.account_id=e.source_account_id AND ((l.kind='noncash' AND e.method<>'cash') OR (l.kind='cash' AND e.method='cash' AND l.id=e.cash_location_id))
 WHERE c.kind IN ('refund','refund_correction')
 UNION ALL
 SELECT p.organization_id,p.franchise_id,CASE WHEN p.kind='collection' THEN 'legacy_collection' ELSE 'legacy_collection_correction' END,p.id,NULL::uuid,NULL::uuid,
 CASE WHEN p.kind='collection' THEN 'in' ELSE 'out' END,p.amount_paise,p.occurred_at,cmd.committed_at,p.actor_id,NULL::uuid,p.reversal_of,'legacy_collection_custody_unknown',p.method
 FROM shipit.payment_entries p JOIN shipit.payment_commands cmd ON cmd.organization_id=p.organization_id AND cmd.franchise_id=p.franchise_id AND cmd.id=p.command_id
 WHERE cmd.receipt_command_id IS NULL AND cmd.state='committed'
 UNION ALL
 SELECT leg.organization_id,leg.franchise_id,CASE WHEN r.correction_of IS NULL THEN r.kind ELSE 'correction' END,e.id,leg.location_id,l.account_id,leg.direction,leg.amount_paise,r.occurred_at,e.recorded_at,e.actor_id,r.id,r.correction_of,NULL::text,r.payment_method
 FROM shipit.cashbook_effect_legs leg JOIN shipit.cashbook_effects e ON e.organization_id=leg.organization_id AND e.franchise_id=leg.franchise_id AND e.id=leg.effect_id
 JOIN shipit.cashbook_requests r ON r.organization_id=e.organization_id AND r.franchise_id=e.franchise_id AND r.id=e.request_id
 JOIN shipit.cash_locations l ON l.organization_id=leg.organization_id AND l.franchise_id=leg.franchise_id AND l.id=leg.location_id
 UNION ALL
 SELECT leg.organization_id,leg.franchise_id,'handover',c.id,leg.location_id,l.account_id,leg.direction,leg.amount_paise,c.recorded_at,c.recorded_at,c.actor_id,h.id,NULL::uuid,NULL::text,'cash'::text
 FROM shipit.cash_handover_legs leg JOIN shipit.cash_handover_commands c ON c.organization_id=leg.organization_id AND c.franchise_id=leg.franchise_id AND c.id=leg.command_id
 JOIN shipit.cash_handovers h ON h.organization_id=c.organization_id AND h.franchise_id=c.franchise_id AND h.id=c.handover_id
 JOIN shipit.cash_locations l ON l.organization_id=leg.organization_id AND l.franchise_id=leg.franchise_id AND l.id=leg.location_id;
CREATE FUNCTION shipit.cashbook_custody_capacity(p_org uuid,p_franchise uuid,p_location uuid,p_exclude uuid)
RETURNS TABLE(recorded numeric,reserved numeric,unknown_refund numeric)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT COALESCE((SELECT sum(CASE WHEN f.direction='in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END) FROM shipit.cashbook_source_facts f WHERE f.organization_id=p_org AND f.franchise_id=p_franchise AND f.location_id=p_location),0),
 COALESCE((SELECT sum(h.remaining_paise::numeric) FROM shipit.cash_handover_positions h WHERE h.organization_id=p_org AND h.franchise_id=p_franchise AND h.source_location_id=p_location AND h.id IS DISTINCT FROM p_exclude),0),
 COALESCE((SELECT sum(CASE WHEN f.source_kind='refund' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END) FROM shipit.cashbook_source_facts f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=p_location WHERE f.organization_id=p_org AND f.franchise_id=p_franchise AND f.location_id IS NULL AND f.source_kind IN('refund','refund_correction') AND (f.account_id IS NULL OR f.account_id=l.account_id)),0);
$fn$;
REVOKE ALL ON FUNCTION shipit.cashbook_custody_capacity(uuid,uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION shipit.guard_cashbook_effect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;approval shipit.cashbook_request_decisions;available numeric;pending numeric;target_total numeric;leg record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.creation_xid<>pg_current_xact_id() THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id FOR UPDATE;
 SELECT * INTO approval FROM shipit.cashbook_request_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.decision_id;
 IF request.id IS NULL OR approval.request_id IS DISTINCT FROM request.id OR approval.decision IS DISTINCT FROM 'approved' OR approval.actor_id=request.actor_id
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cashbook_request_sources(request);
 SELECT recorded,reserved INTO available,pending FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.source_location_id,NULL);
 IF request.correction_of IS NOT NULL THEN
  FOR leg IN SELECT * FROM shipit.cashbook_intended_legs(request) LOOP
   SELECT COALESCE(sum(CASE WHEN direction='in' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO target_total FROM shipit.cashbook_source_facts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=leg.location_id;
   target_total:=target_total+CASE WHEN leg.direction='in' THEN leg.amount_paise ELSE -leg.amount_paise END;
   IF abs(target_total)>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
  END LOOP;
 ELSIF request.kind IN ('expense','deposit','withdrawal') THEN
  IF available-pending<request.amount_paise OR (SELECT COALESCE(sum(CASE WHEN f.source_kind='refund' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END),0) FROM shipit.cashbook_source_facts f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=request.source_location_id
   WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.location_id IS NULL AND f.source_kind IN ('refund','refund_correction') AND (f.account_id IS NULL OR f.account_id=l.account_id))>0
  THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  IF available+request.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF request.correction_of IS NULL AND request.target_location_id IS NOT NULL THEN
  SELECT COALESCE(sum(CASE WHEN direction='in' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO target_total FROM shipit.cashbook_source_facts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=request.target_location_id;
  IF target_total+request.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER cashbook_effect_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cashbook_effects FOR EACH ROW EXECUTE FUNCTION shipit.guard_cashbook_effect();
CREATE TRIGGER cashbook_effect_source_version AFTER INSERT ON shipit.cashbook_effects FOR EACH ROW EXECUTE FUNCTION shipit.bump_cashbook_source_version();
CREATE FUNCTION shipit.guard_cashbook_effect_leg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;effect shipit.cashbook_effects;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_LEG_IMMUTABLE' USING ERRCODE='23514';END IF;
 SELECT * INTO effect FROM shipit.cashbook_effects WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.effect_id;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=effect.request_id;
 IF effect.id IS NULL OR effect.creation_xid<>pg_current_xact_id() OR NOT EXISTS(SELECT 1 FROM shipit.cashbook_intended_legs(request) l WHERE l.location_id=NEW.location_id AND l.direction=NEW.direction AND l.amount_paise=NEW.amount_paise)
 THEN RAISE EXCEPTION 'CASHBOOK_LEG_INTENT_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER cashbook_effect_leg_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cashbook_effect_legs FOR EACH ROW EXECUTE FUNCTION shipit.guard_cashbook_effect_leg();
CREATE FUNCTION shipit.check_cashbook_effect_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;legs integer;
BEGIN
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id;
 SELECT count(*) INTO legs FROM shipit.cashbook_effect_legs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND effect_id=NEW.id;
 IF legs<>(SELECT count(*) FROM shipit.cashbook_intended_legs(request)) THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_LEGS_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER cashbook_effect_complete AFTER INSERT ON shipit.cashbook_effects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cashbook_effect_complete();
REVOKE ALL ON shipit.cashbook_effects,shipit.cashbook_effect_legs,shipit.cashbook_source_facts FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_cashbook_effect(),shipit.guard_cashbook_effect_leg(),shipit.check_cashbook_effect_complete() FROM PUBLIC;

REVOKE ALL ON shipit.cashbook_source_versions,shipit.cash_locations,shipit.cash_location_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_cashbook_source_version(),shipit.bump_cashbook_source_version(),
 shipit.guard_cash_location_revision(),shipit.check_cash_location_complete() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only financial migration; disable writes or repair forward.');};
