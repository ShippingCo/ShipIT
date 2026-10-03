exports.up = pgm => pgm.sql(String.raw`
CREATE TABLE shipit.carrier_rate_imports (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'), normalization_version text NOT NULL CHECK(normalization_version ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(purpose IN ('customer_selling','courier_purchase_estimate')),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object' AND config->>'purpose'=purpose AND octet_length(config::text)<=65536),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 100 AND octet_length(rows::text)<=262144),
 issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array' AND jsonb_array_length(issues)<=6),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,installation_id,file_sha256,normalization_version),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_rate_approvals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,import_id uuid NOT NULL,
 pricing_version_id uuid,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 approved_at timestamptz NOT NULL CHECK(isfinite(approved_at)),UNIQUE(organization_id,franchise_id,import_id),UNIQUE(pricing_version_id),
 FOREIGN KEY(organization_id,franchise_id,import_id) REFERENCES shipit.carrier_rate_imports(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,pricing_version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_rate_commands (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,import_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 operation text NOT NULL CHECK(operation IN ('preview','approve')),key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 PRIMARY KEY(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id,import_id) REFERENCES shipit.carrier_rate_imports(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.check_carrier_rate_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE r shipit.carrier_rate_imports;BEGIN
 SELECT * INTO r FROM shipit.carrier_rate_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.import_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('carrier-rate:'||r.installation_id::text,0));
 IF jsonb_array_length(r.issues)<>0 OR (r.config->'policy'->>'effective_from')::timestamptz<NEW.approved_at
   OR (r.purpose='customer_selling')<>(NEW.pricing_version_id IS NOT NULL) THEN
   RAISE EXCEPTION 'RATE_APPROVAL_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.pricing_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.pricing_versions v
   WHERE v.id=NEW.pricing_version_id AND v.organization_id=NEW.organization_id AND v.franchise_id=NEW.franchise_id
   AND v.state='published' AND v.source_ref='carrier-rate:'||r.id::text) THEN
   RAISE EXCEPTION 'RATE_PRICING_MISMATCH' USING ERRCODE='23514'; END IF;
 IF r.purpose='courier_purchase_estimate' AND EXISTS(SELECT 1 FROM shipit.carrier_rate_imports previous_import
   JOIN shipit.carrier_rate_approvals a ON a.organization_id=previous_import.organization_id AND a.franchise_id=previous_import.franchise_id AND a.import_id=previous_import.id
   WHERE previous_import.organization_id=r.organization_id AND previous_import.franchise_id=r.franchise_id AND previous_import.installation_id=r.installation_id
   AND previous_import.purpose=r.purpose AND previous_import.id<>r.id
   AND (previous_import.config->'policy'->>'effective_from')::timestamptz<(r.config->'policy'->>'effective_to')::timestamptz
   AND (r.config->'policy'->>'effective_from')::timestamptz<(previous_import.config->'policy'->>'effective_to')::timestamptz) THEN
   RAISE EXCEPTION 'RATE_PURCHASE_OVERLAP' USING ERRCODE='23514'; END IF;
 RETURN NEW;END $fn$;
CREATE TRIGGER carrier_rate_approval_check BEFORE INSERT ON shipit.carrier_rate_approvals FOR EACH ROW EXECUTE FUNCTION shipit.check_carrier_rate_approval();
REVOKE ALL ON FUNCTION shipit.check_carrier_rate_approval() FROM PUBLIC;
DO $guard$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['carrier_rate_imports','carrier_rate_approvals','carrier_rate_commands'] LOOP
  EXECUTE format('CREATE TRIGGER carrier_immutable BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only()',name);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',name);
 END LOOP;
END $guard$;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'carrier-rate:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.rate.preview','carrier_rate',id,'success','rate_preview',correlation_id,created_at,NULL,NULL,1,NULL FROM shipit.carrier_rate_imports
 UNION ALL SELECT 'carrier-rate-approval:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.rate.approve','carrier_rate',import_id,'success','rate_approval',correlation_id,approved_at,NULL,NULL,2,NULL FROM shipit.carrier_rate_approvals$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
