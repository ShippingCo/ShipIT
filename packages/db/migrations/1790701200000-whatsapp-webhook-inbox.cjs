// Raw callbacks are never stored. Inbox jobs have database-only, atomic effects.
exports.up=pgm=>{pgm.sql(String.raw`
CREATE TABLE shipit.whatsapp_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 installation_id uuid NOT NULL, provider text NOT NULL DEFAULT 'meta_cloud' CHECK(provider='meta_cloud'),
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 250),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), kind text NOT NULL CHECK(kind IN ('inbound','status','unsupported')),
 message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200), status text,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)), received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sealed_payload text NOT NULL CHECK(length(sealed_payload) BETWEEN 38 AND 40000 AND sealed_payload ~ '^[A-Za-z0-9_-]+$'),
 key_version text NOT NULL CHECK(key_version ~ '^[a-z0-9_-]{1,32}$'), correlation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','retry_wait','completed','quarantined')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), processed_at timestamptz,
 reason_code text CHECK(reason_code IN ('unsupported_payload','installation_disabled','processing_failed','attempts_exhausted')),
 UNIQUE(installation_id,event_key), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 CHECK(((kind='status' AND status IN ('sent','delivered','read','failed')) OR kind='unsupported' OR (kind='inbound' AND status IS NULL)) IS TRUE),
 CHECK(isfinite(received_at) AND isfinite(available_at) AND (processed_at IS NULL OR isfinite(processed_at))),
 CHECK((state='completed')=(processed_at IS NOT NULL)),
 CHECK((state IN ('quarantined','retry_wait'))=(reason_code IS NOT NULL))
);
CREATE INDEX whatsapp_inbox_due ON shipit.whatsapp_inbox(available_at,received_at,id) WHERE state IN ('pending','retry_wait');
CREATE INDEX whatsapp_inbox_owner ON shipit.whatsapp_inbox(organization_id,franchise_id,state,received_at,id);
CREATE TABLE shipit.whatsapp_webhook_quarantine (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 reason_code text NOT NULL CHECK(reason_code IN ('unknown_installation','app_identity_mismatch','event_conflict')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), correlation_id uuid NOT NULL,
 UNIQUE(identity_digest,digest,reason_code)
);
CREATE TABLE shipit.whatsapp_delivery_observations (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 message_id text NOT NULL, progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 3),
 failure_observed boolean NOT NULL DEFAULT false, last_event_at timestamptz NOT NULL CHECK(isfinite(last_event_at)),
 PRIMARY KEY(installation_id,message_id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id)
);
CREATE TABLE shipit.whatsapp_inbox_attempts (
 inbox_id uuid NOT NULL, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),
 result text NOT NULL CHECK(result IN ('completed','retry_wait','quarantined')), reason_code text,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(inbox_id,attempt),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 CHECK(reason_code IS NULL OR reason_code IN ('installation_disabled','processing_failed','attempts_exhausted'))
);
CREATE FUNCTION shipit.guard_whatsapp_inbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.installation_id,NEW.provider,NEW.event_key,NEW.digest,NEW.kind,NEW.message_id,NEW.status,
 NEW.occurred_at,NEW.received_at,NEW.sealed_payload,NEW.key_version,NEW.correlation_id)
 IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.installation_id,OLD.provider,OLD.event_key,OLD.digest,OLD.kind,OLD.message_id,OLD.status,
 OLD.occurred_at,OLD.received_at,OLD.sealed_payload,OLD.key_version,OLD.correlation_id)
 THEN RAISE EXCEPTION 'WHATSAPP_INBOX_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.state IN ('completed','quarantined') THEN RAISE EXCEPTION 'WHATSAPP_INBOX_TERMINAL' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER whatsapp_inbox_identity BEFORE UPDATE OR DELETE ON shipit.whatsapp_inbox FOR EACH ROW EXECUTE FUNCTION shipit.guard_whatsapp_inbox();
CREATE FUNCTION shipit.whatsapp_inbox_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'WHATSAPP_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END $fn$;
CREATE TRIGGER whatsapp_quarantine_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_webhook_quarantine FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER whatsapp_inbox_attempts_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_inbox_attempts FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();

-- Only this fixed ingress boundary resolves a signed provider identity to an owner.
-- Runtime cannot insert inbox/quarantine rows or supply organization/franchise IDs.
CREATE FUNCTION shipit.whatsapp_receive(events jsonb,allowed_wabas text[],correlation uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE e jsonb; i shipit.whatsapp_installations; prior_digest text; why text; identity_hash text; quarantined integer:=0; inserted integer;
BEGIN
 IF jsonb_typeof(events)<>'array' OR jsonb_array_length(events) NOT BETWEEN 1 AND 100 OR cardinality(allowed_wabas) NOT BETWEEN 1 AND 1000 OR correlation IS NULL
 THEN RAISE EXCEPTION 'WHATSAPP_INGRESS_INVALID' USING ERRCODE='23514'; END IF;
 -- Canonical order avoids lock-order inversions for overlapping provider batches.
 FOR e IN SELECT value FROM jsonb_array_elements(events) ORDER BY value->>'phone_number_id',value->>'event_key',value->>'digest' LOOP
  IF NOT (jsonb_typeof(e)='object' AND e - ARRAY['waba_id','phone_number_id','event_key','digest','kind','message_id','status','occurred_at','sealed_payload','key_version']='{}'::jsonb
    AND e ?& ARRAY['waba_id','phone_number_id','event_key','digest','kind','message_id','status','occurred_at','sealed_payload','key_version']
    AND e->>'waba_id' ~ '^[1-9][0-9]{0,31}$' AND e->>'phone_number_id' ~ '^[1-9][0-9]{0,31}$' AND e->>'digest' ~ '^[a-f0-9]{64}$') IS TRUE
  THEN RAISE EXCEPTION 'WHATSAPP_INGRESS_INVALID' USING ERRCODE='23514'; END IF;
  why:=NULL; i:=NULL;
  IF NOT (e->>'waba_id'=ANY(allowed_wabas)) THEN why:='app_identity_mismatch';
  ELSE
   SELECT * INTO i FROM shipit.whatsapp_installations x WHERE x.waba_id=e->>'waba_id' AND x.phone_number_id=e->>'phone_number_id' FOR SHARE;
   IF i.id IS NULL THEN why:='unknown_installation'; END IF;
  END IF;
  identity_hash:=encode(sha256(convert_to(jsonb_build_array(e->>'waba_id',e->>'phone_number_id',e->>'event_key')::text,'UTF8')),'hex');
  IF why IS NULL THEN
   INSERT INTO shipit.whatsapp_inbox(organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,status,occurred_at,sealed_payload,key_version,correlation_id,state,reason_code)
   VALUES(i.organization_id,i.franchise_id,i.id,e->>'event_key',e->>'digest',e->>'kind',e->>'message_id',e->>'status',(e->>'occurred_at')::timestamptz,
     e->>'sealed_payload',e->>'key_version',correlation,CASE WHEN e->>'kind'='unsupported' THEN 'quarantined' ELSE 'pending' END,
     CASE WHEN e->>'kind'='unsupported' THEN 'unsupported_payload' ELSE NULL END)
   ON CONFLICT(installation_id,event_key) DO NOTHING;
   SELECT digest INTO prior_digest FROM shipit.whatsapp_inbox WHERE installation_id=i.id AND event_key=e->>'event_key';
   IF prior_digest<>e->>'digest' THEN why:='event_conflict'; END IF;
  END IF;
  IF why IS NOT NULL THEN
   INSERT INTO shipit.whatsapp_webhook_quarantine(identity_digest,digest,reason_code,correlation_id)
   VALUES(identity_hash,e->>'digest',why,correlation) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted=ROW_COUNT;quarantined:=quarantined+inserted;
  END IF;
 END LOOP;
 RETURN quarantined;
END $fn$;

-- Hold the selected row through its database-only effect and completion transaction.
-- Crash/connection loss rolls back both. No external side effect or in-memory lease.
CREATE FUNCTION shipit.whatsapp_inbox_next() RETURNS TABLE(organization_id uuid,franchise_id uuid,inbox_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT j.organization_id,j.franchise_id,j.id FROM shipit.whatsapp_inbox j
 WHERE j.state IN ('pending','retry_wait') AND j.available_at<=clock_timestamp()
 ORDER BY j.available_at,j.received_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED
$fn$;
CREATE FUNCTION shipit.whatsapp_inbox_process(org uuid,franchise uuid,job uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.whatsapp_inbox; active boolean; outcome text; why text; rank smallint;
BEGIN
 SELECT * INTO j FROM shipit.whatsapp_inbox x WHERE x.organization_id=org AND x.franchise_id=franchise AND x.id=job FOR UPDATE;
 IF j.id IS NULL OR j.state NOT IN ('pending','retry_wait') OR j.available_at>clock_timestamp() THEN RETURN 'idle'; END IF;
 UPDATE shipit.whatsapp_inbox SET attempts=attempts+1 WHERE id=j.id;
 outcome:='completed';why:=NULL;
 BEGIN
  SELECT i.state='validated' AND f.lifecycle='active' AND o.lifecycle='active' INTO active FROM shipit.whatsapp_installations i
   JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id JOIN shipit.organizations o ON o.id=i.organization_id
   WHERE i.organization_id=org AND i.franchise_id=franchise AND i.id=j.installation_id FOR SHARE OF i,f,o;
  IF NOT coalesce(active,false) THEN outcome:='quarantined';why:='installation_disabled';
  ELSIF j.kind='status' THEN
   rank:=CASE j.status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END;
   INSERT INTO shipit.whatsapp_delivery_observations AS d(organization_id,franchise_id,installation_id,message_id,progress,failure_observed,last_event_at)
   VALUES(org,franchise,j.installation_id,j.message_id,rank,j.status='failed',j.occurred_at)
   ON CONFLICT(installation_id,message_id) DO UPDATE SET progress=greatest(d.progress,excluded.progress),
    failure_observed=d.failure_observed OR excluded.failure_observed,last_event_at=greatest(d.last_event_at,excluded.last_event_at);
  END IF;
 EXCEPTION WHEN OTHERS THEN
  outcome:=CASE WHEN j.attempts+1>=5 THEN 'quarantined' ELSE 'retry_wait' END;
  why:=CASE WHEN j.attempts+1>=5 THEN 'attempts_exhausted' ELSE 'processing_failed' END;
 END;
 UPDATE shipit.whatsapp_inbox SET state=outcome,reason_code=why,processed_at=CASE WHEN outcome='completed' THEN clock_timestamp() ELSE NULL END,
  available_at=clock_timestamp()+make_interval(secs=>least(30,power(2,j.attempts+1)::integer)) WHERE id=j.id;
 INSERT INTO shipit.whatsapp_inbox_attempts(inbox_id,organization_id,franchise_id,attempt,result,reason_code)
 VALUES(j.id,org,franchise,j.attempts+1,outcome,why);
 RETURN outcome;
END $fn$;
REVOKE ALL ON shipit.whatsapp_inbox,shipit.whatsapp_webhook_quarantine,shipit.whatsapp_delivery_observations,shipit.whatsapp_inbox_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_whatsapp_inbox(),shipit.whatsapp_inbox_append_only(),shipit.whatsapp_receive(jsonb,text[],uuid),
 shipit.whatsapp_inbox_next(),shipit.whatsapp_inbox_process(uuid,uuid,uuid) FROM PUBLIC;
`);};
