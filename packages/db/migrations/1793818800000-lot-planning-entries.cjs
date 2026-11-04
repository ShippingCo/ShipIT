// Planning metadata lives in the versioned, audited lot command ledger. It never
// creates shipment, customer, tax, payment or custody facts for counter entries.
exports.up = pgm => pgm.sql(`
  DO $body$
  DECLARE n text;
  BEGIN
    FOR n IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.lot_commands'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%octet_length(input%'
    LOOP EXECUTE format('ALTER TABLE shipit.lot_commands DROP CONSTRAINT %I',n); END LOOP;
  END $body$;
  ALTER TABLE shipit.lot_commands ADD CONSTRAINT lot_command_input_size
    CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16384);
  CREATE TABLE shipit.lot_message_requests (
    id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,lot_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL,fingerprint text NOT NULL,
    targets jsonb NOT NULL CHECK(jsonb_typeof(targets)='array'),result jsonb,
    correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(organization_id,franchise_id,lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id),
    UNIQUE(organization_id,franchise_id,actor_id,key_digest)
  );
  REVOKE ALL ON shipit.lot_message_requests FROM PUBLIC;
  CREATE INDEX lot_command_planning_idx ON shipit.lot_commands(organization_id,franchise_id,lot_id,expected_version DESC)
    WHERE input ? 'planning_entry_ids' OR input ? 'note';
  CREATE FUNCTION shipit.lot_planning_snapshot(org uuid,franchise uuid,lot uuid) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
      SELECT COALESCE((SELECT jsonb_build_object('planning_entry_ids',c.input->'planning_entry_ids') FROM shipit.lot_commands c
        WHERE c.organization_id=org AND c.franchise_id=franchise AND c.lot_id=lot AND c.input ? 'planning_entry_ids'
        ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1),'{}'::jsonb)
      || COALESCE((SELECT jsonb_build_object('note',c.input->'note') FROM shipit.lot_commands c
        WHERE c.organization_id=org AND c.franchise_id=franchise AND c.lot_id=lot AND c.input ? 'note'
        ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1),'{}'::jsonb)
    $fn$;
  REVOKE ALL ON FUNCTION shipit.lot_planning_snapshot(uuid,uuid,uuid) FROM PUBLIC;
  DO $body$
  DECLARE definition text; old text;
  BEGIN
    definition=pg_get_functiondef('shipit.lot_snapshot(uuid,uuid,uuid)'::regprocedure);
    old='SELECT jsonb_build_object(';
    IF position(old IN definition)=0 THEN RAISE EXCEPTION 'LOT_SNAPSHOT_SHAPE_CHANGED'; END IF;
    EXECUTE replace(definition,old,'SELECT shipit.lot_planning_snapshot(org,franchise,lot) || jsonb_build_object(');
    definition=pg_get_functiondef('shipit.guard_lot()'::regprocedure);
    old='OR NOT EXISTS(SELECT 1 FROM shipit.pricing_rules';
    IF position(old IN definition)=0 THEN RAISE EXCEPTION 'LOT_GUARD_SHAPE_CHANGED'; END IF;
    definition=replace(definition,old,'OR COALESCE(jsonb_array_length(c.input->''planning_entry_ids''),0)=0 AND NOT EXISTS(SELECT 1 FROM shipit.pricing_rules');
    old='RETURN NEW;';
    definition=replace(definition,old,$insert$
      IF c.input ? 'planning_entry_ids' THEN
        IF jsonb_typeof(c.input->'planning_entry_ids')<>'array' OR jsonb_array_length(c.input->'planning_entry_ids')>50
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.input->'planning_entry_ids') e
            WHERE NOT EXISTS(SELECT 1 FROM shipit.counter_bookings b WHERE b.organization_id=NEW.organization_id
              AND b.franchise_id=NEW.franchise_id AND b.id::text=e.value))
          OR EXISTS(SELECT 1 FROM shipit.lots l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id
            AND l.id<>NEW.id AND l.state='active' AND EXISTS(
              SELECT 1 FROM jsonb_array_elements_text(shipit.lot_planning_snapshot(l.organization_id,l.franchise_id,l.id)->'planning_entry_ids') e
              WHERE c.input->'planning_entry_ids' ? e.value))
        THEN RAISE EXCEPTION 'LOT_PLANNING_ENTRY_INVALID' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    $insert$);
    EXECUTE definition;
  END $body$;
`);
