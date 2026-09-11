// Forward-only canonical projection: legacy facts remain in their original stores.
exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE shipit.membership_audit_events ADD COLUMN correlation_id uuid;
    ALTER TABLE shipit.auth_security_events ADD COLUMN correlation_id uuid;
    ALTER TABLE shipit.auth_security_events ADD CONSTRAINT auth_audit_finite_time CHECK(isfinite(occurred_at));
    ALTER TABLE shipit.membership_audit_events ADD CONSTRAINT membership_audit_finite_time CHECK(isfinite(occurred_at));
    -- Validate historical scope snapshots before exposing them; never repair ownership.
    DO $validate$ BEGIN
      IF EXISTS (SELECT 1 FROM shipit.membership_audit_events a, unnest(a.franchise_ids) f(id)
        WHERE f.id IS NULL OR NOT EXISTS (SELECT 1 FROM shipit.franchises x WHERE x.organization_id=a.organization_id AND x.id=f.id))
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AUDIT_SCOPE_INVALID'; END IF;
    END $validate$;
    CREATE FUNCTION shipit.validate_membership_audit_scope() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN
      IF EXISTS (SELECT 1 FROM unnest(NEW.franchise_ids) f(id) WHERE f.id IS NULL OR NOT EXISTS
        (SELECT 1 FROM shipit.franchises x WHERE x.organization_id=NEW.organization_id AND x.id=f.id))
      THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AUDIT_SCOPE_INVALID'; END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER membership_audit_scope BEFORE INSERT ON shipit.membership_audit_events
      FOR EACH ROW EXECUTE FUNCTION shipit.validate_membership_audit_scope();

    CREATE TABLE shipit.audit_records (
      id uuid PRIMARY KEY,
      organization_id uuid REFERENCES shipit.organizations(id) ON DELETE RESTRICT,
      franchise_id uuid,
      actor_type text NOT NULL CHECK(actor_type IN ('user','service','anonymous')),
      actor_id text NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 128 AND actor_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'),
      action text NOT NULL CHECK(action IN ('organization.bootstrap','franchise.create','organization.profile.update',
        'organization.lifecycle.manage','franchise.profile.update','franchise.lifecycle.manage',
        'audit.read','membership.manage','invitation.create','invitation.accept','invitation.revoke',
        'auth.start','auth.verify','auth.resend','auth.session','auth.manage','security.request')),
      resource_type text NOT NULL CHECK(resource_type IN ('organization','franchise','membership','invitation','identity','audit','request')),
      resource_id uuid,
      result text NOT NULL CHECK(result IN ('success','denied')),
      reason_code text NOT NULL CHECK(reason_code IN ('bootstrap','franchise_creation','profile_correction',
        'administrative_disable','administrative_reactivate','ACTION_FORBIDDEN','UNAUTHENTICATED','RESOURCE_NOT_FOUND','RATE_LIMITED')),
      correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(occurred_at)),
      previous_lifecycle text CHECK(previous_lifecycle IN ('active','disabled')),
      new_lifecycle text CHECK(new_lifecycle IN ('active','disabled')),
      committed_version integer CHECK(committed_version > 0),
      CONSTRAINT audit_franchise_owner_fk FOREIGN KEY(organization_id,franchise_id)
        REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      CHECK(franchise_id IS NULL OR organization_id IS NOT NULL),
      CHECK(result='denied' OR (resource_type=CASE WHEN franchise_id IS NULL THEN 'organization' ELSE 'franchise' END
        AND resource_id=COALESCE(franchise_id,organization_id) AND actor_type IN ('user','service'))),
      CHECK((result='denied' AND resource_id IS NULL AND previous_lifecycle IS NULL AND new_lifecycle IS NULL AND committed_version IS NULL
        AND reason_code IN ('ACTION_FORBIDDEN','UNAUTHENTICATED','RESOURCE_NOT_FOUND','RATE_LIMITED')) OR
        (result='success' AND organization_id IS NOT NULL AND resource_id IS NOT NULL AND new_lifecycle IS NOT NULL AND committed_version IS NOT NULL
        AND action IN ('organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage','franchise.profile.update','franchise.lifecycle.manage')
        AND reason_code IN ('bootstrap','franchise_creation','profile_correction','administrative_disable','administrative_reactivate')))
    );
    CREATE INDEX audit_organization_time_id_idx ON shipit.audit_records(organization_id,occurred_at DESC,id DESC);
    CREATE INDEX audit_franchise_time_id_idx ON shipit.audit_records(organization_id,franchise_id,occurred_at DESC,id DESC);
    CREATE INDEX audit_resource_time_idx ON shipit.audit_records(organization_id,resource_type,resource_id,occurred_at DESC,id DESC);
    CREATE INDEX membership_audit_scopes_idx ON shipit.membership_audit_events USING gin(franchise_ids);

    -- Definer owns only the append operation. No runtime INSERT/UPDATE/DELETE on base.
    CREATE FUNCTION shipit.append_tenancy_audit(uuid,uuid,text,text,text,text,uuid,text,uuid,timestamptz,text,text,integer)
      RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
      INSERT INTO shipit.audit_records(id,organization_id,franchise_id,actor_type,actor_id,action,resource_type,resource_id,result,
        reason_code,correlation_id,occurred_at,previous_lifecycle,new_lifecycle,committed_version)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'success',$8,$9,$10,$11,$12,$13)
    $fn$;
    -- Denials deliberately cannot carry a guessed target ID, payload or change data.
    CREATE FUNCTION shipit.append_security_denial(text,text,text,text,text,uuid)
      RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
      INSERT INTO shipit.audit_records(id,actor_type,actor_id,action,resource_type,result,reason_code,correlation_id)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,'denied',$5,$6)
    $fn$;
    CREATE VIEW shipit.audit_history AS
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
        NULL,NULL,NULL,NULL FROM shipit.auth_security_events;
    REVOKE ALL ON shipit.audit_records,shipit.audit_history FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.validate_membership_audit_scope() FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.append_tenancy_audit(uuid,uuid,text,text,text,text,uuid,text,uuid,timestamptz,text,text,integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.append_security_denial(text,text,text,text,text,uuid) FROM PUBLIC;
  `);
};
