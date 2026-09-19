// Forward-only Issue #31: private metadata, durable replay and bounded cleanup.
exports.up = pgm => {
 pgm.sql(String.raw`
CREATE TABLE shipit.attachments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid,
 purpose text NOT NULL CHECK(purpose IN ('shipment_evidence','parcel_proof')),
 kind text NOT NULL CHECK(kind IN ('image','audio','video')),
 object_key text NOT NULL UNIQUE CHECK(object_key ~ '^evidence/[a-f0-9-]{36}$'),
 declared_size integer NOT NULL CHECK(declared_size BETWEEN 1 AND 8388608),
 declared_type text NOT NULL CHECK(declared_type IN ('image/jpeg','image/png','audio/mpeg','audio/wav','video/mp4')),
 expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'),
 actual_size integer CHECK(actual_size BETWEEN 1 AND 8388608),detected_type text,digest text CHECK(digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending_upload' CHECK(state IN ('pending_upload','quarantined','ready','canceled','rejected','cleanup_pending','deleted')),
 scan_state text NOT NULL DEFAULT 'pending' CHECK(scan_state IN ('pending','clean','infected','error')),
 retention_class text NOT NULL CHECK(retention_class IN ('operational_evidence','delivery_proof')),
 initiated_actor uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 actor_type text NOT NULL CHECK(actor_type IN ('user','service')),actor_id text NOT NULL,correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL,upload_expires_at timestamptz NOT NULL,
 uploaded_at timestamptz,validated_at timestamptz,linked_at timestamptz,cleanup_due_at timestamptz,
 deleted_at timestamptz,upload_lease_until timestamptz,upload_attempt uuid,
 cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,booking_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 CHECK((purpose='parcel_proof' AND parcel_id IS NOT NULL AND retention_class='delivery_proof') OR (purpose='shipment_evidence' AND retention_class='operational_evidence')),
 CHECK((kind='image' AND declared_type IN ('image/jpeg','image/png')) OR (kind='audio' AND declared_type IN ('audio/mpeg','audio/wav')) OR (kind='video' AND declared_type='video/mp4')),
 CHECK(isfinite(created_at) AND upload_expires_at=created_at+interval '15 minutes'),
 CHECK(state<>'ready' OR ((scan_state='clean' AND actual_size=declared_size AND digest=expected_digest AND detected_type=declared_type AND linked_at IS NOT NULL AND validated_at IS NOT NULL AND uploaded_at IS NOT NULL) IS TRUE)),
 CHECK(state='ready' OR linked_at IS NULL),CHECK((state='deleted')=(deleted_at IS NOT NULL)),
 CHECK(state IN ('ready','deleted') OR cleanup_due_at IS NOT NULL),
 CHECK((upload_attempt IS NULL)=(upload_lease_until IS NULL))
);
CREATE INDEX attachments_parent_idx ON shipit.attachments(organization_id,franchise_id,booking_id,created_at,id);
CREATE INDEX attachments_cleanup_idx ON shipit.attachments(cleanup_due_at,organization_id,franchise_id) WHERE state NOT IN ('ready','deleted');
CREATE TABLE shipit.attachment_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,attachment_id uuid NOT NULL,
 principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('initiate','finalize','cancel','grant')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<4096),created_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,principal_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id,booking_id,attachment_id) REFERENCES shipit.attachments(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.attachment_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,attachment_id uuid NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN ('user','service')),actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('attachments.initiated','attachments.upload','attachments.quarantined','attachments.ready','attachments.scan_error','attachments.rejected','attachments.canceled','attachments.cleanup_pending','attachments.deleted','attachments.grant')),
 state text NOT NULL,version integer NOT NULL,correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,booking_id,attachment_id) REFERENCES shipit.attachments(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON shipit.attachments,shipit.attachment_commands,shipit.attachment_audit_events FROM PUBLIC;
CREATE INDEX attachment_audit_owner_idx ON shipit.attachment_audit_events(organization_id,franchise_id,attachment_id);
CREATE TRIGGER attachment_commands_immutable BEFORE UPDATE OR DELETE ON shipit.attachment_commands FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER attachment_audit_immutable BEFORE UPDATE OR DELETE ON shipit.attachment_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_attachment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE n integer;bytes bigint;pending integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ATTACHMENT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id FOR UPDATE;
  SELECT count(*),coalesce(sum(declared_size),0),count(*) FILTER(WHERE state<>'ready') INTO n,bytes,pending FROM shipit.attachments
   WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND state<>'deleted';
  IF n>=10 OR bytes+NEW.declared_size>33554432 OR pending>=3 THEN RAISE EXCEPTION 'ATTACHMENT_QUOTA' USING ERRCODE='23514'; END IF;
  IF NEW.version<>1 OR NEW.state<>'pending_upload' OR NEW.scan_state<>'pending' OR NEW.actual_size IS NOT NULL OR NEW.digest IS NOT NULL THEN RAISE EXCEPTION 'ATTACHMENT_INITIAL_STATE' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.parcel_id,NEW.purpose,NEW.kind,NEW.object_key,NEW.declared_size,NEW.declared_type,NEW.expected_digest,NEW.retention_class,NEW.initiated_actor,NEW.created_at,NEW.upload_expires_at)
   IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.booking_id,OLD.parcel_id,OLD.purpose,OLD.kind,OLD.object_key,OLD.declared_size,OLD.declared_type,OLD.expected_digest,OLD.retention_class,OLD.initiated_actor,OLD.created_at,OLD.upload_expires_at)
  THEN RAISE EXCEPTION 'ATTACHMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 OR OLD.state IN ('ready','deleted') OR NOT (
   (OLD.state='pending_upload' AND NEW.state IN ('pending_upload','quarantined','canceled','rejected','cleanup_pending')) OR
   (OLD.state='quarantined' AND NEW.state IN ('quarantined','ready','canceled','rejected','cleanup_pending')) OR
   (OLD.state IN ('canceled','rejected','cleanup_pending') AND NEW.state IN ('cleanup_pending','deleted')))
  THEN RAISE EXCEPTION 'ATTACHMENT_STATE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.attachments FOR EACH ROW EXECUTE FUNCTION shipit.guard_attachment();
CREATE FUNCTION shipit.audit_attachment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE action_code text;
BEGIN
 action_code=CASE WHEN TG_OP='INSERT' THEN 'attachments.initiated' WHEN NEW.state='pending_upload' THEN 'attachments.upload'
  WHEN NEW.state='quarantined' AND NEW.scan_state='error' THEN 'attachments.scan_error' ELSE 'attachments.'||NEW.state END;
 INSERT INTO shipit.attachment_audit_events VALUES(gen_random_uuid(),NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.id,
  NEW.actor_type,NEW.actor_id,action_code,NEW.state,NEW.version,NEW.correlation_id,date_trunc('milliseconds',clock_timestamp()));
 RETURN NEW;
END $fn$;
CREATE TRIGGER attachment_audit AFTER INSERT OR UPDATE ON shipit.attachments FOR EACH ROW EXECUTE FUNCTION shipit.audit_attachment();
CREATE FUNCTION shipit.audit_attachment_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE a record;
BEGIN
 IF NEW.operation='grant' THEN
  SELECT * INTO a FROM shipit.attachments WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.attachment_id;
  INSERT INTO shipit.attachment_audit_events VALUES(gen_random_uuid(),NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.attachment_id,
   'user',NEW.principal_id::text,'attachments.grant',a.state,a.version,NEW.id,NEW.created_at);
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER attachment_grant_audit AFTER INSERT ON shipit.attachment_commands FOR EACH ROW EXECUTE FUNCTION shipit.audit_attachment_grant();
-- Narrow trusted worker discovery returns one due owner pair, never a private object/key.
CREATE FUNCTION shipit.attachment_cleanup_scope(instant timestamptz) RETURNS TABLE(organization_id uuid,franchise_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT a.organization_id,a.franchise_id FROM shipit.attachments a WHERE a.state NOT IN ('ready','deleted') AND a.cleanup_due_at<=instant
 ORDER BY a.cleanup_due_at,a.id LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION shipit.guard_attachment(),shipit.audit_attachment(),shipit.audit_attachment_grant(),shipit.attachment_cleanup_scope(timestamptz) FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'attachment:'||id::text,organization_id,ARRAY[franchise_id],actor_type,actor_id,action,'attachment',attachment_id,
 'success',replace(action,'.','_'),correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.attachment_audit_events$view$;
END $extend$;
`);
};
exports.down = () => { throw new Error('Forward-only migration'); };
