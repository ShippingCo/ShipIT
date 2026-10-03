exports.up = pgm => pgm.sql(String.raw`
CREATE TABLE shipit.carrier_import_runs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('shipments','tracking')), file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 200 AND octet_length(rows::text)<=524288),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 UNIQUE(organization_id,franchise_id,id), UNIQUE(organization_id,franchise_id,id,installation_id,kind),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_import_commits (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, run_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,run_id) REFERENCES shipit.carrier_import_runs(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_import_outcomes (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, run_id uuid NOT NULL, installation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('shipments','tracking')), row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 201),
 identity text NOT NULL CHECK(identity ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('applied','duplicate','conflicted')),
 error text CHECK(error IN ('REFERENCE_NOT_FOUND','STALE_STATE','SOURCE_CONFLICT')),
 resource_id uuid, command_id uuid UNIQUE, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), PRIMARY KEY(run_id,row_number),
 CHECK((state='conflicted' AND error IS NOT NULL AND resource_id IS NULL AND command_id IS NULL)
 OR (state='applied' AND error IS NULL AND resource_id IS NOT NULL AND command_id IS NOT NULL)
 OR (state='duplicate' AND error IS NULL AND resource_id IS NOT NULL AND command_id IS NULL)),
 FOREIGN KEY(organization_id,franchise_id,run_id,installation_id,kind) REFERENCES shipit.carrier_import_runs(organization_id,franchise_id,id,installation_id,kind),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.carrier_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX carrier_import_source ON shipit.carrier_import_outcomes(installation_id,kind,identity) WHERE state='applied';
CREATE INDEX carrier_import_outcome_owner ON shipit.carrier_import_outcomes(organization_id,franchise_id,run_id,row_number);
CREATE INDEX carrier_import_run_owner ON shipit.carrier_import_runs(organization_id,franchise_id,installation_id,id);

ALTER TABLE shipit.carrier_commands DROP CONSTRAINT carrier_commands_reason_code_check;
ALTER TABLE shipit.carrier_commands ADD CONSTRAINT carrier_commands_reason_code_check
 CHECK(reason_code IN ('manual_setup','initial_mapping','mapping_correction','reference_correction','manual_observation','file_reference','file_observation'));
CREATE OR REPLACE FUNCTION shipit.check_carrier_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
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
  AND (x.evidence->'provenance'=jsonb_build_object('mode','manual','actorId',NEW.actor_id,'commandId',NEW.id)
   OR (NEW.reason_code='file_observation' AND EXISTS(SELECT 1 FROM shipit.carrier_import_outcomes o
    JOIN shipit.carrier_import_runs r ON r.organization_id=o.organization_id AND r.franchise_id=o.franchise_id AND r.id=o.run_id
    WHERE o.organization_id=NEW.organization_id AND o.franchise_id=NEW.franchise_id AND o.command_id=NEW.id AND o.resource_id=x.id
    AND o.state='applied' AND o.kind='tracking' AND o.actor_id=NEW.actor_id
    AND x.evidence->'provenance'=jsonb_build_object('mode','file','importId',r.id,'fileSha256',r.file_sha256,'row',o.row_number))))) INTO valid;
 ELSE valid=false; END CASE;
 IF NOT valid THEN RAISE EXCEPTION 'CARRIER_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF NEW.reason_code IN ('file_reference','file_observation') AND NOT EXISTS(
  SELECT 1 FROM shipit.carrier_import_outcomes o WHERE o.organization_id=NEW.organization_id AND o.franchise_id=NEW.franchise_id
  AND o.command_id=NEW.id AND o.resource_id=NEW.resource_id AND o.actor_id=NEW.actor_id AND o.state='applied') THEN
  RAISE EXCEPTION 'IMPORT_OUTCOME_MISSING' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE FUNCTION shipit.check_carrier_import_outcome() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE candidate jsonb; valid boolean; BEGIN
 SELECT r.rows->(NEW.row_number-2) INTO candidate FROM shipit.carrier_import_runs r
 WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=NEW.run_id;
 IF candidate IS NULL OR candidate->>'error' IS NOT NULL OR candidate->>'identity' IS DISTINCT FROM NEW.identity
  OR candidate->>'fingerprint' IS DISTINCT FROM NEW.fingerprint THEN RAISE EXCEPTION 'IMPORT_ROW_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.state='applied' THEN
  SELECT EXISTS(SELECT 1 FROM shipit.carrier_commands c WHERE c.id=NEW.command_id AND c.organization_id=NEW.organization_id
   AND c.franchise_id=NEW.franchise_id AND c.resource_id=NEW.resource_id AND c.actor_id=NEW.actor_id
   AND c.fingerprint=NEW.fingerprint AND c.reason_code=CASE NEW.kind WHEN 'shipments' THEN 'file_reference' ELSE 'file_observation' END) INTO valid;
  IF NOT valid THEN RAISE EXCEPTION 'IMPORT_EFFECT_MISSING' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state='duplicate' THEN
  SELECT EXISTS(SELECT 1 FROM shipit.carrier_import_outcomes o WHERE o.installation_id=NEW.installation_id AND o.kind=NEW.kind
   AND o.identity=NEW.identity AND o.fingerprint=NEW.fingerprint AND o.resource_id=NEW.resource_id AND o.state='applied') INTO valid;
  IF NOT valid THEN RAISE EXCEPTION 'IMPORT_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER carrier_import_outcome_complete AFTER INSERT ON shipit.carrier_import_outcomes DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION shipit.check_carrier_import_outcome();
DO $guard$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['carrier_import_runs','carrier_import_commits','carrier_import_outcomes'] LOOP
  EXECUTE format('CREATE TRIGGER carrier_immutable BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only()',name);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',name);
 END LOOP;
END $guard$;
REVOKE ALL ON FUNCTION shipit.check_carrier_import_outcome() FROM PUBLIC;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'carrier-import:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.import.preview','carrier',id,'success','import_preview',correlation_id,created_at,NULL,NULL,1,NULL FROM shipit.carrier_import_runs
 UNION ALL SELECT 'carrier-import-commit:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.import.commit','carrier',run_id,'success','import_selected',correlation_id,created_at,NULL,NULL,1,NULL FROM shipit.carrier_import_commits
 UNION ALL SELECT 'carrier-import-row:'||run_id::text||':'||row_number::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.import.row','carrier',run_id,CASE WHEN state='conflicted' THEN 'denied' ELSE 'success' END,
 'import_'||state,correlation_id,created_at,NULL,NULL,1,NULL FROM shipit.carrier_import_outcomes$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
