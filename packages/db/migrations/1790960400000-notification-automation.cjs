// Forward-only #40: durable policy activation, decisions and per-affected-entity outbound identity.
exports.up = pgm => { pgm.sql(String.raw`
ALTER TABLE shipit.whatsapp_outbound ADD COLUMN affected_entity_id uuid;
UPDATE shipit.whatsapp_outbound SET affected_entity_id=source_id;
ALTER TABLE shipit.whatsapp_outbound ALTER COLUMN affected_entity_id SET NOT NULL;
DO $drop_old_identity$
DECLARE constraint_name text;
BEGIN
 SELECT c.conname INTO constraint_name
 FROM pg_constraint c
 WHERE c.conrelid='shipit.whatsapp_outbound'::regclass AND c.contype='u'
   AND (SELECT array_agg(a.attname::text ORDER BY u.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum)
     =ARRAY['organization_id','franchise_id','source_kind','source_id','customer_id','purpose'];
 IF constraint_name IS NULL THEN RAISE EXCEPTION 'OUTBOUND_IDENTITY_UPGRADE_MISMATCH'; END IF;
 EXECUTE format('ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT %I',constraint_name);
END $drop_old_identity$;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_effect_identity
 UNIQUE(organization_id,franchise_id,source_kind,source_id,affected_entity_id,customer_id,purpose);

CREATE TABLE shipit.notification_policy_activations (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,consumer_id text NOT NULL,
 policy_id text NOT NULL CHECK(policy_id ~ '^[a-z][a-z0-9.-]{0,63}$'),
 policy_version integer NOT NULL CHECK(policy_version>0),configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
 activated_at timestamptz NOT NULL CHECK(isfinite(activated_at)),
 PRIMARY KEY(organization_id,franchise_id,consumer_id,policy_id,policy_version),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 CHECK(consumer_id='customer-notifications')
);
CREATE INDEX notification_policy_activation_time ON shipit.notification_policy_activations(organization_id,franchise_id,activated_at);

CREATE TABLE shipit.notification_automation_decisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 source_event_id uuid NOT NULL,event_type text NOT NULL,
 policy_id text NOT NULL CHECK(policy_id ~ '^[a-z][a-z0-9.-]{0,63}$'),policy_version integer NOT NULL CHECK(policy_version>0),
 affected_type text NOT NULL CHECK(affected_type IN ('booking','parcel')),affected_entity_id uuid NOT NULL,
 booking_id uuid NOT NULL,parcel_id uuid,customer_id uuid,
 notification_kind text NOT NULL CHECK(notification_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
 semantic_key text NOT NULL CHECK(semantic_key ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN ('queued','blocked','suppressed','skipped')),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),outbound_intent_id uuid,
 correlation_id uuid NOT NULL,decided_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(decided_at)),
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(organization_id,franchise_id,source_event_id,policy_id,policy_version,affected_type,affected_entity_id),
 FOREIGN KEY(organization_id,franchise_id,source_event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,outbound_intent_id) REFERENCES shipit.whatsapp_outbound(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK((affected_type='booking' AND parcel_id IS NULL AND affected_entity_id=booking_id)
   OR (affected_type='parcel' AND parcel_id IS NOT NULL AND affected_entity_id=parcel_id)),
 CHECK((outcome='queued' AND outbound_intent_id IS NOT NULL)
   OR outcome IN ('blocked','suppressed')
   OR (outcome='skipped' AND outbound_intent_id IS NULL))
);
CREATE INDEX notification_decisions_source ON shipit.notification_automation_decisions(organization_id,franchise_id,source_event_id);
CREATE INDEX notification_decisions_history ON shipit.notification_automation_decisions(organization_id,franchise_id,decided_at DESC,id DESC);
CREATE INDEX notification_decisions_semantic ON shipit.notification_automation_decisions(organization_id,franchise_id,semantic_key);
CREATE INDEX notification_decisions_customer ON shipit.notification_automation_decisions(organization_id,franchise_id,customer_id,decided_at DESC) WHERE customer_id IS NOT NULL;

CREATE FUNCTION shipit.guard_notification_automation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'NOTIFICATION_AUTOMATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='notification_automation_decisions' AND NOT EXISTS(
   SELECT 1 FROM shipit.domain_events e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id
     AND e.event_id=NEW.source_event_id AND e.event_type=NEW.event_type AND e.envelope->>'correlation_id'=NEW.correlation_id::text)
 THEN RAISE EXCEPTION 'NOTIFICATION_AUTOMATION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER notification_policy_activations_immutable BEFORE UPDATE OR DELETE ON shipit.notification_policy_activations
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_notification_automation();
CREATE TRIGGER notification_automation_decisions_immutable BEFORE INSERT OR UPDATE OR DELETE ON shipit.notification_automation_decisions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_notification_automation();

-- Deployment configuration establishes cutover before the consumer registry starts.
-- Existing activations never move forward on restart or template/configuration repair.
CREATE FUNCTION shipit.notification_policy_activate(org uuid,franchise uuid,policies jsonb,config_hash text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE activated timestamptz:=clock_timestamp();inserted integer;
BEGIN
 IF config_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(policies)<>'array' OR jsonb_array_length(policies) NOT BETWEEN 1 AND 32
  OR NOT EXISTS(SELECT 1 FROM shipit.franchises f WHERE f.organization_id=org AND f.id=franchise)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(policies) p WHERE jsonb_typeof(p)<>'object'
    OR p-ARRAY['id','version']<>'{}'::jsonb OR p->>'id' !~ '^[a-z][a-z0-9.-]{0,63}$'
    OR jsonb_typeof(p->'version')<>'number' OR (p->>'version')::numeric<>trunc((p->>'version')::numeric)
    OR (p->>'version')::numeric NOT BETWEEN 1 AND 2147483647)
  OR (SELECT count(*) FROM jsonb_array_elements(policies))<>(SELECT count(DISTINCT (p->>'id',(p->>'version')::integer)) FROM jsonb_array_elements(policies) p)
 THEN RAISE EXCEPTION 'NOTIFICATION_ACTIVATION_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO shipit.notification_policy_activations(organization_id,franchise_id,consumer_id,policy_id,policy_version,configuration_hash,activated_at)
 SELECT org,franchise,'customer-notifications',p->>'id',(p->>'version')::integer,config_hash,activated
 FROM jsonb_array_elements(policies) p ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;RETURN inserted;
END $fn$;

REVOKE ALL ON shipit.notification_policy_activations,shipit.notification_automation_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_notification_automation(),shipit.notification_policy_activate(uuid,uuid,jsonb,text) FROM PUBLIC;
DO $extend_audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'notification:'||id::text,organization_id,ARRAY[franchise_id],'service','customer-notifications',
 'notification.decide','notification_automation',id,CASE WHEN outcome='queued' THEN 'success' ELSE 'denied' END,
 reason_code,correlation_id,decided_at,NULL,NULL,policy_version,NULL::text FROM shipit.notification_automation_decisions$view$;
END $extend_audit$;
`); };
exports.down = () => { throw new Error('Forward-only migration'); };
