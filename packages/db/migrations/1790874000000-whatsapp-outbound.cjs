// Forward-only: retain logical identity independently from encrypted rendering.
exports.up = pgm => { pgm.sql(String.raw`
CREATE TABLE shipit.whatsapp_outbound (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 installation_id uuid NOT NULL, customer_id uuid NOT NULL, contact_version uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key ~ '^[a-f0-9]{64}$'),
 source_id uuid NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('event','inbox')),
 purpose text NOT NULL CHECK(purpose IN ('updates','requested_assistance','consent_disclosure')),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 sealed_payload text, key_version text NOT NULL, expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 disclosure_hash text CHECK(disclosure_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('queued','dispatching','retry_wait','accepted','delivered','read','failed','uncertain','suppressed')),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z_]{1,64}$'), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), cycle_attempts integer NOT NULL DEFAULT 0 CHECK(cycle_attempts BETWEEN 0 AND 5),
 attempt_id uuid, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(organization_id,franchise_id,id,installation_id),
 UNIQUE(organization_id,franchise_id,source_kind,source_id,customer_id,purpose),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id),
 CHECK((state='dispatching')=(lease_until IS NOT NULL)),
 CHECK(isfinite(available_at) AND isfinite(created_at) AND (lease_until IS NULL OR isfinite(lease_until))),
 CHECK((purpose='consent_disclosure')=(disclosure_hash IS NOT NULL))
);
CREATE INDEX whatsapp_outbound_due ON shipit.whatsapp_outbound(available_at,id) WHERE state IN ('queued','retry_wait','dispatching');
CREATE INDEX whatsapp_outbound_history ON shipit.whatsapp_outbound(organization_id,franchise_id,created_at,id);
CREATE INDEX whatsapp_outbound_expiry ON shipit.whatsapp_outbound(expires_at,id) WHERE sealed_payload IS NOT NULL;
CREATE TABLE shipit.whatsapp_outbound_attempts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, intent_id uuid NOT NULL,
 installation_id uuid NOT NULL, attempt integer NOT NULL CHECK(attempt>0),
 outcome text NOT NULL CHECK(outcome IN ('accepted','retryable_not_accepted','permanent_failure','configuration_failure','unavailable','uncertain')),
 provider_message_id text CHECK(provider_message_id ~ '^wamid\.[A-Za-z0-9_+=/-]{1,190}$'),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z_]{1,64}$'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(intent_id,attempt), UNIQUE(installation_id,provider_message_id),
 FOREIGN KEY(organization_id,franchise_id,intent_id,installation_id) REFERENCES shipit.whatsapp_outbound(organization_id,franchise_id,id,installation_id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 CHECK((outcome='accepted')=(provider_message_id IS NOT NULL))
);
CREATE INDEX whatsapp_outbound_attempt_history ON shipit.whatsapp_outbound_attempts(organization_id,franchise_id,intent_id,attempt);
CREATE TABLE shipit.whatsapp_outbound_redrives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 intent_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 version integer NOT NULL, reason_code text NOT NULL CHECK(reason_code IN ('dependency_repaired','retry_uncertain_confirmed')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,actor_id,key_hash),
 FOREIGN KEY(organization_id,franchise_id,intent_id) REFERENCES shipit.whatsapp_outbound(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.guard_whatsapp_outbound() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OUTBOUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state NOT IN ('queued','suppressed','failed') OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.cycle_attempts<>0 OR NEW.attempt_id IS NOT NULL
   THEN RAISE EXCEPTION 'OUTBOUND_INITIAL_STATE' USING ERRCODE='23514'; END IF;
  IF NEW.source_kind='event' THEN
   IF NOT EXISTS(SELECT 1 FROM shipit.domain_events e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.event_id=NEW.source_id)
    THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox i WHERE i.organization_id=NEW.organization_id AND i.franchise_id=NEW.franchise_id AND i.id=NEW.source_id AND i.installation_id=NEW.installation_id)
   THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload'])
    OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts
    OR (NEW.sealed_payload IS DISTINCT FROM OLD.sealed_payload AND NEW.sealed_payload IS NOT NULL)
    OR (OLD.state='read' AND NEW.state<>'read') OR (OLD.state='delivered' AND NEW.state NOT IN ('delivered','read'))
   THEN RAISE EXCEPTION 'OUTBOUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER whatsapp_outbound_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.whatsapp_outbound FOR EACH ROW EXECUTE FUNCTION shipit.guard_whatsapp_outbound();
CREATE TRIGGER whatsapp_outbound_attempt_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_outbound_attempts FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER whatsapp_outbound_redrive_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_outbound_redrives FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();

-- Scheduling yields references only. The caller locks and rechecks the intent in its transaction.
CREATE FUNCTION shipit.whatsapp_outbound_scope(target uuid, instant timestamptz, attention boolean)
RETURNS TABLE(organization_id uuid,franchise_id uuid,intent_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT m.organization_id,m.franchise_id,m.id FROM shipit.whatsapp_outbound m
 WHERE CASE WHEN target IS NOT NULL THEN m.id=target WHEN attention THEN m.state IN ('failed','uncertain') ELSE
  (m.state IN ('queued','retry_wait') AND m.available_at<=coalesce(instant,clock_timestamp())) OR
  (m.state='dispatching' AND m.lease_until<=coalesce(instant,clock_timestamp())) OR
  (m.sealed_payload IS NOT NULL AND m.expires_at<=coalesce(instant,clock_timestamp())) OR
  EXISTS(SELECT 1 FROM shipit.whatsapp_outbound_attempts a JOIN shipit.whatsapp_delivery_observations d
    ON d.installation_id=a.installation_id AND d.message_id=a.provider_message_id
    WHERE a.intent_id=m.id AND ((d.progress=3 AND m.state<>'read') OR (d.progress=2 AND m.state NOT IN ('delivered','read')) OR
      (d.failure_observed AND m.state='accepted' AND d.progress<2))) END
 ORDER BY m.available_at,m.id LIMIT 1
$fn$;

-- No runtime caller can manufacture disclosure proof: require a mapped delivered source.
CREATE FUNCTION shipit.whatsapp_outbound_disclose(org uuid,franchise uuid,intent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.whatsapp_consent_disclosures(organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,message_id,purpose,policy_version,disclosure_hash,disclosed_at,expires_at)
 SELECT m.organization_id,m.franchise_id,m.installation_id,m.customer_id,m.contact_version,m.contact_key,a.provider_message_id,'updates','whatsapp-consent-v1',m.disclosure_hash,proof.delivered_at,m.expires_at
 FROM shipit.whatsapp_outbound m JOIN shipit.whatsapp_outbound_attempts a ON a.intent_id=m.id AND a.installation_id=m.installation_id
 JOIN shipit.whatsapp_delivery_observations d ON d.installation_id=a.installation_id AND d.message_id=a.provider_message_id
 JOIN LATERAL (SELECT min(i.occurred_at) AS delivered_at FROM shipit.whatsapp_inbox i WHERE i.installation_id=a.installation_id AND i.message_id=a.provider_message_id
  AND i.kind='status' AND i.state='completed' AND i.status IN ('delivered','read')) proof ON true
 WHERE m.organization_id=org AND m.franchise_id=franchise AND m.id=intent AND m.purpose='consent_disclosure'
 AND m.state IN ('delivered','read') AND d.progress>=2 AND proof.delivered_at>=m.created_at-interval '5 minutes' AND proof.delivered_at<m.expires_at
 AND proof.delivered_at<=clock_timestamp()+interval '5 minutes'
 ON CONFLICT(installation_id,message_id) DO NOTHING;
END $fn$;
REVOKE ALL ON shipit.whatsapp_outbound,shipit.whatsapp_outbound_attempts,shipit.whatsapp_outbound_redrives FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_whatsapp_outbound(),shipit.whatsapp_outbound_scope(uuid,timestamptz,boolean),shipit.whatsapp_outbound_disclose(uuid,uuid,uuid) FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'outbound-redrive:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'whatsapp.redrive','whatsapp_outbound',intent_id,'success',reason_code,correlation_id,occurred_at,NULL,NULL,version,NULL::text FROM shipit.whatsapp_outbound_redrives
 UNION ALL SELECT 'outbound:'||a.id::text,a.organization_id,ARRAY[a.franchise_id],'service','whatsapp-outbound-worker',
 'whatsapp.send','whatsapp_outbound',a.intent_id,CASE WHEN a.outcome='accepted' THEN 'success' ELSE 'denied' END,
 a.reason_code,m.correlation_id,a.recorded_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.whatsapp_outbound_attempts a JOIN shipit.whatsapp_outbound m ON m.id=a.intent_id$view$;
END $extend$;
`); };
exports.down = () => { throw new Error('Forward-only migration'); };
