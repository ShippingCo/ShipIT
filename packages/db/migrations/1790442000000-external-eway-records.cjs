// Additive Issue #32. No historical values, legal presets or browser data are backfilled.
exports.up = pgm => {
 pgm.sql(String.raw`
CREATE TABLE shipit.eway_policies (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), approved boolean NOT NULL,
 effective_from timestamptz NOT NULL CHECK(isfinite(effective_from)),
 recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK(isfinite(recorded_at)),
 source_ref text NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 128 AND source_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 approval_ref text NOT NULL CHECK(length(approval_ref) BETWEEN 1 AND 128 AND approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 threshold_paise bigint CHECK(threshold_paise BETWEEN 0 AND 9007199254740991),
 warning_seconds integer CHECK(warning_seconds BETWEEN 0 AND 2592000),
 estimate_rule text CHECK(estimate_rule='distance_blocks_v1'),block_km integer CHECK(block_km BETWEEN 1 AND 100000),
 block_seconds integer CHECK(block_seconds BETWEEN 1 AND 2592000),
 CHECK((estimate_rule IS NULL AND block_km IS NULL AND block_seconds IS NULL) OR (estimate_rule IS NOT NULL AND block_km IS NOT NULL AND block_seconds IS NOT NULL)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,version),UNIQUE(organization_id,franchise_id,effective_from),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX eway_policy_effective_idx ON shipit.eway_policies(organization_id,franchise_id,effective_from DESC);
CREATE FUNCTION shipit.guard_eway_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'EWAY_POLICY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=CURRENT_TIMESTAMP;
 IF NEW.effective_from<NEW.recorded_at THEN RAISE EXCEPTION 'EWAY_POLICY_BACKDATED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM shipit.eway_policies WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
  AND (version>=NEW.version OR effective_from>=NEW.effective_from)) THEN RAISE EXCEPTION 'EWAY_POLICY_ORDER' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER eway_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.eway_policies FOR EACH ROW EXECUTE FUNCTION shipit.guard_eway_policy();
CREATE TABLE shipit.eway_records (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 declared_goods_value_paise bigint CHECK(declared_goods_value_paise BETWEEN 0 AND 9007199254740991),
 declaration_source_ref text CHECK(length(declaration_source_ref) BETWEEN 1 AND 128 AND declaration_source_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 issuer text CHECK(length(issuer) BETWEEN 1 AND 64 AND issuer ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 external_reference text CHECK(length(external_reference) BETWEEN 1 AND 128 AND external_reference ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 source_ref text CHECK(length(source_ref) BETWEEN 1 AND 128 AND source_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 source_issued_at timestamptz CHECK(isfinite(source_issued_at)),official_valid_until timestamptz CHECK(isfinite(official_valid_until)),
 validity_evidence_ref text CHECK(length(validity_evidence_ref) BETWEEN 1 AND 128 AND validity_evidence_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 vehicle_number text CHECK(length(vehicle_number) BETWEEN 1 AND 32 AND vehicle_number ~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'),
 distance_km integer CHECK(distance_km BETWEEN 1 AND 100000),estimate jsonb,estimate_policy_id uuid,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 captured_at timestamptz NOT NULL CHECK(isfinite(captured_at)),
 reason_code text NOT NULL CHECK(reason_code IN ('initial_capture','metadata_correction','source_extension','declaration_correction','estimate_recalculation')),
 reason_ref text CHECK(length(reason_ref) BETWEEN 1 AND 128 AND reason_ref ~ '^[A-Za-z0-9][A-Za-z0-9.:_/-]*$'),
 command_id uuid NOT NULL UNIQUE,correlation_id uuid NOT NULL,
 CHECK((declared_goods_value_paise IS NULL)=(declaration_source_ref IS NULL)),
 CHECK((external_reference IS NULL)=(issuer IS NULL)),
 CHECK(external_reference IS NOT NULL OR (source_ref IS NULL AND source_issued_at IS NULL AND official_valid_until IS NULL AND validity_evidence_ref IS NULL)),
 CHECK((official_valid_until IS NULL)=(validity_evidence_ref IS NULL)),
 CHECK(official_valid_until IS NULL OR source_ref IS NOT NULL),
 CHECK(source_issued_at IS NULL OR official_valid_until IS NULL OR official_valid_until>source_issued_at),
 CHECK((reason_code='initial_capture' AND version=1 AND reason_ref IS NULL) OR (reason_code<>'initial_capture' AND version>1 AND reason_ref IS NOT NULL)),
 CHECK((estimate IS NULL)=(estimate_policy_id IS NULL)),
 CHECK(estimate IS NULL OR (jsonb_typeof(estimate)='object' AND octet_length(estimate::text)<2048)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,booking_id),
 UNIQUE(organization_id,franchise_id,booking_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,estimate_policy_id) REFERENCES shipit.eway_policies(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX eway_record_expiry_idx ON shipit.eway_records(organization_id,franchise_id,official_valid_until,booking_id);
CREATE TABLE shipit.eway_record_revisions (LIKE shipit.eway_records INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
 PRIMARY KEY(id,version),UNIQUE(command_id),UNIQUE(organization_id,franchise_id,booking_id,id,version),
 FOREIGN KEY(organization_id,franchise_id,booking_id,id) REFERENCES shipit.eway_records(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT);
CREATE INDEX eway_revision_owner_idx ON shipit.eway_record_revisions(organization_id,franchise_id,booking_id,version);
CREATE TABLE shipit.eway_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,record_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('create','correct','estimate')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 normalization_version integer NOT NULL DEFAULT 1 CHECK(normalization_version=1),
 committed_at timestamptz NOT NULL CHECK(isfinite(committed_at)),retain_until timestamptz NOT NULL CHECK(isfinite(retain_until) AND retain_until>=committed_at+interval '24 hours'),
 UNIQUE(organization_id,franchise_id,principal_id,operation,key_digest),
 UNIQUE(organization_id,franchise_id,booking_id,record_id,version,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,record_id,version) REFERENCES shipit.eway_record_revisions(organization_id,franchise_id,booking_id,id,version) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE shipit.eway_records ADD CONSTRAINT eway_current_command FOREIGN KEY(organization_id,franchise_id,booking_id,id,version,command_id)
 REFERENCES shipit.eway_commands(organization_id,franchise_id,booking_id,record_id,version,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE shipit.eway_record_revisions ADD CONSTRAINT eway_revision_command FOREIGN KEY(organization_id,franchise_id,booking_id,id,version,command_id)
 REFERENCES shipit.eway_commands(organization_id,franchise_id,booking_id,record_id,version,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER eway_revisions_immutable BEFORE UPDATE OR DELETE ON shipit.eway_record_revisions FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER eway_commands_immutable BEFORE UPDATE OR DELETE ON shipit.eway_commands FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_eway_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE p record;start_at timestamptz;until_at timestamptz;blocks bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EWAY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.estimate IS NOT NULL THEN RAISE EXCEPTION 'EWAY_INITIAL_VERSION' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.booking_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.booking_id)
   OR NEW.version<>OLD.version+1 OR NEW.captured_at<OLD.captured_at THEN RAISE EXCEPTION 'EWAY_IDENTITY_VERSION' USING ERRCODE='23514'; END IF;
  IF NEW.reason_code='estimate_recalculation' THEN
   IF (NEW.declared_goods_value_paise,NEW.declaration_source_ref,NEW.issuer,NEW.external_reference,NEW.source_ref,NEW.source_issued_at,NEW.official_valid_until,NEW.validity_evidence_ref,NEW.vehicle_number,NEW.distance_km)
    IS DISTINCT FROM (OLD.declared_goods_value_paise,OLD.declaration_source_ref,OLD.issuer,OLD.external_reference,OLD.source_ref,OLD.source_issued_at,OLD.official_valid_until,OLD.validity_evidence_ref,OLD.vehicle_number,OLD.distance_km)
   THEN RAISE EXCEPTION 'EWAY_ESTIMATE_SEPARATION' USING ERRCODE='23514'; END IF;
  ELSIF (NEW.estimate,NEW.estimate_policy_id) IS DISTINCT FROM (OLD.estimate,OLD.estimate_policy_id) THEN RAISE EXCEPTION 'EWAY_ESTIMATE_EXPLICIT' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reason_code='estimate_recalculation' THEN
  SELECT * INTO p FROM shipit.eway_policies WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND effective_from<=NEW.captured_at ORDER BY effective_from DESC LIMIT 1;
  IF p.id IS DISTINCT FROM NEW.estimate_policy_id OR NOT p.approved OR p.estimate_rule IS DISTINCT FROM 'distance_blocks_v1' OR NEW.distance_km IS NULL THEN RAISE EXCEPTION 'EWAY_ESTIMATE_POLICY' USING ERRCODE='23514'; END IF;
  start_at=(NEW.estimate->'estimate_inputs'->>'starts_at')::timestamptz;
  blocks=ceil(NEW.distance_km::numeric/p.block_km)::bigint;until_at=start_at+make_interval(secs=>blocks*p.block_seconds);
  IF start_at IS NULL OR NOT isfinite(start_at) OR NOT isfinite(until_at) OR (NEW.estimate->>'estimated_valid_until')::timestamptz IS DISTINCT FROM until_at
   OR (NEW.estimate->>'estimate_calculated_at')::timestamptz IS DISTINCT FROM NEW.captured_at
   OR NEW.estimate IS DISTINCT FROM jsonb_build_object('estimated_valid_until',NEW.estimate->>'estimated_valid_until','estimate_policy_id',p.id,'estimate_policy_version',p.version,
    'estimate_inputs',jsonb_build_object('distance_km',NEW.distance_km,'starts_at',NEW.estimate->'estimate_inputs'->>'starts_at','block_km',p.block_km,'block_seconds',p.block_seconds),
    'estimate_calculated_at',NEW.estimate->>'estimate_calculated_at','provenance','shippingco_estimate','label','ShippingCo estimate — verify on the government portal')
   THEN RAISE EXCEPTION 'EWAY_ESTIMATE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER eway_record_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.eway_records FOR EACH ROW EXECUTE FUNCTION shipit.guard_eway_record();
CREATE FUNCTION shipit.capture_eway_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.eway_record_revisions SELECT NEW.*;
 RETURN NEW;
END $fn$;
CREATE TRIGGER eway_revision_capture AFTER INSERT OR UPDATE ON shipit.eway_records FOR EACH ROW EXECUTE FUNCTION shipit.capture_eway_revision();
CREATE FUNCTION shipit.check_eway_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.eway_record_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id
  AND r.booking_id=NEW.booking_id AND r.id=NEW.record_id AND r.version=NEW.version AND r.command_id=NEW.id AND r.actor_id=NEW.principal_id
  AND r.captured_at=NEW.committed_at AND ((NEW.operation='create' AND r.reason_code='initial_capture') OR
   (NEW.operation='correct' AND r.reason_code IN ('metadata_correction','source_extension','declaration_correction')) OR
   (NEW.operation='estimate' AND r.reason_code='estimate_recalculation')))
 THEN RAISE EXCEPTION 'EWAY_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER eway_command_complete AFTER INSERT ON shipit.eway_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_eway_command();
REVOKE ALL ON shipit.eway_records,shipit.eway_record_revisions,shipit.eway_commands,shipit.eway_policies FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_eway_policy(),shipit.guard_eway_record(),shipit.capture_eway_revision(),shipit.check_eway_command() FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'eway:'||command_id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 CASE WHEN version=1 THEN 'eway.created' ELSE 'eway.corrected' END,'eway',id,'success',reason_code,correlation_id,captured_at,NULL,NULL,version,NULL
 FROM shipit.eway_record_revisions$view$;
END $extend$;
`);
};
exports.down = () => { throw new Error('Forward-only migration'); };
