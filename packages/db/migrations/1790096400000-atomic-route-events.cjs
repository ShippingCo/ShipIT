// Forward-only #28; existing commands, manifests and event envelopes remain intact.
exports.up = pgm => {
  pgm.sql(String.raw`
ALTER TABLE shipit.routes
 ADD COLUMN execution_state text NOT NULL DEFAULT 'pending' CHECK(execution_state IN ('pending','departed','arrived')),
 ADD COLUMN last_effective_at timestamptz CHECK(isfinite(last_effective_at)),
 ADD COLUMN base_eta_at timestamptz CHECK(isfinite(base_eta_at)),
 ADD COLUMN total_delay_minutes integer NOT NULL DEFAULT 0 CHECK(total_delay_minutes BETWEEN 0 AND 43200),
 ADD CONSTRAINT routes_execution_shape CHECK((execution_state='pending' AND last_effective_at IS NULL AND base_eta_at IS NULL AND total_delay_minutes=0)
   OR (execution_state IN ('departed','arrived') AND state='finalized' AND last_effective_at IS NOT NULL));
DO $extend$
DECLARE n text;expr text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.route_commands'::regclass AND conname='route_commands_operation_id_check';
 ALTER TABLE shipit.route_commands DROP CONSTRAINT route_commands_operation_id_check;
 EXECUTE format('ALTER TABLE shipit.route_commands ADD CONSTRAINT route_commands_operation_id_check CHECK ((%s) OR operation_id IN (''api.v1.routes.departure'',''api.v1.routes.delay'',''api.v1.routes.arrival''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname='domain_events_route_shape_check';
 ALTER TABLE shipit.domain_events DROP CONSTRAINT domain_events_route_shape_check;
 expr=replace(expr,'''route.created''::text','''route.departed''::text, ''route.delayed''::text, ''route.arrived''::text, ''route.created''::text');
 EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT domain_events_route_shape_check CHECK (%s)',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_action_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK ((%s) OR action IN (''routes.event'',''routes.departure'',''routes.delay'',''routes.arrival''))',expr);
END $extend$;
CREATE OR REPLACE FUNCTION shipit.route_event_type(op text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE op WHEN 'api.v1.routes.create' THEN 'route.created' WHEN 'api.v1.routes.update' THEN 'route.updated' WHEN 'api.v1.routes.archive' THEN 'route.archived'
 WHEN 'api.v1.routes.finalize' THEN 'route.manifest_finalized' WHEN 'api.v1.routes.lot.attach' THEN 'route.lot_attached' WHEN 'api.v1.routes.lot.detach' THEN 'route.lot_detached'
 WHEN 'api.v1.routes.parcel.attach' THEN 'route.parcel_attached' WHEN 'api.v1.routes.parcel.detach' THEN 'route.parcel_detached'
 WHEN 'api.v1.routes.departure' THEN 'route.departed' WHEN 'api.v1.routes.delay' THEN 'route.delayed' WHEN 'api.v1.routes.arrival' THEN 'route.arrived' END
$fn$;
ALTER TABLE shipit.route_commands ADD CONSTRAINT route_event_input_check CHECK(operation_id NOT IN
 ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') OR (
 input->>'kind'=substring(operation_id from 15) AND input->>'expected_version'=expected_version::text
 AND (input->>'manifest_id')::uuid IS NOT NULL AND (input->>'manifest_version')::integer BETWEEN 1 AND 2147483646
 AND isfinite((input->>'effective_at')::timestamptz) AND (input->>'evidence_ref')::uuid IS NOT NULL
 AND CASE operation_id WHEN 'api.v1.routes.departure' THEN
   input-ARRAY['kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref','base_eta_at']='{}'::jsonb
   AND input ? 'base_eta_at' AND (input->'base_eta_at'='null'::jsonb OR (isfinite((input->>'base_eta_at')::timestamptz) AND (input->>'base_eta_at')::timestamptz >= (input->>'effective_at')::timestamptz))
 WHEN 'api.v1.routes.delay' THEN input-ARRAY['kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref','total_delay_minutes']='{}'::jsonb
   AND (input->>'total_delay_minutes')::integer BETWEEN 0 AND 43200
 ELSE input-ARRAY['kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref']='{}'::jsonb END) IS TRUE);

CREATE TABLE shipit.route_parcel_effects (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,route_id uuid NOT NULL,manifest_id uuid NOT NULL,command_id uuid NOT NULL,event_id uuid NOT NULL,
 parcel_id uuid NOT NULL,booking_id uuid NOT NULL,route_version integer NOT NULL CHECK(route_version>1),effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),
 prior_status text NOT NULL,outcome text NOT NULL CHECK(outcome IN ('updated','skipped')),skip_reason text,
 base_eta_at timestamptz CHECK(isfinite(base_eta_at)),revised_eta_at timestamptz CHECK(isfinite(revised_eta_at)),
 total_delay_minutes integer NOT NULL CHECK(total_delay_minutes BETWEEN 0 AND 43200),parcel_event_id uuid REFERENCES shipit.domain_events(event_id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,franchise_id,event_id,parcel_id),UNIQUE(command_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,route_id,manifest_id,parcel_id) REFERENCES shipit.route_manifest_parcels(organization_id,franchise_id,route_id,manifest_id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(event_id) REFERENCES shipit.domain_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK(((outcome='updated' AND skip_reason IS NULL) OR (outcome='skipped' AND skip_reason IN ('terminal','booking_inactive','ineligible_state')
   AND base_eta_at IS NULL AND revised_eta_at IS NULL AND parcel_event_id IS NULL)) IS TRUE)
);
CREATE INDEX route_effects_parcel_idx ON shipit.route_parcel_effects(organization_id,franchise_id,parcel_id,route_version DESC);
CREATE INDEX route_effects_command_idx ON shipit.route_parcel_effects(organization_id,franchise_id,command_id);
CREATE INDEX route_event_commands_read_idx ON shipit.route_commands(organization_id,franchise_id,route_id,expected_version DESC)
 WHERE operation_id IN ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival');

CREATE OR REPLACE FUNCTION shipit.bind_dispatch_manifest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.operation_id='api.v1.parcels.dispatch' THEN
  IF NOT EXISTS(SELECT 1 FROM shipit.route_manifest_parcels p JOIN shipit.routes r
    ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id AND r.id=p.route_id
    WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.parcel_id=NEW.parcel_id AND p.booking_id=NEW.booking_id
      AND p.manifest_id=(NEW.input->>'manifest_id')::uuid AND p.finalized AND r.execution_state='pending')
  THEN RAISE EXCEPTION 'PARCEL_MANIFEST_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO shipit.parcel_dispatch_manifests(command_id,organization_id,franchise_id,booking_id,parcel_id,manifest_id)
    VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.parcel_id,(NEW.input->>'manifest_id')::uuid);
 END IF;
 RETURN NEW;
END $fn$;

CREATE FUNCTION shipit.guard_route_effect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands; p shipit.parcels; b shipit.bookings; e shipit.domain_events; expected_reason text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUTE_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM shipit.route_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id AND state='reserved';
 SELECT * INTO p FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.parcel_id;
 SELECT * INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 expected_reason=CASE WHEN NEW.prior_status IN ('delivered','rto') THEN 'terminal' WHEN b.state<>'active' THEN 'booking_inactive'
   WHEN NEW.prior_status NOT IN ('dispatched','in_transit') THEN 'ineligible_state' END;
 IF c.id IS NULL OR c.operation_id NOT IN ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') OR c.route_id<>NEW.route_id
 OR (c.input->>'manifest_id')::uuid<>NEW.manifest_id OR NEW.route_version<>c.expected_version+1 OR NEW.effective_at<>(c.input->>'effective_at')::timestamptz
 OR NEW.skip_reason IS DISTINCT FROM expected_reason OR NEW.outcome<>(CASE WHEN expected_reason IS NULL THEN 'updated' ELSE 'skipped' END)
 THEN RAISE EXCEPTION 'ROUTE_EFFECT_INVALID' USING ERRCODE='23514'; END IF;
 IF c.operation_id='api.v1.routes.departure' AND expected_reason IS NULL AND NEW.prior_status='dispatched' THEN
   SELECT * INTO e FROM shipit.domain_events WHERE event_id=NEW.parcel_event_id;
   IF e.event_id IS NULL OR e.organization_id<>NEW.organization_id OR e.franchise_id<>NEW.franchise_id OR e.parcel_id<>NEW.parcel_id
     OR e.event_type<>'parcel.in_transit' OR e.envelope->'payload'->>'movement_evidence_ref' IS DISTINCT FROM NEW.event_id::text
     OR e.envelope->'payload'->>'route_id' IS DISTINCT FROM NEW.route_id::text OR e.envelope->>'correlation_id' IS DISTINCT FROM c.correlation_id::text
     OR p.status<>'in_transit' THEN RAISE EXCEPTION 'ROUTE_EFFECT_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW.parcel_event_id IS NOT NULL OR p.status<>NEW.prior_status THEN RAISE EXCEPTION 'ROUTE_EFFECT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_effect_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_parcel_effects FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_effect();

CREATE FUNCTION shipit.check_route_event_complete(command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands;r shipit.routes;m shipit.route_manifests;a shipit.route_audit_events;e shipit.domain_events;updated integer;skipped integer;revised timestamptz;eta jsonb;expected jsonb;
BEGIN
 SELECT * INTO c FROM shipit.route_commands WHERE id=command;
 SELECT * INTO r FROM shipit.routes WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND id=c.route_id;
 SELECT * INTO m FROM shipit.route_manifests WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND id=r.current_manifest_id;
 SELECT * INTO a FROM shipit.route_audit_events WHERE command_id=c.id;
 SELECT * INTO e FROM shipit.domain_events WHERE route_command_id=c.id;
 SELECT count(*) FILTER(WHERE outcome='updated'),count(*) FILTER(WHERE outcome='skipped') INTO updated,skipped FROM shipit.route_parcel_effects WHERE command_id=c.id;
 revised=CASE WHEN r.execution_state<>'arrived' THEN r.base_eta_at+make_interval(mins=>r.total_delay_minutes) END;
 eta=jsonb_build_object('state',CASE WHEN r.execution_state='arrived' THEN 'arrived' WHEN revised IS NULL THEN 'unavailable' ELSE 'available' END,
   'base_at',shipit.lot_wire_time(r.base_eta_at),'revised_at',shipit.lot_wire_time(revised),'total_delay_minutes',r.total_delay_minutes);
 expected=jsonb_build_object('event_id',e.event_id,'route_id',r.id,'version',r.version,'manifest_id',m.id,'manifest_version',m.version,
   'kind',c.input->>'kind','effective_at',shipit.lot_wire_time(r.last_effective_at),'updated_count',updated,'skipped_count',skipped,'eta',eta);
 IF c.state<>'committed' OR r.last_command_id IS DISTINCT FROM c.id OR r.version<>c.expected_version+1 OR c.result IS DISTINCT FROM expected
 OR m.id IS NULL OR NOT m.finalized OR m.id<>(c.input->>'manifest_id')::uuid OR m.version<>(c.input->>'manifest_version')::integer OR updated+skipped<>m.parcel_count
 OR a.id IS NULL OR e.event_id IS NULL OR a.id<>e.event_id OR a.committed_version<>r.version OR a.manifest_id<>m.id
 OR a.actor_id<>c.principal_id OR a.correlation_id<>c.correlation_id OR a.occurred_at<>c.occurred_at OR a.action<>shipit.route_event_type(c.operation_id)
 OR e.event_type<>a.action OR e.aggregate_sequence<>r.version OR e.occurred_at<>c.occurred_at
 OR e.envelope->'actor' IS DISTINCT FROM jsonb_build_object('type','user','id',c.principal_id)
 OR e.envelope->>'correlation_id' IS DISTINCT FROM c.correlation_id::text OR e.envelope->>'occurred_at' IS DISTINCT FROM shipit.lot_wire_time(c.occurred_at)
 OR e.envelope->'payload' IS DISTINCT FROM jsonb_build_object('manifest_id',m.id,'affected_set_ref',e.event_id)
 OR (SELECT count(*) FROM shipit.domain_events WHERE route_command_id=c.id)<>1
 OR EXISTS(SELECT 1 FROM shipit.route_manifests WHERE command_id=c.id)
 OR (c.operation_id='api.v1.routes.departure' AND EXISTS(SELECT 1 FROM shipit.route_parcel_effects WHERE command_id=c.id
   AND skip_reason='ineligible_state' AND prior_status IN ('booked','checked_in')))
 OR EXISTS(SELECT 1 FROM shipit.route_parcel_effects x WHERE x.command_id=c.id AND
   (x.event_id<>e.event_id OR x.route_id<>r.id OR x.manifest_id<>m.id OR (x.outcome='updated' AND
     (x.base_eta_at IS DISTINCT FROM r.base_eta_at OR x.revised_eta_at IS DISTINCT FROM revised OR x.total_delay_minutes<>r.total_delay_minutes))))
 THEN RAISE EXCEPTION 'ROUTE_EVENT_INCOMPLETE' USING ERRCODE='23514'; END IF;
END $fn$;

-- Preserve the released planning guards verbatim, inserting one explicitly bounded
-- operational branch. Fail migration if the expected released function shape changes.
DO $extend$
DECLARE source text;marker text;
BEGIN
 SELECT pg_get_functiondef('shipit.guard_route()'::regprocedure) INTO source;
 marker=' IF TG_OP=''INSERT'' THEN';
 IF position(marker in source)=0 THEN RAISE EXCEPTION 'ROUTE_GUARD_UPGRADE_MISMATCH'; END IF;
 source=replace(source,marker,$branch$
 IF c.operation_id IN ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') THEN
  IF TG_OP<>'UPDATE' OR OLD.state<>'finalized' OR NEW.version<>OLD.version+1 OR OLD.version<>c.expected_version OR NEW.updated_at<>c.occurred_at
   OR (to_jsonb(NEW)-ARRAY['version','last_command_id','updated_at','execution_state','last_effective_at','base_eta_at','total_delay_minutes']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['version','last_command_id','updated_at','execution_state','last_effective_at','base_eta_at','total_delay_minutes'])
   OR NEW.last_effective_at IS DISTINCT FROM (c.input->>'effective_at')::timestamptz
   OR (OLD.last_effective_at IS NOT NULL AND NEW.last_effective_at<=OLD.last_effective_at)
   OR NEW.execution_state<>(CASE c.operation_id WHEN 'api.v1.routes.departure' THEN 'departed' WHEN 'api.v1.routes.arrival' THEN 'arrived' ELSE 'departed' END)
   OR OLD.execution_state<>(CASE c.operation_id WHEN 'api.v1.routes.departure' THEN 'pending' ELSE 'departed' END)
   OR NEW.base_eta_at IS DISTINCT FROM (CASE WHEN c.operation_id='api.v1.routes.departure' THEN (c.input->>'base_eta_at')::timestamptz ELSE OLD.base_eta_at END)
   OR NEW.total_delay_minutes IS DISTINCT FROM (CASE WHEN c.operation_id='api.v1.routes.delay' THEN (c.input->>'total_delay_minutes')::integer ELSE OLD.total_delay_minutes END)
   OR NEW.total_delay_minutes<OLD.total_delay_minutes
  THEN RAISE EXCEPTION 'ROUTE_EXECUTION_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN$branch$);
 EXECUTE source;
 SELECT pg_get_functiondef('shipit.check_route_command_complete()'::regprocedure) INTO source;
 marker=' SELECT * INTO r FROM shipit.routes';
 IF position(marker in source)=0 THEN RAISE EXCEPTION 'ROUTE_COMPLETE_UPGRADE_MISMATCH'; END IF;
 source=replace(source,marker,$branch$
 IF c.operation_id IN ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') THEN
  PERFORM shipit.check_route_event_complete(c.id); RETURN NULL;
 END IF;
 SELECT * INTO r FROM shipit.routes$branch$);
 EXECUTE source;
END $extend$;
REVOKE ALL ON shipit.route_parcel_effects FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_route_effect(),shipit.check_route_event_complete(uuid) FROM PUBLIC;
`);
};
