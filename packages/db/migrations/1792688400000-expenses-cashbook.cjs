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
 IF TG_OP<>'INSERT' OR TG_TABLE_SCHEMA<>'shipit' OR TG_TABLE_NAME NOT IN ('money_receipts','financial_changes','cash_location_revisions')
 THEN RAISE EXCEPTION 'CASHBOOK_VERSION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
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
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
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
 CHECK((kind='expense')=(category IS NOT NULL)),CHECK((kind='expense')=(payee IS NOT NULL))
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
CREATE INDEX cashbook_request_owner_idx ON shipit.cashbook_requests(organization_id,franchise_id,actor_id,id);
CREATE FUNCTION shipit.check_cashbook_request_sources(request shipit.cashbook_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.cash_locations;target shipit.cash_locations;source_revision shipit.cash_location_revisions;
 target_revision shipit.cash_location_revisions;source_account shipit.receiving_account_revisions;target_account shipit.receiving_account_revisions;
BEGIN
 SELECT * INTO source FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.source_location_id;
 SELECT * INTO source_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.source_location_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO source_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=source.account_id ORDER BY version DESC LIMIT 1;
 IF source.id IS NULL OR source_revision.id IS DISTINCT FROM request.source_revision_id OR NOT source_revision.active OR NOT source_account.active OR source_account.id IS DISTINCT FROM source_revision.account_revision_id
 OR COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id),0)<>request.expected_source_version
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_SOURCE_STALE' USING ERRCODE='23514';END IF;
 IF source.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=source.custodian_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODIAN_INVALID' USING ERRCODE='23514';END IF;
 IF request.kind='opening_float' AND source.kind<>'cash' THEN RAISE EXCEPTION 'CASHBOOK_FLOAT_REQUIRES_CASH' USING ERRCODE='23514';END IF;
 IF request.target_location_id IS NOT NULL THEN
  SELECT * INTO target FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.target_location_id;
  SELECT * INTO target_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.target_location_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO target_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=target.account_id ORDER BY version DESC LIMIT 1;
  IF target.id IS NULL OR target_revision.id IS DISTINCT FROM request.target_revision_id OR NOT target_revision.active OR NOT target_account.active OR target_account.id IS DISTINCT FROM target_revision.account_revision_id
   OR (request.kind='deposit' AND (source.kind<>'cash' OR target.kind<>'noncash')) OR (request.kind='withdrawal' AND (source.kind<>'noncash' OR target.kind<>'cash'))
  THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_TARGET_STALE' USING ERRCODE='23514';END IF;
  IF target.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
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

REVOKE ALL ON shipit.cashbook_source_versions,shipit.cash_locations,shipit.cash_location_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_cashbook_source_version(),shipit.bump_cashbook_source_version(),
 shipit.guard_cash_location_revision(),shipit.check_cash_location_complete() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only financial migration; disable writes or repair forward.');};
