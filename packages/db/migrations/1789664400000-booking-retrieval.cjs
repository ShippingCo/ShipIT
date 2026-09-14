// Additive read-model support for tenant-scoped parcel discovery and timelines.
// The compatibility trigger keeps the preceding booking writer valid while the API rolls out.
exports.up = pgm => {
  pgm.sql(String.raw`
    ALTER TABLE shipit.domain_events
      ADD COLUMN occurred_at timestamptz,
      ADD COLUMN aggregate_sequence bigint;

    ALTER TABLE shipit.domain_events DISABLE TRIGGER domain_events_immutable;
    UPDATE shipit.domain_events
      SET occurred_at=(envelope->>'occurred_at')::timestamptz,
          aggregate_sequence=(envelope->>'aggregate_version')::bigint;
    ALTER TABLE shipit.domain_events ENABLE TRIGGER domain_events_immutable;

    ALTER TABLE shipit.domain_events
      ALTER COLUMN occurred_at SET NOT NULL,
      ALTER COLUMN aggregate_sequence SET NOT NULL,
      ADD CONSTRAINT domain_events_ordering_check CHECK(
        isfinite(occurred_at) AND aggregate_sequence BETWEEN 1 AND 2147483647
        AND occurred_at=(envelope->>'occurred_at')::timestamptz
        AND aggregate_sequence=(envelope->>'aggregate_version')::bigint),
      ADD CONSTRAINT domain_events_aggregate_sequence_key
        UNIQUE(organization_id,franchise_id,aggregate_id,aggregate_sequence);

    CREATE FUNCTION shipit.fill_domain_event_ordering() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      NEW.occurred_at=COALESCE(NEW.occurred_at,(NEW.envelope->>'occurred_at')::timestamptz);
      NEW.aggregate_sequence=COALESCE(NEW.aggregate_sequence,(NEW.envelope->>'aggregate_version')::bigint);
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.fill_domain_event_ordering() FROM PUBLIC;
    CREATE TRIGGER domain_events_fill_ordering BEFORE INSERT ON shipit.domain_events
      FOR EACH ROW EXECUTE FUNCTION shipit.fill_domain_event_ordering();

    CREATE INDEX parcels_owner_docket_idx
      ON shipit.parcels(organization_id,franchise_id,docket);
    CREATE INDEX parcels_owner_status_booking_idx
      ON shipit.parcels(organization_id,franchise_id,status,booking_id,id);
    CREATE INDEX bookings_owner_created_idx
      ON shipit.bookings(organization_id,franchise_id,confirmed_at DESC,id DESC);
    CREATE INDEX bookings_owner_customer_created_idx
      ON shipit.bookings(organization_id,franchise_id,customer_id,confirmed_at DESC,id DESC);
    CREATE INDEX domain_events_parcel_timeline_idx
      ON shipit.domain_events(organization_id,franchise_id,parcel_id,occurred_at,aggregate_sequence,event_id);
  `);
};
