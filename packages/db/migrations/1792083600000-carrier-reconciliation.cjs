exports.up = pgm => pgm.sql(String.raw`
CREATE TABLE shipit.carrier_tracking_records (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 installation_id uuid NOT NULL, parcel_id uuid NOT NULL, reference_id uuid NOT NULL,
 observation_id uuid, source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 160),
 external_docket text NOT NULL CHECK(length(external_docket) BETWEEN 1 AND 128),
 status_code text NOT NULL CHECK(length(status_code) BETWEEN 1 AND 128), status text,
 occurred_at timestamptz, time_reason text,
 received_at timestamptz NOT NULL CHECK(isfinite(received_at)),
 source_mode text NOT NULL CHECK(source_mode IN ('manual','file','poll','webhook')),
 source_ref uuid NOT NULL, duplicate_of uuid, conflict text,
 CHECK(status IS NULL OR status IN ('booked_claim','collected_claim','in_transit_claim','out_for_delivery_claim','failed_attempt_claim','held_claim','delivered_claim','returned_claim')),
 CHECK((occurred_at IS NOT NULL AND isfinite(occurred_at) AND time_reason IS NULL) OR
       (occurred_at IS NULL AND time_reason IS NOT NULL AND time_reason IN ('missing','invalid','unknown_timezone'))),
 CHECK(conflict IS NULL OR conflict IN ('source_conflict','reference_conflict')),
 CHECK(duplicate_of IS NULL OR (duplicate_of<>id AND conflict IS NULL)),
 UNIQUE(organization_id,franchise_id,id), UNIQUE(observation_id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id,reference_id) REFERENCES shipit.carrier_references(organization_id,franchise_id,parcel_id,id),
 FOREIGN KEY(organization_id,franchise_id,observation_id) REFERENCES shipit.carrier_observations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,duplicate_of) REFERENCES shipit.carrier_tracking_records(organization_id,franchise_id,id)
);
CREATE UNIQUE INDEX carrier_tracking_identity ON shipit.carrier_tracking_records(installation_id,source_id)
 WHERE duplicate_of IS NULL AND conflict IS NULL;
CREATE INDEX carrier_tracking_queue ON shipit.carrier_tracking_records(organization_id,franchise_id,installation_id,id);
CREATE INDEX carrier_tracking_parcel_time ON shipit.carrier_tracking_records(organization_id,franchise_id,parcel_id,occurred_at DESC);
CREATE TABLE shipit.carrier_tracking_decisions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, record_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), key_digest text NOT NULL, fingerprint text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('apply','reject')), reason_code text NOT NULL CHECK(reason_code IN ('verified_movement','incorrect_report','superseded','insufficient_evidence')),
 expected_version integer NOT NULL CHECK(expected_version=1), expected_parcel_version integer NOT NULL CHECK(expected_parcel_version>0),
 event_id uuid REFERENCES shipit.domain_events(event_id), source_ref uuid NOT NULL,
 correlation_id uuid NOT NULL, decided_at timestamptz NOT NULL CHECK(isfinite(decided_at)),
 CHECK(key_digest ~ '^[a-f0-9]{64}$' AND fingerprint ~ '^[a-f0-9]{64}$'),
 CHECK((decision='apply' AND event_id IS NOT NULL AND reason_code='verified_movement') OR (decision='reject' AND event_id IS NULL AND reason_code<>'verified_movement')),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,record_id) REFERENCES shipit.carrier_tracking_records(organization_id,franchise_id,id)
);
CREATE TABLE shipit.carrier_tracking_checkpoints (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), cursor_value text CHECK(length(cursor_value)<=256),
 state text NOT NULL CHECK(state IN ('success','unavailable','auth_failed')), checked_at timestamptz NOT NULL CHECK(isfinite(checked_at)),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 UNIQUE(installation_id,version), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.carrier_installations(organization_id,franchise_id,id)
);
-- Preserve all existing evidence. Conservatively quarantine historical collisions for review.
WITH old AS (
 SELECT o.*,r.installation_id,r.external_docket,
   CASE WHEN o.evidence->'provenance'->>'mode'='manual' THEN 'manual:' ELSE 'external:' END||(o.evidence->>'sourceRecordId') AS identity
 FROM shipit.carrier_observations o JOIN shipit.carrier_references r ON r.id=o.reference_id
), ranked AS (SELECT *,row_number() OVER(PARTITION BY installation_id,identity ORDER BY received_at,id) AS n FROM old)
INSERT INTO shipit.carrier_tracking_records
 (id,organization_id,franchise_id,installation_id,parcel_id,reference_id,observation_id,source_id,external_docket,status_code,status,occurred_at,time_reason,received_at,source_mode,source_ref,conflict)
SELECT id,organization_id,franchise_id,installation_id,parcel_id,reference_id,id,identity,external_docket,status_code,
 evidence->'status'->>'status',CASE WHEN evidence->'occurredAt'->>'state'='known' THEN (evidence->'occurredAt'->>'at')::timestamptz END,
 evidence->'occurredAt'->>'reason',received_at,evidence->'provenance'->>'mode',
 CASE WHEN evidence->'provenance'->>'mode'='file' THEN (evidence->'provenance'->>'importId')::uuid ELSE command_id END,
 CASE WHEN n>1 THEN 'source_conflict' END FROM ranked;
CREATE FUNCTION shipit.check_tracking_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.carrier_references r WHERE r.id=NEW.reference_id AND r.organization_id=NEW.organization_id
   AND r.franchise_id=NEW.franchise_id AND r.installation_id=NEW.installation_id AND r.parcel_id=NEW.parcel_id) THEN
  RAISE EXCEPTION 'TRACKING_REFERENCE_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NEW.source_mode IN ('poll','webhook') AND NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_checkpoints c
   WHERE c.id=NEW.source_ref AND c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id
   AND c.installation_id=NEW.installation_id AND c.state='success') THEN
  RAISE EXCEPTION 'TRACKING_RECEIPT_MISSING' USING ERRCODE='23514'; END IF;
 IF NEW.source_mode IN ('manual','file') AND NOT EXISTS(SELECT 1 FROM shipit.carrier_observations o
   WHERE o.id=NEW.observation_id AND o.organization_id=NEW.organization_id AND o.franchise_id=NEW.franchise_id
   AND o.parcel_id=NEW.parcel_id AND o.reference_id=NEW.reference_id AND o.status_code=NEW.status_code
   AND o.received_at=NEW.received_at AND o.evidence->'status'->>'status' IS NOT DISTINCT FROM NEW.status
   AND o.evidence->'provenance'->>'mode'=NEW.source_mode) THEN
  RAISE EXCEPTION 'TRACKING_OBSERVATION_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NEW.duplicate_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_records r WHERE r.id=NEW.duplicate_of
   AND r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.installation_id=NEW.installation_id
   AND r.source_id=NEW.source_id AND r.parcel_id=NEW.parcel_id AND r.duplicate_of IS NULL AND r.conflict IS NULL
   AND r.status IS NOT DISTINCT FROM NEW.status AND r.occurred_at IS NOT DISTINCT FROM NEW.occurred_at
   AND r.time_reason IS NOT DISTINCT FROM NEW.time_reason AND r.status_code=NEW.status_code AND r.external_docket=NEW.external_docket) THEN
  RAISE EXCEPTION 'TRACKING_DUPLICATE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER tracking_record_complete AFTER INSERT ON shipit.carrier_tracking_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_tracking_record();
CREATE FUNCTION shipit.check_tracking_decision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_records r WHERE r.id=NEW.record_id
   AND r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.source_ref=NEW.source_ref
   AND (NEW.decision='reject' OR (r.duplicate_of IS NULL AND r.conflict IS NULL AND r.status='in_transit_claim'
     AND EXISTS(SELECT 1 FROM shipit.domain_events e WHERE e.event_id=NEW.event_id AND e.organization_id=r.organization_id
       AND e.franchise_id=r.franchise_id AND e.parcel_id=r.parcel_id AND e.event_type='parcel.in_transit'
       AND e.aggregate_sequence=NEW.expected_parcel_version+1 AND e.envelope->'actor'->>'id'=NEW.actor_id::text
       AND e.envelope->'payload'->>'movement_evidence_ref'=r.id::text)))) THEN
  RAISE EXCEPTION 'TRACKING_DECISION_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER tracking_decision_complete AFTER INSERT ON shipit.carrier_tracking_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_tracking_decision();
REVOKE ALL ON FUNCTION shipit.check_tracking_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.check_tracking_decision() FROM PUBLIC;
DO $guard$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['carrier_tracking_records','carrier_tracking_decisions','carrier_tracking_checkpoints'] LOOP
  EXECUTE format('CREATE TRIGGER carrier_immutable BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only()',name);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',name);
 END LOOP;
END $guard$;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'carrier-review:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.reconcile','carrier_reconciliation',record_id,'success',reason_code,correlation_id,decided_at,NULL,NULL,2,NULL
 FROM shipit.carrier_tracking_decisions
 UNION ALL SELECT 'carrier-ingestion:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'carrier.ingest','carrier_ingestion',installation_id,CASE WHEN state='success' THEN 'success' ELSE 'denied' END,
 state,correlation_id,checked_at,NULL,NULL,version,NULL FROM shipit.carrier_tracking_checkpoints$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
