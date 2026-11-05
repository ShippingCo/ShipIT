// Audited planning metadata never changes Parcel custody or physical manifests.
exports.up=pgm=>pgm.sql(`
 CREATE TABLE shipit.route_message_requests (
  id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,route_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL,fingerprint text NOT NULL,
  targets jsonb NOT NULL CHECK(jsonb_typeof(targets)='array'),result jsonb,correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id),
  UNIQUE(organization_id,franchise_id,actor_id,key_digest)
 );
 REVOKE ALL ON shipit.route_message_requests FROM PUBLIC;
 CREATE FUNCTION shipit.guard_route_message_request() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
 BEGIN
  IF TG_OP='DELETE' OR OLD.result IS NOT NULL OR (to_jsonb(NEW)-'result') IS DISTINCT FROM (to_jsonb(OLD)-'result')
  THEN RAISE EXCEPTION 'ROUTE_MESSAGE_REQUEST_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END $fn$;
 CREATE TRIGGER route_message_request_guard BEFORE UPDATE OR DELETE ON shipit.route_message_requests FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_message_request();
 DO $body$ DECLARE n text; BEGIN
  FOR n IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.route_commands'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%octet_length(input%'
  LOOP EXECUTE format('ALTER TABLE shipit.route_commands DROP CONSTRAINT %I',n); END LOOP;
 END $body$;
 ALTER TABLE shipit.route_commands ADD CONSTRAINT route_command_input_size CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16384);
 CREATE INDEX route_command_planning_idx ON shipit.route_commands(organization_id,franchise_id,route_id,expected_version DESC)
  WHERE input ? 'planning_entry_ids' OR input ? 'planning_progress' OR input ? 'planning_delay_minutes';
 CREATE FUNCTION shipit.route_planning_snapshot(org uuid,franchise uuid,route uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 DECLARE field text;value jsonb;result jsonb='{}'; BEGIN
  FOREACH field IN ARRAY ARRAY['planning_entry_ids','planning_progress','planning_delay_minutes'] LOOP
   SELECT c.input->field INTO value FROM shipit.route_commands c WHERE c.organization_id=org AND c.franchise_id=franchise AND c.route_id=route AND c.input ? field
    ORDER BY COALESCE(c.expected_version,0) DESC LIMIT 1;
   IF FOUND THEN result=result||jsonb_build_object(field,value); END IF;
  END LOOP;
  RETURN result;
 END $fn$;
 REVOKE ALL ON FUNCTION shipit.route_planning_snapshot(uuid,uuid,uuid),shipit.guard_route_message_request() FROM PUBLIC;
 DO $body$
 DECLARE definition text;old text;
 BEGIN
  definition=pg_get_functiondef('shipit.route_snapshot(uuid,uuid,uuid)'::regprocedure);old='SELECT jsonb_build_object(';
  IF position(old IN definition)=0 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_SHAPE_CHANGED'; END IF;
  EXECUTE replace(definition,old,'SELECT shipit.route_planning_snapshot(org,franchise,route) || jsonb_build_object(');
  definition=pg_get_functiondef('shipit.guard_route()'::regprocedure);
  EXECUTE replace(definition,'RETURN NEW;',$insert$
   IF c.input ? 'planning_entry_ids' AND (jsonb_typeof(c.input->'planning_entry_ids')<>'array' OR jsonb_array_length(c.input->'planning_entry_ids')>50 OR
     EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.input->'planning_entry_ids') e WHERE NOT EXISTS(SELECT 1 FROM shipit.counter_bookings b
      WHERE b.organization_id=NEW.organization_id AND b.franchise_id=NEW.franchise_id AND b.id::text=e.value)))
   THEN RAISE EXCEPTION 'ROUTE_PLANNING_ENTRY_INVALID' USING ERRCODE='23514'; END IF;
   IF c.input ? 'planning_progress' AND (c.input->>'planning_progress' NOT IN ('scheduled','departed','arrived') OR EXISTS(
     SELECT 1 FROM shipit.route_manifests m WHERE m.organization_id=NEW.organization_id AND m.franchise_id=NEW.franchise_id AND m.id=NEW.current_manifest_id AND m.parcel_count>0))
   THEN RAISE EXCEPTION 'ROUTE_PLANNING_PROGRESS_INVALID' USING ERRCODE='23514'; END IF;
   IF c.input ? 'planning_delay_minutes' AND ((c.input->>'planning_delay_minutes')::integer NOT BETWEEN 0 AND 43200)
   THEN RAISE EXCEPTION 'ROUTE_PLANNING_DELAY_INVALID' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  $insert$);
  definition=pg_get_functiondef('shipit.guard_whatsapp_outbound()'::regprocedure);
  old='AND NOT EXISTS(SELECT 1 FROM shipit.route_delay_reminder_events r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=NEW.source_id)';
  IF position(old IN definition)=0 THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_GUARD_CHANGED'; END IF;
  EXECUTE replace(definition,old,old||$insert$
   AND NOT EXISTS(SELECT 1 FROM shipit.route_message_requests r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=NEW.source_id AND NEW.purpose='updates'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.targets) t WHERE t->>'parcel_id'=NEW.affected_entity_id::text AND t->>'customer_id'=NEW.customer_id::text))
  $insert$);
 END $body$;
`);
