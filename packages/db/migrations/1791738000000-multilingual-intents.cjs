// #51: locale outlives selection; one durable reservation prevents repeat inference.
exports.up=pgm=>{pgm.sql(String.raw`
ALTER TABLE shipit.customer_conversations ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK(locale IN ('en','hi'));
ALTER TABLE shipit.customer_conversations ADD COLUMN locale_explicit boolean NOT NULL DEFAULT false;
CREATE TABLE shipit.conversation_inferences (
 inbox_id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 model text NOT NULL CHECK(model='qwen/qwen3.8-27b'),prompt_version text NOT NULL CHECK(prompt_version='shipping-intent-v1'),
 reasoning_effort text NOT NULL CHECK(reasoning_effort='none'),
 state text NOT NULL CHECK(state IN ('reserved','interpreted','uncertain','invalid','timeout','authentication','rate_limited','unavailable','budget')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 latency_ms integer CHECK(latency_ms BETWEEN 0 AND 60000),input_tokens integer CHECK(input_tokens BETWEEN 0 AND 16384),
 output_tokens integer CHECK(output_tokens BETWEEN 0 AND 192),estimated_micro_usd integer CHECK(estimated_micro_usd>=0),
 reserved_micro_usd integer NOT NULL CHECK(reserved_micro_usd IN (0,10000)),
 correlation_id uuid NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 CHECK(isfinite(started_at) AND isfinite(expires_at) AND expires_at>started_at)
);
CREATE INDEX conversation_inference_owner ON shipit.conversation_inferences(organization_id,franchise_id,started_at);
-- Organization-wide budget: sibling franchises cannot multiply the deployment ceiling.
CREATE TABLE shipit.conversation_inference_budgets (
 organization_id uuid PRIMARY KEY REFERENCES shipit.organizations(id),day_start timestamptz NOT NULL,minute_start timestamptz NOT NULL,
 day_calls integer NOT NULL CHECK(day_calls BETWEEN 0 AND 100),minute_calls integer NOT NULL CHECK(minute_calls BETWEEN 0 AND 10),
 reserved_micro_usd integer NOT NULL CHECK(reserved_micro_usd BETWEEN 0 AND 1000000)
);
CREATE FUNCTION shipit.guard_conversation_inference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'reserved' OR NEW.state='reserved' OR
 ROW(NEW.inbox_id,NEW.organization_id,NEW.franchise_id,NEW.model,NEW.prompt_version,NEW.reasoning_effort,NEW.started_at,NEW.expires_at,NEW.reserved_micro_usd,NEW.correlation_id)
 IS DISTINCT FROM ROW(OLD.inbox_id,OLD.organization_id,OLD.franchise_id,OLD.model,OLD.prompt_version,OLD.reasoning_effort,OLD.started_at,OLD.expires_at,OLD.reserved_micro_usd,OLD.correlation_id)
 THEN RAISE EXCEPTION 'inference immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER conversation_inference_guard BEFORE UPDATE OR DELETE ON shipit.conversation_inferences FOR EACH ROW EXECUTE FUNCTION shipit.guard_conversation_inference();
REVOKE ALL ON shipit.conversation_inferences,shipit.conversation_inference_budgets FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_conversation_inference() FROM PUBLIC;
`);};
exports.down=()=>{throw new Error('Forward-only migration');};
