// Forward-only #41: resumable Route-delay fanout and separately identified reminders.
exports.up = pgm => { pgm.sql(String.raw`
CREATE TABLE shipit.route_delay_reminder_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 route_id uuid NOT NULL,original_event_id uuid NOT NULL,operation_id text NOT NULL CHECK(operation_id='api.v1.routes.delay.remind'),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','committed')),result jsonb,
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 committed_at timestamptz CHECK(isfinite(committed_at)),
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(organization_id,franchise_id,principal_id,operation_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,original_event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 CHECK((state='reserved' AND result IS NULL AND committed_at IS NULL) OR (state='committed' AND result IS NOT NULL AND committed_at IS NOT NULL))
);

CREATE TABLE shipit.route_delay_reminder_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,route_id uuid NOT NULL,
 original_event_id uuid NOT NULL,command_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,correlation_id uuid NOT NULL,
 event_type text NOT NULL DEFAULT 'route.delay_reminder.requested' CHECK(event_type='route.delay_reminder.requested'),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,original_event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.route_delay_reminder_commands(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX route_delay_reminder_rate ON shipit.route_delay_reminder_events
 (organization_id,franchise_id,original_event_id,occurred_at DESC);

CREATE TABLE shipit.route_delay_fanouts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 source_identity_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN ('route_delay','reminder')),
 original_event_id uuid NOT NULL,reminder_event_id uuid,route_id uuid NOT NULL,manifest_id uuid NOT NULL,
 manifest_version integer NOT NULL CHECK(manifest_version>0),route_version integer NOT NULL CHECK(route_version>0),
 consumer_id text NOT NULL DEFAULT 'customer-notifications' CHECK(consumer_id='customer-notifications'),
 policy_id text NOT NULL CHECK(policy_id ~ '^[a-z][a-z0-9.-]{0,63}$'),policy_version integer NOT NULL CHECK(policy_version>0),
 purpose text NOT NULL CHECK(purpose IN ('route_delay','route_delay_reminder')),correlation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed')),
 cursor_parcel_id uuid,total_count integer NOT NULL CHECK(total_count BETWEEN 1 AND 1000),
 completed_count integer NOT NULL DEFAULT 0 CHECK(completed_count>=0),
 skipped_count integer NOT NULL DEFAULT 0 CHECK(skipped_count>=0),failed_count integer NOT NULL DEFAULT 0 CHECK(failed_count>=0),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),reason_code text CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 source_suppression_reason text CHECK(source_suppression_reason IN ('historical_cutover','stale_aggregate_event')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),started_at timestamptz CHECK(isfinite(started_at)),
 completed_at timestamptz CHECK(isfinite(completed_at)),
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(organization_id,franchise_id,source_identity_id,purpose),
 FOREIGN KEY(organization_id,franchise_id,original_event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,reminder_event_id) REFERENCES shipit.route_delay_reminder_events(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,route_id) REFERENCES shipit.routes(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,route_id,manifest_id) REFERENCES shipit.route_manifests(organization_id,franchise_id,route_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,consumer_id,policy_id,policy_version)
   REFERENCES shipit.notification_policy_activations(organization_id,franchise_id,consumer_id,policy_id,policy_version) ON DELETE RESTRICT,
 CHECK((source_kind='route_delay' AND purpose='route_delay' AND reminder_event_id IS NULL AND source_identity_id=original_event_id)
   OR (source_kind='reminder' AND purpose='route_delay_reminder' AND reminder_event_id IS NOT NULL AND source_identity_id=reminder_event_id)),
 CHECK(completed_count+skipped_count+failed_count<=total_count),
 CHECK((state IN ('pending','running') AND completed_at IS NULL) OR (state IN ('completed','failed') AND completed_at IS NOT NULL))
);
CREATE INDEX route_delay_fanout_due ON shipit.route_delay_fanouts(state,created_at,id)
 WHERE state IN ('pending','running');
CREATE INDEX route_delay_fanout_source ON shipit.route_delay_fanouts(organization_id,franchise_id,original_event_id,created_at DESC);

CREATE TABLE shipit.route_delay_fanout_items (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,fanout_id uuid NOT NULL,
 source_identity_id uuid NOT NULL,original_event_id uuid NOT NULL,parcel_id uuid NOT NULL,booking_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('route_delay','route_delay_reminder')),
 outcome text NOT NULL CHECK(outcome IN ('queued','skipped','suppressed','blocked')),
 reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),outbound_intent_id uuid,eta_event_id uuid,
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(decided_at)),
 UNIQUE(organization_id,franchise_id,id),
 UNIQUE(organization_id,franchise_id,fanout_id,parcel_id),
 UNIQUE(organization_id,franchise_id,source_identity_id,parcel_id,purpose),
 FOREIGN KEY(organization_id,franchise_id,fanout_id) REFERENCES shipit.route_delay_fanouts(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,original_event_id,parcel_id)
   REFERENCES shipit.route_parcel_effects(organization_id,franchise_id,event_id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,outbound_intent_id) REFERENCES shipit.whatsapp_outbound(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,eta_event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 CHECK((outcome='queued' AND outbound_intent_id IS NOT NULL) OR outcome IN ('skipped','suppressed','blocked'))
);
CREATE INDEX route_delay_fanout_items_history ON shipit.route_delay_fanout_items(organization_id,franchise_id,fanout_id,parcel_id);

CREATE FUNCTION shipit.guard_route_delay_reminder() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE command shipit.route_delay_reminder_commands;source shipit.domain_events;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUTE_DELAY_REMINDER_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.original_event_id::text,41));
 SELECT * INTO command FROM shipit.route_delay_reminder_commands c WHERE c.id=NEW.command_id AND c.state='reserved';
 SELECT * INTO source FROM shipit.domain_events e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.event_id=NEW.original_event_id;
 IF command.id IS NULL OR command.organization_id<>NEW.organization_id OR command.franchise_id<>NEW.franchise_id OR command.route_id<>NEW.route_id
   OR command.original_event_id<>NEW.original_event_id OR command.principal_id<>NEW.actor_id OR command.correlation_id<>NEW.correlation_id
   OR command.occurred_at<>NEW.occurred_at OR source.event_type<>'route.delayed' OR source.route_id<>NEW.route_id
 THEN RAISE EXCEPTION 'ROUTE_DELAY_REMINDER_INVALID' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM shipit.route_delay_reminder_events r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id
   AND r.original_event_id=NEW.original_event_id AND r.occurred_at>NEW.occurred_at-interval '60 minutes')
 THEN RAISE EXCEPTION 'ROUTE_DELAY_REMINDER_RATE_LIMITED' USING ERRCODE='P0041'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_delay_reminder_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_delay_reminder_events
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_delay_reminder();

CREATE FUNCTION shipit.guard_route_delay_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' OR OLD.state<>'reserved' OR NEW.state<>'committed'
   OR (to_jsonb(NEW)-ARRAY['state','result','committed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','committed_at'])
   OR NEW.result IS NULL OR NEW.committed_at IS NULL
 THEN RAISE EXCEPTION 'ROUTE_DELAY_REMINDER_COMMAND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_delay_reminder_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_delay_reminder_commands
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_delay_command();

CREATE FUNCTION shipit.guard_route_delay_fanout() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE source shipit.domain_events;effect record;actual_completed integer;actual_skipped integer;actual_failed integer;actual_cursor uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO source FROM shipit.domain_events e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.event_id=NEW.original_event_id;
  SELECT count(*)::integer AS total,min(route_id::text)::uuid AS route_id,min(manifest_id::text)::uuid AS manifest_id,min(route_version) AS route_version,
    max(route_version) AS max_route_version INTO effect FROM shipit.route_parcel_effects x
    WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id AND x.event_id=NEW.original_event_id;
  IF source.event_type<>'route.delayed' OR source.route_id<>NEW.route_id OR source.envelope->'payload'->>'affected_set_ref'<>NEW.original_event_id::text
    OR source.envelope->'payload'->>'manifest_id'<>NEW.manifest_id::text OR effect.total<>NEW.total_count OR effect.route_id<>NEW.route_id
    OR effect.manifest_id<>NEW.manifest_id OR effect.route_version<>NEW.route_version OR effect.max_route_version<>NEW.route_version
    OR NOT EXISTS(SELECT 1 FROM shipit.route_manifests m WHERE m.organization_id=NEW.organization_id AND m.franchise_id=NEW.franchise_id
      AND m.route_id=NEW.route_id AND m.id=NEW.manifest_id AND m.version=NEW.manifest_version AND m.finalized)
    OR (NEW.source_kind='reminder' AND NOT EXISTS(SELECT 1 FROM shipit.route_delay_reminder_events r WHERE r.organization_id=NEW.organization_id
      AND r.franchise_id=NEW.franchise_id AND r.id=NEW.reminder_event_id AND r.original_event_id=NEW.original_event_id AND r.route_id=NEW.route_id))
  THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','cursor_parcel_id','completed_count','skipped_count','failed_count','attempt_count','reason_code','started_at','completed_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','cursor_parcel_id','completed_count','skipped_count','failed_count','attempt_count','reason_code','started_at','completed_at'])
 THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER(WHERE outcome='queued'),count(*) FILTER(WHERE outcome IN ('skipped','suppressed')),
   count(*) FILTER(WHERE outcome='blocked'),max(parcel_id::text)::uuid INTO actual_completed,actual_skipped,actual_failed,actual_cursor
 FROM shipit.route_delay_fanout_items i WHERE i.organization_id=NEW.organization_id AND i.franchise_id=NEW.franchise_id AND i.fanout_id=NEW.id;
 IF NEW.completed_count<>actual_completed OR NEW.skipped_count<>actual_skipped OR NEW.failed_count<>actual_failed
   OR NEW.cursor_parcel_id IS DISTINCT FROM actual_cursor OR NEW.attempt_count<OLD.attempt_count
   OR (NEW.state='completed' AND NEW.completed_count+NEW.skipped_count+NEW.failed_count<>NEW.total_count)
 THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_PROGRESS_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_delay_fanout_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_delay_fanouts
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_delay_fanout();

CREATE FUNCTION shipit.guard_route_delay_fanout_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE root shipit.route_delay_fanouts;effect shipit.route_parcel_effects;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_ITEM_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO root FROM shipit.route_delay_fanouts f WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.id=NEW.fanout_id;
 SELECT * INTO effect FROM shipit.route_parcel_effects x WHERE x.organization_id=NEW.organization_id AND x.franchise_id=NEW.franchise_id
   AND x.event_id=NEW.original_event_id AND x.parcel_id=NEW.parcel_id;
 IF root.id IS NULL OR effect.parcel_id IS NULL OR root.source_identity_id<>NEW.source_identity_id OR root.original_event_id<>NEW.original_event_id
   OR root.purpose<>NEW.purpose OR effect.booking_id<>NEW.booking_id
   OR (NEW.eta_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.route_parcel_effects eta WHERE eta.organization_id=NEW.organization_id
     AND eta.franchise_id=NEW.franchise_id AND eta.route_id=root.route_id AND eta.parcel_id=NEW.parcel_id AND eta.event_id=NEW.eta_event_id))
   OR (NEW.outbound_intent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_outbound o WHERE o.organization_id=NEW.organization_id
     AND o.franchise_id=NEW.franchise_id AND o.id=NEW.outbound_intent_id AND o.source_kind='event'
     AND o.source_id=NEW.source_identity_id AND o.affected_entity_id=NEW.parcel_id AND o.purpose='updates'))
 THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_ITEM_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER route_delay_fanout_item_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.route_delay_fanout_items
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_route_delay_fanout_item();

-- #39 permits only a trusted event source. Extend that closed DB invariant for
-- the separate, immutable automation-owned reminder event introduced here.
CREATE OR REPLACE FUNCTION shipit.guard_whatsapp_outbound() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OUTBOUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state NOT IN ('queued','suppressed','failed') OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.cycle_attempts<>0 OR NEW.attempt_id IS NOT NULL
   THEN RAISE EXCEPTION 'OUTBOUND_INITIAL_STATE' USING ERRCODE='23514'; END IF;
  IF NEW.source_kind='event' THEN
   IF NOT EXISTS(SELECT 1 FROM shipit.domain_events e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.event_id=NEW.source_id)
    AND NOT EXISTS(SELECT 1 FROM shipit.route_delay_reminder_events r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=NEW.source_id)
    THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox i WHERE i.organization_id=NEW.organization_id AND i.franchise_id=NEW.franchise_id AND i.id=NEW.source_id AND i.installation_id=NEW.installation_id)
   THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload'])
    OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts
    OR (NEW.sealed_payload IS DISTINCT FROM OLD.sealed_payload AND NEW.sealed_payload IS NOT NULL)
    OR (OLD.state='read' AND NEW.state<>'read') OR (OLD.state='delivered' AND NEW.state NOT IN ('delivered','read'))
   THEN RAISE EXCEPTION 'OUTBOUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $fn$;

CREATE FUNCTION shipit.route_delay_fanout_scope(at_time timestamptz) RETURNS TABLE(organization_id uuid,franchise_id uuid,fanout_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE selected shipit.route_delay_fanouts;
BEGIN
 IF at_time IS NULL OR NOT isfinite(at_time) THEN RAISE EXCEPTION 'ROUTE_DELAY_FANOUT_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO selected FROM shipit.route_delay_fanouts f WHERE f.state IN ('pending','running')
   AND f.completed_count+f.skipped_count+f.failed_count<f.total_count ORDER BY f.created_at,f.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF selected.id IS NULL THEN RETURN; END IF;
 organization_id:=selected.organization_id;franchise_id:=selected.franchise_id;fanout_id:=selected.id;RETURN NEXT;
END $fn$;

REVOKE ALL ON shipit.route_delay_reminder_commands,shipit.route_delay_reminder_events,
 shipit.route_delay_fanouts,shipit.route_delay_fanout_items FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_route_delay_reminder(),shipit.guard_route_delay_command(),
 shipit.guard_route_delay_fanout(),shipit.guard_route_delay_fanout_item(),shipit.route_delay_fanout_scope(timestamptz) FROM PUBLIC;

DO $extend_audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'route-delay-reminder:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'route.delay_reminder.requested','route',route_id,'success','reminder_requested',correlation_id,occurred_at,NULL,NULL,NULL,NULL::text
 FROM shipit.route_delay_reminder_events
 UNION ALL SELECT 'route-delay-fanout-item:'||id::text,organization_id,ARRAY[franchise_id],'service','customer-notifications',
 'notification.decide','notification_automation',id,CASE WHEN outcome='queued' THEN 'success' ELSE 'denied' END,
 reason_code,(SELECT correlation_id FROM shipit.route_delay_fanouts f WHERE f.id=fanout_id),decided_at,NULL,NULL,NULL,NULL::text
 FROM shipit.route_delay_fanout_items$view$;
END $extend_audit$;
`); };
exports.down = () => { throw new Error('Forward-only migration'); };
