exports.up = pgm => pgm.sql(`
CREATE TABLE shipit.report_snapshots (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 metadata jsonb CHECK(jsonb_typeof(metadata)='object'),
 rows jsonb CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows)<=5000 AND octet_length(rows::text)<=8388608),
 CHECK((metadata IS NULL)=(rows IS NULL)),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(isfinite(created_at) AND expires_at=created_at+interval '24 hours'),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE INDEX report_snapshot_expiry_idx ON shipit.report_snapshots(organization_id,franchise_id,expires_at);
CREATE FUNCTION shipit.guard_report_snapshot() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REPORT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.metadata IS NULL OR NEW.rows IS NULL OR
   (NEW.metadata->>'id') IS DISTINCT FROM NEW.id::text OR
   (NEW.metadata->>'organization_id') IS DISTINCT FROM NEW.organization_id::text OR
   (NEW.metadata->>'franchise_id') IS DISTINCT FROM NEW.franchise_id::text OR
   (NEW.metadata->>'count')::integer IS DISTINCT FROM jsonb_array_length(NEW.rows)
  THEN RAISE EXCEPTION 'REPORT_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.expires_at>clock_timestamp() OR NEW.metadata IS NOT NULL OR NEW.rows IS NOT NULL OR
   (to_jsonb(NEW)-'metadata'-'rows') IS DISTINCT FROM (to_jsonb(OLD)-'metadata'-'rows')
  THEN RAISE EXCEPTION 'REPORT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER report_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.report_snapshots
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_report_snapshot();
REVOKE ALL ON FUNCTION shipit.guard_report_snapshot() FROM PUBLIC;
CREATE TABLE shipit.report_access_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),snapshot_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('report.capture','report.read','report.export')),
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TRIGGER report_access_immutable BEFORE UPDATE OR DELETE ON shipit.report_access_events
 FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
REVOKE ALL ON shipit.report_snapshots,shipit.report_access_events FROM PUBLIC;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\\n ')||$view$
 UNION ALL SELECT 'report:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 action,'report',snapshot_id,'success','report_access',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.report_access_events$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
