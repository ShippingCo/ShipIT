// #49. Additive; no implicit capacity, tariff, or contact authorization.
exports.up=pgm=>pgm.sql(String.raw`
ALTER TABLE shipit.customer_conversations ADD COLUMN pickup_draft jsonb;
ALTER TABLE shipit.customer_conversations ADD CONSTRAINT pickup_draft_bounded CHECK(pickup_draft IS NULL OR
 (jsonb_typeof(pickup_draft)='object' AND octet_length(pickup_draft::text)<=4096));
ALTER TABLE shipit.customer_conversation_turns DROP CONSTRAINT customer_conversation_turns_intent_check;
ALTER TABLE shipit.customer_conversation_turns ADD CONSTRAINT customer_conversation_turns_intent_check
 CHECK(intent IN ('stop','start','human','resume','tracking','eta','delay','charges','receipt','resend','clarify','quote','pickup'));
CREATE TABLE shipit.pickup_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,installation_id uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key~'^[a-f0-9]{64}$'),quote_id uuid NOT NULL,inbox_id uuid NOT NULL,request_key uuid NOT NULL,
 address text NOT NULL CHECK(length(address) BETWEEN 12 AND 500),window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 review_reason text,state text NOT NULL DEFAULT 'submitted' CHECK(state IN ('submitted','accepted','declined','canceled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),assigned_staff_id uuid,agreed_start timestamptz,agreed_end timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(installation_id,contact_key,request_key),
 FOREIGN KEY(organization_id,franchise_id,quote_id) REFERENCES shipit.customer_quotes(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(assigned_staff_id) REFERENCES shipit.auth_users(id),
 CHECK(isfinite(window_start) AND isfinite(window_end) AND window_end>window_start AND window_end<=window_start+interval '1 day'),
 CHECK((state='accepted' AND assigned_staff_id IS NOT NULL AND agreed_start IS NOT NULL AND agreed_end IS NOT NULL
  AND isfinite(agreed_start) AND isfinite(agreed_end) AND agreed_end>agreed_start AND agreed_end<=agreed_start+interval '1 day') OR
  (state<>'accepted' AND agreed_start IS NULL AND agreed_end IS NULL))
);
CREATE INDEX pickup_queue ON shipit.pickup_requests(organization_id,franchise_id,state,created_at,id);
CREATE INDEX pickup_contact ON shipit.pickup_requests(organization_id,franchise_id,installation_id,contact_key,created_at DESC,id);
-- Clear abandoned private drafts on ordinary worker ticks, including an idle inbox.
-- A bounded batch avoids an unbounded maintenance transaction.
CREATE INDEX pickup_draft_expiry ON shipit.customer_conversations(expires_at,id) WHERE pickup_draft IS NOT NULL;
CREATE OR REPLACE FUNCTION shipit.customer_conversation_next() RETURNS TABLE(organization_id uuid,franchise_id uuid,inbox_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE cleaned integer;
BEGIN
 UPDATE shipit.customer_conversations c SET pickup_draft=NULL WHERE c.id IN
  (SELECT expired.id FROM shipit.customer_conversations expired WHERE expired.pickup_draft IS NOT NULL AND expired.expires_at<=clock_timestamp()
   ORDER BY expired.expires_at,expired.id LIMIT 100 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS cleaned=ROW_COUNT;
 IF cleaned>0 THEN RETURN; END IF;
 RETURN QUERY SELECT j.organization_id,j.franchise_id,j.id FROM shipit.whatsapp_inbox j
 WHERE j.kind='inbound' AND j.state='completed'
 AND EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r WHERE r.inbox_id=j.id)
 AND NOT EXISTS(SELECT 1 FROM shipit.customer_conversation_turns t WHERE t.inbox_id=j.id)
 AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox older WHERE older.installation_id=j.installation_id AND older.kind='inbound' AND older.state<>'quarantined'
  AND (older.received_at,older.id)<(j.received_at,j.id) AND NOT EXISTS(SELECT 1 FROM shipit.customer_conversation_turns t WHERE t.inbox_id=older.id))
 ORDER BY j.received_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
END $fn$;
CREATE TABLE shipit.pickup_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,pickup_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('pickup.requested','pickup.accepted','pickup.declined','pickup.canceled')),
 version integer NOT NULL,actor_type text NOT NULL CHECK(actor_type IN ('user','service')),actor_id text NOT NULL,
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(pickup_id,version),
 FOREIGN KEY(organization_id,franchise_id,pickup_id) REFERENCES shipit.pickup_requests(organization_id,franchise_id,id)
);
CREATE TABLE shipit.pickup_commands (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id text NOT NULL,key_digest text NOT NULL,fingerprint text NOT NULL,
 pickup_id uuid NOT NULL,result jsonb NOT NULL,PRIMARY KEY(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,pickup_id) REFERENCES shipit.pickup_requests(organization_id,franchise_id,id)
);
CREATE TRIGGER pickup_events_immutable BEFORE UPDATE OR DELETE ON shipit.pickup_events FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER pickup_commands_immutable BEFORE UPDATE OR DELETE ON shipit.pickup_commands FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE FUNCTION shipit.guard_pickup() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PICKUP_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'submitted' OR NEW.version<>1 OR NEW.assigned_staff_id IS NOT NULL THEN RAISE EXCEPTION 'PICKUP_INITIAL' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.state<>'submitted' OR NEW.state NOT IN ('accepted','declined','canceled') OR NEW.version<>OLD.version+1 OR
   (to_jsonb(NEW)-ARRAY['state','version','assigned_staff_id','agreed_start','agreed_end','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','version','assigned_staff_id','agreed_start','agreed_end','updated_at'])
  THEN RAISE EXCEPTION 'PICKUP_TRANSITION' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $fn$;
CREATE TRIGGER pickup_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.pickup_requests FOR EACH ROW EXECUTE FUNCTION shipit.guard_pickup();
ALTER TABLE shipit.whatsapp_outbound ADD COLUMN pickup_event_id uuid;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT outbound_pickup_fk FOREIGN KEY(organization_id,franchise_id,pickup_event_id)
 REFERENCES shipit.pickup_events(organization_id,franchise_id,id);
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_source_kind_check;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_source_kind_check CHECK(source_kind IN ('event','inbox','delivery_challenge','conversation','pickup'));
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_recipient_shape;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_recipient_shape CHECK(
 (source_kind='delivery_challenge' AND purpose='delivery_otp' AND customer_id IS NULL AND delivery_recipient_ref IS NOT NULL AND conversation_inbox_id IS NULL AND pickup_event_id IS NULL)
 OR (source_kind IN ('event','inbox') AND purpose<>'delivery_otp' AND customer_id IS NOT NULL AND delivery_recipient_ref IS NULL AND conversation_inbox_id IS NULL AND pickup_event_id IS NULL)
 OR (source_kind='conversation' AND purpose='requested_assistance' AND customer_id IS NULL AND delivery_recipient_ref IS NULL
  AND conversation_inbox_id=source_id AND contact_version=source_id AND conversation_inbox_id IS NOT NULL AND pickup_event_id IS NULL)
 OR (source_kind='pickup' AND purpose='requested_assistance' AND customer_id IS NULL AND delivery_recipient_ref IS NULL
  AND conversation_inbox_id IS NULL AND pickup_event_id=source_id AND contact_version=source_id AND pickup_event_id IS NOT NULL));
CREATE UNIQUE INDEX outbound_pickup_identity ON shipit.whatsapp_outbound(pickup_event_id) WHERE pickup_event_id IS NOT NULL;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_functiondef('shipit.guard_whatsapp_outbound()'::regprocedure) INTO source;
 source:=replace(source,'ELSIF NEW.source_kind IN (''inbox'',''conversation'') THEN',
 'ELSIF NEW.source_kind=''pickup'' THEN
   IF NOT EXISTS(SELECT 1 FROM shipit.pickup_events e JOIN shipit.pickup_requests p ON p.id=e.pickup_id
    WHERE e.id=NEW.source_id AND e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id
     AND p.installation_id=NEW.installation_id AND p.contact_key=NEW.contact_key AND p.id=NEW.affected_entity_id
     AND e.event_type IN (''pickup.accepted'',''pickup.declined'')) THEN RAISE EXCEPTION ''OUTBOUND_SOURCE_INVALID'' USING ERRCODE=''23514''; END IF;
  ELSIF NEW.source_kind IN (''inbox'',''conversation'') THEN');
 EXECUTE source;
END $extend$;
DO $audit$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'pickup:'||id::text,organization_id,ARRAY[franchise_id],actor_type,actor_id,event_type,'pickup',pickup_id,
 'success',NULL::text,correlation_id,occurred_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.pickup_events$view$;
END $audit$;
REVOKE ALL ON shipit.pickup_requests,shipit.pickup_events,shipit.pickup_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_pickup() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only migration');};
