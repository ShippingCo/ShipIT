// Additive membership and invitation authority. Runtime grants are provisioned
// separately for the deployment identity; migrations never embed role names.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE shipit.memberships (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL REFERENCES shipit.organizations(id) ON DELETE RESTRICT,
      role text NOT NULL CHECK (role IN ('org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only')),
      lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','revoked')),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      revoked_at timestamptz,
      CONSTRAINT memberships_organization_id_key UNIQUE (organization_id, id),
      CONSTRAINT memberships_revocation_consistent CHECK (
        (lifecycle = 'active' AND revoked_at IS NULL) OR
        (lifecycle = 'revoked' AND revoked_at IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX memberships_one_active_role_idx
      ON shipit.memberships (user_id, organization_id, role) WHERE lifecycle = 'active';
    CREATE INDEX memberships_user_organization_idx
      ON shipit.memberships (user_id, organization_id, lifecycle, id);
    CREATE INDEX memberships_organization_idx
      ON shipit.memberships (organization_id, lifecycle, created_at, id);

    CREATE TABLE shipit.membership_franchise_scopes (
      membership_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      PRIMARY KEY (membership_id, franchise_id),
      CONSTRAINT membership_scopes_membership_fk FOREIGN KEY (organization_id, membership_id)
        REFERENCES shipit.memberships (organization_id, id) ON DELETE RESTRICT,
      CONSTRAINT membership_scopes_franchise_fk FOREIGN KEY (organization_id, franchise_id)
        REFERENCES shipit.franchises (organization_id, id) ON DELETE RESTRICT
    );
    CREATE INDEX membership_scopes_franchise_idx
      ON shipit.membership_franchise_scopes (organization_id, franchise_id, membership_id);

    CREATE TABLE shipit.membership_invitations (
      id uuid PRIMARY KEY,
      invitee_user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL REFERENCES shipit.organizations(id) ON DELETE RESTRICT,
      role text NOT NULL CHECK (role IN ('org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only')),
      token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','revoked')),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      expires_at timestamptz NOT NULL,
      created_by_user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      accepted_at timestamptz,
      revoked_at timestamptz,
      CONSTRAINT invitations_organization_id_key UNIQUE (organization_id, id),
      CONSTRAINT invitations_state_consistent CHECK (
        (state = 'pending' AND accepted_at IS NULL AND revoked_at IS NULL) OR
        (state = 'accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL) OR
        (state = 'revoked' AND accepted_at IS NULL AND revoked_at IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX invitations_one_pending_role_idx
      ON shipit.membership_invitations (invitee_user_id, organization_id, role) WHERE state = 'pending';
    CREATE INDEX invitations_organization_idx
      ON shipit.membership_invitations (organization_id, state, created_at, id);
    CREATE INDEX invitations_expiry_idx
      ON shipit.membership_invitations (expires_at) WHERE state = 'pending';

    CREATE TABLE shipit.invitation_franchise_scopes (
      invitation_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      PRIMARY KEY (invitation_id, franchise_id),
      CONSTRAINT invitation_scopes_invitation_fk FOREIGN KEY (organization_id, invitation_id)
        REFERENCES shipit.membership_invitations (organization_id, id) ON DELETE RESTRICT,
      CONSTRAINT invitation_scopes_franchise_fk FOREIGN KEY (organization_id, franchise_id)
        REFERENCES shipit.franchises (organization_id, id) ON DELETE RESTRICT
    );

    CREATE TABLE shipit.membership_audit_events (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES shipit.organizations(id) ON DELETE RESTRICT,
      actor_type text NOT NULL CHECK (actor_type IN ('user','service')),
      actor_user_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      affected_user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      membership_id uuid,
      invitation_id uuid,
      action text NOT NULL CHECK (action IN ('bootstrap_admin','invitation_created','invitation_expired','invitation_revoked','invitation_accepted','membership_updated','membership_revoked')),
      role text NOT NULL CHECK (role IN ('org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only')),
      franchise_ids uuid[] NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      CONSTRAINT membership_audit_actor_consistent CHECK (
        (actor_type = 'service' AND actor_user_id IS NULL) OR
        (actor_type = 'user' AND actor_user_id IS NOT NULL)
      ),
      CONSTRAINT membership_audit_reference_present CHECK (membership_id IS NOT NULL OR invitation_id IS NOT NULL),
      CONSTRAINT membership_audit_scopes_bounded CHECK (cardinality(franchise_ids) <= 100)
    );
    CREATE INDEX membership_audit_organization_time_idx
      ON shipit.membership_audit_events (organization_id, occurred_at, id);

    REVOKE ALL ON shipit.memberships, shipit.membership_franchise_scopes,
      shipit.membership_invitations, shipit.invitation_franchise_scopes,
      shipit.membership_audit_events FROM PUBLIC;
  `);
};
