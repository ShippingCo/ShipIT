// Additive configuration boundary. No browser state, credentials or templates are seeded.
exports.up = pgm => { pgm.sql(String.raw`
CREATE TABLE shipit.whatsapp_installations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 binding_key text NOT NULL CHECK(binding_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
 waba_id text NOT NULL CHECK(waba_id ~ '^[1-9][0-9]{0,31}$'),
 phone_number_id text NOT NULL CHECK(phone_number_id ~ '^[1-9][0-9]{0,31}$'),
 credential_ref text NOT NULL CHECK(credential_ref ~ '^whatsapp:[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$' AND credential_ref NOT LIKE '%://%'),
 version integer NOT NULL CHECK(version>0), credential_revision integer NOT NULL CHECK(credential_revision>0),
 state text NOT NULL CHECK(state IN ('validated','disabled')),
 validated_at timestamptz NOT NULL CHECK(isfinite(validated_at)), command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id), UNIQUE(organization_id,franchise_id,id),
 CONSTRAINT whatsapp_phone_unique UNIQUE(phone_number_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.whatsapp_commands (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), operation text NOT NULL CHECK(operation IN ('connect','rotate','disable','sync')),
 version integer NOT NULL CHECK(version>0), result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,franchise_id,actor_id,key_hash), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE shipit.whatsapp_installations ADD CONSTRAINT whatsapp_installation_command
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.whatsapp_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION shipit.whatsapp_text_variables(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE WHEN jsonb_typeof(value)='array' THEN (SELECT coalesce(bool_and(v='{"type":"text"}'::jsonb),true) FROM jsonb_array_elements(value) v) ELSE false END
$fn$;
CREATE TABLE shipit.whatsapp_templates (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 512 AND name ~ '^[a-z][a-z0-9_]*$'), language text NOT NULL CHECK(language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
 version integer NOT NULL CHECK(version>0), credential_revision integer NOT NULL CHECK(credential_revision>0),
 provider_id text CHECK(provider_id ~ '^[1-9][0-9]{0,31}$'),
 status text NOT NULL CHECK(status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED','LIMIT_EXCEEDED','UNKNOWN','MISSING')),
 category text NOT NULL CHECK(category IN ('UTILITY','MARKETING','AUTHENTICATION','UNKNOWN')),
 supported boolean NOT NULL, shape_hash text NOT NULL CHECK(shape_hash ~ '^[a-f0-9]{64}$'),
 variables jsonb NOT NULL CHECK(jsonb_typeof(variables)='array' AND jsonb_array_length(variables)<=20),
 checked_at timestamptz NOT NULL CHECK(isfinite(checked_at)), command_id uuid NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,installation_id,name,language,version),
 UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.whatsapp_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(shipit.whatsapp_text_variables(variables)),
 CHECK((status='MISSING')=(provider_id IS NULL))
);
CREATE TRIGGER whatsapp_templates_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_templates FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER whatsapp_commands_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_commands FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_whatsapp_installation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WHATSAPP_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.credential_revision<>1 THEN RAISE EXCEPTION 'WHATSAPP_INITIAL_VERSION' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.waba_id,NEW.phone_number_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.waba_id,OLD.phone_number_id)
   OR NEW.version<>OLD.version+1 OR NEW.command_id=OLD.command_id
   OR NEW.credential_revision NOT IN (OLD.credential_revision,OLD.credential_revision+1)
   OR ((NEW.binding_key,NEW.credential_ref) IS DISTINCT FROM (OLD.binding_key,OLD.credential_ref) AND NEW.credential_revision<>OLD.credential_revision+1)
   THEN RAISE EXCEPTION 'WHATSAPP_IDENTITY_VERSION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER whatsapp_installation_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.whatsapp_installations FOR EACH ROW EXECUTE FUNCTION shipit.guard_whatsapp_installation();
CREATE FUNCTION shipit.check_whatsapp_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE i record; template_count integer;
BEGIN
 SELECT * INTO i FROM shipit.whatsapp_installations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.installation_id;
 IF i.id IS NULL OR i.command_id IS DISTINCT FROM NEW.id OR i.version IS DISTINCT FROM NEW.version
  OR (NEW.operation='connect' AND i.version<>1) OR (NEW.operation='disable' AND i.state<>'disabled')
  OR (NEW.operation IN ('connect','rotate','sync') AND i.state<>'validated')
 THEN RAISE EXCEPTION 'WHATSAPP_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO template_count FROM shipit.whatsapp_templates WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.id;
 IF template_count<>(CASE WHEN NEW.operation='sync' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'WHATSAPP_TEMPLATE_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER whatsapp_command_complete AFTER INSERT ON shipit.whatsapp_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_whatsapp_command();
CREATE FUNCTION shipit.check_whatsapp_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE c record; i record; previous_version integer;
BEGIN
 SELECT * INTO c FROM shipit.whatsapp_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id;
 IF TG_TABLE_NAME='whatsapp_installations' THEN
  IF c.id IS NULL OR c.installation_id IS DISTINCT FROM NEW.id OR c.version IS DISTINCT FROM NEW.version
  THEN RAISE EXCEPTION 'WHATSAPP_INSTALLATION_EVIDENCE' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO i FROM shipit.whatsapp_installations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.installation_id;
  SELECT coalesce(max(version),0) INTO previous_version FROM shipit.whatsapp_templates WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
   AND installation_id=NEW.installation_id AND name=NEW.name AND language=NEW.language AND version<>NEW.version;
  IF c.id IS NULL OR c.operation<>'sync' OR c.installation_id IS DISTINCT FROM NEW.installation_id OR i.command_id IS DISTINCT FROM NEW.command_id
   OR NEW.credential_revision IS DISTINCT FROM i.credential_revision OR NEW.version<>previous_version+1
  THEN RAISE EXCEPTION 'WHATSAPP_TEMPLATE_EVIDENCE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER whatsapp_installation_evidence AFTER INSERT OR UPDATE ON shipit.whatsapp_installations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_whatsapp_evidence();
CREATE CONSTRAINT TRIGGER whatsapp_template_evidence AFTER INSERT ON shipit.whatsapp_templates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_whatsapp_evidence();
REVOKE ALL ON shipit.whatsapp_installations,shipit.whatsapp_templates,shipit.whatsapp_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_whatsapp_installation(),shipit.check_whatsapp_command(),shipit.check_whatsapp_evidence() FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'whatsapp:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'whatsapp.'||operation,'whatsapp_installation',installation_id,'success',operation,correlation_id,occurred_at,NULL,NULL,version,NULL
 FROM shipit.whatsapp_commands$view$;
END $extend$;
`); };
exports.down = () => { throw new Error('Forward-only migration'); };
