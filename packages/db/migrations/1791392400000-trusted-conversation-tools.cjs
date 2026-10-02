// Forward-only #47: signed-channel turns, durable replies and recipient-only resend.
exports.up = pgm => { pgm.sql(String.raw`
CREATE TABLE shipit.customer_conversations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,installation_id uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key~'^[a-f0-9]{64}$'),
 selected_docket text,pending_intent text,state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','human_requested')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(installation_id,contact_key),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 CHECK(selected_docket IS NULL OR selected_docket~'^[A-Z0-9][A-Z0-9-]{0,39}$'),
 CHECK(pending_intent IS NULL OR pending_intent IN ('tracking','eta','delay','charges','receipt','resend'))
);
CREATE TABLE shipit.customer_conversation_turns (
 inbox_id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,installation_id uuid NOT NULL,
 conversation_id uuid,contact_key text CHECK(contact_key~'^[a-f0-9]{64}$'),
 intent text NOT NULL CHECK(intent IN ('stop','start','human','resume','tracking','eta','delay','charges','receipt','resend','clarify')),
 outcome text NOT NULL CHECK(outcome IN ('answered','selection_required','not_found','forbidden','unavailable','human_requested','paused','consent','stale','invalid')),
 provenance jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(provenance)='array' AND octet_length(provenance::text)<=4096),
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,inbox_id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,conversation_id) REFERENCES shipit.customer_conversations(organization_id,franchise_id,id)
);
CREATE INDEX customer_turn_history ON shipit.customer_conversation_turns(organization_id,franchise_id,conversation_id,recorded_at DESC,inbox_id);
CREATE TRIGGER customer_turns_immutable BEFORE UPDATE OR DELETE ON shipit.customer_conversation_turns FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE INDEX customer_conversation_inbox_order ON shipit.whatsapp_inbox(installation_id,received_at,id) WHERE kind='inbound' AND state<>'quarantined';
CREATE INDEX customer_conversation_inbox_completed ON shipit.whatsapp_inbox(received_at,id) WHERE kind='inbound' AND state='completed';

-- Consume in installation order. A second worker cannot overtake an uncommitted turn.
CREATE FUNCTION shipit.customer_conversation_next() RETURNS TABLE(organization_id uuid,franchise_id uuid,inbox_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT j.organization_id,j.franchise_id,j.id FROM shipit.whatsapp_inbox j
 WHERE j.kind='inbound' AND j.state='completed'
 AND EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r WHERE r.inbox_id=j.id)
 AND NOT EXISTS(SELECT 1 FROM shipit.customer_conversation_turns t WHERE t.inbox_id=j.id)
 AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox older WHERE older.installation_id=j.installation_id AND older.kind='inbound' AND older.state<>'quarantined'
   AND (older.received_at,older.id)<(j.received_at,j.id) AND NOT EXISTS(SELECT 1 FROM shipit.customer_conversation_turns t WHERE t.inbox_id=older.id))
 ORDER BY j.received_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
$fn$;

ALTER TABLE shipit.whatsapp_outbound ADD COLUMN conversation_inbox_id uuid;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT outbound_conversation_fk FOREIGN KEY(organization_id,franchise_id,conversation_inbox_id)
 REFERENCES shipit.customer_conversation_turns(organization_id,franchise_id,inbox_id);
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_source_kind_check;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_source_kind_check CHECK(source_kind IN ('event','inbox','delivery_challenge','conversation'));
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_recipient_shape;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_recipient_shape CHECK(
 (source_kind='delivery_challenge' AND purpose='delivery_otp' AND customer_id IS NULL AND delivery_recipient_ref IS NOT NULL AND conversation_inbox_id IS NULL)
 OR (source_kind IN ('event','inbox') AND purpose<>'delivery_otp' AND customer_id IS NOT NULL AND delivery_recipient_ref IS NULL AND conversation_inbox_id IS NULL)
 OR (source_kind='conversation' AND purpose='requested_assistance' AND customer_id IS NULL AND delivery_recipient_ref IS NULL
   AND conversation_inbox_id=source_id AND contact_version=source_id AND conversation_inbox_id IS NOT NULL));
CREATE UNIQUE INDEX outbound_conversation_identity ON shipit.whatsapp_outbound(organization_id,franchise_id,conversation_inbox_id) WHERE source_kind='conversation';
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_functiondef('shipit.guard_whatsapp_outbound()'::regprocedure) INTO source;
 source:=replace(source,'ELSIF NEW.source_kind=''inbox'' THEN','ELSIF NEW.source_kind IN (''inbox'',''conversation'') THEN');
 EXECUTE source;
END $extend$;

-- Existing staff commands retain their user principal. Only resend gets a signed
-- customer principal; this does not authorize start/replace/complete or staff roles.
ALTER TABLE shipit.delivery_commands ADD COLUMN customer_inbox_id uuid;
ALTER TABLE shipit.delivery_commands ALTER COLUMN principal_id DROP NOT NULL;
ALTER TABLE shipit.delivery_commands ADD CONSTRAINT delivery_customer_source FOREIGN KEY(organization_id,franchise_id,customer_inbox_id)
 REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id);
ALTER TABLE shipit.delivery_commands ADD CONSTRAINT delivery_principal_shape CHECK(
 (principal_id IS NOT NULL AND customer_inbox_id IS NULL) OR
 (principal_id IS NULL AND customer_inbox_id IS NOT NULL AND operation_id='api.v1.deliveries.resend'));
CREATE UNIQUE INDEX delivery_customer_replay ON shipit.delivery_commands(organization_id,franchise_id,customer_inbox_id) WHERE customer_inbox_id IS NOT NULL;

DO $audit$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'conversation:'||inbox_id::text,organization_id,ARRAY[franchise_id],'service','whatsapp-inbox-worker',
 'conversation.'||intent,'whatsapp_inbox',inbox_id,CASE WHEN outcome='answered' THEN 'success' ELSE 'denied' END,
 outcome,correlation_id,recorded_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.customer_conversation_turns$view$;
END $audit$;
REVOKE ALL ON shipit.customer_conversations,shipit.customer_conversation_turns FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.customer_conversation_next() FROM PUBLIC;
`); };
exports.down=()=>{throw new Error('Forward-only migration');};
