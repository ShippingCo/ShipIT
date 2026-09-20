exports.up = pgm => {
  pgm.sql(`
CREATE UNIQUE INDEX domain_events_outbox_owner_key ON shipit.domain_events(organization_id,franchise_id,event_id);
CREATE INDEX domain_events_outbox_scan_idx ON shipit.domain_events(organization_id,franchise_id,event_type,event_id);
CREATE TABLE shipit.outbox_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 event_id uuid NOT NULL, consumer_id text NOT NULL CHECK(consumer_id ~ '^[a-z][a-z0-9_.-]{0,63}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retry_wait','completed','quarantined')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 cycle_attempts integer NOT NULL DEFAULT 0 CHECK(cycle_attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(available_at)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 lease_token uuid, lease_until timestamptz, reason_code text,
 UNIQUE(event_id,consumer_id), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,event_id) REFERENCES shipit.domain_events(organization_id,franchise_id,event_id) ON DELETE RESTRICT,
 CHECK((state='leased')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state='leased' OR (lease_token IS NULL AND lease_until IS NULL)),
 CHECK(lease_until IS NULL OR isfinite(lease_until)),
 CHECK(reason_code IS NULL OR reason_code IN ('retryable_failure','permanent_failure','attempts_exhausted','schema_mismatch','ordering_gap','version_conflict','lease_expired'))
);
CREATE INDEX outbox_jobs_due_idx ON shipit.outbox_jobs(consumer_id,organization_id,franchise_id,available_at,id) WHERE state IN ('pending','retry_wait','leased');
CREATE INDEX outbox_jobs_quarantine_idx ON shipit.outbox_jobs(consumer_id,organization_id,franchise_id) WHERE state='quarantined';
CREATE TABLE shipit.outbox_schedule (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, consumer_id text NOT NULL,
 relay_turn bigint NOT NULL DEFAULT 0, claim_turn bigint NOT NULL DEFAULT 0, alert_turn bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,franchise_id,consumer_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE SEQUENCE shipit.outbox_turn;
CREATE TABLE shipit.outbox_streams (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, consumer_id text NOT NULL,
 aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, high_water integer NOT NULL DEFAULT 0 CHECK(high_water>=0),
 PRIMARY KEY(organization_id,franchise_id,consumer_id,aggregate_type,aggregate_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.outbox_receipts (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, job_id uuid PRIMARY KEY,
 lease_token uuid NOT NULL, disposition text NOT NULL CHECK(disposition IN ('applied','skipped_stale','historical')),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 FOREIGN KEY(organization_id,franchise_id,job_id) REFERENCES shipit.outbox_jobs(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.outbox_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, franchise_id uuid NOT NULL, job_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0), kind text NOT NULL CHECK(kind IN ('claimed','retry_wait','quarantined','completed','lease_expired')),
 reason_code text CHECK(reason_code IN ('retryable_failure','permanent_failure','attempts_exhausted','schema_mismatch','ordering_gap','version_conflict','lease_expired')),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)), UNIQUE(job_id,attempt,kind),
 FOREIGN KEY(organization_id,franchise_id,job_id) REFERENCES shipit.outbox_jobs(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.outbox_redrives (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, job_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT, correlation_id uuid NOT NULL,
 key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 reason_code text NOT NULL CHECK(reason_code IN ('dependency_repaired','consumer_upgraded','ordering_reconciled')),
 version integer NOT NULL CHECK(version>1), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,actor_id,key_hash), UNIQUE(job_id,version),
 FOREIGN KEY(organization_id,franchise_id,job_id) REFERENCES shipit.outbox_jobs(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX outbox_attempts_owner_idx ON shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt);
CREATE INDEX outbox_redrives_owner_idx ON shipit.outbox_redrives(organization_id,franchise_id,job_id,version);
CREATE FUNCTION shipit.guard_outbox_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.event_id,NEW.consumer_id,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.event_id,OLD.consumer_id,OLD.created_at)
 THEN RAISE EXCEPTION 'OUTBOX_IDENTITY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER outbox_job_identity BEFORE UPDATE OR DELETE ON shipit.outbox_jobs FOR EACH ROW EXECUTE FUNCTION shipit.guard_outbox_job();
REVOKE ALL ON FUNCTION shipit.guard_outbox_job() FROM PUBLIC;

-- Only owner references cross the global scheduler boundary. There is no payload export.
CREATE FUNCTION shipit.outbox_next_scope(consumer text, types text[], mode text, at_time timestamptz)
RETURNS TABLE(organization_id uuid,franchise_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE owner_org uuid; owner_franchise uuid; turn bigint;
BEGIN
 at_time:=coalesce(at_time,clock_timestamp());
 IF consumer !~ '^[a-z][a-z0-9_.-]{0,63}$' OR cardinality(types) NOT BETWEEN 1 AND 64 OR mode NOT IN ('relay','claim','alert') OR NOT isfinite(at_time)
 THEN RAISE EXCEPTION 'OUTBOX_INPUT_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock(350035,1) THEN RETURN; END IF;
 SELECT f.organization_id,f.id INTO owner_org,owner_franchise FROM shipit.franchises f
 LEFT JOIN shipit.outbox_schedule s ON s.organization_id=f.organization_id AND s.franchise_id=f.id AND s.consumer_id=consumer
 WHERE CASE WHEN mode='relay' THEN EXISTS (
   SELECT 1 FROM shipit.domain_events e WHERE e.organization_id=f.organization_id AND e.franchise_id=f.id AND e.event_type=ANY(types)
   AND NOT EXISTS(SELECT 1 FROM shipit.outbox_jobs j WHERE j.event_id=e.event_id AND j.consumer_id=consumer))
 WHEN mode='alert' THEN EXISTS(SELECT 1 FROM shipit.outbox_jobs j WHERE j.organization_id=f.organization_id AND j.franchise_id=f.id AND j.consumer_id=consumer AND j.state='quarantined')
 ELSE EXISTS(SELECT 1 FROM shipit.outbox_jobs j WHERE j.organization_id=f.organization_id AND j.franchise_id=f.id AND j.consumer_id=consumer
   AND ((j.state IN ('pending','retry_wait') AND j.available_at<=at_time) OR (j.state='leased' AND j.lease_until<=at_time))) END
 ORDER BY CASE WHEN mode='relay' THEN coalesce(s.relay_turn,0) WHEN mode='alert' THEN coalesce(s.alert_turn,0) ELSE coalesce(s.claim_turn,0) END,f.organization_id,f.id LIMIT 1;
 IF owner_org IS NULL THEN RETURN; END IF;
 turn:=nextval('shipit.outbox_turn');
 INSERT INTO shipit.outbox_schedule AS s(organization_id,franchise_id,consumer_id,relay_turn,claim_turn,alert_turn)
 VALUES(owner_org,owner_franchise,consumer,CASE WHEN mode='relay' THEN turn ELSE 0 END,CASE WHEN mode='claim' THEN turn ELSE 0 END,CASE WHEN mode='alert' THEN turn ELSE 0 END)
 ON CONFLICT ON CONSTRAINT outbox_schedule_pkey DO UPDATE SET
 relay_turn=CASE WHEN mode='relay' THEN turn ELSE s.relay_turn END,claim_turn=CASE WHEN mode='claim' THEN turn ELSE s.claim_turn END,alert_turn=CASE WHEN mode='alert' THEN turn ELSE s.alert_turn END;
 RETURN QUERY SELECT owner_org,owner_franchise;
END $fn$;
CREATE FUNCTION shipit.outbox_job_scope(job uuid) RETURNS TABLE(organization_id uuid,franchise_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT j.organization_id,j.franchise_id FROM shipit.outbox_jobs j JOIN shipit.domain_events e
 ON e.organization_id=j.organization_id AND e.franchise_id=j.franchise_id AND e.event_id=j.event_id WHERE j.id=job
$fn$;
CREATE FUNCTION shipit.outbox_relay(org uuid,franchise uuid,consumer text,types text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE inserted integer;
BEGIN
 IF cardinality(types) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'OUTBOX_INPUT_INVALID' USING ERRCODE='23514'; END IF;
 INSERT INTO shipit.outbox_jobs(organization_id,franchise_id,event_id,consumer_id)
 SELECT e.organization_id,e.franchise_id,e.event_id,consumer FROM shipit.domain_events e
 WHERE e.organization_id=org AND e.franchise_id=franchise AND e.event_type=ANY(types)
 AND NOT EXISTS(SELECT 1 FROM shipit.outbox_jobs j WHERE j.event_id=e.event_id AND j.consumer_id=consumer)
 ORDER BY e.event_id LIMIT 100 ON CONFLICT(event_id,consumer_id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT; RETURN inserted;
END $fn$;
CREATE FUNCTION shipit.outbox_claim(org uuid,franchise uuid,consumer text,at_time timestamptz)
RETURNS SETOF shipit.outbox_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.outbox_jobs;
BEGIN
 at_time:=coalesce(at_time,clock_timestamp());
 SELECT * INTO j FROM shipit.outbox_jobs q WHERE q.organization_id=org AND q.franchise_id=franchise AND q.consumer_id=consumer
 AND ((q.state IN ('pending','retry_wait') AND q.available_at<=at_time) OR (q.state='leased' AND q.lease_until<=at_time))
 ORDER BY q.available_at,q.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 IF j.state='leased' THEN
 INSERT INTO shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt,kind,reason_code,occurred_at)
 VALUES(org,franchise,j.id,j.attempts,'lease_expired','lease_expired',at_time);
 END IF;
 -- A committed effect can always be acknowledged, even on the last expired attempt.
 IF EXISTS(SELECT 1 FROM shipit.outbox_receipts r WHERE r.job_id=j.id) THEN
 UPDATE shipit.outbox_jobs SET state='completed',lease_token=NULL,lease_until=NULL,reason_code=NULL,version=version+1 WHERE id=j.id;
 INSERT INTO shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt,kind,occurred_at)
 VALUES(org,franchise,j.id,j.attempts,'completed',at_time); RETURN;
 END IF;
 IF j.cycle_attempts>=5 THEN
 UPDATE shipit.outbox_jobs SET state='quarantined',lease_token=NULL,lease_until=NULL,reason_code='attempts_exhausted',version=version+1 WHERE id=j.id;
 INSERT INTO shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt,kind,reason_code,occurred_at)
 VALUES(org,franchise,j.id,j.attempts,'quarantined','attempts_exhausted',at_time); RETURN;
 END IF;
 UPDATE shipit.outbox_jobs SET state='leased',lease_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds',
 attempts=attempts+1,cycle_attempts=cycle_attempts+1,version=version+1,reason_code=NULL WHERE id=j.id RETURNING * INTO j;
 INSERT INTO shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt,kind,occurred_at)
 VALUES(org,franchise,j.id,j.attempts,'claimed',at_time);
 RETURN NEXT j;
END $fn$;
CREATE FUNCTION shipit.outbox_receipt(org uuid,franchise uuid,job uuid,token uuid,disposition text,at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.outbox_jobs;
BEGIN
 at_time:=coalesce(at_time,clock_timestamp());
 SELECT * INTO j FROM shipit.outbox_jobs WHERE organization_id=org AND franchise_id=franchise AND id=job FOR UPDATE;
 IF NOT FOUND OR token IS NULL OR j.state<>'leased' OR j.lease_token<>token OR j.lease_until<=at_time THEN RETURN false; END IF;
 INSERT INTO shipit.outbox_receipts VALUES(org,franchise,job,token,disposition,at_time);
 RETURN true;
END $fn$;
CREATE FUNCTION shipit.outbox_finish(org uuid,franchise uuid,job uuid,token uuid,code text,delay_ms integer,at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.outbox_jobs; next_state text;
BEGIN
 at_time:=coalesce(at_time,clock_timestamp());
 SELECT * INTO j FROM shipit.outbox_jobs WHERE organization_id=org AND franchise_id=franchise AND id=job FOR UPDATE;
 IF NOT FOUND OR token IS NULL OR j.state<>'leased' OR j.lease_token<>token OR j.lease_until<=at_time THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM shipit.outbox_receipts r WHERE r.job_id=j.id) THEN next_state:='completed';code:=NULL;
 ELSE
 IF code IS NULL OR code NOT IN ('retryable_failure','permanent_failure','schema_mismatch','ordering_gap','version_conflict') OR delay_ms NOT BETWEEN 1000 AND 30000
 THEN RAISE EXCEPTION 'OUTBOX_OUTCOME_INVALID' USING ERRCODE='23514'; END IF;
 next_state:=CASE WHEN code='retryable_failure' AND j.cycle_attempts<5 THEN 'retry_wait' ELSE 'quarantined' END;
 IF code='retryable_failure' AND j.cycle_attempts>=5 THEN code:='attempts_exhausted'; END IF;
 END IF;
 UPDATE shipit.outbox_jobs SET state=next_state,lease_token=NULL,lease_until=NULL,reason_code=code,version=version+1,
 available_at=at_time+delay_ms*interval '1 millisecond' WHERE id=job;
 INSERT INTO shipit.outbox_attempts(organization_id,franchise_id,job_id,attempt,kind,reason_code,occurred_at)
 VALUES(org,franchise,job,j.attempts,next_state,code,at_time); RETURN true;
END $fn$;
CREATE FUNCTION shipit.outbox_redrive(org uuid,franchise uuid,job uuid,actor uuid,correlation uuid,key_hash text,fingerprint text,
 expected integer,reason text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.outbox_jobs;
BEGIN
 SELECT * INTO j FROM shipit.outbox_jobs WHERE organization_id=org AND franchise_id=franchise AND id=job FOR UPDATE;
 IF NOT FOUND OR expected IS NULL OR j.state<>'quarantined' OR j.version<>expected THEN RETURN NULL; END IF;
 UPDATE shipit.outbox_jobs SET state='pending',cycle_attempts=0,reason_code=NULL,available_at=clock_timestamp(),version=version+1 WHERE id=job;
 INSERT INTO shipit.outbox_redrives(id,organization_id,franchise_id,job_id,actor_id,correlation_id,key_hash,fingerprint,reason_code,version)
 VALUES(gen_random_uuid(),org,franchise,job,actor,correlation,key_hash,fingerprint,reason,j.version+1); RETURN j.version+1;
END $fn$;
CREATE TRIGGER outbox_receipts_immutable BEFORE UPDATE OR DELETE ON shipit.outbox_receipts FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation();
CREATE TRIGGER outbox_attempts_immutable BEFORE UPDATE OR DELETE ON shipit.outbox_attempts FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation();
CREATE TRIGGER outbox_redrives_immutable BEFORE UPDATE OR DELETE ON shipit.outbox_redrives FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation();
REVOKE ALL ON shipit.outbox_jobs,shipit.outbox_schedule,shipit.outbox_streams,shipit.outbox_receipts,shipit.outbox_attempts,shipit.outbox_redrives FROM PUBLIC;
REVOKE ALL ON SEQUENCE shipit.outbox_turn FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.outbox_next_scope(text,text[],text,timestamptz),shipit.outbox_job_scope(uuid),
 shipit.outbox_relay(uuid,uuid,text,text[]),shipit.outbox_claim(uuid,uuid,text,timestamptz),
 shipit.outbox_receipt(uuid,uuid,uuid,uuid,text,timestamptz),shipit.outbox_finish(uuid,uuid,uuid,uuid,text,integer,timestamptz),
 shipit.outbox_redrive(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'outbox:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'outbox.redrive','outbox_job',job_id,'success',reason_code,correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.outbox_redrives$view$;
END $extend$;
`);
};
exports.down = () => { throw new Error('Forward-only migration'); };
