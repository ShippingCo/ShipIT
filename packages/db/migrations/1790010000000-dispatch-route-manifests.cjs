// Forward-only Issue #27. Legacy opaque dispatch facts are retained without rewriting.
exports.up = pgm => {
  pgm.sql(String.raw`

CREATE TABLE shipit.route_commands (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 route_id uuid NOT NULL, operation_id text NOT NULL CHECK(operation_id IN ('api.v1.routes.create','api.v1.routes.update','api.v1.routes.archive','api.v1.routes.finalize',
   'api.v1.routes.lot.attach','api.v1.routes.lot.detach','api.v1.routes.parcel.attach','api.v1.routes.parcel.detach')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 normalization_version integer NOT NULL DEFAULT 1 CHECK(normalization_version=1), expected_version integer,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=2048), source_resource_id uuid,
 correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 state text NOT NULL DEFAULT 'reserved', http_status integer, result jsonb, committed_at timestamptz, retain_until timestamptz,
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(principal_id,organization_id,franchise_id,operation_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 CHECK(((operation_id='api.v1.routes.create' AND expected_version IS NULL) OR
   (operation_id<>'api.v1.routes.create' AND expected_version BETWEEN 1 AND 2147483646)) IS TRUE),
 CHECK((operation_id IN ('api.v1.routes.lot.attach','api.v1.routes.lot.detach','api.v1.routes.parcel.attach','api.v1.routes.parcel.detach'))=(source_resource_id IS NOT NULL)),
 CHECK(((state='reserved' AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL) OR
   (state='committed' AND http_status=CASE WHEN operation_id='api.v1.routes.create' THEN 201 ELSE 200 END
     AND jsonb_typeof(result)='object' AND octet_length(result::text)<=4096 AND isfinite(committed_at) AND isfinite(retain_until)
     AND retain_until>=committed_at+interval '24 hours')) IS TRUE)
);
CREATE TABLE shipit.routes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 origin text NOT NULL CHECK(char_length(origin) BETWEEN 1 AND 120 AND origin=btrim(origin) AND origin !~ '[[:cntrl:]]'),
 destination text NOT NULL CHECK(char_length(destination) BETWEEN 1 AND 120 AND destination=btrim(destination) AND destination !~ '[[:cntrl:]]'),
 mode text NOT NULL CHECK(mode IN ('road','rail','air','sea')), carrier_code text CHECK(carrier_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
 scheduled_departure_at timestamptz NOT NULL CHECK(isfinite(scheduled_departure_at)),
 state text NOT NULL DEFAULT 'planning' CHECK(state IN ('planning','finalized','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), current_manifest_id uuid NOT NULL, last_command_id uuid NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,last_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX routes_page_idx ON shipit.routes(organization_id,franchise_id,created_at DESC,id DESC);
ALTER TABLE shipit.route_commands ADD FOREIGN KEY(organization_id,franchise_id,route_id)
 REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE shipit.parcels ADD UNIQUE(organization_id,franchise_id,id);
CREATE TABLE shipit.route_lots (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, route_id uuid NOT NULL, lot_id uuid NOT NULL,
 start_command_id uuid NOT NULL, started_at timestamptz NOT NULL CHECK(isfinite(started_at)), end_command_id uuid, ended_at timestamptz,
 UNIQUE(organization_id,franchise_id,route_id,lot_id,id),
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,start_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,end_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK(((end_command_id IS NULL AND ended_at IS NULL) OR (end_command_id IS NOT NULL AND ended_at IS NOT NULL AND isfinite(ended_at) AND ended_at>=started_at)) IS TRUE)
);
CREATE UNIQUE INDEX route_lots_active_idx ON shipit.route_lots(organization_id,franchise_id,route_id,lot_id) WHERE ended_at IS NULL;
CREATE INDEX route_lots_target_idx ON shipit.route_lots(organization_id,franchise_id,lot_id,route_id) WHERE ended_at IS NULL;
CREATE INDEX route_lots_start_idx ON shipit.route_lots(organization_id,franchise_id,start_command_id);
CREATE INDEX route_lots_end_idx ON shipit.route_lots(organization_id,franchise_id,end_command_id);

CREATE TABLE shipit.route_parcels (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, route_id uuid NOT NULL, parcel_id uuid NOT NULL,
 start_command_id uuid NOT NULL, started_at timestamptz NOT NULL CHECK(isfinite(started_at)), end_command_id uuid, ended_at timestamptz,
 UNIQUE(organization_id,franchise_id,route_id,parcel_id,id),
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,start_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,end_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK(((end_command_id IS NULL AND ended_at IS NULL) OR (end_command_id IS NOT NULL AND ended_at IS NOT NULL AND isfinite(ended_at) AND ended_at>=started_at)) IS TRUE)
);
CREATE UNIQUE INDEX route_parcels_active_idx ON shipit.route_parcels(organization_id,franchise_id,route_id,parcel_id) WHERE ended_at IS NULL;
CREATE INDEX route_parcels_target_idx ON shipit.route_parcels(organization_id,franchise_id,parcel_id,route_id) WHERE ended_at IS NULL;
CREATE INDEX route_parcels_start_idx ON shipit.route_parcels(organization_id,franchise_id,start_command_id);
CREATE INDEX route_parcels_end_idx ON shipit.route_parcels(organization_id,franchise_id,end_command_id);

CREATE TABLE shipit.route_manifests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, route_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), finalized boolean NOT NULL, parcel_count integer NOT NULL CHECK(parcel_count BETWEEN 0 AND 1000),
 command_id uuid NOT NULL, created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 UNIQUE(organization_id,franchise_id,route_id,version), UNIQUE(organization_id,franchise_id,route_id,id),
 UNIQUE(organization_id,franchise_id,route_id,id,finalized), UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK(NOT finalized OR parcel_count>0)
);
ALTER TABLE shipit.routes ADD FOREIGN KEY(organization_id,franchise_id,id,current_manifest_id)
 REFERENCES shipit.route_manifests(organization_id,franchise_id,route_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE shipit.route_manifest_parcels (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, route_id uuid NOT NULL, manifest_id uuid NOT NULL,
 booking_id uuid NOT NULL, parcel_id uuid NOT NULL, finalized boolean NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,manifest_id,parcel_id),
 UNIQUE(organization_id,franchise_id,route_id,manifest_id,parcel_id),
 UNIQUE(organization_id,franchise_id,manifest_id,booking_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,route_id,manifest_id,finalized) REFERENCES shipit.route_manifests(organization_id,franchise_id,route_id,id,finalized) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX route_manifest_dispatch_once_idx ON shipit.route_manifest_parcels(organization_id,franchise_id,parcel_id) WHERE finalized;
ALTER TABLE shipit.lot_memberships ADD UNIQUE(organization_id,franchise_id,lot_id,parcel_id,id);
CREATE TABLE shipit.route_manifest_sources (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, route_id uuid NOT NULL, manifest_id uuid NOT NULL,
 parcel_id uuid NOT NULL, source_id uuid NOT NULL, lot_id uuid, lot_membership_id uuid,
 lot_source_id uuid GENERATED ALWAYS AS (CASE WHEN lot_id IS NOT NULL THEN source_id END) STORED,
 direct_source_id uuid GENERATED ALWAYS AS (CASE WHEN lot_id IS NULL THEN source_id END) STORED,
 PRIMARY KEY(organization_id,franchise_id,manifest_id,parcel_id,source_id),
 CHECK((lot_id IS NULL)=(lot_membership_id IS NULL)),
 FOREIGN KEY(organization_id,franchise_id,route_id,manifest_id,parcel_id) REFERENCES shipit.route_manifest_parcels(organization_id,franchise_id,route_id,manifest_id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,route_id,lot_id,lot_source_id) REFERENCES shipit.route_lots(organization_id,franchise_id,route_id,lot_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,route_id,parcel_id,direct_source_id) REFERENCES shipit.route_parcels(organization_id,franchise_id,route_id,parcel_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,lot_id,parcel_id,lot_membership_id) REFERENCES shipit.lot_memberships(organization_id,franchise_id,lot_id,parcel_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION shipit.guard_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ROUTE_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM shipit.route_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.last_command_id AND route_id=NEW.id AND state='reserved';
 IF c.id IS NULL THEN RAISE EXCEPTION 'ROUTE_COMMAND_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF c.operation_id<>'api.v1.routes.create' OR NEW.version<>1 OR NEW.state<>'planning' OR NEW.created_at<>c.occurred_at
   THEN RAISE EXCEPTION 'ROUTE_CREATE_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['origin','destination','mode','carrier_code','scheduled_departure_at','state','version','current_manifest_id','last_command_id','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['origin','destination','mode','carrier_code','scheduled_departure_at','state','version','current_manifest_id','last_command_id','updated_at'])
    OR OLD.state<>'planning' OR OLD.version IS DISTINCT FROM c.expected_version OR NEW.version<>OLD.version+1
    OR NEW.state<>(CASE c.operation_id WHEN 'api.v1.routes.finalize' THEN 'finalized' WHEN 'api.v1.routes.archive' THEN 'archived' ELSE 'planning' END)
    OR (c.operation_id='api.v1.routes.archive' AND NEW.current_manifest_id<>OLD.current_manifest_id)
  THEN RAISE EXCEPTION 'ROUTE_MUTATION_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.updated_at<>c.occurred_at OR
   (c.operation_id IN ('api.v1.routes.create','api.v1.routes.update') AND
     (NEW.origin IS DISTINCT FROM c.input->>'origin' OR NEW.destination IS DISTINCT FROM c.input->>'destination'
      OR NEW.mode IS DISTINCT FROM c.input->>'mode' OR NEW.carrier_code IS DISTINCT FROM c.input->>'carrier_code'
      OR NEW.scheduled_departure_at IS DISTINCT FROM (c.input->>'scheduled_departure_at')::timestamptz)) OR
   (TG_OP='UPDATE' AND c.operation_id<>'api.v1.routes.update' AND
     (NEW.origin,NEW.destination,NEW.mode,NEW.carrier_code,NEW.scheduled_departure_at) IS DISTINCT FROM
     (OLD.origin,OLD.destination,OLD.mode,OLD.carrier_code,OLD.scheduled_departure_at))
 THEN RAISE EXCEPTION 'ROUTE_METADATA_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER routes_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.routes FOR EACH ROW EXECUTE FUNCTION shipit.guard_route();
CREATE FUNCTION shipit.guard_route_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands; target uuid; kind text; r shipit.routes;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ROUTE_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 kind=CASE TG_TABLE_NAME WHEN 'route_lots' THEN 'lot' ELSE 'parcel' END;
 target=(to_jsonb(NEW)->>(kind||'_id'))::uuid;
 SELECT * INTO r FROM shipit.routes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.route_id FOR UPDATE;
 SELECT * INTO c FROM shipit.route_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
   AND id=CASE WHEN TG_OP='INSERT' THEN NEW.start_command_id ELSE NEW.end_command_id END AND route_id=NEW.route_id AND state='reserved';
 IF r.id IS NULL OR r.state<>'planning' OR c.id IS NULL OR c.expected_version<>r.version OR c.source_resource_id<>target
   OR c.operation_id<>('api.v1.routes.'||kind||(CASE WHEN TG_OP='INSERT' THEN '.attach' ELSE '.detach' END))
 THEN RAISE EXCEPTION 'ROUTE_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.started_at<>c.occurred_at OR NEW.ended_at IS NOT NULL THEN RAISE EXCEPTION 'ROUTE_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['ended_at','end_command_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ended_at','end_command_id'])
    OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS DISTINCT FROM c.occurred_at
  THEN RAISE EXCEPTION 'ROUTE_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_lots_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_lots FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_source();
CREATE TRIGGER route_parcels_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_parcels FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_source();

CREATE FUNCTION shipit.guard_route_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands; m shipit.route_manifests;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUTE_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='route_manifests' THEN
  SELECT * INTO c FROM shipit.route_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id AND route_id=NEW.route_id AND state='reserved';
  IF c.id IS NULL OR c.operation_id='api.v1.routes.archive' OR NEW.version<>COALESCE(c.expected_version,0)+1
   OR NEW.finalized<>(c.operation_id='api.v1.routes.finalize') OR NEW.created_at<>c.occurred_at
  THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO m FROM shipit.route_manifests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.manifest_id;
  IF m.id IS NULL OR NOT EXISTS(SELECT 1 FROM shipit.route_commands WHERE id=m.command_id AND state='reserved')
  THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_manifests_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_manifests FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_snapshot();
CREATE TRIGGER route_manifest_parcels_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_manifest_parcels FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_snapshot();
CREATE TRIGGER route_manifest_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_manifest_sources FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_snapshot();

-- The Lot owner remains the command authority. SQL also protects direct runtime writes.
CREATE FUNCTION shipit.guard_lot_active_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE lot uuid;
BEGIN
 IF TG_TABLE_NAME='lots' THEN lot=NEW.id; ELSE lot=NEW.lot_id; END IF;
 IF TG_TABLE_NAME='lots' THEN IF NEW.state='active' THEN RETURN NEW; END IF; END IF;
 IF EXISTS(SELECT 1 FROM shipit.route_lots s JOIN shipit.routes r
    ON r.organization_id=s.organization_id AND r.franchise_id=s.franchise_id AND r.id=s.route_id
    WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.lot_id=lot AND s.ended_at IS NULL AND r.state='planning')
 THEN RAISE EXCEPTION 'LOT_ACTIVE_ROUTE' USING ERRCODE='23514',CONSTRAINT='lot_active_route_guard'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER lots_route_guard BEFORE UPDATE ON shipit.lots FOR EACH ROW EXECUTE FUNCTION shipit.guard_lot_active_route();
CREATE TRIGGER lot_memberships_route_guard BEFORE INSERT OR UPDATE ON shipit.lot_memberships FOR EACH ROW EXECUTE FUNCTION shipit.guard_lot_active_route();

CREATE TABLE shipit.parcel_dispatch_manifests (
 command_id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 booking_id uuid NOT NULL, parcel_id uuid NOT NULL, manifest_id uuid NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,command_id,booking_id,parcel_id) REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,manifest_id,booking_id,parcel_id) REFERENCES shipit.route_manifest_parcels(organization_id,franchise_id,manifest_id,booking_id,parcel_id) ON DELETE RESTRICT
);
CREATE INDEX parcel_dispatch_manifest_idx ON shipit.parcel_dispatch_manifests(organization_id,franchise_id,manifest_id,parcel_id);
CREATE FUNCTION shipit.bind_dispatch_manifest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.operation_id='api.v1.parcels.dispatch' THEN
  IF NOT EXISTS(SELECT 1 FROM shipit.route_manifest_parcels p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id
    AND p.parcel_id=NEW.parcel_id AND p.booking_id=NEW.booking_id AND p.manifest_id=(NEW.input->>'manifest_id')::uuid AND p.finalized)
  THEN RAISE EXCEPTION 'PARCEL_MANIFEST_INVALID' USING ERRCODE='23514'; END IF;
  INSERT INTO shipit.parcel_dispatch_manifests(command_id,organization_id,franchise_id,booking_id,parcel_id,manifest_id)
    VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.parcel_id,(NEW.input->>'manifest_id')::uuid);
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER parcel_commands_manifest AFTER INSERT ON shipit.parcel_commands FOR EACH ROW EXECUTE FUNCTION shipit.bind_dispatch_manifest();
CREATE TRIGGER parcel_dispatch_manifests_immutable BEFORE UPDATE OR DELETE ON shipit.parcel_dispatch_manifests FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();

CREATE TABLE shipit.route_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,route_id uuid NOT NULL,command_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT, action text NOT NULL,
 committed_version integer NOT NULL CHECK(committed_version>0),manifest_id uuid NOT NULL,
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 UNIQUE(organization_id,franchise_id,route_id,committed_version),UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,route_id,manifest_id) REFERENCES shipit.route_manifests(organization_id,franchise_id,route_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION shipit.route_event_type(op text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE op WHEN 'api.v1.routes.create' THEN 'route.created' WHEN 'api.v1.routes.update' THEN 'route.updated' WHEN 'api.v1.routes.archive' THEN 'route.archived'
 WHEN 'api.v1.routes.finalize' THEN 'route.manifest_finalized' WHEN 'api.v1.routes.lot.attach' THEN 'route.lot_attached' WHEN 'api.v1.routes.lot.detach' THEN 'route.lot_detached'
 WHEN 'api.v1.routes.parcel.attach' THEN 'route.parcel_attached' WHEN 'api.v1.routes.parcel.detach' THEN 'route.parcel_detached' END
$fn$;
CREATE FUNCTION shipit.append_route_audit(org uuid,franchise uuid,route uuid,command uuid,event uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands; r shipit.routes;
BEGIN
 SELECT * INTO c FROM shipit.route_commands WHERE organization_id=org AND franchise_id=franchise AND id=command AND route_id=route AND state='reserved';
 SELECT * INTO r FROM shipit.routes WHERE organization_id=org AND franchise_id=franchise AND id=route AND last_command_id=command;
 IF c.id IS NULL OR r.id IS NULL THEN RAISE EXCEPTION 'ROUTE_AUDIT_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO shipit.route_audit_events(id,organization_id,franchise_id,route_id,command_id,actor_id,action,committed_version,manifest_id,correlation_id,occurred_at)
 VALUES(event,org,franchise,route,command,c.principal_id,shipit.route_event_type(c.operation_id),r.version,r.current_manifest_id,c.correlation_id,c.occurred_at);
END $fn$;
CREATE TRIGGER route_audit_immutable BEFORE UPDATE OR DELETE ON shipit.route_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER route_commands_guard BEFORE UPDATE OR DELETE ON shipit.route_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_command();

ALTER TABLE shipit.domain_events ADD COLUMN route_id uuid,ADD COLUMN route_command_id uuid;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,route_command_id) REFERENCES shipit.route_commands(organization_id,franchise_id,id) ON DELETE RESTRICT;
DO $extend$
DECLARE n text;expr text;
BEGIN
 FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check','domain_events_envelope_check'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
  EXECUTE format('ALTER TABLE shipit.domain_events DROP CONSTRAINT %I',n);
  EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK ((route_id IS NULL AND route_command_id IS NULL AND (%s)) OR (route_id IS NOT NULL AND route_command_id IS NOT NULL))',n,expr);
 END LOOP;
END $extend$;
ALTER TABLE shipit.domain_events ADD CONSTRAINT domain_events_route_shape_check CHECK(route_id IS NULL OR (
 booking_id IS NULL AND parcel_id IS NULL AND lot_id IS NULL AND lot_command_id IS NULL AND booking_command_id IS NULL AND parcel_command_id IS NULL
 AND route_command_id=command_id AND aggregate_id=route_id AND octet_length(envelope::text)<=2048
 AND event_type IN ('route.created','route.updated','route.archived','route.manifest_finalized','route.lot_attached','route.lot_detached','route.parcel_attached','route.parcel_detached')
 AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text AND envelope->>'franchise_id'=franchise_id::text
 AND envelope->>'event_type'=event_type AND envelope->>'aggregate_id'=route_id::text AND envelope->>'aggregate_type'='route' AND envelope->>'schema_version'='1'
 AND (envelope->>'aggregate_version')::bigint=aggregate_sequence AND envelope->>'command_id'=command_id::text AND envelope->>'causation_id'=command_id::text
 AND envelope-ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE);
CREATE UNIQUE INDEX domain_events_route_revision_idx ON shipit.domain_events(organization_id,franchise_id,route_id,aggregate_sequence) WHERE route_id IS NOT NULL;
CREATE OR REPLACE FUNCTION shipit.fill_domain_event_ordering() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 NEW.occurred_at=COALESCE(NEW.occurred_at,(NEW.envelope->>'occurred_at')::timestamptz);
 NEW.aggregate_sequence=COALESCE(NEW.aggregate_sequence,(NEW.envelope->>'aggregate_version')::bigint);
 IF NEW.event_type IN ('booking.created','parcel.booked') THEN NEW.booking_command_id=COALESCE(NEW.booking_command_id,NEW.command_id);
 ELSIF NEW.route_id IS NOT NULL THEN NEW.route_command_id=COALESCE(NEW.route_command_id,NEW.command_id);
 ELSIF NEW.lot_id IS NOT NULL THEN NEW.lot_command_id=COALESCE(NEW.lot_command_id,NEW.command_id);
 ELSE NEW.parcel_command_id=COALESCE(NEW.parcel_command_id,NEW.command_id); END IF;
 RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.guard_domain_event_creation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.booking_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.booking_commands WHERE id=NEW.booking_command_id AND state='reserved')
 OR NEW.parcel_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.parcel_commands WHERE id=NEW.parcel_command_id AND state='reserved')
 OR NEW.lot_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.lot_commands WHERE id=NEW.lot_command_id AND state='reserved')
 OR NEW.route_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.route_commands WHERE id=NEW.route_command_id AND state='reserved')
 THEN RAISE EXCEPTION 'DOMAIN_EVENT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
    CREATE OR REPLACE VIEW shipit.audit_history AS
      SELECT 'audit:'||id::text AS id,organization_id,(CASE WHEN franchise_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[franchise_id] END) AS franchise_ids,
        actor_type,actor_id,action,resource_type,resource_id,result,reason_code,correlation_id,occurred_at,previous_lifecycle,new_lifecycle,committed_version,NULL::text AS role FROM shipit.audit_records
      UNION ALL SELECT 'membership:'||id::text,organization_id,franchise_ids,actor_type,COALESCE(actor_user_id::text,'onboarding'),action,
        (CASE WHEN invitation_id IS NULL THEN 'membership' ELSE 'invitation' END),COALESCE(invitation_id,membership_id),'success','grant_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,role FROM shipit.membership_audit_events
      UNION ALL SELECT 'identity:'||id::text,NULL::uuid,'{}'::uuid[],(CASE WHEN action IN ('provision','disable','enable') THEN 'service' ELSE 'user' END),
        (CASE WHEN action IN ('provision','disable','enable') THEN 'authentication' ELSE COALESCE(user_id::text,'unknown') END),action,'identity',user_id,'success','identity_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,NULL FROM shipit.auth_security_events
      UNION ALL SELECT 'customer:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'customer',customer_id,'success','contact_change',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events
      UNION ALL SELECT 'pricing:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'pricing',COALESCE(quote_id,version_id),'success',reason_code,correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.pricing_audit_events
      UNION ALL SELECT 'tax:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'tax',resource_id,'success','tax_command',correlation_id,occurred_at,NULL,NULL,NULL,NULL FROM shipit.tax_audit_events
      UNION ALL SELECT 'booking:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'bookings.create','booking',booking_id,'success','booking_create',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.booking_audit_events
      UNION ALL SELECT 'parcel:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,operation_id,'parcel',parcel_id,'success',
        COALESCE(reason_code,'parcel_transition'),correlation_id,occurred_at,from_status,to_status,sequence,NULL FROM shipit.parcel_transitions
      UNION ALL SELECT 'lot:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'lot',lot_id,'success','lot_command',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.lot_audit_events
 UNION ALL SELECT 'route:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'route',route_id,'success','route_command',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.route_audit_events;

CREATE FUNCTION shipit.route_snapshot(org uuid,franchise uuid,route uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('id',r.id,'origin',r.origin,'destination',r.destination,'mode',r.mode,'carrier_code',r.carrier_code,
 'scheduled_departure_at',shipit.lot_wire_time(r.scheduled_departure_at),'state',r.state,'version',r.version,'current_manifest_id',r.current_manifest_id,
 'created_at',shipit.lot_wire_time(r.created_at),'updated_at',shipit.lot_wire_time(r.updated_at))
 FROM shipit.routes r WHERE r.organization_id=org AND r.franchise_id=franchise AND r.id=route
$fn$;
-- Reference-only expansion, used once at commit; never a historical read API.
CREATE FUNCTION shipit.route_contributions(org uuid,franchise uuid,route uuid)
 RETURNS TABLE(parcel_id uuid,source_id uuid,lot_id uuid,lot_membership_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT m.parcel_id,s.id,s.lot_id,m.id FROM shipit.route_lots s JOIN shipit.lot_memberships m
 ON m.organization_id=s.organization_id AND m.franchise_id=s.franchise_id AND m.lot_id=s.lot_id AND m.ended_at IS NULL
 WHERE s.organization_id=org AND s.franchise_id=franchise AND s.route_id=route AND s.ended_at IS NULL
 UNION ALL SELECT s.parcel_id,s.id,NULL::uuid,NULL::uuid FROM shipit.route_parcels s
 WHERE s.organization_id=org AND s.franchise_id=franchise AND s.route_id=route AND s.ended_at IS NULL
$fn$;
CREATE FUNCTION shipit.check_route_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.route_commands; r shipit.routes; m shipit.route_manifests; a shipit.route_audit_events; e shipit.domain_events; starts integer;ends integer;
BEGIN
 SELECT * INTO c FROM shipit.route_commands WHERE id=NEW.id;
 SELECT * INTO r FROM shipit.routes WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND id=c.route_id;
 SELECT * INTO a FROM shipit.route_audit_events WHERE command_id=c.id;
 SELECT * INTO e FROM shipit.domain_events WHERE route_command_id=c.id;
 IF c.state<>'committed' OR r.last_command_id IS DISTINCT FROM c.id OR r.version<>COALESCE(c.expected_version,0)+1
 OR a.id IS NULL OR e.event_id IS NULL OR e.event_id<>a.id OR a.committed_version<>r.version OR a.manifest_id<>r.current_manifest_id
 OR a.actor_id<>c.principal_id OR a.correlation_id<>c.correlation_id OR a.occurred_at<>c.occurred_at OR a.action<>shipit.route_event_type(c.operation_id)
 OR e.event_type<>a.action OR e.aggregate_sequence<>r.version OR e.occurred_at<>c.occurred_at
 OR e.envelope->'actor' IS DISTINCT FROM jsonb_build_object('type','user','id',c.principal_id)
 OR e.envelope->>'correlation_id' IS DISTINCT FROM c.correlation_id::text OR e.envelope->>'occurred_at' IS DISTINCT FROM shipit.lot_wire_time(c.occurred_at)
 OR e.envelope->'payload' IS DISTINCT FROM jsonb_build_object('manifest_id',r.current_manifest_id)
 OR c.result IS DISTINCT FROM shipit.route_snapshot(c.organization_id,c.franchise_id,c.route_id)
 OR (SELECT count(*) FROM shipit.domain_events WHERE route_command_id=c.id)<>1
 THEN RAISE EXCEPTION 'ROUTE_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
 SELECT (SELECT count(*) FROM shipit.route_lots WHERE start_command_id=c.id)+(SELECT count(*) FROM shipit.route_parcels WHERE start_command_id=c.id),
   (SELECT count(*) FROM shipit.route_lots WHERE end_command_id=c.id)+(SELECT count(*) FROM shipit.route_parcels WHERE end_command_id=c.id) INTO starts,ends;
 IF starts<>(CASE WHEN c.operation_id LIKE '%.attach' THEN 1 ELSE 0 END) OR ends<>(CASE WHEN c.operation_id LIKE '%.detach' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'ROUTE_SOURCE_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF c.operation_id='api.v1.routes.archive' THEN
  IF EXISTS(SELECT 1 FROM shipit.route_manifests WHERE command_id=c.id) THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO m FROM shipit.route_manifests WHERE command_id=c.id;
 IF m.id IS NULL OR r.current_manifest_id<>m.id OR m.version<>r.version
 OR m.parcel_count<>(SELECT count(*) FROM shipit.route_manifest_parcels WHERE manifest_id=m.id)
 OR (SELECT count(*) FROM shipit.route_lots WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND route_id=r.id AND ended_at IS NULL)+
    (SELECT count(*) FROM shipit.route_parcels WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND route_id=r.id AND ended_at IS NULL)>100
 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 -- Exact unique-key lookups keep validation bounded even before ANALYZE has
 -- statistics for a newly populated tenant; a three-table join can multiply rows.
 IF EXISTS(SELECT 1 FROM shipit.route_manifest_parcels mp
   WHERE mp.organization_id=c.organization_id AND mp.franchise_id=c.franchise_id AND mp.manifest_id=m.id AND
   ((SELECT p.status FROM shipit.parcels p WHERE p.organization_id=mp.organization_id AND p.franchise_id=mp.franchise_id
      AND p.booking_id=mp.booking_id AND p.id=mp.parcel_id) <> ALL(CASE WHEN m.finalized THEN ARRAY['checked_in'] ELSE ARRAY['booked','checked_in'] END)
    OR (SELECT b.state FROM shipit.bookings b WHERE b.organization_id=mp.organization_id AND b.franchise_id=mp.franchise_id AND b.id=mp.booking_id)<>'active'))
 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM shipit.route_lots s JOIN shipit.lots l ON l.organization_id=s.organization_id AND l.franchise_id=s.franchise_id AND l.id=s.lot_id
   WHERE s.organization_id=c.organization_id AND s.franchise_id=c.franchise_id AND s.route_id=r.id AND s.ended_at IS NULL AND
   (l.state<>'active' OR NOT EXISTS(SELECT 1 FROM shipit.lot_memberships lm WHERE lm.organization_id=s.organization_id AND lm.franchise_id=s.franchise_id AND lm.lot_id=s.lot_id AND lm.ended_at IS NULL)))
 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF EXISTS((SELECT * FROM shipit.route_contributions(c.organization_id,c.franchise_id,r.id) EXCEPT
   SELECT parcel_id,source_id,lot_id,lot_membership_id FROM shipit.route_manifest_sources WHERE manifest_id=m.id)
   UNION ALL (SELECT parcel_id,source_id,lot_id,lot_membership_id FROM shipit.route_manifest_sources WHERE manifest_id=m.id EXCEPT
   SELECT * FROM shipit.route_contributions(c.organization_id,c.franchise_id,r.id)))
 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF EXISTS((SELECT parcel_id FROM shipit.route_manifest_parcels WHERE manifest_id=m.id EXCEPT SELECT parcel_id FROM shipit.route_manifest_sources WHERE manifest_id=m.id)
   UNION ALL (SELECT parcel_id FROM shipit.route_manifest_sources WHERE manifest_id=m.id EXCEPT SELECT parcel_id FROM shipit.route_manifest_parcels WHERE manifest_id=m.id))
 THEN RAISE EXCEPTION 'ROUTE_SNAPSHOT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER route_command_complete AFTER INSERT OR UPDATE ON shipit.route_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_route_command_complete();
DO $extend$
DECLARE expr text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_action_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK ((%s) OR action IN (''routes.read'',''routes.list'',''routes.create'',''routes.update'',''routes.archive'',''routes.finalize'',''routes.lot.attach'',''routes.lot.detach'',''routes.parcel.attach'',''routes.parcel.detach''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_resource_type_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check CHECK ((%s) OR resource_type=''route'')',expr);
END $extend$;
REVOKE ALL ON shipit.routes,shipit.route_commands,shipit.route_lots,shipit.route_parcels,shipit.route_manifests,shipit.route_manifest_parcels,shipit.route_manifest_sources,shipit.route_audit_events,shipit.parcel_dispatch_manifests FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_route(),shipit.guard_route_source(),shipit.guard_route_snapshot(),shipit.guard_lot_active_route(),shipit.bind_dispatch_manifest(),
 shipit.route_event_type(text),shipit.append_route_audit(uuid,uuid,uuid,uuid,uuid),shipit.route_snapshot(uuid,uuid,uuid),shipit.route_contributions(uuid,uuid,uuid),shipit.check_route_command_complete() FROM PUBLIC;

  `);
};
