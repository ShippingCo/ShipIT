// #48 forward-only. No rate is made customer-visible without explicit W27 policy.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.customer_quote_policies (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=32768),
 rate_version_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,version),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id,rate_version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id),
 CHECK(configuration->>'rate_version_id'=rate_version_id::text)
);
CREATE TABLE shipit.customer_quote_policy_commands (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),result jsonb NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.customer_quotes (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,inbox_id uuid NOT NULL UNIQUE,installation_id uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key~'^[a-f0-9]{64}$'),policy_id uuid,rate_version_id uuid,rule_id uuid,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=1024),
 reason text CHECK(reason IN ('policy_unavailable','unsupported_origin','manual_review','heavy','large','unsupported_lane','dimensional_review','rate_unavailable')),
 freight_paise bigint,packing_paise bigint,total_paise bigint,
 assumptions text NOT NULL DEFAULT 'one_package_actual_weight_v1' CHECK(assumptions='one_package_actual_weight_v1'),
 exclusions jsonb NOT NULL DEFAULT '["tax","final_payable_rounding","pickup","insurance","special_handling"]'
  CHECK(exclusions='["tax","final_payable_rounding","pickup","insurance","special_handling"]'::jsonb),
 non_binding boolean NOT NULL DEFAULT true CHECK(non_binding),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 refreshed_from uuid,correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,policy_id) REFERENCES shipit.customer_quote_policies(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,rate_version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,refreshed_from) REFERENCES shipit.customer_quotes(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,rate_version_id,rule_id) REFERENCES shipit.pricing_rules(organization_id,franchise_id,version_id,id),
 CHECK(isfinite(created_at) AND isfinite(expires_at) AND expires_at>created_at),
 CHECK((reason IS NULL AND policy_id IS NOT NULL AND rate_version_id IS NOT NULL AND rule_id IS NOT NULL AND
   freight_paise IS NOT NULL AND packing_paise IS NOT NULL AND total_paise IS NOT NULL AND
   freight_paise>=0 AND packing_paise>=0 AND total_paise=freight_paise+packing_paise AND total_paise<=9007199254740991)
  OR (reason IS NOT NULL AND rule_id IS NULL AND freight_paise IS NULL AND packing_paise IS NULL AND total_paise IS NULL))
);
CREATE INDEX customer_quote_contact ON shipit.customer_quotes(organization_id,franchise_id,installation_id,contact_key,created_at DESC);
CREATE INDEX customer_quote_budget ON shipit.customer_conversation_turns(organization_id,franchise_id,installation_id,contact_key,recorded_at DESC) WHERE intent='quote';
CREATE TRIGGER customer_quote_policies_immutable BEFORE UPDATE OR DELETE ON shipit.customer_quote_policies FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER customer_quote_policy_commands_immutable BEFORE UPDATE OR DELETE ON shipit.customer_quote_policy_commands FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER customer_quotes_immutable BEFORE UPDATE OR DELETE ON shipit.customer_quotes FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
ALTER TABLE shipit.customer_conversations ADD COLUMN quote_draft jsonb CHECK(quote_draft IS NULL OR (jsonb_typeof(quote_draft)='object' AND octet_length(quote_draft::text)<=1024));
ALTER TABLE shipit.customer_conversation_turns ADD COLUMN quote_id uuid;
ALTER TABLE shipit.customer_conversation_turns ADD CONSTRAINT conversation_quote_fk FOREIGN KEY(organization_id,franchise_id,quote_id) REFERENCES shipit.customer_quotes(organization_id,franchise_id,id);
ALTER TABLE shipit.customer_conversation_turns DROP CONSTRAINT customer_conversation_turns_intent_check;
ALTER TABLE shipit.customer_conversation_turns ADD CONSTRAINT customer_conversation_turns_intent_check CHECK(intent IN ('stop','start','human','resume','tracking','eta','delay','charges','receipt','resend','clarify','quote'));
DO $audit$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'quote-policy:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'customer_quote.policy','customer_quote_policy',id,'success','policy_change',correlation_id,created_at,NULL,NULL,NULL::integer,NULL::text
 FROM shipit.customer_quote_policies$view$;
END $audit$;
REVOKE ALL ON shipit.customer_quote_policies,shipit.customer_quote_policy_commands,shipit.customer_quotes FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only migration');};
