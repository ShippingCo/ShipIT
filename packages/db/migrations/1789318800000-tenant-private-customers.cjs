// Additive Customer v1 storage; released migrations and historical facts stay intact.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.customers (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') AND name !~ '[\x01-\x1f\x7f-\x9f]'),
      phone_normalized text NOT NULL CHECK(phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
      phone_display text NOT NULL CHECK(char_length(phone_display) BETWEEN 9 AND 40 AND phone_display ~ '^\+[1-9][0-9]*([ -][0-9]+)*$'),
      address text NOT NULL DEFAULT '' CHECK(char_length(address)<=500 AND address=btrim(address,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') AND address !~ '[\x01-\x1f\x7f-\x9f]'),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()) CHECK(isfinite(created_at)),
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()) CHECK(isfinite(updated_at)),
      CONSTRAINT customers_franchise_owner_fk FOREIGN KEY(organization_id,franchise_id)
        REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT customers_owner_id_key UNIQUE(organization_id,franchise_id,id),
      CHECK(phone_normalized=translate(phone_display,' -',''))
    );
    CREATE FUNCTION shipit.reject_customer_identity_update() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
        NEW.franchise_id IS DISTINCT FROM OLD.franchise_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CUSTOMER_IDENTITY_IMMUTABLE'; END IF;
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.reject_customer_identity_update() FROM PUBLIC;
    CREATE TRIGGER customers_immutable_identity BEFORE UPDATE ON shipit.customers
      FOR EACH ROW EXECUTE FUNCTION shipit.reject_customer_identity_update();
    CREATE INDEX customers_phone_prefix_idx ON shipit.customers(organization_id,franchise_id,phone_normalized text_pattern_ops);
    CREATE INDEX customers_name_prefix_idx ON shipit.customers(organization_id,franchise_id,name text_pattern_ops);
    CREATE INDEX customers_order_idx ON shipit.customers(organization_id,franchise_id,created_at,id);

    CREATE TABLE shipit.customer_commands (
      command_id uuid PRIMARY KEY,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      operation_id text NOT NULL CHECK(operation_id IN ('api.v1.customers.create','api.v1.customers.update')),
      key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
      fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      normalization_version integer NOT NULL CHECK(normalization_version=1),
      customer_id uuid NOT NULL,
      -- Original allowlisted DTO required for authorized replay, never a raw request.
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=8192
        AND result ?& ARRAY['id','name','phone','phone_display','address','version','created_at','updated_at']
        AND (result - ARRAY['id','name','phone','phone_display','address','version','created_at','updated_at'])='{}'::jsonb
        AND result->>'id'=customer_id::text),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
      retain_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '25 hours' CHECK(isfinite(retain_until)),
      CHECK(retain_until>=recorded_at+interval '24 hours'),
      CONSTRAINT customer_commands_owner_fk FOREIGN KEY(organization_id,franchise_id,customer_id)
        REFERENCES shipit.customers(organization_id,franchise_id,id) ON DELETE RESTRICT,
      UNIQUE(actor_id,organization_id,franchise_id,operation_id,key_digest)
    );
    CREATE INDEX customer_commands_customer_idx ON shipit.customer_commands(organization_id,franchise_id,customer_id);

    CREATE TABLE shipit.customer_audit_events (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK(action IN ('customer.create','customer.update')),
      committed_version integer NOT NULL CHECK(committed_version>0),
      correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(occurred_at)),
      FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id) ON DELETE RESTRICT,
      UNIQUE(organization_id,franchise_id,customer_id,committed_version)
    );
    CREATE INDEX customer_audit_time_idx ON shipit.customer_audit_events(organization_id,franchise_id,occurred_at DESC,id DESC);
    CREATE FUNCTION shipit.append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      INSERT INTO shipit.customer_audit_events(id,organization_id,franchise_id,customer_id,actor_id,action,committed_version,correlation_id)
        SELECT gen_random_uuid(),$1,$2,c.id,$4,$5,$6,$7 FROM shipit.customers c
        WHERE c.organization_id=$1 AND c.franchise_id=$2 AND c.id=$3 AND c.version=$6
          AND (($5='customer.create' AND $6=1) OR ($5='customer.update' AND $6>1));
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CUSTOMER_AUDIT_INVALID'; END IF;
    END $fn$;

    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK(action IN (
      'organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage',
      'franchise.profile.update','franchise.lifecycle.manage','audit.read','membership.manage',
      'invitation.create','invitation.accept','invitation.revoke','auth.start','auth.verify','auth.resend',
      'auth.session','auth.manage','security.request','customer.read','customer.list','customer.create','customer.update'));
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check
      CHECK(resource_type IN ('organization','franchise','membership','invitation','identity','audit','request','customer'));

    CREATE OR REPLACE VIEW shipit.audit_history AS
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
        NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events;

    REVOKE ALL ON shipit.customers,shipit.customer_commands,shipit.customer_audit_events FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid) FROM PUBLIC;
  `);
};
