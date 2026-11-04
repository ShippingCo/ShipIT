// Confirmed counter records preserve incomplete entries without fabricating shipment,
// contact, tax or payment facts. Dispatchable bookings retain their existing contracts.
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE shipit.counter_bookings (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
      key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
      fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
      state text NOT NULL DEFAULT 'confirmed' CHECK(state='confirmed'),
      data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
      confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      correlation_id uuid NOT NULL,
      FOREIGN KEY(franchise_id,organization_id) REFERENCES shipit.franchises(id,organization_id),
      UNIQUE(organization_id,franchise_id,actor_id,key_digest)
    );
    CREATE INDEX counter_bookings_scope_time_idx ON shipit.counter_bookings(organization_id,franchise_id,confirmed_at DESC,id);
    CREATE TABLE shipit.counter_booking_events (
      booking_id uuid PRIMARY KEY REFERENCES shipit.counter_bookings(id),
      organization_id uuid NOT NULL,
      franchise_id uuid NOT NULL,
      actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
      action text NOT NULL CHECK(action='confirmed'),
      correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    REVOKE ALL ON shipit.counter_bookings,shipit.counter_booking_events FROM PUBLIC;
  `);
};
