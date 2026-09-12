// Forward-only pricing: no extension, retroactive update, tax or Booking table.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.pricing_cards (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      publication_revision bigint NOT NULL DEFAULT 0 CHECK(publication_revision>=0),
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()) CHECK(isfinite(created_at)),
      UNIQUE(organization_id,franchise_id), UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.pricing_versions (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, card_id uuid NOT NULL,
      version_number integer NOT NULL CHECK(version_number>0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
      state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
      effective_from timestamptz NOT NULL CHECK(isfinite(effective_from) AND effective_from=date_trunc('milliseconds',effective_from)),
      effective_to timestamptz NOT NULL CHECK(isfinite(effective_to) AND effective_to=date_trunc('milliseconds',effective_to)),
      quote_validity_seconds integer NOT NULL CHECK(quote_validity_seconds BETWEEN 1 AND 86400),
      override_tolerance_paise bigint NOT NULL CHECK(override_tolerance_paise BETWEEN 0 AND 9007199254740991),
      approval_ref text NOT NULL CHECK(char_length(approval_ref) BETWEEN 1 AND 128 AND approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'),
      source_ref text NOT NULL CHECK(char_length(source_ref) BETWEEN 1 AND 128 AND source_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'),
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()) CHECK(isfinite(created_at)),
      published_at timestamptz CHECK(isfinite(published_at)),
      published_by uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      CHECK(effective_from<effective_to),
      CHECK((state='draft' AND published_at IS NULL AND published_by IS NULL) OR
        (state='published' AND published_at IS NOT NULL AND published_by IS NOT NULL)),
      UNIQUE(card_id,version_number), UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id,card_id) REFERENCES shipit.pricing_cards(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX pricing_effective_idx ON shipit.pricing_versions(organization_id,franchise_id,effective_from,effective_to) WHERE state='published';
    CREATE TABLE shipit.pricing_rules (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, version_id uuid NOT NULL,
      destination_key text NOT NULL CHECK(char_length(destination_key) BETWEEN 1 AND 32 AND destination_key ~ '^[A-Z][A-Z0-9_]*$'),
      service text NOT NULL CHECK(service IN ('standard','express','same_city')),
      min_weight_grams bigint NOT NULL CHECK(min_weight_grams BETWEEN 1 AND 9007199254740991),
      max_weight_grams bigint CHECK(max_weight_grams BETWEEN 1 AND 9007199254740991),
      freight_paise bigint NOT NULL CHECK(freight_paise BETWEEN 0 AND 9007199254740991),
      packing_paise bigint NOT NULL CHECK(packing_paise BETWEEN 0 AND 9007199254740991),
      CHECK(max_weight_grams IS NULL OR min_weight_grams<max_weight_grams),
      CHECK(freight_paise::numeric+packing_paise::numeric<=9007199254740991),
      UNIQUE(organization_id,franchise_id,version_id,id),
      FOREIGN KEY(organization_id,franchise_id,version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX pricing_rules_match_idx ON shipit.pricing_rules(organization_id,franchise_id,version_id,destination_key,service,min_weight_grams);
    CREATE FUNCTION shipit.guard_pricing_rule() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    DECLARE v shipit.pricing_versions;
    BEGIN
      IF TG_OP='UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_RULE_REPLACE_ONLY'; END IF;
      IF TG_OP='DELETE' THEN
        SELECT * INTO v FROM shipit.pricing_versions WHERE id=OLD.version_id FOR UPDATE;
      ELSE SELECT * INTO v FROM shipit.pricing_versions WHERE id=NEW.version_id FOR UPDATE; END IF;
      IF v.state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_IMMUTABLE'; END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER pricing_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.pricing_rules FOR EACH ROW EXECUTE FUNCTION shipit.guard_pricing_rule();

    CREATE FUNCTION shipit.guard_pricing_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_IMMUTABLE'; END IF;
      IF TG_OP='INSERT' THEN
        IF NEW.state<>'draft' OR NEW.revision<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_DRAFT_REQUIRED'; END IF;
        RETURN NEW;
      END IF;
      IF OLD.state='published' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.franchise_id<>OLD.franchise_id OR
        NEW.card_id<>OLD.card_id OR NEW.version_number<>OLD.version_number OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_IMMUTABLE'; END IF;
      IF NEW.state='published' THEN
        -- Persistent write lock serializes direct SQL publishers too. Under stronger isolation
        -- a changed row causes serialization failure instead of a stale overlap decision.
        UPDATE shipit.pricing_cards SET publication_revision=publication_revision+1
          WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.card_id;
        IF NEW.effective_from<date_trunc('milliseconds',clock_timestamp()) OR
          NOT EXISTS(SELECT 1 FROM shipit.pricing_rules WHERE version_id=NEW.id) OR
          (SELECT count(*) FROM shipit.pricing_rules WHERE version_id=NEW.id)>100 OR
          EXISTS(SELECT 1 FROM shipit.pricing_versions p WHERE p.card_id=NEW.card_id AND p.state='published' AND
            (p.version_number>=NEW.version_number OR (p.effective_from<NEW.effective_to AND NEW.effective_from<p.effective_to))) OR
          EXISTS(SELECT 1 FROM shipit.pricing_rules a JOIN shipit.pricing_rules b ON a.version_id=b.version_id AND a.id<b.id
            AND a.destination_key=b.destination_key AND a.service=b.service WHERE a.version_id=NEW.id
            AND (a.max_weight_grams IS NULL OR b.min_weight_grams<a.max_weight_grams)
            AND (b.max_weight_grams IS NULL OR a.min_weight_grams<b.max_weight_grams))
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_PUBLICATION_CONFLICT'; END IF;
        -- Publication changes only lifecycle metadata; draft content must already be reviewed.
        IF (NEW.effective_from,NEW.effective_to,NEW.quote_validity_seconds,NEW.override_tolerance_paise,NEW.approval_ref,NEW.source_ref)
          IS DISTINCT FROM (OLD.effective_from,OLD.effective_to,OLD.quote_validity_seconds,OLD.override_tolerance_paise,OLD.approval_ref,OLD.source_ref)
        THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_PUBLICATION_CONTENT_CHANGE'; END IF;
        NEW.published_at=date_trunc('milliseconds',clock_timestamp());
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER pricing_version_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.pricing_versions FOR EACH ROW EXECUTE FUNCTION shipit.guard_pricing_version();

    CREATE TABLE shipit.pricing_quotes (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      version_id uuid NOT NULL, rule_id uuid NOT NULL,
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=8192 AND result->>'id'=id::text
        AND result->>'rate_version_id'=version_id::text AND result->>'rule_id'=rule_id::text
        AND result ?& ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown']
        AND (result - ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown'])='{}'::jsonb),
      created_at timestamptz NOT NULL CHECK(isfinite(created_at)), expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>created_at),
      CHECK(((result->>'created_at')::timestamptz=created_at AND (result->>'expires_at')::timestamptz=expires_at) IS TRUE),
      UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id,version_id,rule_id) REFERENCES shipit.pricing_rules(organization_id,franchise_id,version_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX pricing_quotes_actor_idx ON shipit.pricing_quotes(organization_id,franchise_id,actor_id,id);
    CREATE TABLE shipit.pricing_commands (
      command_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      operation_id text NOT NULL CHECK(operation_id IN ('api.v1.pricing.draft','api.v1.pricing.replace','api.v1.pricing.publish','api.v1.pricing.quote')),
      key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      normalization_version integer NOT NULL CHECK(normalization_version=1),
      version_id uuid NOT NULL, quote_id uuid,
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
      retain_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '25 hours' CHECK(isfinite(retain_until)),
      CHECK(retain_until>=recorded_at+interval '24 hours'),
      CHECK(((operation_id='api.v1.pricing.quote' AND quote_id IS NOT NULL AND result->>'id'=quote_id::text AND result->>'rate_version_id'=version_id::text) OR
        (operation_id<>'api.v1.pricing.quote' AND quote_id IS NULL AND result->>'id'=version_id::text)) IS TRUE),
      UNIQUE(actor_id,organization_id,franchise_id,operation_id,key_digest),
      FOREIGN KEY(organization_id,franchise_id,version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,quote_id) REFERENCES shipit.pricing_quotes(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.pricing_audit_events (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, version_id uuid NOT NULL, quote_id uuid,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK(action IN ('pricing.draft','pricing.publish','pricing.override','pricing.override.approve')),
      reason_code text NOT NULL CHECK(reason_code IN ('policy_change','policy_publication','customer_agreement','service_recovery','commercial_exception')),
      committed_version integer NOT NULL CHECK(committed_version>0), correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(occurred_at)),
      FOREIGN KEY(organization_id,franchise_id,version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,quote_id) REFERENCES shipit.pricing_quotes(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX pricing_audit_version_idx ON shipit.pricing_audit_events(version_id,committed_version) WHERE quote_id IS NULL;
    CREATE UNIQUE INDEX pricing_audit_quote_idx ON shipit.pricing_audit_events(quote_id) WHERE quote_id IS NOT NULL;
    CREATE INDEX pricing_audit_time_idx ON shipit.pricing_audit_events(organization_id,franchise_id,occurred_at,id);
    CREATE FUNCTION shipit.append_pricing_audit(uuid,uuid,uuid,uuid,uuid,text,text,integer,uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM shipit.pricing_versions WHERE organization_id=$1 AND franchise_id=$2 AND id=$3 AND revision=$8
        AND (($4 IS NULL AND (($6='pricing.draft' AND state='draft') OR ($6='pricing.publish' AND state='published' AND published_by=$5)))
          OR ($4 IS NOT NULL AND state='published'))) OR
        ($4 IS NULL AND ($6 NOT IN ('pricing.draft','pricing.publish') OR $7<>CASE WHEN $6='pricing.draft' THEN 'policy_change' ELSE 'policy_publication' END)) OR
        ($4 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.pricing_quotes WHERE organization_id=$1 AND franchise_id=$2 AND id=$4 AND actor_id=$5 AND version_id=$3
          AND result->'inputs'->'override'->>'reason_code'=$7 AND $6=CASE WHEN result->>'override_status'='privileged' THEN 'pricing.override.approve' ELSE 'pricing.override' END))
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRICING_AUDIT_INVALID'; END IF;
      INSERT INTO shipit.pricing_audit_events VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp());
    END $fn$;
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK(action IN (
      'organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage',
      'franchise.profile.update','franchise.lifecycle.manage','audit.read','membership.manage',
      'invitation.create','invitation.accept','invitation.revoke','auth.start','auth.verify','auth.resend',
      'auth.session','auth.manage','security.request','customer.read','customer.list','customer.create','customer.update',
      'pricing.read','pricing.draft','pricing.publish','pricing.quote'));
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check
      CHECK(resource_type IN ('organization','franchise','membership','invitation','identity','audit','request','customer','pricing'));
    REVOKE ALL ON shipit.pricing_cards,shipit.pricing_versions,shipit.pricing_rules,shipit.pricing_quotes,shipit.pricing_commands,shipit.pricing_audit_events FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.guard_pricing_rule(),shipit.guard_pricing_version(),shipit.append_pricing_audit(uuid,uuid,uuid,uuid,uuid,text,text,integer,uuid) FROM PUBLIC;
  `);
  // Preserve the existing view identity and grants, extending only its typed projection.
  pgm.sql(`CREATE OR REPLACE VIEW shipit.audit_history AS
      SELECT 'audit:'||id::text AS id,organization_id,
        CASE WHEN franchise_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[franchise_id] END AS franchise_ids,
        actor_type,actor_id,action,resource_type,resource_id,result,reason_code,correlation_id,occurred_at,
        previous_lifecycle,new_lifecycle,committed_version,NULL::text AS role
      FROM shipit.audit_records
      UNION ALL
      SELECT 'membership:'||id::text,organization_id,franchise_ids,actor_type,COALESCE(actor_user_id::text,'onboarding'),
        action,CASE WHEN invitation_id IS NULL THEN 'membership' ELSE 'invitation' END,
        COALESCE(invitation_id,membership_id),'success','grant_change',COALESCE(correlation_id,id),occurred_at,
        NULL,NULL,NULL,role FROM shipit.membership_audit_events
      UNION ALL
      SELECT 'identity:'||id::text,NULL::uuid,'{}'::uuid[],
        CASE WHEN action IN ('provision','disable','enable') THEN 'service' ELSE 'user' END,
        CASE WHEN action IN ('provision','disable','enable') THEN 'authentication' ELSE COALESCE(user_id::text,'unknown') END,
        action,'identity',user_id,'success','identity_change',COALESCE(correlation_id,id),occurred_at,
        NULL,NULL,NULL,NULL FROM shipit.auth_security_events
      UNION ALL
      SELECT 'customer:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
        action,'customer',customer_id,'success','contact_change',correlation_id,occurred_at,
        NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events
      UNION ALL SELECT 'pricing:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
        action,'pricing',COALESCE(quote_id,version_id),'success',reason_code,correlation_id,occurred_at,
        NULL,NULL,committed_version,NULL FROM shipit.pricing_audit_events;`);
};
