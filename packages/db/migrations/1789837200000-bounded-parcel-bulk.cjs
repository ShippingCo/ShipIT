// Outer command intent is durable; per-Parcel receipts remain the recovery ledger.
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE shipit.parcel_bulk_requests (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
      fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      normalization_version integer NOT NULL DEFAULT 1 CHECK(normalization_version=1),
      action text NOT NULL CHECK(action IN ('parcels.check_in','parcels.dispatch')),
      item_count integer NOT NULL CHECK(item_count BETWEEN 1 AND 50),
      correlation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
      retain_until timestamptz NOT NULL DEFAULT 'infinity',
      CONSTRAINT parcel_bulk_owner_fk FOREIGN KEY(organization_id,franchise_id)
        REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT parcel_bulk_identity_key UNIQUE(organization_id,franchise_id,principal_id,key_digest),
      CHECK(isfinite(created_at) AND retain_until='infinity'::timestamptz)
    );
    CREATE TRIGGER parcel_bulk_requests_immutable BEFORE UPDATE OR DELETE ON shipit.parcel_bulk_requests
      FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
    REVOKE ALL ON shipit.parcel_bulk_requests FROM PUBLIC;
  `);
};
