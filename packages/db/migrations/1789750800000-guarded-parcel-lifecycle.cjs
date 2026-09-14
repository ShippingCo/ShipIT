// Additive lifecycle aggregate, idempotent command ledger and append-only evidence for Issue #24.
// Deployment grants remain explicit and never embed a runtime role in the migration.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.parcel_commands (
      id uuid CONSTRAINT parcel_commands_pkey PRIMARY KEY,
      principal_id uuid NOT NULL CONSTRAINT parcel_commands_principal_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid NOT NULL,
      operation_id text NOT NULL CONSTRAINT parcel_commands_operation_check CHECK(operation_id IN (
        'api.v1.parcels.check_in','api.v1.parcels.dispatch','api.v1.parcels.transit','api.v1.parcels.fail_delivery','api.v1.parcels.approve_rto')),
      key_digest text NOT NULL CONSTRAINT parcel_commands_digest_check CHECK(key_digest ~ '^[0-9a-f]{64}$'),
      fingerprint text NOT NULL CONSTRAINT parcel_commands_fingerprint_check CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      expected_version integer NOT NULL CONSTRAINT parcel_commands_version_check CHECK(expected_version BETWEEN 1 AND 2147483646),
      from_status text NOT NULL, to_status text NOT NULL, input jsonb NOT NULL, correlation_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'reserved', http_status integer, result jsonb, committed_at timestamptz, retain_until timestamptz,
      CONSTRAINT parcel_commands_identity_key UNIQUE(principal_id,organization_id,franchise_id,operation_id,key_digest),
      CONSTRAINT parcel_commands_owner_key UNIQUE(organization_id,franchise_id,id,booking_id,parcel_id),
      CONSTRAINT parcel_commands_parcel_fk FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id)
        REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
      CONSTRAINT parcel_commands_edge_check CHECK(
        (operation_id='api.v1.parcels.check_in' AND from_status='booked' AND to_status='checked_in') OR
        (operation_id='api.v1.parcels.dispatch' AND from_status='checked_in' AND to_status='dispatched') OR
        (operation_id='api.v1.parcels.transit' AND from_status='dispatched' AND to_status='in_transit') OR
        (operation_id='api.v1.parcels.fail_delivery' AND from_status='out_for_delivery' AND to_status='failed_attempt') OR
        (operation_id='api.v1.parcels.approve_rto' AND from_status='failed_attempt' AND to_status='rto')),
      CONSTRAINT parcel_commands_input_check CHECK((jsonb_typeof(input)='object' AND octet_length(input::text)<=2048
        AND jsonb_typeof(input->'expected_version')='number' AND input->>'expected_version'=expected_version::text
        AND (input->>'evidence_ref')::uuid IS NOT NULL AND (
          (operation_id='api.v1.parcels.check_in' AND input-ARRAY['expected_version','evidence_ref','location_ref']='{}'::jsonb
            AND (input->>'location_ref')::uuid IS NOT NULL) OR
          (operation_id='api.v1.parcels.dispatch' AND input-ARRAY['expected_version','evidence_ref','manifest_id']='{}'::jsonb
            AND (input->>'manifest_id')::uuid IS NOT NULL) OR
          (operation_id='api.v1.parcels.transit' AND input-ARRAY['expected_version','evidence_ref','route_id']='{}'::jsonb
            AND (input->>'route_id')::uuid IS NOT NULL) OR
          (operation_id='api.v1.parcels.fail_delivery' AND input-ARRAY['expected_version','evidence_ref','attempt_id','reason_code','failure_subreason_code']='{}'::jsonb
            AND (input->>'attempt_id')::uuid IS NOT NULL
            AND (input->>'reason_code') IN ('customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue','other_controlled')
            AND ((input->>'reason_code'='other_controlled' AND (input->>'failure_subreason_code') IN ('weather_disruption','vehicle_breakdown','route_access_restricted','device_or_network_failure'))
              OR (input->>'reason_code'<>'other_controlled' AND NOT (input ? 'failure_subreason_code')))) OR
          (operation_id='api.v1.parcels.approve_rto' AND input-ARRAY['expected_version','evidence_ref','approval_ref','return_plan_ref','override_reason_code']='{}'::jsonb
            AND (input->>'approval_ref')::uuid IS NOT NULL AND (input->>'return_plan_ref')::uuid IS NOT NULL
            AND (NOT (input ? 'override_reason_code') OR (input->>'override_reason_code') IN ('safety_risk','legal_restriction','operationally_unserviceable')))
        )) IS TRUE),
      CONSTRAINT parcel_commands_state_check CHECK((state='reserved' AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL) OR
        (state='committed' AND http_status=200 AND jsonb_typeof(result)='object' AND octet_length(result::text)<=8192
          AND result->>'id'=parcel_id::text AND result->>'booking_id'=booking_id::text
          AND (result->>'version')::integer=expected_version+1 AND result->>'status'=to_status
          AND isfinite(committed_at) AND isfinite(retain_until) AND retain_until>=committed_at+interval '24 hours'))
    );

    ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_version_check;
    ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_status_check;
    ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_custody_check;
    ALTER TABLE shipit.parcels
      ADD COLUMN attempts_started integer NOT NULL DEFAULT 0,
      ADD COLUMN failed_attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN active_attempt_id uuid,
      ADD COLUMN assigned_agent_id uuid CONSTRAINT parcels_agent_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      ADD COLUMN last_command_id uuid,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
      ADD CONSTRAINT parcels_version_check CHECK(version BETWEEN 1 AND 2147483647),
      ADD CONSTRAINT parcels_status_check CHECK(status IN ('booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto')),
      ADD CONSTRAINT parcels_custody_check CHECK(custody IN ('awaiting_intake','franchise_office','route_dispatch','delivery_agent','recipient')),
      ADD CONSTRAINT parcels_attempt_count_check CHECK(attempts_started BETWEEN 0 AND 2 AND failed_attempt_count BETWEEN 0 AND attempts_started),
      ADD CONSTRAINT parcels_state_shape_check CHECK(
        (status='booked' AND custody='awaiting_intake' AND attempts_started=0 AND failed_attempt_count=0 AND active_attempt_id IS NULL AND assigned_agent_id IS NULL) OR
        (status='checked_in' AND custody='franchise_office' AND attempts_started=0 AND failed_attempt_count=0 AND active_attempt_id IS NULL AND assigned_agent_id IS NULL) OR
        (status IN ('dispatched','in_transit') AND custody='route_dispatch' AND attempts_started=0 AND failed_attempt_count=0 AND active_attempt_id IS NULL AND assigned_agent_id IS NULL) OR
        (status='out_for_delivery' AND custody='delivery_agent' AND attempts_started BETWEEN 1 AND 2 AND failed_attempt_count=attempts_started-1 AND active_attempt_id IS NOT NULL AND assigned_agent_id IS NOT NULL) OR
        (status='failed_attempt' AND custody='delivery_agent' AND attempts_started BETWEEN 1 AND 2 AND failed_attempt_count=attempts_started AND active_attempt_id IS NULL AND assigned_agent_id IS NOT NULL) OR
        (status='held_at_office' AND custody='franchise_office' AND active_attempt_id IS NULL) OR
        (status='delivered' AND custody='recipient' AND active_attempt_id IS NULL AND assigned_agent_id IS NULL) OR
        (status='rto' AND active_attempt_id IS NULL)),
      ADD CONSTRAINT parcels_updated_time_check CHECK(isfinite(updated_at)),
      ADD CONSTRAINT parcels_last_command_fk FOREIGN KEY(organization_id,franchise_id,last_command_id,booking_id,id)
        REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) DEFERRABLE INITIALLY DEFERRED;

    CREATE TABLE shipit.parcel_transitions (
      id uuid CONSTRAINT parcel_transitions_pkey PRIMARY KEY,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid NOT NULL, command_id uuid NOT NULL,
      sequence integer NOT NULL CONSTRAINT parcel_transitions_sequence_check CHECK(sequence BETWEEN 2 AND 2147483647),
      operation_id text NOT NULL, from_status text NOT NULL, to_status text NOT NULL,
      actor_id uuid NOT NULL CONSTRAINT parcel_transitions_actor_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      reason_code text, evidence_ref uuid NOT NULL, correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
      CONSTRAINT parcel_transitions_sequence_key UNIQUE(organization_id,franchise_id,parcel_id,sequence),
      CONSTRAINT parcel_transitions_command_key UNIQUE(organization_id,franchise_id,command_id),
      CONSTRAINT parcel_transitions_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,booking_id,parcel_id)
        REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT,
      CONSTRAINT parcel_transitions_time_check CHECK(isfinite(occurred_at)),
      CONSTRAINT parcel_transitions_reason_check CHECK(reason_code IS NULL OR reason_code IN (
        'customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue','other_controlled',
        'safety_risk','legal_restriction','operationally_unserviceable'))
    );
    CREATE INDEX parcel_transitions_timeline_idx ON shipit.parcel_transitions(organization_id,franchise_id,parcel_id,sequence);

    CREATE TABLE shipit.parcel_failed_attempts (
      id uuid CONSTRAINT parcel_failed_attempts_pkey PRIMARY KEY,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid NOT NULL, command_id uuid NOT NULL,
      attempt_id uuid NOT NULL, attempt_number integer NOT NULL CONSTRAINT parcel_failed_attempts_number_check CHECK(attempt_number BETWEEN 1 AND 2),
      reason_code text NOT NULL CONSTRAINT parcel_failed_attempts_reason_check CHECK(reason_code IN (
        'customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue','other_controlled')),
      failure_subreason_code text CONSTRAINT parcel_failed_attempts_subreason_check CHECK(
        (reason_code='other_controlled' AND failure_subreason_code IN ('weather_disruption','vehicle_breakdown','route_access_restricted','device_or_network_failure')) OR
        (reason_code<>'other_controlled' AND failure_subreason_code IS NULL)),
      evidence_ref uuid NOT NULL, actor_id uuid NOT NULL CONSTRAINT parcel_failed_attempts_actor_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      occurred_at timestamptz NOT NULL CONSTRAINT parcel_failed_attempts_time_check CHECK(isfinite(occurred_at)),
      CONSTRAINT parcel_failed_attempts_number_key UNIQUE(organization_id,franchise_id,parcel_id,attempt_number),
      CONSTRAINT parcel_failed_attempts_attempt_key UNIQUE(organization_id,franchise_id,parcel_id,attempt_id),
      CONSTRAINT parcel_failed_attempts_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,booking_id,parcel_id)
        REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT
    );

    CREATE TABLE shipit.parcel_rto_approvals (
      id uuid CONSTRAINT parcel_rto_approvals_pkey PRIMARY KEY,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL, parcel_id uuid NOT NULL, command_id uuid NOT NULL,
      mode text NOT NULL CONSTRAINT parcel_rto_mode_check CHECK(mode IN ('attempt_limit','privileged_override')),
      override_reason_code text CONSTRAINT parcel_rto_override_check CHECK(
        (mode='attempt_limit' AND override_reason_code IS NULL) OR
        (mode='privileged_override' AND override_reason_code IN ('safety_risk','legal_restriction','operationally_unserviceable'))),
      approval_ref uuid NOT NULL, eligibility_ref uuid NOT NULL, return_plan_ref uuid NOT NULL,
      actor_id uuid NOT NULL CONSTRAINT parcel_rto_actor_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      occurred_at timestamptz NOT NULL CONSTRAINT parcel_rto_time_check CHECK(isfinite(occurred_at)),
      CONSTRAINT parcel_rto_parcel_key UNIQUE(organization_id,franchise_id,parcel_id),
      CONSTRAINT parcel_rto_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,booking_id,parcel_id)
        REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT
    );

    ALTER TABLE shipit.domain_events DROP CONSTRAINT domain_events_logical_key;
    ALTER TABLE shipit.domain_events DROP CONSTRAINT domain_events_command_fk;
    ALTER TABLE shipit.domain_events DROP CONSTRAINT domain_events_type_check;
    ALTER TABLE shipit.domain_events DROP CONSTRAINT domain_events_envelope_check;
    ALTER TABLE shipit.domain_events ADD COLUMN booking_command_id uuid, ADD COLUMN parcel_command_id uuid;
    ALTER TABLE shipit.domain_events DISABLE TRIGGER domain_events_immutable;
    UPDATE shipit.domain_events SET booking_command_id=command_id;
    ALTER TABLE shipit.domain_events ENABLE TRIGGER domain_events_immutable;
    ALTER TABLE shipit.domain_events
      ADD CONSTRAINT domain_events_booking_command_fk FOREIGN KEY(organization_id,franchise_id,booking_command_id,booking_id)
        REFERENCES shipit.booking_commands(organization_id,franchise_id,id,booking_id) ON DELETE RESTRICT,
      ADD CONSTRAINT domain_events_parcel_command_fk FOREIGN KEY(organization_id,franchise_id,parcel_command_id,booking_id,parcel_id)
        REFERENCES shipit.parcel_commands(organization_id,franchise_id,id,booking_id,parcel_id) ON DELETE RESTRICT,
      ADD CONSTRAINT domain_events_command_owner_check CHECK(
        (event_type IN ('booking.created','parcel.booked') AND booking_command_id=command_id AND parcel_command_id IS NULL) OR
        (event_type IN ('parcel.checked_in','parcel.dispatched','parcel.in_transit','delivery.attempt_failed','parcel.rto_approved')
          AND parcel_command_id=command_id AND booking_command_id IS NULL)),
      ADD CONSTRAINT domain_events_type_check CHECK(
        (event_type='booking.created' AND parcel_id IS NULL AND aggregate_id=booking_id) OR
        (event_type IN ('parcel.booked','parcel.checked_in','parcel.dispatched','parcel.in_transit','delivery.attempt_failed','parcel.rto_approved')
          AND parcel_id IS NOT NULL AND aggregate_id=parcel_id)),
      ADD CONSTRAINT domain_events_envelope_check CHECK((jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=2048
        AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text AND envelope->>'franchise_id'=franchise_id::text
        AND envelope->>'event_type'=event_type AND envelope->>'aggregate_id'=aggregate_id::text AND envelope->>'schema_version'='1'
        AND (envelope->>'aggregate_version')::bigint=aggregate_sequence AND envelope->>'command_id'=command_id::text
        AND envelope->>'causation_id'=command_id::text AND envelope->>'aggregate_type'=CASE WHEN parcel_id IS NULL THEN 'booking' ELSE 'parcel' END
        AND envelope - ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE);

    CREATE OR REPLACE FUNCTION shipit.fill_domain_event_ordering() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      NEW.occurred_at=COALESCE(NEW.occurred_at,(NEW.envelope->>'occurred_at')::timestamptz);
      NEW.aggregate_sequence=COALESCE(NEW.aggregate_sequence,(NEW.envelope->>'aggregate_version')::bigint);
      IF NEW.event_type IN ('booking.created','parcel.booked') THEN NEW.booking_command_id=COALESCE(NEW.booking_command_id,NEW.command_id);
      ELSE NEW.parcel_command_id=COALESCE(NEW.parcel_command_id,NEW.command_id); END IF;
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.fill_domain_event_ordering() FROM PUBLIC;

    DROP TRIGGER domain_events_creation_guard ON shipit.domain_events;
    CREATE FUNCTION shipit.guard_domain_event_creation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      IF NEW.booking_command_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipit.booking_commands c WHERE c.id=NEW.booking_command_id AND c.state='reserved')
        OR NEW.parcel_command_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipit.parcel_commands c WHERE c.id=NEW.parcel_command_id AND c.state='reserved')
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='domain_event_command_state',MESSAGE='DOMAIN_EVENT_INVALID'; END IF;
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.guard_domain_event_creation() FROM PUBLIC;
    CREATE TRIGGER domain_events_creation_guard BEFORE INSERT ON shipit.domain_events FOR EACH ROW EXECUTE FUNCTION shipit.guard_domain_event_creation();

    DROP TRIGGER parcels_immutable ON shipit.parcels;
    CREATE FUNCTION shipit.guard_parcel_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE c shipit.parcel_commands;
    BEGIN
      IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','custody','version','attempts_started','failed_attempt_count','active_attempt_id','assigned_agent_id','last_command_id','updated_at'])
        <> (to_jsonb(OLD)-ARRAY['status','custody','version','attempts_started','failed_attempt_count','active_attempt_id','assigned_agent_id','last_command_id','updated_at'])
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcel_immutable_fields',MESSAGE='PARCEL_MUTATION_INVALID'; END IF;
      SELECT * INTO c FROM shipit.parcel_commands WHERE id=NEW.last_command_id AND organization_id=OLD.organization_id
        AND franchise_id=OLD.franchise_id AND booking_id=OLD.booking_id AND parcel_id=OLD.id AND state='reserved';
      IF c.id IS NULL OR c.expected_version<>OLD.version OR c.from_status<>OLD.status OR c.to_status<>NEW.status OR NEW.version<>OLD.version+1 OR
        NOT isfinite(NEW.updated_at) OR
        (c.operation_id='api.v1.parcels.check_in' AND NOT (OLD.status='booked' AND NEW.status='checked_in' AND NEW.custody='franchise_office')) OR
        (c.operation_id='api.v1.parcels.dispatch' AND NOT (OLD.status='checked_in' AND NEW.status='dispatched' AND NEW.custody='route_dispatch')) OR
        (c.operation_id='api.v1.parcels.transit' AND NOT (OLD.status='dispatched' AND NEW.status='in_transit' AND NEW.custody='route_dispatch')) OR
        (c.operation_id='api.v1.parcels.fail_delivery' AND NOT (OLD.status='out_for_delivery' AND NEW.status='failed_attempt'
          AND NEW.custody=OLD.custody AND NEW.assigned_agent_id=OLD.assigned_agent_id AND NEW.active_attempt_id IS NULL
          AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count+1)) OR
        (c.operation_id='api.v1.parcels.approve_rto' AND NOT (OLD.status='failed_attempt' AND NEW.status='rto' AND NEW.custody=OLD.custody
          AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id AND NEW.active_attempt_id IS NULL
          AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count
          AND ((c.input ? 'override_reason_code') OR (OLD.failed_attempt_count=2 AND EXISTS (
            SELECT 1 FROM shipit.parcel_failed_attempts f WHERE f.organization_id=OLD.organization_id
              AND f.franchise_id=OLD.franchise_id AND f.parcel_id=OLD.id AND f.attempt_number=2
              AND f.reason_code IN ('customer_unavailable','address_issue','payment_not_collected','operational_issue'))))))
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcel_transition_guard',MESSAGE='PARCEL_TRANSITION_INVALID'; END IF;
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.guard_parcel_lifecycle() FROM PUBLIC;
    CREATE TRIGGER parcels_lifecycle_guard BEFORE UPDATE OR DELETE ON shipit.parcels FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_lifecycle();

    CREATE FUNCTION shipit.guard_parcel_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN
      IF TG_OP='DELETE' OR OLD.state<>'reserved' OR NEW.state<>'committed' OR
        (to_jsonb(NEW)-ARRAY['state','http_status','result','committed_at','retain_until'])<>(to_jsonb(OLD)-ARRAY['state','http_status','result','committed_at','retain_until'])
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcel_command_immutable',MESSAGE='PARCEL_COMMAND_INVALID'; END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER parcel_commands_guard BEFORE UPDATE OR DELETE ON shipit.parcel_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_command();

    CREATE FUNCTION shipit.check_parcel_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE p shipit.parcels; transition_count integer; event_count integer; failure_count integer; rto_count integer;
    BEGIN
      IF NEW.state<>'committed' THEN RETURN NULL; END IF;
      SELECT * INTO p FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.parcel_id;
      SELECT count(*) INTO transition_count FROM shipit.parcel_transitions t WHERE t.command_id=NEW.id
        AND t.organization_id=NEW.organization_id AND t.franchise_id=NEW.franchise_id AND t.booking_id=NEW.booking_id
        AND t.parcel_id=NEW.parcel_id AND t.sequence=NEW.expected_version+1 AND t.operation_id=replace(NEW.operation_id,'api.v1.','')
        AND t.from_status=NEW.from_status AND t.to_status=NEW.to_status AND t.actor_id=NEW.principal_id
        AND t.correlation_id=NEW.correlation_id AND t.evidence_ref=(NEW.input->>'evidence_ref')::uuid
        AND t.reason_code IS NOT DISTINCT FROM CASE WHEN NEW.operation_id='api.v1.parcels.fail_delivery' THEN NEW.input->>'reason_code'
          WHEN NEW.operation_id='api.v1.parcels.approve_rto' THEN NEW.input->>'override_reason_code' ELSE NULL END;
      SELECT count(*) INTO event_count FROM shipit.domain_events e JOIN shipit.parcel_transitions t ON t.id=e.event_id AND t.command_id=NEW.id
        WHERE e.parcel_command_id=NEW.id
        AND e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.booking_id=NEW.booking_id
        AND e.parcel_id=NEW.parcel_id AND e.aggregate_id=NEW.parcel_id AND e.aggregate_sequence=NEW.expected_version+1
        AND e.event_type=CASE NEW.operation_id WHEN 'api.v1.parcels.check_in' THEN 'parcel.checked_in'
          WHEN 'api.v1.parcels.dispatch' THEN 'parcel.dispatched' WHEN 'api.v1.parcels.transit' THEN 'parcel.in_transit'
          WHEN 'api.v1.parcels.fail_delivery' THEN 'delivery.attempt_failed' ELSE 'parcel.rto_approved' END
        AND e.envelope->>'correlation_id'=NEW.correlation_id::text AND e.envelope->'actor'->>'id'=NEW.principal_id::text
        AND e.envelope->'payload'=CASE NEW.operation_id
          WHEN 'api.v1.parcels.check_in' THEN jsonb_build_object('receipt_ref',NEW.input->'evidence_ref','location_ref',NEW.input->'location_ref')
          WHEN 'api.v1.parcels.dispatch' THEN jsonb_build_object('manifest_id',NEW.input->'manifest_id','dispatch_evidence_ref',NEW.input->'evidence_ref')
          WHEN 'api.v1.parcels.transit' THEN jsonb_build_object('route_id',NEW.input->'route_id','movement_evidence_ref',NEW.input->'evidence_ref')
          WHEN 'api.v1.parcels.fail_delivery' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','failure_reason',NEW.input->'reason_code','evidence_ref',NEW.input->'evidence_ref')
            || CASE WHEN NEW.input ? 'failure_subreason_code' THEN jsonb_build_object('failure_subreason',NEW.input->'failure_subreason_code') ELSE '{}'::jsonb END
          ELSE jsonb_build_object('approval_ref',NEW.input->'approval_ref','eligibility_ref',NEW.input->'evidence_ref','return_plan_ref',NEW.input->'return_plan_ref')
            || CASE WHEN NEW.input ? 'override_reason_code' THEN jsonb_build_object('override_reason_code',NEW.input->'override_reason_code') ELSE '{}'::jsonb END END;
      SELECT count(*) INTO failure_count FROM shipit.parcel_failed_attempts f WHERE f.command_id=NEW.id
        AND f.attempt_id=(NEW.input->>'attempt_id')::uuid AND f.reason_code=NEW.input->>'reason_code'
        AND f.failure_subreason_code IS NOT DISTINCT FROM NEW.input->>'failure_subreason_code'
        AND f.evidence_ref=(NEW.input->>'evidence_ref')::uuid AND f.actor_id=NEW.principal_id;
      SELECT count(*) INTO rto_count FROM shipit.parcel_rto_approvals r WHERE r.command_id=NEW.id
        AND r.mode=CASE WHEN NEW.input ? 'override_reason_code' THEN 'privileged_override' ELSE 'attempt_limit' END
        AND r.override_reason_code IS NOT DISTINCT FROM NEW.input->>'override_reason_code'
        AND r.approval_ref=(NEW.input->>'approval_ref')::uuid AND r.eligibility_ref=(NEW.input->>'evidence_ref')::uuid
        AND r.return_plan_ref=(NEW.input->>'return_plan_ref')::uuid AND r.actor_id=NEW.principal_id;
      IF p.id IS NULL OR p.last_command_id<>NEW.id OR p.version<>NEW.expected_version+1 OR p.status<>NEW.to_status OR
        transition_count<>1 OR event_count<>1 OR
        failure_count<>(CASE WHEN NEW.operation_id='api.v1.parcels.fail_delivery' THEN 1 ELSE 0 END) OR
        rto_count<>(CASE WHEN NEW.operation_id='api.v1.parcels.approve_rto' THEN 1 ELSE 0 END)
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcel_command_complete',MESSAGE='PARCEL_COMMAND_INCOMPLETE'; END IF;
      RETURN NULL;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.check_parcel_command_complete() FROM PUBLIC;
    CREATE CONSTRAINT TRIGGER parcel_command_complete AFTER UPDATE ON shipit.parcel_commands DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION shipit.check_parcel_command_complete();

    CREATE FUNCTION shipit.reject_parcel_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcel_history_immutable',MESSAGE='PARCEL_HISTORY_IMMUTABLE'; END $fn$;
    REVOKE ALL ON FUNCTION shipit.reject_parcel_history_mutation() FROM PUBLIC;
    CREATE TRIGGER parcel_transitions_immutable BEFORE UPDATE OR DELETE ON shipit.parcel_transitions FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
    CREATE TRIGGER parcel_failed_attempts_immutable BEFORE UPDATE OR DELETE ON shipit.parcel_failed_attempts FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
    CREATE TRIGGER parcel_rto_approvals_immutable BEFORE UPDATE OR DELETE ON shipit.parcel_rto_approvals FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();

    CREATE OR REPLACE VIEW shipit.audit_history AS
      SELECT 'audit:'||id::text AS id,organization_id,CASE WHEN franchise_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[franchise_id] END AS franchise_ids,
        actor_type,actor_id,action,resource_type,resource_id,result,reason_code,correlation_id,occurred_at,previous_lifecycle,new_lifecycle,committed_version,NULL::text AS role FROM shipit.audit_records
      UNION ALL SELECT 'membership:'||id::text,organization_id,franchise_ids,actor_type,COALESCE(actor_user_id::text,'onboarding'),action,
        CASE WHEN invitation_id IS NULL THEN 'membership' ELSE 'invitation' END,COALESCE(invitation_id,membership_id),'success','grant_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,role FROM shipit.membership_audit_events
      UNION ALL SELECT 'identity:'||id::text,NULL::uuid,'{}'::uuid[],CASE WHEN action IN ('provision','disable','enable') THEN 'service' ELSE 'user' END,
        CASE WHEN action IN ('provision','disable','enable') THEN 'authentication' ELSE COALESCE(user_id::text,'unknown') END,action,'identity',user_id,'success','identity_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,NULL FROM shipit.auth_security_events
      UNION ALL SELECT 'customer:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'customer',customer_id,'success','contact_change',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events
      UNION ALL SELECT 'pricing:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'pricing',COALESCE(quote_id,version_id),'success',reason_code,correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.pricing_audit_events
      UNION ALL SELECT 'tax:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'tax',resource_id,'success','tax_command',correlation_id,occurred_at,NULL,NULL,NULL,NULL FROM shipit.tax_audit_events
      UNION ALL SELECT 'booking:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'bookings.create','booking',booking_id,'success','booking_create',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.booking_audit_events
      UNION ALL SELECT 'parcel:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,operation_id,'parcel',parcel_id,'success',
        COALESCE(reason_code,'parcel_transition'),correlation_id,occurred_at,from_status,to_status,sequence,NULL FROM shipit.parcel_transitions;

    REVOKE ALL ON shipit.parcel_commands,shipit.parcel_transitions,shipit.parcel_failed_attempts,shipit.parcel_rto_approvals FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.guard_parcel_lifecycle(),shipit.guard_parcel_command(),shipit.check_parcel_command_complete(),
      shipit.reject_parcel_history_mutation(),shipit.guard_domain_event_creation() FROM PUBLIC;
  `);
};
