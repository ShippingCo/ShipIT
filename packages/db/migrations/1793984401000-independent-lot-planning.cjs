// A lot can be planned before rates or bookings exist. Keep the audited command,
// ownership, destination syntax and subsequent parcel-destination checks intact.
exports.up = pgm => pgm.sql(`
  DO $body$
  DECLARE definition text; old text;
  BEGIN
    definition=pg_get_functiondef('shipit.guard_lot()'::regprocedure);
    old=$old$OR COALESCE(jsonb_array_length(c.input->'planning_entry_ids'),0)=0 AND NOT EXISTS(SELECT 1 FROM shipit.pricing_rules r JOIN shipit.pricing_versions v
            ON v.organization_id=r.organization_id AND v.franchise_id=r.franchise_id AND v.id=r.version_id
            WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id
              AND r.destination_key=NEW.destination_key AND v.state='published')$old$;
    IF position(old IN definition)=0 THEN RAISE EXCEPTION 'LOT_GUARD_SHAPE_CHANGED'; END IF;
    EXECUTE replace(definition,old,$new$OR NEW.destination_key !~ '^[A-Z][A-Z0-9_]{0,31}$'$new$);
  END $body$;
`);
