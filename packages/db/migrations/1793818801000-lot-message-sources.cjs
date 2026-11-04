exports.up=pgm=>pgm.sql(`
 DO $body$
 DECLARE definition text; old text;
 BEGIN
  definition=pg_get_functiondef('shipit.guard_whatsapp_outbound()'::regprocedure);
  old='AND NOT EXISTS(SELECT 1 FROM shipit.route_delay_reminder_events r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=NEW.source_id)';
  IF position(old IN definition)=0 THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_GUARD_CHANGED'; END IF;
  EXECUTE replace(definition,old,old||$insert$
    AND NOT EXISTS(SELECT 1 FROM shipit.lot_message_requests r WHERE r.organization_id=NEW.organization_id
      AND r.franchise_id=NEW.franchise_id AND r.id=NEW.source_id AND NEW.purpose='updates'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.targets) t WHERE t->>'parcel_id'=NEW.affected_entity_id::text AND t->>'customer_id'=NEW.customer_id::text))
  $insert$);
  definition=pg_get_functiondef('shipit.lot_planning_snapshot(uuid,uuid,uuid)'::regprocedure);
  EXECUTE replace(definition,'SELECT COALESCE(',
    $insert$SELECT COALESCE((SELECT jsonb_build_object('planning_route_id',c.input->'planning_route_id') FROM shipit.lot_commands c
      WHERE c.organization_id=org AND c.franchise_id=franchise AND c.lot_id=lot AND c.input ? 'planning_route_id'
      ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1),'{}'::jsonb) || COALESCE($insert$);
  definition=pg_get_functiondef('shipit.guard_lot()'::regprocedure);
  EXECUTE replace(definition,'RETURN NEW;',$insert$
    IF c.input->>'planning_route_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.routes r WHERE r.organization_id=NEW.organization_id
      AND r.franchise_id=NEW.franchise_id AND r.id::text=c.input->>'planning_route_id' AND r.state='planning')
    THEN RAISE EXCEPTION 'LOT_PLANNING_ROUTE_INVALID' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  $insert$);
 END $body$;
`);
