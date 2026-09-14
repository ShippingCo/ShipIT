// Forward-only Issue #26. Existing producers and retained history remain compatible.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.lot_commands (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      operation_id text NOT NULL CHECK(operation_id IN ('api.v1.lots.create','api.v1.lots.update','api.v1.lots.archive',
        'api.v1.lots.membership.add','api.v1.lots.membership.move','api.v1.lots.membership.remove')),
      key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      normalization_version integer NOT NULL DEFAULT 1 CHECK(normalization_version=1),
      lot_id uuid NOT NULL, target_lot_id uuid, booking_id uuid, parcel_id uuid, membership_id uuid,
      expected_version integer, expected_target_version integer, dispatcher_required boolean NOT NULL,
      input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=2048),
      correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
      state text NOT NULL DEFAULT 'reserved', http_status integer, result jsonb, committed_at timestamptz, retain_until timestamptz,
      UNIQUE(organization_id,franchise_id,id),
      CONSTRAINT lot_commands_identity_key UNIQUE(principal_id,organization_id,franchise_id,operation_id,key_digest),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
      CHECK((operation_id='api.v1.lots.create' AND expected_version IS NULL) OR
        (operation_id<>'api.v1.lots.create' AND expected_version BETWEEN 1 AND 2147483646)),
      CHECK((operation_id='api.v1.lots.membership.move' AND target_lot_id IS NOT NULL AND target_lot_id<>lot_id AND expected_target_version BETWEEN 1 AND 2147483646)
        OR (operation_id<>'api.v1.lots.membership.move' AND target_lot_id IS NULL AND expected_target_version IS NULL)),
      CHECK((operation_id LIKE 'api.v1.lots.membership.%' AND parcel_id IS NOT NULL AND booking_id IS NOT NULL AND membership_id IS NOT NULL)
        OR (operation_id NOT LIKE 'api.v1.lots.membership.%' AND parcel_id IS NULL AND booking_id IS NULL AND membership_id IS NULL)),
      CHECK((state='reserved' AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL) OR
        (state='committed' AND (http_status=(CASE WHEN operation_id='api.v1.lots.create' THEN 201 ELSE 200 END)
          AND jsonb_typeof(result)='object' AND octet_length(result::text)<=8192 AND isfinite(committed_at)
          AND isfinite(retain_until) AND retain_until>=committed_at+interval '24 hours') IS TRUE))
    );
    CREATE TABLE shipit.lot_code_counters (
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, value bigint NOT NULL CHECK(value>0),
      PRIMARY KEY(organization_id,franchise_id),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.lots (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      code text NOT NULL CHECK(code ~ '^LOT-[0-9]{19}$'),
      name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
      destination_key text NOT NULL CHECK(destination_key ~ '^[A-Z][A-Z0-9_]{0,31}$'),
      state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
      version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
      created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)),
      archived_at timestamptz, last_command_id uuid NOT NULL,
      UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,last_command_id) REFERENCES shipit.lot_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CHECK((state='active' AND archived_at IS NULL) OR (state='archived' AND archived_at IS NOT NULL AND isfinite(archived_at)))
    );
    CREATE UNIQUE INDEX lots_active_code_idx ON shipit.lots(organization_id,franchise_id,code) WHERE state='active';
    CREATE INDEX lots_page_idx ON shipit.lots(organization_id,franchise_id,created_at DESC,id DESC);
    ALTER TABLE shipit.lot_commands ADD FOREIGN KEY(organization_id,franchise_id,lot_id)
      REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE shipit.lot_commands ADD FOREIGN KEY(organization_id,franchise_id,target_lot_id)
      REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT;

    CREATE TABLE shipit.lot_memberships (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      lot_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid NOT NULL,
      started_at timestamptz NOT NULL CHECK(isfinite(started_at)), start_command_id uuid NOT NULL,
      ended_at timestamptz, end_command_id uuid, end_reason text,
      UNIQUE(organization_id,franchise_id,id),
      FOREIGN KEY(organization_id,franchise_id,lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,start_command_id) REFERENCES shipit.lot_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,end_command_id) REFERENCES shipit.lot_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CHECK(((ended_at IS NULL AND end_command_id IS NULL AND end_reason IS NULL) OR
        (ended_at IS NOT NULL AND isfinite(ended_at) AND ended_at>=started_at AND end_command_id IS NOT NULL AND end_reason IN ('removed','moved','archived'))) IS TRUE)
    );
    CREATE UNIQUE INDEX lot_memberships_one_active_idx ON shipit.lot_memberships(organization_id,franchise_id,parcel_id) WHERE ended_at IS NULL;
    CREATE INDEX lot_memberships_page_idx ON shipit.lot_memberships(organization_id,franchise_id,lot_id,started_at DESC,id DESC);
    CREATE INDEX lot_memberships_start_command_idx ON shipit.lot_memberships(organization_id,franchise_id,start_command_id);
    CREATE INDEX lot_memberships_end_command_idx ON shipit.lot_memberships(organization_id,franchise_id,end_command_id);

    CREATE FUNCTION shipit.guard_lot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE c shipit.lot_commands; allocated bigint;
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LOT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
      SELECT * INTO c FROM shipit.lot_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
        AND id=NEW.last_command_id AND state='reserved' AND NEW.id IN (lot_id,target_lot_id);
      IF c.id IS NULL THEN RAISE EXCEPTION 'LOT_COMMAND_INVALID' USING ERRCODE='23514'; END IF;
      IF TG_OP='INSERT' THEN
        IF c.operation_id<>'api.v1.lots.create' OR NEW.version<>1 OR NEW.state<>'active' OR NEW.code IS NOT NULL
          OR NEW.name IS DISTINCT FROM c.input->>'name' OR NEW.destination_key IS DISTINCT FROM c.input->>'destination_key'
          OR NEW.created_at<>c.occurred_at OR NEW.updated_at<>c.occurred_at
          OR NOT EXISTS(SELECT 1 FROM shipit.pricing_rules r JOIN shipit.pricing_versions v
            ON v.organization_id=r.organization_id AND v.franchise_id=r.franchise_id AND v.id=r.version_id
            WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id
              AND r.destination_key=NEW.destination_key AND v.state='published')
        THEN RAISE EXCEPTION 'LOT_CREATE_INVALID' USING ERRCODE='23514'; END IF;
        INSERT INTO shipit.lot_code_counters(organization_id,franchise_id,value) VALUES(NEW.organization_id,NEW.franchise_id,1)
          ON CONFLICT(organization_id,franchise_id) DO UPDATE SET value=shipit.lot_code_counters.value+1 RETURNING value INTO allocated;
        NEW.code='LOT-'||lpad(allocated::text,19,'0');
      ELSE
        IF (to_jsonb(NEW)-ARRAY['name','state','version','updated_at','archived_at','last_command_id'])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','state','version','updated_at','archived_at','last_command_id'])
          OR OLD.state<>'active' OR NEW.version<>OLD.version+1 OR NEW.updated_at<>c.occurred_at
          OR OLD.version IS DISTINCT FROM (CASE WHEN NEW.id=c.lot_id THEN c.expected_version ELSE c.expected_target_version END)
          OR NEW.state<>(CASE WHEN c.operation_id='api.v1.lots.archive' THEN 'archived' ELSE 'active' END)
          OR NEW.archived_at IS DISTINCT FROM (CASE WHEN c.operation_id='api.v1.lots.archive' THEN c.occurred_at ELSE NULL END)
          OR NEW.name IS DISTINCT FROM (CASE WHEN c.operation_id='api.v1.lots.update' THEN c.input->>'name' ELSE OLD.name END)
        THEN RAISE EXCEPTION 'LOT_MUTATION_INVALID' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER lots_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.lots FOR EACH ROW EXECUTE FUNCTION shipit.guard_lot();

    CREATE FUNCTION shipit.guard_lot_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE c shipit.lot_commands; l shipit.lots; p shipit.parcels; dest text;
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LOT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
      SELECT * INTO c FROM shipit.lot_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
        AND id=(CASE WHEN TG_OP='INSERT' THEN NEW.start_command_id ELSE NEW.end_command_id END) AND state='reserved';
      IF c.id IS NULL THEN RAISE EXCEPTION 'LOT_COMMAND_INVALID' USING ERRCODE='23514'; END IF;
      IF TG_OP='INSERT' THEN
        SELECT * INTO l FROM shipit.lots WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.lot_id;
        SELECT * INTO p FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id
          AND booking_id=NEW.booking_id AND id=NEW.parcel_id FOR UPDATE;
        SELECT tax_intent->'pricing_input'->>'destination_key' INTO dest FROM shipit.bookings
          WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
        IF l.id IS NULL OR p.id IS NULL OR l.state<>'active' OR p.status IN ('delivered','rto') OR dest IS DISTINCT FROM l.destination_key
          OR c.operation_id NOT IN ('api.v1.lots.membership.add','api.v1.lots.membership.move')
          OR NEW.lot_id IS DISTINCT FROM COALESCE(c.target_lot_id,c.lot_id) OR NEW.parcel_id IS DISTINCT FROM c.parcel_id
          OR NEW.booking_id IS DISTINCT FROM c.booking_id
          OR (c.operation_id='api.v1.lots.membership.add' AND NEW.id IS DISTINCT FROM c.membership_id) OR NEW.started_at<>c.occurred_at OR NEW.ended_at IS NOT NULL
        THEN RAISE EXCEPTION 'LOT_MEMBERSHIP_INVALID' USING ERRCODE='23514'; END IF;
      ELSE
        IF (to_jsonb(NEW)-ARRAY['ended_at','end_command_id','end_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ended_at','end_command_id','end_reason'])
          OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS DISTINCT FROM c.occurred_at OR NEW.lot_id<>c.lot_id
          OR NEW.end_reason IS DISTINCT FROM (CASE c.operation_id WHEN 'api.v1.lots.membership.remove' THEN 'removed'
            WHEN 'api.v1.lots.membership.move' THEN 'moved' WHEN 'api.v1.lots.archive' THEN 'archived' ELSE NULL END)
          OR (c.operation_id<>'api.v1.lots.archive' AND (NEW.id<>c.membership_id OR NEW.parcel_id<>c.parcel_id))
        THEN RAISE EXCEPTION 'LOT_MEMBERSHIP_INVALID' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER lot_memberships_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.lot_memberships FOR EACH ROW EXECUTE FUNCTION shipit.guard_lot_membership();

    CREATE TABLE shipit.lot_audit_events (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, lot_id uuid NOT NULL,
      command_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK(action IN ('lot.created','lot.updated','lot.archived','lot.parcel_added','lot.parcel_removed')),
      committed_version integer NOT NULL CHECK(committed_version>0), parcel_id uuid, membership_id uuid, counterpart_lot_id uuid,
      correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
      UNIQUE(organization_id,franchise_id,lot_id,committed_version), UNIQUE(organization_id,franchise_id,command_id,lot_id),
      FOREIGN KEY(organization_id,franchise_id,lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,counterpart_lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.lot_commands(organization_id,franchise_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(organization_id,franchise_id,membership_id) REFERENCES shipit.lot_memberships(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.append_lot_audit(org uuid,franchise uuid,lot uuid,command uuid,event uuid)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE c shipit.lot_commands; l shipit.lots; member uuid; kind text;
    BEGIN
      SELECT * INTO c FROM shipit.lot_commands WHERE organization_id=org AND franchise_id=franchise AND id=command AND state='reserved';
      SELECT * INTO l FROM shipit.lots WHERE organization_id=org AND franchise_id=franchise AND id=lot AND last_command_id=command;
      IF c.id IS NULL OR l.id IS NULL OR lot NOT IN (c.lot_id,COALESCE(c.target_lot_id,c.lot_id)) THEN RAISE EXCEPTION 'LOT_AUDIT_INVALID' USING ERRCODE='23514'; END IF;
      kind=(CASE c.operation_id WHEN 'api.v1.lots.create' THEN 'lot.created' WHEN 'api.v1.lots.update' THEN 'lot.updated'
        WHEN 'api.v1.lots.archive' THEN 'lot.archived' WHEN 'api.v1.lots.membership.add' THEN 'lot.parcel_added'
        WHEN 'api.v1.lots.membership.remove' THEN 'lot.parcel_removed' ELSE (CASE WHEN lot=c.lot_id THEN 'lot.parcel_removed' ELSE 'lot.parcel_added' END) END);
      IF kind='lot.parcel_added' THEN SELECT id INTO member FROM shipit.lot_memberships WHERE organization_id=org AND franchise_id=franchise AND lot_id=lot AND start_command_id=command;
      ELSIF kind='lot.parcel_removed' THEN member=c.membership_id; END IF;
      INSERT INTO shipit.lot_audit_events(id,organization_id,franchise_id,lot_id,command_id,actor_id,action,committed_version,
        parcel_id,membership_id,counterpart_lot_id,correlation_id,occurred_at)
      VALUES(event,org,franchise,lot,command,c.principal_id,kind,l.version,c.parcel_id,member,
        (CASE WHEN c.target_lot_id IS NOT NULL THEN (CASE WHEN lot=c.lot_id THEN c.target_lot_id ELSE c.lot_id END) ELSE NULL END),c.correlation_id,c.occurred_at);
    END $fn$;
    CREATE TRIGGER lot_audit_immutable BEFORE UPDATE OR DELETE ON shipit.lot_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
    CREATE TRIGGER lot_commands_guard BEFORE UPDATE OR DELETE ON shipit.lot_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_command();

    ALTER TABLE shipit.domain_events ALTER COLUMN booking_id DROP NOT NULL;
    ALTER TABLE shipit.domain_events ADD COLUMN lot_id uuid, ADD COLUMN lot_command_id uuid;
    ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,lot_id) REFERENCES shipit.lots(organization_id,franchise_id,id) ON DELETE RESTRICT;
    ALTER TABLE shipit.domain_events ADD FOREIGN KEY(organization_id,franchise_id,lot_command_id) REFERENCES shipit.lot_commands(organization_id,franchise_id,id) ON DELETE RESTRICT;
    -- Preserve exact old predicates while extending only the new mutually exclusive producer.
    DO $extend$
    DECLARE n text; expr text;
    BEGIN
      FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check','domain_events_envelope_check'] LOOP
        SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
        EXECUTE format('ALTER TABLE shipit.domain_events DROP CONSTRAINT %I',n);
        EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK ((lot_id IS NULL AND lot_command_id IS NULL AND booking_id IS NOT NULL AND (%s)) OR (lot_id IS NOT NULL AND lot_command_id IS NOT NULL))',n,expr);
      END LOOP;
    END $extend$;
    ALTER TABLE shipit.domain_events ADD CONSTRAINT domain_events_lot_shape_check CHECK(lot_id IS NULL OR (
      booking_id IS NULL AND parcel_id IS NULL AND booking_command_id IS NULL AND parcel_command_id IS NULL
      AND lot_command_id=command_id AND aggregate_id=lot_id
      AND event_type IN ('lot.created','lot.updated','lot.archived','lot.parcel_added','lot.parcel_removed')
      AND jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=2048
      AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text
      AND envelope->>'franchise_id'=franchise_id::text AND envelope->>'event_type'=event_type
      AND envelope->>'aggregate_id'=lot_id::text AND envelope->>'aggregate_type'='lot' AND envelope->>'schema_version'='1'
      AND (envelope->>'aggregate_version')::bigint=aggregate_sequence AND envelope->>'command_id'=command_id::text
      AND envelope->>'causation_id'=command_id::text
      AND envelope-ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE);
    CREATE UNIQUE INDEX domain_events_lot_revision_idx ON shipit.domain_events(organization_id,franchise_id,lot_id,aggregate_sequence) WHERE lot_id IS NOT NULL;
    CREATE OR REPLACE FUNCTION shipit.fill_domain_event_ordering() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      NEW.occurred_at=COALESCE(NEW.occurred_at,(NEW.envelope->>'occurred_at')::timestamptz);
      NEW.aggregate_sequence=COALESCE(NEW.aggregate_sequence,(NEW.envelope->>'aggregate_version')::bigint);
      IF NEW.event_type IN ('booking.created','parcel.booked') THEN NEW.booking_command_id=COALESCE(NEW.booking_command_id,NEW.command_id);
      ELSIF NEW.lot_id IS NOT NULL THEN NEW.lot_command_id=COALESCE(NEW.lot_command_id,NEW.command_id);
      ELSE NEW.parcel_command_id=COALESCE(NEW.parcel_command_id,NEW.command_id); END IF;
      RETURN NEW;
    END $fn$;
    CREATE OR REPLACE FUNCTION shipit.guard_domain_event_creation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      IF NEW.booking_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.booking_commands WHERE id=NEW.booking_command_id AND state='reserved')
        OR NEW.parcel_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.parcel_commands WHERE id=NEW.parcel_command_id AND state='reserved')
        OR NEW.lot_command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.lot_commands WHERE id=NEW.lot_command_id AND state='reserved')
      THEN RAISE EXCEPTION 'DOMAIN_EVENT_INVALID' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $fn$;


    CREATE FUNCTION shipit.lot_wire_time(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
      SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') ||
        CASE WHEN to_char(t AT TIME ZONE 'UTC','US')='000000' THEN '' ELSE '.'||rtrim(to_char(t AT TIME ZONE 'UTC','US'),'0') END || 'Z'
    $fn$;
    CREATE FUNCTION shipit.lot_snapshot(org uuid,franchise uuid,lot uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
      SELECT jsonb_build_object('id',l.id,'code',l.code,'name',l.name,'destination_key',l.destination_key,'state',l.state,'version',l.version,
        'created_at',shipit.lot_wire_time(l.created_at),'updated_at',shipit.lot_wire_time(l.updated_at),'archived_at',shipit.lot_wire_time(l.archived_at),
        'active_member_count',(SELECT count(*) FROM shipit.lot_memberships m WHERE m.organization_id=org AND m.franchise_id=franchise AND m.lot_id=lot AND m.ended_at IS NULL))
      FROM shipit.lots l WHERE l.organization_id=org AND l.franchise_id=franchise AND l.id=lot
    $fn$;
    REVOKE ALL ON FUNCTION shipit.lot_wire_time(timestamptz),shipit.lot_snapshot(uuid,uuid,uuid) FROM PUBLIC;
    CREATE FUNCTION shipit.check_lot_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE c shipit.lot_commands; expected_count integer; actual_count integer; starts integer; ends integer; expected_result jsonb; member_result jsonb;
    BEGIN
      SELECT * INTO c FROM shipit.lot_commands WHERE id=NEW.id;
      IF c.state<>'committed' THEN RAISE EXCEPTION 'LOT_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
      expected_count=(CASE WHEN c.target_lot_id IS NULL THEN 1 ELSE 2 END);
      SELECT count(*) INTO actual_count FROM shipit.lots l JOIN shipit.lot_audit_events a ON a.organization_id=l.organization_id
        AND a.franchise_id=l.franchise_id AND a.lot_id=l.id AND a.command_id=c.id AND a.committed_version=l.version
        JOIN shipit.domain_events e ON e.event_id=a.id AND e.lot_command_id=c.id AND e.lot_id=l.id AND e.aggregate_sequence=l.version
        WHERE l.organization_id=c.organization_id AND l.franchise_id=c.franchise_id AND l.last_command_id=c.id
        AND l.id IN (c.lot_id,c.target_lot_id) AND l.version=(CASE WHEN l.id=c.lot_id THEN COALESCE(c.expected_version,0)+1 ELSE c.expected_target_version+1 END)
        AND a.actor_id=c.principal_id AND a.correlation_id=c.correlation_id AND a.occurred_at=c.occurred_at
        AND e.event_type=a.action AND e.occurred_at=c.occurred_at AND e.envelope->'actor'=jsonb_build_object('type','user','id',c.principal_id)
        AND e.envelope->>'correlation_id'=c.correlation_id::text
        AND e.envelope->>'occurred_at'=shipit.lot_wire_time(c.occurred_at)
        AND e.envelope->'payload'=(CASE WHEN a.parcel_id IS NULL THEN '{}'::jsonb ELSE
          jsonb_build_object('parcel_id',a.parcel_id,'membership_id',a.membership_id)||
          (CASE WHEN a.counterpart_lot_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('counterpart_lot_id',a.counterpart_lot_id) END) END);
      IF actual_count<>expected_count OR (SELECT count(*) FROM shipit.lot_audit_events WHERE command_id=c.id)<>expected_count
        OR (SELECT count(*) FROM shipit.domain_events WHERE lot_command_id=c.id)<>expected_count
      THEN RAISE EXCEPTION 'LOT_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
      SELECT count(*) INTO starts FROM shipit.lot_memberships WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND start_command_id=c.id;
      SELECT count(*) INTO ends FROM shipit.lot_memberships WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND end_command_id=c.id;
      IF starts<>(CASE WHEN c.operation_id IN ('api.v1.lots.membership.add','api.v1.lots.membership.move') THEN 1 ELSE 0 END)
        OR (c.operation_id<>'api.v1.lots.archive' AND ends<>(CASE WHEN c.operation_id IN ('api.v1.lots.membership.remove','api.v1.lots.membership.move') THEN 1 ELSE 0 END))
        OR (c.operation_id='api.v1.lots.archive' AND EXISTS(SELECT 1 FROM shipit.lot_memberships WHERE organization_id=c.organization_id AND franchise_id=c.franchise_id AND lot_id=c.lot_id AND ended_at IS NULL))
      THEN RAISE EXCEPTION 'LOT_COMMAND_INCOMPLETE' USING ERRCODE='23514'; END IF;
      IF c.parcel_id IS NULL THEN expected_result=shipit.lot_snapshot(c.organization_id,c.franchise_id,c.lot_id);
      ELSE
        SELECT jsonb_build_object('id',m.id,'lot_id',m.lot_id,'parcel_id',m.parcel_id,'started_at',shipit.lot_wire_time(m.started_at),
          'ended_at',shipit.lot_wire_time(m.ended_at),'end_reason',m.end_reason) INTO member_result
          FROM shipit.lot_memberships m WHERE m.organization_id=c.organization_id AND m.franchise_id=c.franchise_id AND m.start_command_id=c.id;
        SELECT jsonb_build_object('lots',jsonb_agg(shipit.lot_snapshot(c.organization_id,c.franchise_id,l.id) ORDER BY l.id),
          'membership',member_result) INTO expected_result FROM shipit.lots l
          WHERE l.organization_id=c.organization_id AND l.franchise_id=c.franchise_id AND l.id IN (c.lot_id,c.target_lot_id);
      END IF;
      IF c.result IS DISTINCT FROM expected_result THEN RAISE EXCEPTION 'LOT_RESULT_INVALID' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END $fn$;
    CREATE CONSTRAINT TRIGGER lot_command_complete AFTER INSERT OR UPDATE ON shipit.lot_commands DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION shipit.check_lot_command_complete();
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
      UNION ALL SELECT 'lot:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'lot',lot_id,'success','lot_command',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.lot_audit_events;

    DO $extend$
    DECLARE expr text;
    BEGIN
      SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_action_check';
      ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
      EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK ((%s) OR action IN (''lots.read'',''lots.list'',''lots.create'',''lots.update'',''lots.archive'',''lots.membership.add'',''lots.membership.move'',''lots.membership.remove''))',expr);
      SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_resource_type_check';
      ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
      EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check CHECK ((%s) OR resource_type=''lot'')',expr);
    END $extend$;
    REVOKE ALL ON shipit.lots,shipit.lot_memberships,shipit.lot_commands,shipit.lot_code_counters,shipit.lot_audit_events FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.guard_lot(),shipit.guard_lot_membership(),shipit.append_lot_audit(uuid,uuid,uuid,uuid,uuid),shipit.check_lot_command_complete() FROM PUBLIC;
  `);
};
