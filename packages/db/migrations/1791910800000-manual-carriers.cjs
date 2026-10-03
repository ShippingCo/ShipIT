// Additive evidence store. No legacy carrier strings are inferred or backfilled.
exports.up = pgm => pgm.sql(String.raw`
CREATE TABLE shipit.carrier_commands (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), operation text NOT NULL
 CHECK(operation IN ('installation','mapping','reference','observation')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 resource_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), reason_code text NOT NULL
 CHECK(reason_code IN ('manual_setup','initial_mapping','mapping_correction','reference_correction','manual_observation')),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'), correlation_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.carrier_installations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 courier_id uuid NOT NULL, label text NOT NULL CHECK(length(label) BETWEEN 1 AND 128),
 revision integer NOT NULL DEFAULT 1 CHECK(revision=1), command_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.carrier_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX carrier_installation_courier ON shipit.carrier_installations(organization_id,franchise_id,courier_id);
CREATE TABLE shipit.carrier_mappings (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('service','location')), source_code text NOT NULL CHECK(length(source_code) BETWEEN 1 AND 128),
 normalized_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), command_id uuid NOT NULL UNIQUE,
 UNIQUE(installation_id,kind,source_code,version), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.carrier_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX carrier_mapping_target ON shipit.carrier_mappings(organization_id,franchise_id,installation_id,kind,normalized_id);
-- Historical claims remain reserved: a correction must never redirect old evidence to a different parcel.
CREATE TABLE shipit.carrier_dockets (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 external_docket text NOT NULL CHECK(length(external_docket) BETWEEN 1 AND 128), parcel_id uuid NOT NULL,
 PRIMARY KEY(installation_id,external_docket), UNIQUE(organization_id,franchise_id,installation_id,external_docket,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_references (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 parcel_id uuid NOT NULL, external_docket text NOT NULL, version integer NOT NULL CHECK(version>0),
 dimensions jsonb NOT NULL CHECK(jsonb_typeof(dimensions)='object'), command_id uuid NOT NULL UNIQUE,
 UNIQUE(installation_id,parcel_id,version), UNIQUE(organization_id,franchise_id,parcel_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id,external_docket,parcel_id)
 REFERENCES shipit.carrier_dockets(organization_id,franchise_id,installation_id,external_docket,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.carrier_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX carrier_reference_parcel ON shipit.carrier_references(organization_id,franchise_id,parcel_id,id);
CREATE TABLE shipit.carrier_observations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, parcel_id uuid NOT NULL,
 reference_id uuid NOT NULL, parcel_version integer NOT NULL CHECK(parcel_version>0),
 status_code text NOT NULL CHECK(length(status_code) BETWEEN 1 AND 128),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 review_state text NOT NULL DEFAULT 'pending_review' CHECK(review_state='pending_review'),
 command_id uuid NOT NULL, received_at timestamptz NOT NULL CHECK(isfinite(received_at)),
 UNIQUE(organization_id,franchise_id,id), UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id,reference_id) REFERENCES shipit.carrier_references(organization_id,franchise_id,parcel_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.carrier_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX carrier_observation_parcel ON shipit.carrier_observations(organization_id,franchise_id,parcel_id,id);
CREATE FUNCTION shipit.check_carrier_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE valid boolean; BEGIN
 IF NEW.result <> jsonb_build_object('id',NEW.resource_id,'version',NEW.version) THEN
  RAISE EXCEPTION 'CARRIER_COMMAND_RESULT' USING ERRCODE='23514'; END IF;
 CASE NEW.operation
 WHEN 'installation' THEN SELECT EXISTS(SELECT 1 FROM shipit.carrier_installations x WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id
  AND x.id=NEW.resource_id AND x.command_id=NEW.id AND x.revision=NEW.version AND x.created_at=NEW.occurred_at) INTO valid;
 WHEN 'mapping' THEN SELECT EXISTS(SELECT 1 FROM shipit.carrier_mappings x WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id
  AND x.id=NEW.resource_id AND x.command_id=NEW.id AND x.version=NEW.version) INTO valid;
 WHEN 'reference' THEN SELECT EXISTS(SELECT 1 FROM shipit.carrier_references x WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id
  AND x.id=NEW.resource_id AND x.command_id=NEW.id AND x.version=NEW.version) INTO valid;
 WHEN 'observation' THEN SELECT EXISTS(SELECT 1 FROM shipit.carrier_observations x WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id
  AND x.id=NEW.resource_id AND x.command_id=NEW.id AND NEW.version=1 AND x.received_at=NEW.occurred_at
  AND x.evidence->'provenance'=jsonb_build_object('mode','manual','actorId',NEW.actor_id,'commandId',NEW.id)) INTO valid;
 ELSE valid=false; END CASE;
 IF NOT valid THEN RAISE EXCEPTION 'CARRIER_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER carrier_command_complete AFTER INSERT ON shipit.carrier_commands DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION shipit.check_carrier_command();
CREATE FUNCTION shipit.carrier_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'CARRIER_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END $fn$;
DO $guard$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['carrier_commands','carrier_installations','carrier_mappings','carrier_dockets','carrier_references','carrier_observations'] LOOP
  EXECUTE format('CREATE TRIGGER carrier_immutable BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only()',name);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',name);
 END LOOP;
END $guard$;
REVOKE ALL ON FUNCTION shipit.carrier_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.check_carrier_command() FROM PUBLIC;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'carrier:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.'||operation,'carrier',resource_id,'success',reason_code,correlation_id,occurred_at,NULL,NULL,version,NULL
 FROM shipit.carrier_commands$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
