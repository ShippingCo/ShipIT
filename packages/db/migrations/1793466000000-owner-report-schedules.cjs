// #149 Additive, private owner reporting; no financial source rewrite or historical sends.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.owner_report_schedules (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 version integer NOT NULL CHECK(version>0),timing jsonb NOT NULL,enabled boolean NOT NULL DEFAULT false,
 whatsapp boolean NOT NULL DEFAULT false,corrections boolean NOT NULL DEFAULT false,alerts jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),next_check timestamptz NOT NULL DEFAULT clock_timestamp(),last_period_to timestamptz,last_state text NOT NULL DEFAULT 'pending' CHECK(last_state IN ('pending','completed','suppressed','failed')),last_reason text,last_check timestamptz,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 CHECK(jsonb_typeof(timing)='object' AND timing ?& ARRAY['frequency','timezone','minute','weekday'] AND timing->>'frequency' IN ('daily','weekly','monthly') AND length(timing->>'timezone') BETWEEN 1 AND 64
  AND (timing->>'minute')::int BETWEEN 0 AND 1439 AND (timing->>'weekday')::int BETWEEN 1 AND 7),
 CHECK(jsonb_typeof(alerts)='object' AND alerts ?& ARRAY['enabled','notify','minimum_paise','minimum_overdue_days','repeat_hours'] AND jsonb_typeof(alerts->'enabled')='boolean' AND jsonb_typeof(alerts->'notify')='boolean' AND (alerts->>'minimum_paise')~'^[0-9]{1,16}$'
  AND (alerts->>'minimum_paise')::numeric>0 AND (alerts->>'minimum_overdue_days')::int BETWEEN 1 AND 3650
  AND (alerts->'repeat_hours'='null'::jsonb OR (alerts->>'repeat_hours')::int BETWEEN 24 AND 8760))
);
CREATE INDEX owner_report_due ON shipit.owner_report_schedules(next_check,id);
CREATE TABLE shipit.owner_report_franchises (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,schedule_id uuid NOT NULL,selected_id uuid NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,schedule_id,selected_id),
 FOREIGN KEY(organization_id,franchise_id,schedule_id) REFERENCES shipit.owner_report_schedules(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,selected_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.owner_report_recipients (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,schedule_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 PRIMARY KEY(organization_id,franchise_id,schedule_id,user_id),
 FOREIGN KEY(organization_id,franchise_id,schedule_id) REFERENCES shipit.owner_report_schedules(organization_id,franchise_id,id)
);
CREATE TABLE shipit.owner_report_consents (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 enabled boolean NOT NULL,identifier_id uuid REFERENCES shipit.auth_identifiers(id),version integer NOT NULL CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,franchise_id,user_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 CHECK(NOT enabled OR identifier_id IS NOT NULL)
);
CREATE TABLE shipit.owner_report_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 operation text NOT NULL CHECK(operation IN ('schedule','consent','correct','acknowledge','retry','preview')),
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536)
);
CREATE TABLE shipit.owner_report_runs (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,schedule_id uuid NOT NULL,schedule_version integer NOT NULL,
 schedule_name text NOT NULL,kind text NOT NULL DEFAULT 'summary' CHECK(kind IN ('summary','alert','preview')),version integer NOT NULL CHECK(version>0),period jsonb NOT NULL,
 period_from timestamptz NOT NULL,period_to timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,state text NOT NULL CHECK(state IN ('ready','failed')),reason text,
 corrected_from uuid,payload jsonb,payload_digest text CHECK(payload_digest~'^[a-f0-9]{64}$'),franchise_ids uuid[] NOT NULL CHECK(cardinality(franchise_ids) BETWEEN 1 AND 50),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,schedule_id,kind,period_from,period_to,version),
 FOREIGN KEY(organization_id,franchise_id,schedule_id) REFERENCES shipit.owner_report_schedules(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,corrected_from) REFERENCES shipit.owner_report_runs(organization_id,franchise_id,id),
 CHECK(period_to>period_from AND period_to-period_from<=interval '32 days'),
 CHECK(jsonb_typeof(period)='object' AND period ?& ARRAY['frequency','timezone','from','to','label'] AND (period->>'from')::timestamptz=period_from AND (period->>'to')::timestamptz=period_to),
 CHECK((version=1)=(corrected_from IS NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 CHECK(payload IS NULL OR jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8388608)
);
CREATE INDEX owner_report_run_history ON shipit.owner_report_runs(organization_id,franchise_id,created_at,id);
CREATE TABLE shipit.owner_report_deliveries (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,run_id uuid NOT NULL,
 recipient_id uuid NOT NULL REFERENCES shipit.auth_users(id),channel text NOT NULL CHECK(channel IN ('in_app','whatsapp')),
 state text NOT NULL CHECK(state IN ('pending','sending','sent','failed','uncertain','suppressed')),
 reason text NOT NULL,notification_key text NOT NULL DEFAULT 'summary' CHECK(length(notification_key) BETWEEN 1 AND 128),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_token uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 provider_message_id text,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,run_id,recipient_id,channel),UNIQUE(organization_id,franchise_id,notification_key),
 FOREIGN KEY(organization_id,franchise_id,run_id) REFERENCES shipit.owner_report_runs(organization_id,franchise_id,id),
 CHECK(provider_message_id IS NULL OR provider_message_id~'^wamid\.[A-Za-z0-9_+=/-]{1,190}$')
);
CREATE UNIQUE INDEX owner_report_provider_identity ON shipit.owner_report_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX owner_report_delivery_due ON shipit.owner_report_deliveries(available_at,id) WHERE state IN ('pending','sending');
CREATE TABLE shipit.owner_report_delivery_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,delivery_id uuid NOT NULL,
 state text NOT NULL,reason text NOT NULL,attempt integer NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,franchise_id,delivery_id) REFERENCES shipit.owner_report_deliveries(organization_id,franchise_id,id)
);
CREATE TABLE shipit.owner_report_alerts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,schedule_id uuid NOT NULL,
 source_franchise_id uuid NOT NULL,source_id uuid NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>0),
 overdue_days integer NOT NULL CHECK(overdue_days>0),state text NOT NULL CHECK(state IN ('open','acknowledged','resolved')),
 version integer NOT NULL CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_notified_at timestamptz,notice_seq integer NOT NULL DEFAULT 0 CHECK(notice_seq>=0),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,schedule_id,source_id),
 FOREIGN KEY(organization_id,franchise_id,schedule_id) REFERENCES shipit.owner_report_schedules(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,source_franchise_id,source_id) REFERENCES shipit.bookings(organization_id,franchise_id,id)
);
CREATE TABLE shipit.owner_report_access_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid REFERENCES shipit.auth_users(id),
 resource_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('read','export','generate','suppressed','failed')),
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE FUNCTION shipit.owner_report_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND OLD.recorded_at<clock_timestamp()-interval '90 days' THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'OWNER_REPORT_IMMUTABLE' USING ERRCODE='23514';END $fn$;
CREATE TRIGGER owner_report_command_immutable BEFORE UPDATE OR DELETE ON shipit.owner_report_commands FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_immutable();
CREATE TRIGGER owner_report_access_immutable BEFORE UPDATE OR DELETE ON shipit.owner_report_access_events FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_immutable();
CREATE TRIGGER owner_report_history_immutable BEFORE UPDATE OR DELETE ON shipit.owner_report_delivery_history FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_immutable();
CREATE FUNCTION shipit.owner_report_payload_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) AND OLD.created_at<clock_timestamp()-interval '90 days' THEN RETURN OLD;END IF;
 IF TG_OP='DELETE' OR NEW.payload IS NOT NULL OR OLD.expires_at>clock_timestamp() OR (to_jsonb(NEW)-'payload')<>(to_jsonb(OLD)-'payload')
 THEN RAISE EXCEPTION 'OWNER_REPORT_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER owner_report_payload_guard BEFORE UPDATE OR DELETE ON shipit.owner_report_runs FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_payload_guard();
CREATE FUNCTION shipit.owner_report_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.owner_report_schedules s WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.id=NEW.schedule_id AND s.version=NEW.schedule_version)
 OR NEW.franchise_ids<>ARRAY(SELECT f.selected_id FROM shipit.owner_report_franchises f WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.schedule_id=NEW.schedule_id ORDER BY f.selected_id)
 OR NOT NEW.franchise_id=ANY(NEW.franchise_ids) OR NEW.payload IS NOT NULL AND (NEW.payload->>'definition'<>'owner_period_v1' OR NEW.payload->'franchise_ids'<>to_jsonb(NEW.franchise_ids))
 OR NEW.corrected_from IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.owner_report_runs p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.id=NEW.corrected_from
  AND p.schedule_id=NEW.schedule_id AND p.kind=NEW.kind AND p.period_from=NEW.period_from AND p.period_to=NEW.period_to AND p.version=NEW.version-1)
 THEN RAISE EXCEPTION 'OWNER_REPORT_SCOPE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER owner_report_run_guard BEFORE INSERT ON shipit.owner_report_runs FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_run_guard();
CREATE FUNCTION shipit.owner_report_delivery_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.organization_id,NEW.franchise_id,NEW.run_id,NEW.recipient_id,NEW.channel,NEW.notification_key) IS DISTINCT FROM
  (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.run_id,OLD.recipient_id,OLD.channel,OLD.notification_key) OR NEW.attempts<OLD.attempts
  OR OLD.state IN ('sent','suppressed') AND NEW.state<>OLD.state
  OR OLD.state='uncertain' AND NEW.state<>OLD.state
  OR OLD.state<>NEW.state AND NOT(OLD.state='pending' AND NEW.state IN ('sending','sent','failed','suppressed') OR OLD.state='sending' AND NEW.state IN ('pending','sent','uncertain','failed','suppressed') OR OLD.state='failed' AND NEW.state='pending')) THEN RAISE EXCEPTION 'OWNER_REPORT_DELIVERY_TRANSITION' USING ERRCODE='23514';END IF;
 NEW.updated_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER owner_report_delivery_guard BEFORE UPDATE ON shipit.owner_report_deliveries FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_delivery_guard();
CREATE FUNCTION shipit.owner_report_delivery_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.owner_report_delivery_history(organization_id,franchise_id,delivery_id,state,reason,attempt)
 VALUES(NEW.organization_id,NEW.franchise_id,NEW.id,NEW.state,NEW.reason,NEW.attempts);RETURN NEW;
END $fn$;
CREATE TRIGGER owner_report_delivery_audit AFTER INSERT OR UPDATE ON shipit.owner_report_deliveries FOR EACH ROW EXECUTE FUNCTION shipit.owner_report_delivery_audit();
CREATE FUNCTION shipit.owner_report_next(p_delivery boolean) RETURNS TABLE(organization_id uuid,franchise_id uuid,resource_id uuid,franchise_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF p_delivery THEN RETURN QUERY
  SELECT d.organization_id,d.franchise_id,d.id,r.franchise_ids FROM shipit.owner_report_deliveries d
  JOIN shipit.owner_report_runs r ON r.organization_id=d.organization_id AND r.franchise_id=d.franchise_id AND r.id=d.run_id
  WHERE d.state IN ('pending','sending') AND d.available_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
  ORDER BY d.available_at,d.id LIMIT 1;
 ELSE RETURN QUERY
  SELECT s.organization_id,s.franchise_id,s.id,ARRAY(SELECT f.selected_id FROM shipit.owner_report_franchises f
   WHERE f.organization_id=s.organization_id AND f.franchise_id=s.franchise_id AND f.schedule_id=s.id ORDER BY f.selected_id)
  FROM shipit.owner_report_schedules s WHERE s.next_check<=clock_timestamp()
  ORDER BY s.next_check,s.id LIMIT 1;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION shipit.owner_report_next(boolean) FROM PUBLIC;
CREATE FUNCTION shipit.owner_report_delivery_scope(p_id uuid,p_token uuid) RETURNS TABLE(organization_id uuid,franchise_id uuid,franchise_ids uuid[])
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT d.organization_id,d.franchise_id,r.franchise_ids FROM shipit.owner_report_deliveries d
 JOIN shipit.owner_report_runs r ON r.organization_id=d.organization_id AND r.franchise_id=d.franchise_id AND r.id=d.run_id
 WHERE d.id=p_id AND d.lease_token=p_token AND d.state='sending' AND d.lease_until>clock_timestamp()
$fn$;
REVOKE ALL ON FUNCTION shipit.owner_report_delivery_scope(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION shipit.owner_report_schedule_scope(p_id uuid) RETURNS TABLE(organization_id uuid,franchise_id uuid,resource_id uuid,franchise_ids uuid[])
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT s.organization_id,s.franchise_id,s.id,ARRAY(SELECT f.selected_id FROM shipit.owner_report_franchises f WHERE f.organization_id=s.organization_id AND f.franchise_id=s.franchise_id AND f.schedule_id=s.id ORDER BY f.selected_id)
 FROM shipit.owner_report_schedules s WHERE s.id=p_id
$fn$;
REVOKE ALL ON FUNCTION shipit.owner_report_schedule_scope(uuid) FROM PUBLIC;
CREATE FUNCTION shipit.owner_report_purge(p_org uuid,p_franchise uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_ids uuid[];
BEGIN
 UPDATE shipit.owner_report_runs SET payload=NULL WHERE organization_id=p_org AND franchise_id=p_franchise AND expires_at<=clock_timestamp() AND payload IS NOT NULL;
 SELECT array_agg(r.id) INTO old_ids FROM shipit.owner_report_runs r WHERE r.organization_id=p_org AND r.franchise_id=p_franchise
  AND NOT EXISTS(SELECT 1 FROM shipit.owner_report_runs n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.schedule_id=r.schedule_id AND n.kind=r.kind AND n.period_from=r.period_from AND n.period_to=r.period_to AND n.created_at>=clock_timestamp()-interval '90 days');
 DELETE FROM shipit.owner_report_delivery_history h WHERE h.organization_id=p_org AND h.franchise_id=p_franchise AND h.recorded_at<clock_timestamp()-interval '90 days';
 DELETE FROM shipit.owner_report_deliveries d WHERE d.organization_id=p_org AND d.franchise_id=p_franchise AND d.run_id=ANY(old_ids)
  AND NOT EXISTS(SELECT 1 FROM shipit.owner_report_delivery_history h WHERE h.organization_id=d.organization_id AND h.franchise_id=d.franchise_id AND h.delivery_id=d.id);
 DELETE FROM shipit.owner_report_runs r WHERE r.organization_id=p_org AND r.franchise_id=p_franchise AND r.id=ANY(old_ids)
  AND NOT EXISTS(SELECT 1 FROM shipit.owner_report_deliveries d WHERE d.organization_id=r.organization_id AND d.franchise_id=r.franchise_id AND d.run_id=r.id);
 DELETE FROM shipit.owner_report_commands WHERE organization_id=p_org AND franchise_id=p_franchise AND recorded_at<clock_timestamp()-interval '365 days';
 DELETE FROM shipit.owner_report_access_events WHERE organization_id=p_org AND franchise_id=p_franchise AND recorded_at<clock_timestamp()-interval '90 days';
 DELETE FROM shipit.owner_report_alerts WHERE organization_id=p_org AND franchise_id=p_franchise AND state='resolved' AND updated_at<clock_timestamp()-interval '90 days';
END $fn$;
REVOKE ALL ON FUNCTION shipit.owner_report_purge(uuid,uuid) FROM PUBLIC;
DO $audit$ DECLARE source text;BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'owner_report_command:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
  'owner_report.'||operation,'owner_report_command',id,'success','owner_reporting',correlation_id,recorded_at,NULL,NULL,(result->>'version')::int,NULL FROM shipit.owner_report_commands
 UNION ALL SELECT 'owner_report_access:'||id::text,organization_id,ARRAY[franchise_id],CASE WHEN actor_id IS NULL THEN 'service' ELSE 'user' END,COALESCE(actor_id::text,'owner-report-worker'),
  'owner_report.'||action,'owner_report',resource_id,CASE WHEN action IN ('suppressed','failed') THEN action ELSE 'success' END,'owner_reporting',correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.owner_report_access_events
 $view$;
END $audit$;
`);
exports.down=()=>{throw new Error('Forward-only owner report migration');};
