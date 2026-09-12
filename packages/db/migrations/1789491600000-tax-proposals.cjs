// Additive proposal storage. No booking, production rate seed, or historical rewrite.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.tax_cards (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      publication_revision bigint NOT NULL DEFAULT 0,
      UNIQUE(organization_id,franchise_id), UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.tax_versions (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, card_id uuid NOT NULL,
      version_number integer NOT NULL CHECK(version_number>0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
      state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
      effective_from timestamptz NOT NULL CHECK(isfinite(effective_from)),
      effective_to timestamptz NOT NULL CHECK(isfinite(effective_to)),
      policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=32768),
      published_by uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      CHECK(effective_from<effective_to),
      CHECK(((policy->>'effective_from')::timestamptz=effective_from AND (policy->>'effective_to')::timestamptz=effective_to
        AND policy->>'time_rule'='contemporaneous_v1' AND (policy->>'validity_seconds')::integer BETWEEN 1 AND 86400
        AND jsonb_array_length(policy->'rules') BETWEEN 1 AND 12) IS TRUE),
      CHECK((state='published')=(published_by IS NOT NULL)),
      UNIQUE(card_id,version_number), UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id,card_id) REFERENCES shipit.tax_cards(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX tax_versions_effective_idx ON shipit.tax_versions(organization_id,franchise_id,effective_from,effective_to) WHERE state='published';
    CREATE FUNCTION shipit.guard_tax_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
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
        NEW.card_id<>OLD.card_id OR NEW.version_number<>OLD.version_number OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_IMMUTABLE'; END IF;
      IF NEW.state='published' THEN
        IF NEW.policy<>OLD.policy THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_PUBLICATION_CONTENT_CHANGED'; END IF;
        UPDATE shipit.tax_cards SET publication_revision=publication_revision+1 WHERE id=NEW.card_id;
        IF NEW.effective_from<clock_timestamp() OR EXISTS(SELECT 1 FROM shipit.tax_versions v WHERE v.card_id=NEW.card_id AND v.state='published'
          AND (v.version_number>=NEW.version_number OR (v.effective_from<NEW.effective_to AND NEW.effective_from<v.effective_to)))
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_POLICY_CONFLICT'; END IF;
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER tax_version_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.tax_versions FOR EACH ROW EXECUTE FUNCTION shipit.guard_tax_version();
    ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_quote_actor_owner_unique UNIQUE(organization_id,franchise_id,id,actor_id);
    CREATE TABLE shipit.tax_intents (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT, quote_id uuid NOT NULL,
      input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=4096),
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=2048),
      created_at timestamptz NOT NULL CHECK(isfinite(created_at)), expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
      CHECK(expires_at>created_at),
      CHECK((input->>'quote_id'=quote_id::text AND result->>'id'=id::text AND result->>'quote_id'=quote_id::text
        AND (result->>'created_at')::timestamptz=created_at AND (result->>'expires_at')::timestamptz=expires_at) IS TRUE),
      UNIQUE(organization_id,franchise_id,id), UNIQUE(organization_id,franchise_id,id,actor_id),
      FOREIGN KEY(organization_id,franchise_id,quote_id,actor_id) REFERENCES shipit.pricing_quotes(organization_id,franchise_id,id,actor_id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.tax_resolutions (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT, intent_id uuid NOT NULL, policy_id uuid NOT NULL,
      input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=4096),
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=2048),
      CHECK((input->>'intent_id'=intent_id::text AND input->>'policy_id'=policy_id::text AND result->>'id'=id::text
        AND result->>'intent_id'=intent_id::text AND result->>'policy_id'=policy_id::text
        AND isfinite((result->>'expires_at')::timestamptz) AND (result->>'expires_at')::timestamptz>(result->>'created_at')::timestamptz) IS TRUE),
      UNIQUE(organization_id,franchise_id,intent_id), UNIQUE(organization_id,franchise_id,id,intent_id,policy_id),
      FOREIGN KEY(organization_id,franchise_id,intent_id) REFERENCES shipit.tax_intents(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,policy_id) REFERENCES shipit.tax_versions(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.tax_calculations (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, actor_id uuid NOT NULL,
      intent_id uuid NOT NULL, policy_id uuid NOT NULL, resolution_id uuid,
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=8192),
      CHECK((result->>'id'=id::text AND result->>'intent_id'=intent_id::text AND result->>'policy_id'=policy_id::text
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
        AND mod((result->>'final_payable_paise')::numeric,100)=0
        AND isfinite((result->>'expires_at')::timestamptz) AND (result->>'expires_at')::timestamptz>(result->>'created_at')::timestamptz) IS TRUE),
      UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id,intent_id,actor_id) REFERENCES shipit.tax_intents(organization_id,franchise_id,id,actor_id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,policy_id) REFERENCES shipit.tax_versions(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,resolution_id,intent_id,policy_id) REFERENCES shipit.tax_resolutions(organization_id,franchise_id,id,intent_id,policy_id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.guard_tax_calculation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    DECLARE field text; amount numeric; component jsonb; total numeric=0;
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
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER tax_calculation_guard BEFORE INSERT ON shipit.tax_calculations FOR EACH ROW EXECUTE FUNCTION shipit.guard_tax_calculation();
    REVOKE ALL ON FUNCTION shipit.guard_tax_calculation() FROM PUBLIC;
    CREATE TABLE shipit.tax_commands (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      correlation_id uuid NOT NULL,
      operation text NOT NULL CHECK(operation IN ('draft','replace','publish','prepare','resolve','calculate')),
      key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=32768),
      UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.reject_tax_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TAX_IMMUTABLE'; END $fn$;
    CREATE TRIGGER tax_intent_immutable BEFORE UPDATE OR DELETE ON shipit.tax_intents FOR EACH ROW EXECUTE FUNCTION shipit.reject_tax_mutation();
    CREATE TRIGGER tax_resolution_immutable BEFORE UPDATE OR DELETE ON shipit.tax_resolutions FOR EACH ROW EXECUTE FUNCTION shipit.reject_tax_mutation();
    CREATE TRIGGER tax_calculation_immutable BEFORE UPDATE OR DELETE ON shipit.tax_calculations FOR EACH ROW EXECUTE FUNCTION shipit.reject_tax_mutation();
    CREATE TRIGGER tax_command_immutable BEFORE UPDATE OR DELETE ON shipit.tax_commands FOR EACH ROW EXECUTE FUNCTION shipit.reject_tax_mutation();
    CREATE TABLE shipit.tax_audit_events (
      id uuid PRIMARY KEY REFERENCES shipit.tax_commands(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, actor_id uuid NOT NULL,
      action text NOT NULL CHECK(action IN ('tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate')),
      resource_id uuid NOT NULL, correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(occurred_at)),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.record_tax_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      INSERT INTO shipit.tax_audit_events(id,organization_id,franchise_id,actor_id,action,resource_id,correlation_id)
      VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.actor_id,'tax.'||CASE WHEN NEW.operation='replace' THEN 'draft' ELSE NEW.operation END,
        (NEW.result->>'id')::uuid,NEW.correlation_id);
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER tax_command_audit AFTER INSERT ON shipit.tax_commands FOR EACH ROW EXECUTE FUNCTION shipit.record_tax_command();
    CREATE TRIGGER tax_audit_immutable BEFORE UPDATE OR DELETE ON shipit.tax_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_tax_mutation();
    CREATE INDEX tax_audit_time_idx ON shipit.tax_audit_events(organization_id,franchise_id,occurred_at,id);
    REVOKE ALL ON shipit.tax_audit_events FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.record_tax_command() FROM PUBLIC;
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK(action IN (
      'organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage',
      'franchise.profile.update','franchise.lifecycle.manage','audit.read','membership.manage',
      'invitation.create','invitation.accept','invitation.revoke','auth.start','auth.verify','auth.resend',
      'auth.session','auth.manage','security.request','customer.read','customer.list','customer.create','customer.update',
      'pricing.read','pricing.draft','pricing.publish','pricing.quote','tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate'));
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check
      CHECK(resource_type IN ('organization','franchise','membership','invitation','identity','audit','request','customer','pricing','tax'));
    REVOKE ALL ON shipit.tax_cards,shipit.tax_versions,shipit.tax_intents,shipit.tax_resolutions,shipit.tax_calculations,shipit.tax_commands FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.guard_tax_version(),shipit.reject_tax_mutation() FROM PUBLIC;
  `);
  // Extend the existing canonical projection while preserving its identity and grants.
  pgm.sql(`CREATE OR REPLACE VIEW shipit.audit_history AS
    SELECT 'audit:'||id::text AS id,organization_id,CASE WHEN franchise_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[franchise_id] END AS franchise_ids,
      actor_type,actor_id,action,resource_type,resource_id,result,reason_code,correlation_id,occurred_at,previous_lifecycle,new_lifecycle,committed_version,NULL::text AS role FROM shipit.audit_records
    UNION ALL SELECT 'membership:'||id::text,organization_id,franchise_ids,actor_type,COALESCE(actor_user_id::text,'onboarding'),action,
      CASE WHEN invitation_id IS NULL THEN 'membership' ELSE 'invitation' END,COALESCE(invitation_id,membership_id),'success','grant_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,role FROM shipit.membership_audit_events
    UNION ALL SELECT 'identity:'||id::text,NULL::uuid,'{}'::uuid[],CASE WHEN action IN ('provision','disable','enable') THEN 'service' ELSE 'user' END,
      CASE WHEN action IN ('provision','disable','enable') THEN 'authentication' ELSE COALESCE(user_id::text,'unknown') END,action,'identity',user_id,'success','identity_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,NULL FROM shipit.auth_security_events
    UNION ALL SELECT 'customer:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'customer',customer_id,'success','contact_change',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events
    UNION ALL SELECT 'pricing:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'pricing',COALESCE(quote_id,version_id),'success',reason_code,correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.pricing_audit_events
    UNION ALL SELECT 'tax:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'tax',resource_id,'success','tax_command',correlation_id,occurred_at,NULL,NULL,NULL,NULL FROM shipit.tax_audit_events`);
};
