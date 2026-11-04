/* Counter-entered charges are an explicit source, independent of published rates. */
exports.up=pgm=>pgm.sql(`
ALTER TABLE shipit.pricing_quotes ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE shipit.pricing_commands ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE shipit.pricing_quotes ADD FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id);
DO $checks$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.pricing_quotes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%' LOOP
 EXECUTE format('ALTER TABLE shipit.pricing_quotes DROP CONSTRAINT %I',c.conname);END LOOP;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.pricing_commands'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%rate_version_id%' LOOP
 EXECUTE format('ALTER TABLE shipit.pricing_commands DROP CONSTRAINT %I',c.conname);END LOOP;
END $checks$;
ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_quote_source CHECK(
 (version_id IS NOT NULL AND num_nonnulls(rule_id,account_rate_id,service_option_id)=1 AND NOT(result->'inputs' ? 'charges')) OR
 (version_id IS NULL AND num_nonnulls(rule_id,account_rate_id,service_option_id)=0 AND result->'inputs' ? 'charges')
);
ALTER TABLE shipit.pricing_quotes DROP CONSTRAINT pricing_quote_evidence;
ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_quote_evidence CHECK((
 jsonb_typeof(result)='object' AND octet_length(result::text)<=8192 AND result->>'id'=id::text AND (result->>'rate_version_id') IS NOT DISTINCT FROM version_id::text
 AND (result->>'rule_id') IS NOT DISTINCT FROM rule_id::text AND (result->'account'->>'rate_revision_id') IS NOT DISTINCT FROM account_rate_id::text
 AND (result->'inputs'->>'service_option_id') IS NOT DISTINCT FROM service_option_id::text
 AND (result->'service_option'->>'id') IS NOT DISTINCT FROM service_option_id::text
 AND result ?& ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown']
 AND result-ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown','account','service_option']='{}'::jsonb
 AND (NOT(result ? 'account') OR ((result->'account'->>'id')=(result->'inputs'->>'customer_account_id') AND (result->'account'->>'rate_source')=CASE WHEN account_rate_id IS NULL THEN 'normal' ELSE 'account' END))
) IS TRUE);

ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_entered_charges CHECK(version_id IS NOT NULL OR (
 result->'card_id'='null'::jsonb AND result->'rate_version_id'='null'::jsonb AND result->'rate_version_number'='0'::jsonb
 AND result->'rule_id'='null'::jsonb AND result->'approval_actor_id'='null'::jsonb AND result->>'override_status'='none'
 AND result->'variance_paise'='0'::jsonb AND result->'proposal'='true'::jsonb
 AND result->'policy'->>'source_ref'='COUNTER_ENTERED' AND result->'policy'->>'approval_ref'='NOT_REQUIRED'
 AND jsonb_typeof(result->'inputs'->'charges')='object'
 AND result->'inputs'->'charges' ?& ARRAY['freight_paise','packing_paise']
 AND (result->'inputs'->'charges')-ARRAY['freight_paise','packing_paise']='{}'::jsonb
 AND NOT(result->'inputs' ?| ARRAY['override','customer_account_id','service_option_id'])
 AND jsonb_typeof(result->'inputs'->'charges'->'freight_paise')='number' AND jsonb_typeof(result->'inputs'->'charges'->'packing_paise')='number'
 AND result->'inputs'->'charges'->>'freight_paise'~'^[0-9]+$' AND result->'inputs'->'charges'->>'packing_paise'~'^[0-9]+$'
 AND (result->'inputs'->'charges'->>'freight_paise')::numeric BETWEEN 0 AND 9007199254740991
 AND (result->'inputs'->'charges'->>'packing_paise')::numeric BETWEEN 0 AND 9007199254740991
 AND result->'freight_paise'=result->'inputs'->'charges'->'freight_paise'
 AND result->'packing_paise'=result->'inputs'->'charges'->'packing_paise'
 AND result->'freight_suggestion_paise'=result->'freight_paise'
 AND (result->>'subtotal_paise')::numeric=(result->>'freight_paise')::numeric+(result->>'packing_paise')::numeric
 AND (result->>'subtotal_paise')::numeric BETWEEN 0 AND 9007199254740991
) IS TRUE);
ALTER TABLE shipit.pricing_commands ADD CONSTRAINT pricing_command_source CHECK((
 (operation_id='api.v1.pricing.quote' AND quote_id IS NOT NULL AND result->>'id'=quote_id::text
  AND (result->>'rate_version_id') IS NOT DISTINCT FROM version_id::text
  AND (version_id IS NOT NULL OR result->'inputs' ? 'charges')) OR
 (operation_id<>'api.v1.pricing.quote' AND version_id IS NOT NULL AND quote_id IS NULL AND result->>'id'=version_id::text)
) IS TRUE);
`);
exports.down=()=>{throw new Error('Forward-only evidence migration');};
