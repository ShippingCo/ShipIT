// Additive first-party identity. Business tenancy remains owned by #12/#14.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE shipit.auth_users (
      id uuid PRIMARY KEY,
      lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','disabled')),
      auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE shipit.auth_identifiers (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      channel text NOT NULL CHECK (channel IN ('email','whatsapp')),
      address text NOT NULL CHECK (length(address) BETWEEN 3 AND 254),
      verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(channel,address)
    );
    CREATE INDEX auth_identifiers_user_idx ON shipit.auth_identifiers(user_id);
    CREATE TABLE shipit.auth_sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
      auth_version bigint NOT NULL, authenticated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      idle_expires_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CHECK (idle_expires_at <= expires_at)
    );
    CREATE INDEX auth_sessions_user_idx ON shipit.auth_sessions(user_id);
    CREATE INDEX auth_sessions_expiry_idx ON shipit.auth_sessions(expires_at);
    CREATE TABLE shipit.auth_challenges (
      id uuid PRIMARY KEY, user_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      auth_version bigint, binding_hash text NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
      purpose text NOT NULL CHECK (purpose IN ('login','link')),
      session_id uuid REFERENCES shipit.auth_sessions(id) ON DELETE RESTRICT,
      channel text NOT NULL CHECK(channel IN ('email','whatsapp')),
      address text NOT NULL CHECK(length(address) BETWEEN 3 AND 254),
      verifier text NOT NULL CHECK (verifier ~ '^[a-f0-9]{64}$'),
      key_version text NOT NULL,
      payload text,
      failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5),
      resends integer NOT NULL DEFAULT 0 CHECK(resends BETWEEN 0 AND 3),
      last_sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL, consumed_at timestamptz,
      CHECK ((purpose='login' AND session_id IS NULL) OR (purpose='link' AND session_id IS NOT NULL)),
      CHECK ((user_id IS NULL AND auth_version IS NULL AND payload IS NULL) OR (user_id IS NOT NULL AND auth_version>0))
    );
    CREATE INDEX auth_challenges_expiry_idx ON shipit.auth_challenges(expires_at);
    CREATE INDEX auth_challenges_user_idx ON shipit.auth_challenges(user_id);
    CREATE INDEX auth_challenges_session_idx ON shipit.auth_challenges(session_id) WHERE session_id IS NOT NULL;
    CREATE TABLE shipit.auth_delivery_jobs (
      id uuid PRIMARY KEY, challenge_id uuid NOT NULL REFERENCES shipit.auth_challenges(id) ON DELETE RESTRICT,
      state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed','uncertain','expired')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      claimed_at timestamptz, finished_at timestamptz,
      provider_ref text CHECK(length(provider_ref)<=256)
    );
    CREATE INDEX auth_jobs_pending_idx ON shipit.auth_delivery_jobs(created_at,id) WHERE state='pending';
    CREATE INDEX auth_jobs_challenge_idx ON shipit.auth_delivery_jobs(challenge_id);
    CREATE INDEX auth_jobs_claimed_idx ON shipit.auth_delivery_jobs(claimed_at) WHERE state='sending';
    CREATE TABLE shipit.auth_rate_limits (
      bucket text PRIMARY KEY CHECK(bucket ~ '^[a-f0-9]{64}$'),
      hits integer NOT NULL CHECK(hits>0), expires_at timestamptz NOT NULL
    );
    CREATE INDEX auth_limits_expiry_idx ON shipit.auth_rate_limits(expires_at);
    -- Minimal durable security facts; #16 integrates broader audit retrieval/policy.
    CREATE TABLE shipit.auth_security_events (
      id uuid PRIMARY KEY, user_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK(action IN ('login','logout','revoke_all','disable','enable','link','unlink','provision')),
      session_id uuid, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX auth_events_user_time_idx ON shipit.auth_security_events(user_id,occurred_at,id);
    REVOKE ALL ON ALL TABLES IN SCHEMA shipit FROM PUBLIC;
  `);
};
