/* Named courier services preserve their immutable rates and existing tax category. */
exports.up=pgm=>pgm.sql(`
CREATE TABLE shipit.booking_services (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 accepts_liquids boolean NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80 AND name=btrim(name) AND name!~'[[:cntrl:]]'),
 service text NOT NULL CHECK(service IN ('standard','express','same_city')),
 destination_key text NOT NULL CHECK(destination_key~'^[A-Z][A-Z0-9_]{0,31}$'),
 pricing jsonb NOT NULL CHECK((jsonb_typeof(pricing)='object' AND pricing ?& ARRAY['kind','first_kg_paise','additional_kg_paise','packing_paise'] AND pricing-ARRAY['kind','first_kg_paise','additional_kg_paise','packing_paise']='{}'::jsonb
 AND pricing->>'kind' IN ('flat','per_kg') AND pricing->>'first_kg_paise'~'^[0-9]+$' AND pricing->>'additional_kg_paise'~'^[0-9]+$' AND pricing->>'packing_paise'~'^[0-9]+$'
 AND (pricing->>'first_kg_paise')::numeric BETWEEN 0 AND 9007199254740991 AND (pricing->>'additional_kg_paise')::numeric BETWEEN 0 AND 9007199254740991 AND (pricing->>'packing_paise')::numeric BETWEEN 0 AND 9007199254740991
 AND (pricing->>'kind'<>'flat' OR (pricing->>'additional_kg_paise')::numeric=0)) IS TRUE),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE UNIQUE INDEX booking_services_name_idx ON shipit.booking_services(organization_id,franchise_id,lower(name),destination_key);
CREATE FUNCTION shipit.guard_booking_service() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'BOOKING_SERVICE_IMMUTABLE' USING ERRCODE='23514';END $fn$;
CREATE TRIGGER booking_service_immutable BEFORE UPDATE OR DELETE ON shipit.booking_services FOR EACH ROW EXECUTE FUNCTION shipit.guard_booking_service();
ALTER TABLE shipit.pricing_quotes ADD COLUMN service_option_id uuid,
 ADD FOREIGN KEY(organization_id,franchise_id,service_option_id) REFERENCES shipit.booking_services(organization_id,franchise_id,id);
DO $checks$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.pricing_quotes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%rule_id IS NULL%' LOOP
 EXECUTE format('ALTER TABLE shipit.pricing_quotes DROP CONSTRAINT %I',c.conname);END LOOP;
END $checks$;
ALTER TABLE shipit.pricing_quotes ADD CHECK(num_nonnulls(rule_id,account_rate_id,service_option_id)=1);
ALTER TABLE shipit.pricing_quotes DROP CONSTRAINT pricing_quote_evidence;
ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_quote_evidence CHECK((
 jsonb_typeof(result)='object' AND octet_length(result::text)<=8192 AND result->>'id'=id::text AND result->>'rate_version_id'=version_id::text
 AND (result->>'rule_id') IS NOT DISTINCT FROM rule_id::text AND (result->'account'->>'rate_revision_id') IS NOT DISTINCT FROM account_rate_id::text
 AND (result->'inputs'->>'service_option_id') IS NOT DISTINCT FROM service_option_id::text
 AND (result->'service_option'->>'id') IS NOT DISTINCT FROM service_option_id::text
 AND result ?& ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown']
 AND result-ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown','account','service_option']='{}'::jsonb
 AND (NOT(result ? 'account') OR ((result->'account'->>'id')=(result->'inputs'->>'customer_account_id') AND (result->'account'->>'rate_source')=CASE WHEN account_rate_id IS NULL THEN 'normal' ELSE 'account' END))
) IS TRUE);
REVOKE ALL ON shipit.booking_services FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_booking_service() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only evidence migration');};
