// Forward-only Issue #42: protected delivery challenges and atomic completion.
exports.up = pgm => { pgm.sql(String.raw`
CREATE TABLE shipit.delivery_commands (
 id uuid PRIMARY KEY,principal_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid,
 operation_id text NOT NULL CHECK(operation_id IN ('api.v1.deliveries.start','api.v1.deliveries.retry','api.v1.deliveries.resend',
  'api.v1.deliveries.replace','api.v1.deliveries.complete','api.v1.deliveries.exception.request','api.v1.deliveries.exception.approve','api.v1.deliveries.exception.complete')),
 key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 expected_version integer NOT NULL CHECK(expected_version BETWEEN 1 AND 2147483646),input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=2048),
 correlation_id uuid NOT NULL,state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','committed')),
 http_status integer,result jsonb,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),committed_at timestamptz,retain_until timestamptz,
 UNIQUE(principal_id,organization_id,franchise_id,operation_id,key_digest),UNIQUE(organization_id,franchise_id,id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK(isfinite(created_at) AND ((state='reserved' AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL)
  OR (state='committed' AND http_status BETWEEN 200 AND 499 AND jsonb_typeof(result)='object' AND octet_length(result::text)<=8192
    AND isfinite(committed_at) AND isfinite(retain_until) AND retain_until>=committed_at+interval '24 hours')))
);
CREATE INDEX delivery_commands_parcel_idx ON shipit.delivery_commands(organization_id,franchise_id,parcel_id,created_at,id);

-- The booking customer is the sender. Delivery proof instead owns a private, immutable
-- contact generation copied from the Parcel recipient snapshot at the first handover.
CREATE TABLE shipit.delivery_recipients (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,
 contact_version uuid NOT NULL,phone_normalized text NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,id,parcel_id),
 UNIQUE(organization_id,franchise_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id) ON DELETE RESTRICT,
 CHECK(phone_normalized~'^\+[1-9][0-9]{7,14}$' AND isfinite(created_at))
);

CREATE TABLE shipit.delivery_attempts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid NOT NULL,
 assignment_id uuid NOT NULL,agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 recipient_ref uuid NOT NULL,recipient_contact_version uuid NOT NULL,attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 2),
 state text NOT NULL CHECK(state IN ('active','failed','completed')),failed_verifications integer NOT NULL DEFAULT 0 CHECK(failed_verifications BETWEEN 0 AND 5),
 resend_count integer NOT NULL DEFAULT 0 CHECK(resend_count BETWEEN 0 AND 3),locked_at timestamptz,started_at timestamptz NOT NULL,closed_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),start_command_id uuid NOT NULL,close_delivery_command_id uuid,close_parcel_command_id uuid,
 UNIQUE(organization_id,franchise_id,id,parcel_id),UNIQUE(organization_id,franchise_id,parcel_id,attempt_number),UNIQUE(organization_id,franchise_id,assignment_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,recipient_ref,parcel_id) REFERENCES shipit.delivery_recipients(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,start_command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,close_delivery_command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,close_parcel_command_id,booking_id,parcel_id) REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(started_at) AND (locked_at IS NULL OR isfinite(locked_at)) AND (closed_at IS NULL OR isfinite(closed_at))
  AND ((state='active' AND closed_at IS NULL AND close_delivery_command_id IS NULL AND close_parcel_command_id IS NULL) OR
   (state='failed' AND closed_at IS NOT NULL AND close_delivery_command_id IS NULL AND close_parcel_command_id IS NOT NULL) OR
   (state='completed' AND closed_at IS NOT NULL AND close_delivery_command_id IS NOT NULL AND close_parcel_command_id IS NULL))
  AND ((failed_verifications=5)=(locked_at IS NOT NULL)))
);
CREATE INDEX delivery_attempts_agent_queue ON shipit.delivery_attempts(organization_id,franchise_id,agent_id,started_at,id) WHERE state='active';

CREATE TABLE shipit.delivery_challenges (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,
 challenge_version integer NOT NULL CHECK(challenge_version>0),verifier text CHECK(verifier~'^[0-9a-f]{64}$'),encrypted_secret text,
 key_version text NOT NULL CHECK(key_version~'^[a-z0-9_-]{1,32}$'),issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 superseded_at timestamptz,superseded_by uuid,consumed_at timestamptz,closed_at timestamptz,created_command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id,attempt_id),UNIQUE(organization_id,franchise_id,attempt_id,challenge_version),
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(superseded_by) REFERENCES shipit.delivery_challenges(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organization_id,franchise_id,created_command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(issued_at) AND isfinite(expires_at) AND expires_at=issued_at+interval '10 minutes'
  AND (superseded_at IS NULL OR isfinite(superseded_at)) AND (consumed_at IS NULL OR isfinite(consumed_at)) AND (closed_at IS NULL OR isfinite(closed_at))
  AND ((superseded_at IS NULL)=(superseded_by IS NULL)) AND num_nonnulls(superseded_at,consumed_at,closed_at)<=1
  AND ((verifier IS NOT NULL AND encrypted_secret IS NOT NULL) OR (verifier IS NULL AND encrypted_secret IS NULL)))
);
CREATE UNIQUE INDEX delivery_challenges_current_idx ON shipit.delivery_challenges(organization_id,franchise_id,attempt_id) WHERE superseded_at IS NULL;
CREATE INDEX delivery_challenges_cleanup_idx ON shipit.delivery_challenges(expires_at,id) WHERE encrypted_secret IS NOT NULL;

CREATE TABLE shipit.delivery_exception_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,
 requester_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,reason_code text NOT NULL CHECK(reason_code IN
  ('recipient_channel_unavailable','provider_unavailable','challenge_locked_reviewed')),evidence_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','invalidated')),requested_at timestamptz NOT NULL,
 request_command_id uuid NOT NULL,decided_at timestamptz,decision_command_id uuid,
 UNIQUE(organization_id,franchise_id,id,attempt_id),UNIQUE(organization_id,franchise_id,attempt_id),
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,evidence_id) REFERENCES shipit.attachments(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,request_command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,decision_command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(requested_at) AND ((state='pending' AND decided_at IS NULL AND decision_command_id IS NULL) OR
  (state IN ('approved','denied') AND isfinite(decided_at) AND decision_command_id IS NOT NULL) OR
  (state='invalidated' AND isfinite(decided_at))))
);
CREATE TABLE shipit.delivery_exception_approvals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,request_id uuid NOT NULL,
 requester_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,approver_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 evidence_id uuid NOT NULL,reason_code text NOT NULL,approved_at timestamptz NOT NULL,command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,request_id),UNIQUE(organization_id,franchise_id,id,attempt_id),
 FOREIGN KEY(organization_id,franchise_id,request_id,attempt_id) REFERENCES shipit.delivery_exception_requests(organization_id,franchise_id,id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(requester_id<>approver_id AND isfinite(approved_at))
);
CREATE TABLE shipit.delivery_proofs (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,
 proof_method text NOT NULL CHECK(proof_method IN ('otp_verified','exceptional')),challenge_id uuid,approval_id uuid,reason_code text,evidence_id uuid,
 requester_id uuid,approver_id uuid,completed_by uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,completed_at timestamptz NOT NULL,
 parcel_version integer NOT NULL CHECK(parcel_version>1),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,parcel_id),UNIQUE(organization_id,franchise_id,attempt_id),UNIQUE(command_id),
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,challenge_id,attempt_id) REFERENCES shipit.delivery_challenges(organization_id,franchise_id,id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,approval_id,attempt_id) REFERENCES shipit.delivery_exception_approvals(organization_id,franchise_id,id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(completed_at) AND ((proof_method='otp_verified' AND challenge_id IS NOT NULL AND approval_id IS NULL AND reason_code IS NULL
   AND evidence_id IS NULL AND requester_id IS NULL AND approver_id IS NULL) OR
  (proof_method='exceptional' AND challenge_id IS NULL AND approval_id IS NOT NULL AND reason_code IN
   ('recipient_channel_unavailable','provider_unavailable','challenge_locked_reviewed') AND evidence_id IS NOT NULL AND requester_id IS NOT NULL
   AND approver_id IS NOT NULL AND requester_id<>approver_id)))
);
CREATE TABLE shipit.delivery_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,action text NOT NULL,reason_code text NOT NULL CHECK(reason_code~'^[a-z_]{1,64}$'),
 outcome text NOT NULL CHECK(outcome IN ('success','denied')),correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL,command_id uuid NOT NULL UNIQUE,
 FOREIGN KEY(organization_id,franchise_id,command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(occurred_at))
);

ALTER TABLE shipit.delivery_commands ADD CONSTRAINT delivery_commands_attempt_fk FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id)
 REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE shipit.parcels ADD CONSTRAINT parcels_delivery_attempt_fk FOREIGN KEY(organization_id,franchise_id,active_attempt_id,id)
 REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED NOT VALID;

CREATE TABLE shipit.delivery_challenge_sends (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,challenge_id uuid NOT NULL,
 recipient_ref uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('initial','resend','replacement')),resend_ordinal integer NOT NULL CHECK(resend_ordinal BETWEEN 0 AND 3),
 reserved_at timestamptz NOT NULL,outbound_intent_id uuid,send_state text NOT NULL CHECK(send_state IN ('queued','failed')),
 reason_code text NOT NULL CHECK(reason_code~'^[a-z_]{1,64}$'),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,attempt_id,resend_ordinal),UNIQUE(organization_id,franchise_id,outbound_intent_id),
 FOREIGN KEY(organization_id,franchise_id,challenge_id,attempt_id) REFERENCES shipit.delivery_challenges(organization_id,franchise_id,id,attempt_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,recipient_ref,parcel_id) REFERENCES shipit.delivery_recipients(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id,parcel_id) REFERENCES shipit.delivery_commands(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 CHECK(isfinite(reserved_at) AND ((kind='initial' AND resend_ordinal=0) OR (kind<>'initial' AND resend_ordinal>0))
  AND ((send_state='queued')=(outbound_intent_id IS NOT NULL)))
);

CREATE FUNCTION shipit.delivery_challenge_cleanup_scope(at_time timestamptz)
RETURNS TABLE(organization_id uuid,franchise_id uuid,challenge_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT c.organization_id,c.franchise_id,c.id FROM shipit.delivery_challenges c JOIN shipit.delivery_attempts a
 ON a.organization_id=c.organization_id AND a.franchise_id=c.franchise_id AND a.id=c.attempt_id
 WHERE (c.encrypted_secret IS NOT NULL OR EXISTS(SELECT 1 FROM shipit.delivery_challenge_sends s JOIN shipit.whatsapp_outbound m
   ON m.organization_id=s.organization_id AND m.franchise_id=s.franchise_id AND m.id=s.outbound_intent_id
   WHERE s.organization_id=c.organization_id AND s.franchise_id=c.franchise_id AND s.challenge_id=c.id AND m.sealed_payload IS NOT NULL))
  AND (c.expires_at<=at_time OR c.superseded_at IS NOT NULL OR c.consumed_at IS NOT NULL OR c.closed_at IS NOT NULL OR a.state<>'active')
 ORDER BY c.expires_at,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1
$fn$;

-- Extend only the closed Parcel transitions owned by Deliveries; there remains no generic delivered mutation.
DO $extend_parcel$
DECLARE expr text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_operation_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_operation_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_operation_check CHECK ((%s) OR operation_id IN (''api.v1.deliveries.start'',''api.v1.deliveries.retry'',''api.v1.deliveries.complete''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_edge_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_edge_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_edge_check CHECK ((%s) OR
  (operation_id=''api.v1.deliveries.start'' AND from_status=''in_transit'' AND to_status=''out_for_delivery'') OR
  (operation_id=''api.v1.deliveries.retry'' AND from_status=''failed_attempt'' AND to_status=''out_for_delivery'') OR
  (operation_id=''api.v1.deliveries.complete'' AND from_status=''out_for_delivery'' AND to_status=''delivered''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_input_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_input_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_input_check CHECK ((%s) OR
  (operation_id IN (''api.v1.deliveries.start'',''api.v1.deliveries.retry'') AND input-ARRAY[''expected_version'',''evidence_ref'',''attempt_id'',''assignment_id'',''challenge_ref'',''agent_id'']=''{}''::jsonb
   AND input->>''expected_version''=expected_version::text AND (input->>''evidence_ref'')::uuid IS NOT NULL AND (input->>''attempt_id'')::uuid IS NOT NULL
   AND (input->>''assignment_id'')::uuid IS NOT NULL AND (input->>''challenge_ref'')::uuid IS NOT NULL AND (input->>''agent_id'')::uuid IS NOT NULL) OR
  (operation_id=''api.v1.deliveries.complete'' AND input-ARRAY[''expected_version'',''evidence_ref'',''attempt_id'',''proof_ref'']=''{}''::jsonb
   AND input->>''expected_version''=expected_version::text AND (input->>''evidence_ref'')::uuid IS NOT NULL AND (input->>''attempt_id'')::uuid IS NOT NULL
   AND (input->>''proof_ref'')::uuid IS NOT NULL))',expr);
END $extend_parcel$;

CREATE OR REPLACE FUNCTION shipit.guard_parcel_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.parcel_commands;
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','custody','version','attempts_started','failed_attempt_count','active_attempt_id','assigned_agent_id','last_command_id','updated_at'])
  <> (to_jsonb(OLD)-ARRAY['status','custody','version','attempts_started','failed_attempt_count','active_attempt_id','assigned_agent_id','last_command_id','updated_at'])
 THEN RAISE EXCEPTION 'PARCEL_MUTATION_INVALID' USING ERRCODE='23514',CONSTRAINT='parcel_immutable_fields'; END IF;
 SELECT * INTO c FROM shipit.parcel_commands WHERE id=NEW.last_command_id AND organization_id=OLD.organization_id AND franchise_id=OLD.franchise_id
  AND booking_id=OLD.booking_id AND parcel_id=OLD.id AND state='reserved';
 IF c.id IS NULL OR c.expected_version<>OLD.version OR c.from_status<>OLD.status OR c.to_status<>NEW.status OR NEW.version<>OLD.version+1 OR NOT isfinite(NEW.updated_at)
 OR (c.operation_id='api.v1.parcels.check_in' AND NOT (OLD.status='booked' AND NEW.status='checked_in' AND NEW.custody='franchise_office'))
 OR (c.operation_id='api.v1.parcels.dispatch' AND NOT (OLD.status='checked_in' AND NEW.status='dispatched' AND NEW.custody='route_dispatch'))
 OR (c.operation_id='api.v1.parcels.transit' AND NOT (OLD.status='dispatched' AND NEW.status='in_transit' AND NEW.custody='route_dispatch'))
 OR (c.operation_id='api.v1.parcels.fail_delivery' AND NOT (OLD.status='out_for_delivery' AND NEW.status='failed_attempt' AND NEW.custody=OLD.custody
   AND NEW.assigned_agent_id=OLD.assigned_agent_id AND NEW.active_attempt_id IS NULL AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count+1))
 OR (c.operation_id='api.v1.parcels.approve_rto' AND NOT (OLD.status='failed_attempt' AND NEW.status='rto' AND NEW.custody=OLD.custody
   AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id AND NEW.active_attempt_id IS NULL AND NEW.attempts_started=OLD.attempts_started
   AND NEW.failed_attempt_count=OLD.failed_attempt_count AND ((c.input?'override_reason_code') OR (OLD.failed_attempt_count=2 AND EXISTS(SELECT 1 FROM shipit.parcel_failed_attempts f
    WHERE f.organization_id=OLD.organization_id AND f.franchise_id=OLD.franchise_id AND f.parcel_id=OLD.id AND f.attempt_number=2
    AND f.reason_code IN ('customer_unavailable','address_issue','payment_not_collected','operational_issue'))))))
 OR (c.operation_id IN ('api.v1.deliveries.start','api.v1.deliveries.retry') AND NOT (
   OLD.status=CASE c.operation_id WHEN 'api.v1.deliveries.start' THEN 'in_transit' ELSE 'failed_attempt' END AND NEW.status='out_for_delivery'
   AND NEW.custody='delivery_agent' AND NEW.active_attempt_id=(c.input->>'attempt_id')::uuid AND NEW.assigned_agent_id=(c.input->>'agent_id')::uuid
   AND NEW.attempts_started=OLD.attempts_started+1 AND NEW.failed_attempt_count=OLD.failed_attempt_count))
 OR (c.operation_id='api.v1.deliveries.complete' AND NOT (OLD.status='out_for_delivery' AND NEW.status='delivered' AND NEW.custody='recipient'
   AND NEW.active_attempt_id IS NULL AND NEW.assigned_agent_id IS NULL AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count))
 THEN RAISE EXCEPTION 'PARCEL_TRANSITION_INVALID' USING ERRCODE='23514',CONSTRAINT='parcel_transition_guard'; END IF;
 RETURN NEW;
END $fn$;

DO $events$
DECLARE n text;expr text;
BEGIN
 FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
  ALTER TABLE shipit.domain_events DROP CONSTRAINT IF EXISTS domain_events_command_owner_check;
  IF n='domain_events_type_check' THEN ALTER TABLE shipit.domain_events DROP CONSTRAINT IF EXISTS domain_events_type_check; END IF;
  expr=replace(expr,'''delivery.attempt_failed''::text','''delivery.attempt_started''::text, ''delivery.retry_started''::text, ''delivery.completed''::text, ''delivery.attempt_failed''::text');
  EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK (%s)',n,expr);
 END LOOP;
END $events$;

CREATE OR REPLACE FUNCTION shipit.check_parcel_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE p shipit.parcels;transition_count integer;event_count integer;failure_count integer;rto_count integer;expected_event text;expected_payload jsonb;
BEGIN
 IF NEW.state<>'committed' THEN RETURN NULL; END IF;
 SELECT * INTO p FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.parcel_id;
 expected_event=CASE NEW.operation_id WHEN 'api.v1.parcels.check_in' THEN 'parcel.checked_in' WHEN 'api.v1.parcels.dispatch' THEN 'parcel.dispatched'
  WHEN 'api.v1.parcels.transit' THEN 'parcel.in_transit' WHEN 'api.v1.parcels.fail_delivery' THEN 'delivery.attempt_failed'
  WHEN 'api.v1.parcels.approve_rto' THEN 'parcel.rto_approved' WHEN 'api.v1.deliveries.start' THEN 'delivery.attempt_started'
  WHEN 'api.v1.deliveries.retry' THEN 'delivery.retry_started' ELSE 'delivery.completed' END;
 expected_payload=CASE NEW.operation_id WHEN 'api.v1.parcels.check_in' THEN jsonb_build_object('receipt_ref',NEW.input->'evidence_ref','location_ref',NEW.input->'location_ref')
  WHEN 'api.v1.parcels.dispatch' THEN jsonb_build_object('manifest_id',NEW.input->'manifest_id','dispatch_evidence_ref',NEW.input->'evidence_ref')
  WHEN 'api.v1.parcels.transit' THEN jsonb_build_object('route_id',NEW.input->'route_id','movement_evidence_ref',NEW.input->'evidence_ref')
  WHEN 'api.v1.parcels.fail_delivery' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','failure_reason',NEW.input->'reason_code','evidence_ref',NEW.input->'evidence_ref')
   ||CASE WHEN NEW.input?'failure_subreason_code' THEN jsonb_build_object('failure_subreason',NEW.input->'failure_subreason_code') ELSE '{}'::jsonb END
  WHEN 'api.v1.parcels.approve_rto' THEN jsonb_build_object('approval_ref',NEW.input->'approval_ref','eligibility_ref',NEW.input->'evidence_ref','return_plan_ref',NEW.input->'return_plan_ref')
   ||CASE WHEN NEW.input?'override_reason_code' THEN jsonb_build_object('override_reason_code',NEW.input->'override_reason_code') ELSE '{}'::jsonb END
  WHEN 'api.v1.deliveries.start' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','assignment_id',NEW.input->'assignment_id','challenge_ref',NEW.input->'challenge_ref')
  WHEN 'api.v1.deliveries.retry' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','assignment_id',NEW.input->'assignment_id','challenge_ref',NEW.input->'challenge_ref')
  ELSE jsonb_build_object('attempt_id',NEW.input->'attempt_id','proof_ref',NEW.input->'proof_ref') END;
 SELECT count(*) INTO transition_count FROM shipit.parcel_transitions t WHERE t.command_id=NEW.id AND t.organization_id=NEW.organization_id
  AND t.franchise_id=NEW.franchise_id AND t.booking_id=NEW.booking_id AND t.parcel_id=NEW.parcel_id AND t.sequence=NEW.expected_version+1
  AND t.operation_id=replace(NEW.operation_id,'api.v1.','') AND t.from_status=NEW.from_status AND t.to_status=NEW.to_status AND t.actor_id=NEW.principal_id
  AND t.correlation_id=NEW.correlation_id AND t.evidence_ref=(NEW.input->>'evidence_ref')::uuid
  AND t.reason_code IS NOT DISTINCT FROM CASE WHEN NEW.operation_id='api.v1.parcels.fail_delivery' THEN NEW.input->>'reason_code'
    WHEN NEW.operation_id='api.v1.parcels.approve_rto' THEN NEW.input->>'override_reason_code' ELSE NULL END;
 SELECT count(*) INTO event_count FROM shipit.domain_events e JOIN shipit.parcel_transitions t ON t.id=e.event_id AND t.command_id=NEW.id
  WHERE e.parcel_command_id=NEW.id AND e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.booking_id=NEW.booking_id
  AND e.parcel_id=NEW.parcel_id AND e.aggregate_id=NEW.parcel_id AND e.aggregate_sequence=NEW.expected_version+1 AND e.event_type=expected_event
  AND e.envelope->>'correlation_id'=NEW.correlation_id::text AND e.envelope->'actor'->>'id'=NEW.principal_id::text AND e.envelope->'payload'=expected_payload;
 SELECT count(*) INTO failure_count FROM shipit.parcel_failed_attempts f WHERE f.command_id=NEW.id AND f.attempt_id=(NEW.input->>'attempt_id')::uuid
  AND f.reason_code=NEW.input->>'reason_code' AND f.failure_subreason_code IS NOT DISTINCT FROM NEW.input->>'failure_subreason_code'
  AND f.evidence_ref=(NEW.input->>'evidence_ref')::uuid AND f.actor_id=NEW.principal_id;
 SELECT count(*) INTO rto_count FROM shipit.parcel_rto_approvals r WHERE r.command_id=NEW.id
  AND r.mode=CASE WHEN NEW.input?'override_reason_code' THEN 'privileged_override' ELSE 'attempt_limit' END
  AND r.override_reason_code IS NOT DISTINCT FROM NEW.input->>'override_reason_code' AND r.approval_ref=(NEW.input->>'approval_ref')::uuid
  AND r.eligibility_ref=(NEW.input->>'evidence_ref')::uuid AND r.return_plan_ref=(NEW.input->>'return_plan_ref')::uuid AND r.actor_id=NEW.principal_id;
 IF p.id IS NULL OR p.last_command_id<>NEW.id OR p.version<>NEW.expected_version+1 OR p.status<>NEW.to_status OR transition_count<>1 OR event_count<>1
  OR failure_count<>(CASE WHEN NEW.operation_id='api.v1.parcels.fail_delivery' THEN 1 ELSE 0 END)
 OR rto_count<>(CASE WHEN NEW.operation_id='api.v1.parcels.approve_rto' THEN 1 ELSE 0 END)
  OR (NEW.operation_id='api.v1.parcels.fail_delivery' AND NOT EXISTS(SELECT 1 FROM shipit.delivery_attempts a
    WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.id=(NEW.input->>'attempt_id')::uuid
      AND a.parcel_id=NEW.parcel_id AND a.state='failed' AND a.close_parcel_command_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM shipit.delivery_challenges c WHERE c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id
        AND c.attempt_id=a.id AND c.superseded_at IS NULL AND (c.closed_at IS NULL OR c.verifier IS NOT NULL OR c.encrypted_secret IS NOT NULL))))
 THEN RAISE EXCEPTION 'PARCEL_COMMAND_INCOMPLETE' USING ERRCODE='23514',CONSTRAINT='parcel_command_complete'; END IF;
 RETURN NULL;
END $fn$;

CREATE FUNCTION shipit.guard_delivery_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'DELIVERY_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;RETURN NEW;END $fn$;
CREATE TRIGGER delivery_proofs_immutable BEFORE UPDATE OR DELETE ON shipit.delivery_proofs FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE TRIGGER delivery_approvals_immutable BEFORE UPDATE OR DELETE ON shipit.delivery_exception_approvals FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE TRIGGER delivery_audit_immutable BEFORE UPDATE OR DELETE ON shipit.delivery_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE TRIGGER delivery_sends_immutable BEFORE UPDATE OR DELETE ON shipit.delivery_challenge_sends FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE TRIGGER delivery_recipients_immutable BEFORE UPDATE OR DELETE ON shipit.delivery_recipients FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE TRIGGER delivery_commands_guard BEFORE UPDATE OR DELETE ON shipit.delivery_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_command();

-- Narrowly admit delivery_otp into the existing durable outbound ledger.
ALTER TABLE shipit.whatsapp_outbound ADD COLUMN delivery_recipient_ref uuid;
ALTER TABLE shipit.whatsapp_outbound ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_source_kind_check;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_source_kind_check CHECK(source_kind IN ('event','inbox','delivery_challenge'));
ALTER TABLE shipit.whatsapp_outbound DROP CONSTRAINT whatsapp_outbound_purpose_check;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_purpose_check CHECK(purpose IN ('updates','requested_assistance','consent_disclosure','delivery_otp'));
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_delivery_recipient_fk
 FOREIGN KEY(organization_id,franchise_id,delivery_recipient_ref) REFERENCES shipit.delivery_recipients(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.whatsapp_outbound ADD CONSTRAINT whatsapp_outbound_recipient_shape CHECK(
 (source_kind='delivery_challenge' AND purpose='delivery_otp' AND customer_id IS NULL AND delivery_recipient_ref IS NOT NULL)
 OR (source_kind<>'delivery_challenge' AND purpose<>'delivery_otp' AND customer_id IS NOT NULL AND delivery_recipient_ref IS NULL));
CREATE UNIQUE INDEX whatsapp_outbound_delivery_effect_identity ON shipit.whatsapp_outbound
 (organization_id,franchise_id,source_kind,source_id,affected_entity_id,delivery_recipient_ref,purpose)
 WHERE source_kind='delivery_challenge';
ALTER TABLE shipit.delivery_challenge_sends ADD CONSTRAINT delivery_sends_outbound_fk FOREIGN KEY(organization_id,franchise_id,outbound_intent_id)
 REFERENCES shipit.whatsapp_outbound(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
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
  ELSIF NEW.source_kind='inbox' THEN
   IF NOT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox i WHERE i.organization_id=NEW.organization_id AND i.franchise_id=NEW.franchise_id AND i.id=NEW.source_id AND i.installation_id=NEW.installation_id)
    THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.purpose<>'delivery_otp' OR NOT EXISTS(SELECT 1 FROM shipit.delivery_challenge_sends s JOIN shipit.delivery_attempts a
    ON a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.id=s.attempt_id
    WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.id=NEW.source_id AND s.outbound_intent_id=NEW.id
      AND s.recipient_ref=NEW.delivery_recipient_ref AND s.parcel_id=NEW.affected_entity_id AND a.state='active' AND a.recipient_ref=NEW.delivery_recipient_ref)
    THEN RAISE EXCEPTION 'OUTBOUND_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','reason_code','version','attempts','cycle_attempts','attempt_id','lease_until','available_at','sealed_payload'])
    OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR (NEW.sealed_payload IS DISTINCT FROM OLD.sealed_payload AND NEW.sealed_payload IS NOT NULL)
    OR (OLD.state='read' AND NEW.state<>'read') OR (OLD.state='delivered' AND NEW.state NOT IN ('delivered','read'))
   THEN RAISE EXCEPTION 'OUTBOUND_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $fn$;

DO $audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'delivery:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'delivery',parcel_id,
 outcome,reason_code,correlation_id,occurred_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.delivery_audit_events$view$;
END $audit$;

REVOKE ALL ON shipit.delivery_commands,shipit.delivery_recipients,shipit.delivery_attempts,shipit.delivery_challenges,shipit.delivery_challenge_sends,
 shipit.delivery_exception_requests,shipit.delivery_exception_approvals,shipit.delivery_proofs,shipit.delivery_audit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_delivery_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.delivery_challenge_cleanup_scope(timestamptz) FROM PUBLIC;
`); };
exports.down=()=>{throw new Error('Forward-only migration');};
