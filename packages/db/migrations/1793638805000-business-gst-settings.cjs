// One-step business GST settings. Published history remains append-only.
exports.up = pgm => {
  pgm.sql(String.raw`
    ALTER TABLE shipit.tax_versions ADD COLUMN business_gst_mode text
      CHECK(business_gst_mode IN ('courier18','gta5','gta18','none'));
    ALTER TABLE shipit.tax_commands DROP CONSTRAINT tax_commands_operation_check;
    ALTER TABLE shipit.tax_commands ADD CONSTRAINT tax_commands_operation_check
      CHECK(operation IN ('draft','replace','publish','prepare','resolve','calculate','configure'));
    CREATE OR REPLACE FUNCTION shipit.record_tax_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      INSERT INTO shipit.tax_audit_events(id,organization_id,franchise_id,actor_id,action,resource_id,correlation_id)
      VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.actor_id,
        'tax.'||CASE WHEN NEW.operation='replace' THEN 'draft' WHEN NEW.operation='configure' THEN 'publish' ELSE NEW.operation END,
        (NEW.result->>'id')::uuid,NEW.correlation_id);
      RETURN NEW;
    END $fn$;
    CREATE OR REPLACE FUNCTION shipit.guard_tax_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE r jsonb; c jsonb; seen text[]='{}'; matching text[]='{}'; components text[]; n numeric; d numeric; rate numeric; prior_denominator numeric; key text;
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_IMMUTABLE'; END IF;
      IF NOT COALESCE(NEW.policy->>'supplier_state'=ANY(ARRAY['02','03','05','06','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','27','29','30','32','33','36','37'])
        AND NEW.policy->>'supplier_gstin' ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
        AND left(NEW.policy->>'supplier_gstin',2)=NEW.policy->>'supplier_state'
        AND NEW.policy->>'approval_ref' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'
        AND NEW.policy->>'source_ref' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$',false)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_POLICY_INVALID'; END IF;
      FOR r IN SELECT value FROM jsonb_array_elements(NEW.policy->'rules') LOOP
        key=(r->>'service')||':'||(r->>'registration')||':'||(r->>'jurisdiction');
        IF NOT COALESCE(r->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' AND NOT r->>'id'=ANY(seen) AND NOT key=ANY(matching)
          AND r->>'service' IN ('standard','express','same_city') AND r->>'registration' IN ('registered','unregistered')
          AND r->>'jurisdiction' IN ('intra','inter') AND r->>'treatment' IN ('taxable','nil_rated','exempt')
          AND r->>'classification' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' AND r->>'evidence_ref' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'
          AND jsonb_typeof(r->'taxable_lines')='array' AND jsonb_array_length(r->'taxable_lines')<=2
          AND jsonb_typeof(r->'components')='array' AND jsonb_array_length(r->'components')<=2,false)
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_RULE_INVALID'; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'taxable_lines') line WHERE line NOT IN ('freight','packing')) OR
          (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements_text(r->'taxable_lines'))
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_BASIS_INVALID'; END IF;
        seen=array_append(seen,r->>'id'); matching=array_append(matching,key); components='{}'; rate=NULL;
        FOR c IN SELECT value FROM jsonb_array_elements(r->'components') LOOP
          n=(c->>'numerator')::numeric; d=(c->>'denominator')::numeric;
          IF NOT COALESCE(c->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' AND c->>'kind' IN ('CGST','SGST','IGST') AND NOT c->>'kind'=ANY(components)
            AND n BETWEEN 1 AND 1000000 AND d BETWEEN 1 AND 1000000 AND n<=d AND trunc(n)=n AND trunc(d)=d,false)
          THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_RATE_INVALID'; END IF;
          components=array_append(components,c->>'kind');
          IF rate IS NOT NULL AND rate*d<>n*prior_denominator THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_SPLIT_INVALID'; END IF;
          rate=n; prior_denominator=d;
        END LOOP;
        IF (r->>'treatment'<>'taxable' AND cardinality(components)<>0) OR (r->>'treatment'='taxable' AND
          (jsonb_array_length(r->'taxable_lines')=0 OR (r->>'jurisdiction'='inter' AND components<>ARRAY['IGST']) OR
            (r->>'jurisdiction'='intra' AND NOT (cardinality(components)=2 AND components @> ARRAY['CGST','SGST']))))
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_COMPONENTS_INVALID'; END IF;
      END LOOP;
      IF TG_OP='INSERT' THEN
        IF NEW.state<>'draft' OR NEW.revision<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_DRAFT_REQUIRED'; END IF;
        RETURN NEW;
      END IF;
      IF OLD.state='published' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.franchise_id<>OLD.franchise_id OR
        NEW.business_gst_mode IS DISTINCT FROM OLD.business_gst_mode OR NEW.card_id<>OLD.card_id OR NEW.version_number<>OLD.version_number OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_IMMUTABLE'; END IF;
      IF NEW.state='published' THEN
        IF NEW.policy<>OLD.policy THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_PUBLICATION_CONTENT_CHANGED'; END IF;
        UPDATE shipit.tax_cards SET publication_revision=publication_revision+1 WHERE id=NEW.card_id;
        IF NEW.business_gst_mode IS NULL AND (NEW.effective_from<clock_timestamp() OR EXISTS(SELECT 1 FROM shipit.tax_versions v WHERE v.card_id=NEW.card_id AND v.state='published'
          AND (v.version_number>=NEW.version_number OR (v.effective_from<NEW.effective_to AND NEW.effective_from<v.effective_to))))
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_POLICY_CONFLICT'; END IF;
      END IF;
      RETURN NEW;
    END $fn$;

    DO $fn$ DECLARE c record; BEGIN
      FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.tax_calculations'::regclass
        AND contype='c' AND pg_get_constraintdef(oid) LIKE '%mod(%' LOOP
        EXECUTE format('ALTER TABLE shipit.tax_calculations DROP CONSTRAINT %I',c.conname);
      END LOOP;
    END $fn$;
    ALTER TABLE shipit.tax_calculations ADD CONSTRAINT business_gst_money_check CHECK((result->>'id'=id::text AND result->>'intent_id'=intent_id::text AND result->>'policy_id'=policy_id::text
        AND result->>'proposal'='true' AND result->>'allocation'='largest_remainder_v1'
        AND (result->>'resolution_id') IS NOT DISTINCT FROM resolution_id::text
        AND (result->>'pre_tax_paise')::numeric BETWEEN 0 AND 9007199254740991
        AND (result->>'taxable_basis_paise')::numeric BETWEEN 0 AND (result->>'pre_tax_paise')::numeric
        AND (result->>'cgst_paise')::numeric>=0 AND (result->>'sgst_paise')::numeric>=0 AND (result->>'igst_paise')::numeric>=0
        AND (result->>'tax_total_paise')::numeric=(result->>'cgst_paise')::numeric+(result->>'sgst_paise')::numeric+(result->>'igst_paise')::numeric
        AND (result->>'unrounded_payable_paise')::numeric=(result->>'pre_tax_paise')::numeric+(result->>'tax_total_paise')::numeric
        AND (result->>'final_payable_paise')::numeric=(result->>'unrounded_payable_paise')::numeric+(result->>'rounding_adjustment_paise')::numeric
        AND (result->>'rounding_adjustment_paise')::numeric BETWEEN -49 AND 50
        AND (result->>'final_payable_paise')::numeric BETWEEN 0 AND 9007199254740991
        AND isfinite((result->>'expires_at')::timestamptz) AND (result->>'expires_at')::timestamptz>(result->>'created_at')::timestamptz) IS TRUE);
    CREATE OR REPLACE FUNCTION shipit.guard_tax_calculation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    DECLARE field text; amount numeric; component jsonb; total numeric=0; mode text; expected numeric;
    BEGIN
      FOREACH field IN ARRAY ARRAY['pre_tax_paise','taxable_basis_paise','cgst_paise','sgst_paise','igst_paise','tax_total_paise','unrounded_payable_paise','rounding_adjustment_paise','final_payable_paise'] LOOP
        amount=(NEW.result->>field)::numeric;
        IF amount IS NULL OR trunc(amount)<>amount THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_INTEGER_REQUIRED'; END IF;
      END LOOP;
      IF NOT COALESCE(jsonb_typeof(NEW.result->'components')='array' AND jsonb_array_length(NEW.result->'components')<=2,false)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_COMPONENTS_INVALID'; END IF;
      FOR component IN SELECT value FROM jsonb_array_elements(NEW.result->'components') LOOP
        amount=(component->>'amount_paise')::numeric;
        IF NOT COALESCE(amount>=0 AND amount=trunc(amount),false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_INTEGER_REQUIRED'; END IF;
        total=total+amount;
      END LOOP;
      IF total<>(NEW.result->>'tax_total_paise')::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_TOTAL_MISMATCH'; END IF;
      SELECT business_gst_mode INTO mode FROM shipit.tax_versions WHERE id=NEW.policy_id;
      expected=(NEW.result->>'unrounded_payable_paise')::numeric;
      IF mode IS NULL THEN expected=trunc((expected+50)/100)*100; END IF;
      IF (NEW.result->>'final_payable_paise')::numeric<>expected THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_ROUNDING_MISMATCH';
      END IF;
      RETURN NEW;
    END $fn$;
  `);
};
