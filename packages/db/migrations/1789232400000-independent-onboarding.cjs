// Identity-bound bootstrap evidence is immutable. There is no tenant before bootstrap.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE shipit.onboarding_commands (
      user_id uuid PRIMARY KEY REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      command_id uuid NOT NULL UNIQUE,
      operation_id text NOT NULL CHECK (operation_id = 'api.v1.onboarding.create'),
      request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{1,255}$'),
      fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      normalization_version integer NOT NULL CHECK (normalization_version = 1),
      organization_id uuid NOT NULL UNIQUE REFERENCES shipit.organizations(id) ON DELETE RESTRICT,
      franchise_id uuid NOT NULL,
      membership_id uuid NOT NULL,
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      retain_until timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours',
      CONSTRAINT onboarding_retention CHECK (retain_until >= committed_at + interval '24 hours'),
      CONSTRAINT onboarding_franchise_owner FOREIGN KEY (organization_id, franchise_id)
        REFERENCES shipit.franchises(organization_id, id) ON DELETE RESTRICT,
      CONSTRAINT onboarding_membership_owner FOREIGN KEY (organization_id, membership_id)
        REFERENCES shipit.memberships(organization_id, id) ON DELETE RESTRICT
    );
    REVOKE ALL ON shipit.onboarding_commands FROM PUBLIC;
  `);
};
