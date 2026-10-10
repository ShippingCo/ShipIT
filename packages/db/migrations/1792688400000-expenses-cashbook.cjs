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
REVOKE ALL ON shipit.cashbook_source_versions,shipit.cash_locations,shipit.cash_location_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_cashbook_source_version(),shipit.bump_cashbook_source_version(),
 shipit.guard_cash_location_revision(),shipit.check_cash_location_complete() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only financial migration; disable writes or repair forward.');};
