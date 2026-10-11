// #143 additive physical custody evidence. No legacy assignment/receipt backfill.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.custody_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('authorize','prepare','acknowledge','release','return','grant','revoke_grant','cancel','delivery')),
 correlation_id uuid NOT NULL,key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16384),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE shipit.delivery_attempts ADD CONSTRAINT delivery_attempts_custody_identity_key UNIQUE(organization_id,franchise_id,id,parcel_id,assignment_id);
CREATE TABLE shipit.custody_assignment_instructions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid NOT NULL,
 attempt_id uuid NOT NULL,assignment_id uuid NOT NULL,from_agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 to_agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 expected_parcel_version integer NOT NULL CHECK(expected_parcel_version BETWEEN 1 AND 2147483646),
 command_id uuid NOT NULL UNIQUE,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 CHECK(from_agent_id<>to_agent_id),UNIQUE(organization_id,franchise_id,id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id,assignment_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id,assignment_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.custody_manifests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 command_id uuid NOT NULL UNIQUE,item_count integer NOT NULL CHECK(item_count BETWEEN 1 AND 50),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,id,agent_id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.custody_manifest_items (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,manifest_id uuid NOT NULL,
 booking_id uuid NOT NULL,parcel_id uuid NOT NULL,attempt_id uuid NOT NULL,assignment_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 expected_parcel_version integer NOT NULL CHECK(expected_parcel_version BETWEEN 1 AND 2147483646),
 previous_receipt_id uuid,instruction_id uuid,
 UNIQUE(organization_id,franchise_id,id,parcel_id),UNIQUE(organization_id,franchise_id,manifest_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,manifest_id,agent_id) REFERENCES shipit.custody_manifests(organization_id,franchise_id,id,agent_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id,assignment_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id,assignment_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,instruction_id,parcel_id) REFERENCES shipit.custody_assignment_instructions(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT
);
CREATE TABLE shipit.custody_receipts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid NOT NULL,
 attempt_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 2147483647),
 previous_receipt_id uuid,manifest_item_id uuid,kind text NOT NULL CHECK(kind IN ('agent_received','office_received','recipient_received')),
 agent_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,proof_id uuid,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 discrepancy text NOT NULL CHECK(discrepancy IN ('none','damaged','tampered','label_mismatch')),
 command_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 CHECK((sequence=1)=(previous_receipt_id IS NULL)),
 CHECK((kind='agent_received' AND agent_id IS NOT NULL AND manifest_item_id IS NOT NULL AND proof_id IS NULL AND discrepancy='none')
  OR (kind='office_received' AND agent_id IS NULL AND manifest_item_id IS NULL AND proof_id IS NULL)
  OR (kind='recipient_received' AND agent_id IS NULL AND manifest_item_id IS NULL AND proof_id IS NOT NULL AND discrepancy='none')),
 UNIQUE(organization_id,franchise_id,id,parcel_id),UNIQUE(organization_id,franchise_id,parcel_id,sequence),
 UNIQUE(organization_id,franchise_id,previous_receipt_id),UNIQUE(organization_id,franchise_id,manifest_item_id),
 UNIQUE(organization_id,franchise_id,proof_id),UNIQUE(command_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,attempt_id,parcel_id) REFERENCES shipit.delivery_attempts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,previous_receipt_id,parcel_id) REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,manifest_item_id,parcel_id) REFERENCES shipit.custody_manifest_items(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE shipit.delivery_proofs ADD CONSTRAINT delivery_proofs_custody_owner_key UNIQUE(organization_id,franchise_id,id,parcel_id);
ALTER TABLE shipit.custody_receipts ADD CONSTRAINT custody_receipts_proof_owner_fk FOREIGN KEY(organization_id,franchise_id,proof_id,parcel_id)
 REFERENCES shipit.delivery_proofs(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT;
ALTER TABLE shipit.custody_manifest_items ADD CONSTRAINT custody_items_previous_owner_fk FOREIGN KEY(organization_id,franchise_id,previous_receipt_id,parcel_id)
 REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT;
CREATE INDEX custody_receipts_latest ON shipit.custody_receipts(organization_id,franchise_id,parcel_id,sequence DESC);
CREATE INDEX custody_receipts_agent ON shipit.custody_receipts(organization_id,franchise_id,agent_id,recorded_at,id) WHERE kind='agent_received';
CREATE INDEX custody_manifest_agent ON shipit.custody_manifests(organization_id,franchise_id,agent_id,recorded_at,id);
CREATE INDEX custody_item_parcel ON shipit.custody_manifest_items(organization_id,franchise_id,parcel_id,manifest_id);
CREATE TABLE shipit.custody_discrepancies (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,source_receipt_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('missing','damaged','tampered','label_mismatch')),
 command_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(command_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,source_receipt_id,parcel_id) REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipit.custody_transfer_grants (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,source_receipt_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 destination_agent_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 destination_kind text NOT NULL CHECK(destination_kind IN ('agent','office')),
 command_id uuid NOT NULL UNIQUE,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 CHECK((destination_kind='agent' AND destination_agent_id IS NOT NULL AND destination_agent_id<>agent_id)
  OR (destination_kind='office' AND destination_agent_id IS NULL)),
 UNIQUE(organization_id,franchise_id,id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,source_receipt_id,parcel_id) REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.custody_grant_revocations (
 grant_id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 FOREIGN KEY(organization_id,franchise_id,grant_id,parcel_id) REFERENCES shipit.custody_transfer_grants(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE shipit.custody_manifest_items ADD COLUMN grant_id uuid,
 ADD CONSTRAINT custody_items_grant_owner_fk FOREIGN KEY(organization_id,franchise_id,grant_id,parcel_id)
 REFERENCES shipit.custody_transfer_grants(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT;
CREATE TABLE shipit.custody_releases (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,parcel_id uuid NOT NULL,source_receipt_id uuid NOT NULL,
 grant_id uuid NOT NULL,manifest_id uuid,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,source_receipt_id,manifest_id),
 FOREIGN KEY(organization_id,franchise_id,source_receipt_id,parcel_id) REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,grant_id,parcel_id) REFERENCES shipit.custody_transfer_grants(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,manifest_id) REFERENCES shipit.custody_manifests(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.custody_manifest_cancellations (
 manifest_id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 FOREIGN KEY(organization_id,franchise_id,manifest_id) REFERENCES shipit.custody_manifests(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.custody_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,command_id uuid NOT NULL UNIQUE,
 resource_id uuid NOT NULL,receipt_ids uuid[] NOT NULL CHECK(cardinality(receipt_ids)<=50 AND array_position(receipt_ids,NULL) IS NULL),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.custody_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipit.custody_access_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('custody.read','custody.worklist','custody.export.capture','custody.export.read','custody.export.download')),
 manifest_id uuid,snapshot_id uuid,correlation_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 CHECK((action='custody.worklist' AND manifest_id IS NULL AND snapshot_id IS NULL) OR
  (action='custody.read' AND manifest_id IS NOT NULL AND snapshot_id IS NULL) OR
  (action IN ('custody.export.capture','custody.export.read','custody.export.download') AND manifest_id IS NOT NULL AND snapshot_id IS NOT NULL)),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,manifest_id) REFERENCES shipit.custody_manifests(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,snapshot_id) REFERENCES shipit.report_snapshots(organization_id,franchise_id,id) ON DELETE RESTRICT
);
CREATE INDEX custody_access_scope_time ON shipit.custody_access_events(organization_id,franchise_id,recorded_at,id);

CREATE FUNCTION shipit.guard_custody_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CUSTODY_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;END $fn$;
DO $history$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['custody_access_events','custody_commands','custody_assignment_instructions','custody_manifests','custody_manifest_items','custody_receipts','custody_discrepancies','custody_transfer_grants','custody_grant_revocations','custody_releases','custody_manifest_cancellations','custody_events'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.guard_custody_history()',n||'_immutable',n);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',n);
 END LOOP;
END $history$;
CREATE FUNCTION shipit.guard_custody_receipt_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous shipit.custody_receipts;item shipit.custody_manifest_items;proof shipit.delivery_proofs;attempt shipit.delivery_attempts;parcel shipit.parcels;latest integer;
BEGIN
 SELECT * INTO parcel FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.parcel_id FOR UPDATE;
 IF parcel.id IS NULL THEN RAISE EXCEPTION 'CUSTODY_PARCEL_INVALID' USING ERRCODE='23514';END IF;
 SELECT max(sequence) INTO latest FROM shipit.custody_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id;
 IF NEW.sequence<>COALESCE(latest,0)+1 THEN RAISE EXCEPTION 'CUSTODY_SEQUENCE_INVALID' USING ERRCODE='23514';END IF;
 IF NEW.previous_receipt_id IS NOT NULL THEN
  SELECT * INTO previous FROM shipit.custody_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id AND id=NEW.previous_receipt_id;
  IF previous.id IS NULL OR previous.sequence<>latest OR previous.recorded_at>NEW.recorded_at OR previous.kind='recipient_received'
   THEN RAISE EXCEPTION 'CUSTODY_PREDECESSOR_INVALID' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind<>'agent_received' THEN RAISE EXCEPTION 'CUSTODY_INITIAL_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO attempt FROM shipit.delivery_attempts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id AND id=NEW.attempt_id;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'CUSTODY_ATTEMPT_INVALID' USING ERRCODE='23514';END IF;
 IF NEW.kind<>'recipient_received' AND EXISTS(SELECT 1 FROM shipit.delivery_proofs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id)
 THEN RAISE EXCEPTION 'CUSTODY_ALREADY_DELIVERED' USING ERRCODE='23514';END IF;
 IF NEW.kind='agent_received' THEN
  SELECT * INTO item FROM shipit.custody_manifest_items WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id AND id=NEW.manifest_item_id;
  IF item.id IS NULL OR item.attempt_id<>NEW.attempt_id OR item.agent_id<>NEW.agent_id OR NEW.actor_id<>NEW.agent_id
   OR item.previous_receipt_id IS DISTINCT FROM NEW.previous_receipt_id OR attempt.state<>'active' OR attempt.agent_id<>NEW.agent_id
   OR EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND manifest_id=item.manifest_id)
   OR item.assignment_id<>attempt.assignment_id OR parcel.status<>'out_for_delivery' OR parcel.active_attempt_id IS DISTINCT FROM NEW.attempt_id OR parcel.assigned_agent_id IS DISTINCT FROM NEW.agent_id
   THEN RAISE EXCEPTION 'CUSTODY_ACKNOWLEDGEMENT_INVALID' USING ERRCODE='23514';END IF;
 ELSIF NEW.kind='office_received' THEN
  IF previous.kind<>'agent_received' OR previous.attempt_id<>NEW.attempt_id THEN RAISE EXCEPTION 'CUSTODY_RETURN_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO proof FROM shipit.delivery_proofs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id AND id=NEW.proof_id;
  IF previous.kind<>'agent_received' OR proof.id IS NULL OR proof.attempt_id<>NEW.attempt_id OR proof.completed_by<>previous.agent_id
   OR parcel.status<>'delivered' OR previous.attempt_id<>NEW.attempt_id OR NEW.actor_id<>proof.completed_by OR proof.completed_at<previous.recorded_at OR attempt.state<>'completed'
   THEN RAISE EXCEPTION 'CUSTODY_DELIVERY_PROOF_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER custody_receipt_chain BEFORE INSERT ON shipit.custody_receipts FOR EACH ROW EXECUTE FUNCTION shipit.guard_custody_receipt_chain();
REVOKE ALL ON FUNCTION shipit.guard_custody_history(),shipit.guard_custody_receipt_chain() FROM PUBLIC;


CREATE FUNCTION shipit.guard_custody_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE command uuid;
BEGIN
 IF TG_TABLE_NAME='custody_manifest_items' THEN
  SELECT command_id INTO command FROM shipit.custody_manifests WHERE id=NEW.manifest_id AND organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id;
 ELSE
  IF NEW.recorded_at IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'CUSTODY_TIME_SERVER_OWNED' USING ERRCODE='23514';END IF;
  command=NEW.command_id;
 END IF;
 IF command IS NULL OR (TG_TABLE_NAME<>'custody_events' AND EXISTS(SELECT 1 FROM shipit.custody_commands c WHERE c.id=command))
 THEN RAISE EXCEPTION 'CUSTODY_COMMAND_SEALED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
DO $sealed$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['custody_assignment_instructions','custody_manifests','custody_manifest_items','custody_receipts','custody_discrepancies',
  'custody_transfer_grants','custody_grant_revocations','custody_releases','custody_manifest_cancellations','custody_events'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.guard_custody_fact()',n||'_sealed',n);
 END LOOP;
END $sealed$;
REVOKE ALL ON FUNCTION shipit.guard_custody_fact() FROM PUBLIC;

CREATE FUNCTION shipit.custody_member(o uuid,f uuid,u uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users a ON a.id=m.user_id AND a.lifecycle='active'
 WHERE m.organization_id=o AND s.franchise_id=f AND m.user_id=u AND m.lifecycle='active' AND m.role=r)
$fn$;
CREATE FUNCTION shipit.check_custody_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE command_event shipit.custody_events;prepared_manifest shipit.custody_manifests;grant_source shipit.custody_receipts;transfer_grant shipit.custody_transfer_grants;
 ids uuid[];valid boolean:=false;actual integer;expected integer;resource uuid;
BEGIN
 IF NEW.recorded_at IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'CUSTODY_TIME_SERVER_OWNED' USING ERRCODE='23514';END IF;
 resource=(NEW.result->>'resource_id')::uuid;
 SELECT * INTO command_event FROM shipit.custody_events WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.id;
 SELECT COALESCE(array_agg(id ORDER BY parcel_id),'{}'::uuid[]) INTO ids FROM shipit.custody_receipts
  WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.id;
 IF command_event.id IS NULL OR command_event.resource_id IS DISTINCT FROM resource OR command_event.recorded_at<>NEW.recorded_at OR command_event.receipt_ids IS DISTINCT FROM ids
  OR NEW.result->>'command_id' IS DISTINCT FROM NEW.id::text OR NEW.result-ARRAY['command_id','resource_id','receipt_ids','recorded_at']<>'{}'::jsonb
  OR NEW.result->'receipt_ids' IS DISTINCT FROM to_jsonb(ids)
  OR (NEW.result->>'recorded_at')::timestamptz IS DISTINCT FROM date_trunc('milliseconds',NEW.recorded_at)
 THEN RAISE EXCEPTION 'CUSTODY_EVENT_INCOMPLETE' USING ERRCODE='23514';END IF;
 -- Every command must own exactly its domain facts; a journal row cannot stand in for a receipt.
 SELECT (SELECT count(*) FROM shipit.custody_manifests WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_assignment_instructions WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_receipts WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_discrepancies WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_transfer_grants WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_grant_revocations WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_releases WHERE command_id=NEW.id)+
  (SELECT count(*) FROM shipit.custody_manifest_cancellations WHERE command_id=NEW.id) INTO actual;
 expected=1;
 CASE NEW.operation
 WHEN 'prepare' THEN
  SELECT * INTO prepared_manifest FROM shipit.custody_manifests WHERE id=resource AND command_id=NEW.id;
  valid=prepared_manifest.id IS NOT NULL AND prepared_manifest.agent_id=(NEW.input->>'agent_id')::uuid AND cardinality(ids)=0
   AND prepared_manifest.item_count=jsonb_array_length(NEW.input->'items') AND prepared_manifest.item_count=(SELECT count(*) FROM shipit.custody_manifest_items WHERE manifest_id=prepared_manifest.id)
   AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,prepared_manifest.agent_id,'delivery_agent')
   AND (shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') OR
    (shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'delivery_agent') AND NOT EXISTS(
     SELECT 1 FROM shipit.custody_manifest_items i LEFT JOIN shipit.custody_transfer_grants g ON g.id=i.grant_id
      LEFT JOIN shipit.custody_receipts r ON r.id=i.previous_receipt_id
     WHERE i.manifest_id=prepared_manifest.id AND (g.id IS NULL OR r.id IS NULL OR r.agent_id IS DISTINCT FROM NEW.actor_id
      OR g.source_receipt_id<>r.id OR g.agent_id<>NEW.actor_id OR g.destination_agent_id IS DISTINCT FROM prepared_manifest.agent_id OR g.destination_kind<>'agent'
      OR EXISTS(SELECT 1 FROM shipit.custody_grant_revocations v WHERE v.grant_id=g.id)))));
 WHEN 'authorize' THEN
  valid=cardinality(ids)=0 AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'dispatcher')
   AND EXISTS(SELECT 1 FROM shipit.custody_assignment_instructions i JOIN shipit.parcels p ON p.id=i.parcel_id
    JOIN shipit.delivery_attempts a ON a.id=i.attempt_id WHERE i.id=resource AND i.command_id=NEW.id
     AND i.parcel_id=(NEW.input->>'parcel_id')::uuid AND i.to_agent_id=(NEW.input->>'agent_id')::uuid
     AND i.expected_parcel_version=(NEW.input->>'expected_parcel_version')::integer AND p.version=i.expected_parcel_version
     AND p.status='out_for_delivery' AND p.active_attempt_id=a.id AND a.state='active' AND a.assignment_id=i.assignment_id
     AND a.agent_id=i.from_agent_id AND p.assigned_agent_id=i.from_agent_id
     AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,i.to_agent_id,'delivery_agent'));
 WHEN 'acknowledge' THEN
  SELECT * INTO prepared_manifest FROM shipit.custody_manifests WHERE id=resource AND id=(NEW.input->>'manifest_id')::uuid;
  expected=prepared_manifest.item_count;
  valid=prepared_manifest.id IS NOT NULL AND prepared_manifest.agent_id=NEW.actor_id AND cardinality(ids)=prepared_manifest.item_count
   AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'delivery_agent')
   AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations c WHERE c.manifest_id=prepared_manifest.id)
   AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_items i LEFT JOIN shipit.custody_receipts r ON r.manifest_item_id=i.id
    WHERE i.manifest_id=prepared_manifest.id AND (r.id IS NULL OR r.command_id<>NEW.id OR r.kind<>'agent_received' OR r.actor_id<>NEW.actor_id))
   AND EXISTS(SELECT 1 FROM shipit.custody_commands c WHERE c.id=prepared_manifest.command_id AND
    (shipit.custody_member(NEW.organization_id,NEW.franchise_id,c.actor_id,'franchise_admin') OR
     (shipit.custody_member(NEW.organization_id,NEW.franchise_id,c.actor_id,'delivery_agent') AND NOT EXISTS(
      SELECT 1 FROM shipit.custody_manifest_items i LEFT JOIN shipit.custody_transfer_grants g ON g.id=i.grant_id
       LEFT JOIN shipit.custody_receipts r ON r.id=i.previous_receipt_id WHERE i.manifest_id=prepared_manifest.id
       AND (g.id IS NULL OR r.agent_id IS DISTINCT FROM c.actor_id OR g.agent_id IS DISTINCT FROM c.actor_id)))))
   AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_items i JOIN shipit.custody_receipts source ON source.id=i.previous_receipt_id
    LEFT JOIN shipit.custody_transfer_grants g ON g.id=i.grant_id WHERE i.manifest_id=prepared_manifest.id AND source.kind='agent_received'
     AND (g.id IS NULL OR g.source_receipt_id<>source.id OR g.destination_agent_id IS DISTINCT FROM prepared_manifest.agent_id
      OR NOT shipit.custody_member(NEW.organization_id,NEW.franchise_id,g.agent_id,'delivery_agent')
      OR EXISTS(SELECT 1 FROM shipit.custody_grant_revocations v WHERE v.grant_id=g.id)
      OR NOT EXISTS(SELECT 1 FROM shipit.custody_releases l WHERE l.source_receipt_id=source.id AND l.grant_id=g.id AND l.manifest_id=prepared_manifest.id)));
 WHEN 'return' THEN
  expected=CASE WHEN NEW.input->>'discrepancy' IN ('none','missing') THEN 1 ELSE 2 END;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin')
   AND (CASE WHEN NEW.input->>'discrepancy'='missing' THEN cardinality(ids)=0 ELSE cardinality(ids)=1 AND EXISTS(
    SELECT 1 FROM shipit.custody_receipts r WHERE r.command_id=NEW.id AND r.kind='office_received' AND r.actor_id=NEW.actor_id
     AND r.parcel_id=(NEW.input->>'parcel_id')::uuid AND r.previous_receipt_id=(NEW.input->>'source_receipt_id')::uuid AND r.discrepancy=NEW.input->>'discrepancy') END)
   AND (CASE WHEN NEW.input->>'discrepancy'='none' THEN resource=ids[1] ELSE EXISTS(SELECT 1 FROM shipit.custody_discrepancies d
    WHERE d.id=resource AND d.command_id=NEW.id AND d.reason=NEW.input->>'discrepancy' AND d.parcel_id=(NEW.input->>'parcel_id')::uuid AND d.source_receipt_id=(NEW.input->>'source_receipt_id')::uuid) END);
 WHEN 'grant' THEN
  SELECT * INTO transfer_grant FROM shipit.custody_transfer_grants WHERE id=resource AND command_id=NEW.id;
  SELECT * INTO grant_source FROM shipit.custody_receipts WHERE id=transfer_grant.source_receipt_id;
  valid=transfer_grant.id IS NOT NULL AND cardinality(ids)=0 AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin')
   AND transfer_grant.parcel_id=(NEW.input->>'parcel_id')::uuid AND transfer_grant.source_receipt_id=(NEW.input->>'source_receipt_id')::uuid
   AND transfer_grant.destination_kind=NEW.input->>'destination_kind' AND transfer_grant.destination_agent_id IS NOT DISTINCT FROM (NEW.input->>'destination_agent_id')::uuid
   AND grant_source.kind='agent_received' AND grant_source.agent_id=transfer_grant.agent_id AND NOT EXISTS(SELECT 1 FROM shipit.custody_receipts next WHERE next.previous_receipt_id=grant_source.id)
   AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,transfer_grant.agent_id,'delivery_agent')
   AND (transfer_grant.destination_kind='office' OR shipit.custody_member(NEW.organization_id,NEW.franchise_id,transfer_grant.destination_agent_id,'delivery_agent'));
 WHEN 'revoke_grant' THEN
  valid=cardinality(ids)=0 AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin')
   AND resource=(NEW.input->>'grant_id')::uuid AND EXISTS(SELECT 1 FROM shipit.custody_grant_revocations v WHERE v.grant_id=resource AND v.command_id=NEW.id);
 WHEN 'release' THEN
  valid=cardinality(ids)=0 AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'delivery_agent')
   AND EXISTS(SELECT 1 FROM shipit.custody_releases l JOIN shipit.custody_transfer_grants g ON g.id=l.grant_id
    JOIN shipit.custody_receipts r ON r.id=l.source_receipt_id WHERE l.id=resource AND l.command_id=NEW.id
     AND l.parcel_id=(NEW.input->>'parcel_id')::uuid AND l.source_receipt_id=(NEW.input->>'source_receipt_id')::uuid AND l.grant_id=(NEW.input->>'grant_id')::uuid
     AND l.manifest_id IS NOT DISTINCT FROM (NEW.input->>'manifest_id')::uuid AND g.agent_id=NEW.actor_id AND r.agent_id=NEW.actor_id
     AND g.source_receipt_id=r.id AND r.kind='agent_received' AND NOT EXISTS(SELECT 1 FROM shipit.custody_grant_revocations v WHERE v.grant_id=g.id)
     AND NOT EXISTS(SELECT 1 FROM shipit.custody_receipts next WHERE next.previous_receipt_id=r.id)
     AND ((g.destination_kind='office' AND l.manifest_id IS NULL) OR EXISTS(
      SELECT 1 FROM shipit.custody_manifests m JOIN shipit.custody_manifest_items i ON i.manifest_id=m.id
      WHERE m.id=l.manifest_id AND m.agent_id=g.destination_agent_id AND i.parcel_id=l.parcel_id AND i.grant_id=g.id AND i.previous_receipt_id=r.id
       AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,m.agent_id,'delivery_agent')
       AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations c WHERE c.manifest_id=m.id))));
 WHEN 'cancel' THEN
  valid=cardinality(ids)=0 AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin')
   AND resource=(NEW.input->>'manifest_id')::uuid AND EXISTS(SELECT 1 FROM shipit.custody_manifest_cancellations c WHERE c.manifest_id=resource AND c.command_id=NEW.id)
   AND NOT EXISTS(SELECT 1 FROM shipit.custody_manifest_items i JOIN shipit.custody_receipts r ON r.manifest_item_id=i.id WHERE i.manifest_id=resource);
 WHEN 'delivery' THEN
  valid=cardinality(ids)=1 AND resource=ids[1] AND shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'delivery_agent')
   AND EXISTS(SELECT 1 FROM shipit.custody_receipts r WHERE r.id=resource AND r.command_id=NEW.id AND r.kind='recipient_received' AND r.actor_id=NEW.actor_id);
 ELSE valid=false;
 END CASE;
 IF valid IS DISTINCT FROM true OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CUSTODY_COMMAND_INCOMPLETE' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER custody_command_complete AFTER INSERT ON shipit.custody_commands DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION shipit.check_custody_command_complete();
REVOKE ALL ON FUNCTION shipit.custody_member(uuid,uuid,uuid,text),shipit.check_custody_command_complete() FROM PUBLIC;
DO $audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'custody:'||e.id::text,e.organization_id,ARRAY[e.franchise_id],'user',c.actor_id::text,'custody.'||c.operation,'custody',e.resource_id,
 'success','custody_recorded',c.correlation_id,e.recorded_at,NULL,NULL,NULL::integer,NULL::text
 FROM shipit.custody_events e JOIN shipit.custody_commands c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.command_id
 UNION ALL SELECT 'custody_access:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'custody',
 COALESCE(snapshot_id,manifest_id,franchise_id),'success','custody_access',correlation_id,recorded_at,NULL,NULL,NULL::integer,NULL::text
 FROM shipit.custody_access_events$view$;
END $audit$;



-- An acknowledged reassignment is an owned parcel transition within the original active attempt.
DO $reassign$
DECLARE expr text;n text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_operation_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_operation_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_operation_check CHECK ((%s) OR operation_id=''api.v1.deliveries.reassign'')',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_edge_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_edge_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_edge_check CHECK ((%s) OR (operation_id=''api.v1.deliveries.reassign'' AND from_status=''out_for_delivery'' AND to_status=''out_for_delivery''))',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT expr FROM pg_constraint WHERE conrelid='shipit.parcel_commands'::regclass AND conname='parcel_commands_input_check';
 ALTER TABLE shipit.parcel_commands DROP CONSTRAINT parcel_commands_input_check;
 EXECUTE format('ALTER TABLE shipit.parcel_commands ADD CONSTRAINT parcel_commands_input_check CHECK ((%s) OR
  ((operation_id=''api.v1.deliveries.reassign'' AND jsonb_typeof(input)=''object'' AND octet_length(input::text)<=2048
   AND input-ARRAY[''expected_version'',''evidence_ref'',''attempt_id'',''assignment_id'',''from_agent_id'',''agent_id'',''instruction_id'',''acknowledgement_command_id'']=''{}''::jsonb
   AND input->>''expected_version''=expected_version::text AND (input->>''evidence_ref'')::uuid=(input->>''instruction_id'')::uuid
   AND (input->>''attempt_id'')::uuid IS NOT NULL AND (input->>''assignment_id'')::uuid IS NOT NULL
   AND (input->>''agent_id'')::uuid IS NOT NULL AND (input->>''from_agent_id'')::uuid IS NOT NULL
   AND (input->>''instruction_id'')::uuid IS NOT NULL AND (input->>''acknowledgement_command_id'')::uuid IS NOT NULL) IS TRUE))',expr);
 FOREACH n IN ARRAY ARRAY['domain_events_command_owner_check','domain_events_type_check'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.domain_events'::regclass AND conname=n;
  -- Match the released receipt upgrade: #42 removed this separate owner check.
  -- Existing creation/shape/deferred guards retain ownership; do not invent a historical constraint.
  IF expr IS NULL AND n='domain_events_command_owner_check' THEN CONTINUE;END IF;
  IF expr IS NULL THEN RAISE EXCEPTION 'CUSTODY_EVENT_UPGRADE_MISMATCH';END IF;
  EXECUTE format('ALTER TABLE shipit.domain_events DROP CONSTRAINT %I',n);
  expr=replace(expr,'''delivery.completed''::text','''delivery.assignment_changed''::text, ''delivery.completed''::text');
  EXECUTE format('ALTER TABLE shipit.domain_events ADD CONSTRAINT %I CHECK (%s)',n,expr);
 END LOOP;
END $reassign$;
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
 OR (c.operation_id='api.v1.deliveries.reassign' AND NOT (OLD.status='out_for_delivery' AND NEW.status=OLD.status AND NEW.custody=OLD.custody
   AND NEW.active_attempt_id=OLD.active_attempt_id AND NEW.active_attempt_id=(c.input->>'attempt_id')::uuid
   AND OLD.assigned_agent_id=(c.input->>'from_agent_id')::uuid AND NEW.assigned_agent_id=(c.input->>'agent_id')::uuid
   AND NEW.assigned_agent_id<>OLD.assigned_agent_id AND NEW.assigned_agent_id=c.principal_id
   AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count
   AND EXISTS(SELECT 1 FROM shipit.custody_assignment_instructions i JOIN shipit.custody_commands ic ON ic.id=i.command_id
    WHERE i.id=(c.input->>'instruction_id')::uuid AND i.organization_id=OLD.organization_id AND i.franchise_id=OLD.franchise_id
     AND i.parcel_id=OLD.id AND i.attempt_id=OLD.active_attempt_id AND i.assignment_id=(c.input->>'assignment_id')::uuid
     AND i.from_agent_id=OLD.assigned_agent_id AND i.to_agent_id=NEW.assigned_agent_id AND i.expected_parcel_version=OLD.version
     AND ic.operation='authorize' AND shipit.custody_member(OLD.organization_id,OLD.franchise_id,ic.actor_id,'dispatcher'))
   AND shipit.custody_member(OLD.organization_id,OLD.franchise_id,c.principal_id,'delivery_agent')))
 OR (c.operation_id='api.v1.deliveries.complete' AND NOT (OLD.status='out_for_delivery' AND NEW.status='delivered' AND NEW.custody='recipient'
   AND NEW.active_attempt_id IS NULL AND NEW.assigned_agent_id IS NULL AND NEW.attempts_started=OLD.attempts_started AND NEW.failed_attempt_count=OLD.failed_attempt_count))
 THEN RAISE EXCEPTION 'PARCEL_TRANSITION_INVALID' USING ERRCODE='23514',CONSTRAINT='parcel_transition_guard'; END IF;
 RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.check_parcel_command_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE p shipit.parcels;transition_count integer;event_count integer;failure_count integer;rto_count integer;expected_event text;expected_payload jsonb;
BEGIN
 IF NEW.state<>'committed' THEN RETURN NULL; END IF;
 SELECT * INTO p FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.parcel_id;
 expected_event=CASE NEW.operation_id WHEN 'api.v1.parcels.check_in' THEN 'parcel.checked_in' WHEN 'api.v1.parcels.dispatch' THEN 'parcel.dispatched'
  WHEN 'api.v1.parcels.transit' THEN 'parcel.in_transit' WHEN 'api.v1.parcels.fail_delivery' THEN 'delivery.attempt_failed'
  WHEN 'api.v1.parcels.approve_rto' THEN 'parcel.rto_approved' WHEN 'api.v1.deliveries.start' THEN 'delivery.attempt_started'
  WHEN 'api.v1.deliveries.retry' THEN 'delivery.retry_started' WHEN 'api.v1.deliveries.reassign' THEN 'delivery.assignment_changed' ELSE 'delivery.completed' END;
 expected_payload=CASE NEW.operation_id WHEN 'api.v1.parcels.check_in' THEN jsonb_build_object('receipt_ref',NEW.input->'evidence_ref','location_ref',NEW.input->'location_ref')
  WHEN 'api.v1.parcels.dispatch' THEN jsonb_build_object('manifest_id',NEW.input->'manifest_id','dispatch_evidence_ref',NEW.input->'evidence_ref')
  WHEN 'api.v1.parcels.transit' THEN jsonb_build_object('route_id',NEW.input->'route_id','movement_evidence_ref',NEW.input->'evidence_ref')
  WHEN 'api.v1.parcels.fail_delivery' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','failure_reason',NEW.input->'reason_code','evidence_ref',NEW.input->'evidence_ref')
   ||CASE WHEN NEW.input?'failure_subreason_code' THEN jsonb_build_object('failure_subreason',NEW.input->'failure_subreason_code') ELSE '{}'::jsonb END
  WHEN 'api.v1.parcels.approve_rto' THEN jsonb_build_object('approval_ref',NEW.input->'approval_ref','eligibility_ref',NEW.input->'evidence_ref','return_plan_ref',NEW.input->'return_plan_ref')
   ||CASE WHEN NEW.input?'override_reason_code' THEN jsonb_build_object('override_reason_code',NEW.input->'override_reason_code') ELSE '{}'::jsonb END
  WHEN 'api.v1.deliveries.start' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','assignment_id',NEW.input->'assignment_id','challenge_ref',NEW.input->'challenge_ref')
  WHEN 'api.v1.deliveries.retry' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','assignment_id',NEW.input->'assignment_id','challenge_ref',NEW.input->'challenge_ref')
  WHEN 'api.v1.deliveries.reassign' THEN jsonb_build_object('attempt_id',NEW.input->'attempt_id','assignment_id',NEW.input->'assignment_id',
   'from_agent_id',NEW.input->'from_agent_id','agent_id',NEW.input->'agent_id','instruction_id',NEW.input->'instruction_id','acknowledgement_command_id',NEW.input->'acknowledgement_command_id')
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
  OR (NEW.operation_id='api.v1.deliveries.reassign' AND NOT EXISTS(
   SELECT 1 FROM shipit.delivery_attempts a JOIN shipit.custody_receipts r ON r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.attempt_id=a.id
    JOIN shipit.custody_manifest_items i ON i.organization_id=r.organization_id AND i.franchise_id=r.franchise_id AND i.id=r.manifest_item_id
    JOIN shipit.custody_commands cc ON cc.organization_id=r.organization_id AND cc.franchise_id=r.franchise_id AND cc.id=r.command_id
   WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.parcel_id=NEW.parcel_id
    AND a.id=(NEW.input->>'attempt_id')::uuid AND a.assignment_id=(NEW.input->>'assignment_id')::uuid AND a.state='active'
    AND a.agent_id=NEW.principal_id AND p.assigned_agent_id=NEW.principal_id AND p.active_attempt_id=a.id
    AND r.kind='agent_received' AND r.agent_id=NEW.principal_id AND r.actor_id=NEW.principal_id AND r.parcel_id=NEW.parcel_id
    AND cc.operation='acknowledge' AND cc.actor_id=NEW.principal_id AND cc.id=(NEW.input->>'acknowledgement_command_id')::uuid
    AND i.instruction_id=(NEW.input->>'instruction_id')::uuid AND i.expected_parcel_version=NEW.expected_version))
  OR (NEW.operation_id='api.v1.parcels.fail_delivery' AND NOT EXISTS(SELECT 1 FROM shipit.delivery_attempts a
    WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.id=(NEW.input->>'attempt_id')::uuid
      AND a.parcel_id=NEW.parcel_id AND a.state='failed' AND a.close_parcel_command_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM shipit.delivery_challenges c WHERE c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id
        AND c.attempt_id=a.id AND c.superseded_at IS NULL AND (c.closed_at IS NULL OR c.verifier IS NOT NULL OR c.encrypted_secret IS NOT NULL))))
 THEN RAISE EXCEPTION 'PARCEL_COMMAND_INCOMPLETE' USING ERRCODE='23514',CONSTRAINT='parcel_command_complete'; END IF;
 RETURN NULL;
END $fn$;

CREATE FUNCTION shipit.guard_delivery_agent_reassignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
  IF (to_jsonb(NEW)-'agent_id') IS DISTINCT FROM (to_jsonb(OLD)-'agent_id') OR OLD.state<>'active' OR NOT EXISTS(
   SELECT 1 FROM shipit.parcel_commands c JOIN shipit.parcels p ON p.organization_id=c.organization_id AND p.franchise_id=c.franchise_id AND p.id=c.parcel_id
   WHERE c.organization_id=OLD.organization_id AND c.franchise_id=OLD.franchise_id AND c.parcel_id=OLD.parcel_id
    AND c.operation_id='api.v1.deliveries.reassign' AND c.state='reserved' AND c.expected_version=p.version
    AND p.status='out_for_delivery' AND p.active_attempt_id=OLD.id AND p.assigned_agent_id=OLD.agent_id
    AND c.principal_id=NEW.agent_id AND (c.input->>'attempt_id')::uuid=OLD.id AND (c.input->>'assignment_id')::uuid=OLD.assignment_id
    AND (c.input->>'from_agent_id')::uuid=OLD.agent_id AND (c.input->>'agent_id')::uuid=NEW.agent_id
  ) THEN RAISE EXCEPTION 'DELIVERY_REASSIGNMENT_INVALID' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER delivery_agent_reassignment BEFORE UPDATE ON shipit.delivery_attempts FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_agent_reassignment();
REVOKE ALL ON FUNCTION shipit.guard_delivery_agent_reassignment() FROM PUBLIC;

CREATE FUNCTION shipit.check_delivery_agent_reassignment_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.agent_id IS DISTINCT FROM OLD.agent_id AND NOT EXISTS(
  SELECT 1 FROM shipit.parcels p JOIN shipit.parcel_commands c ON c.organization_id=p.organization_id AND c.franchise_id=p.franchise_id AND c.id=p.last_command_id
  WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.id=NEW.parcel_id
   AND p.status='out_for_delivery' AND p.active_attempt_id=NEW.id AND p.assigned_agent_id=NEW.agent_id
   AND c.state='committed' AND c.operation_id='api.v1.deliveries.reassign' AND p.version=c.expected_version+1
   AND c.principal_id=NEW.agent_id AND (c.input->>'attempt_id')::uuid=NEW.id AND (c.input->>'assignment_id')::uuid=NEW.assignment_id
   AND (c.input->>'from_agent_id')::uuid=OLD.agent_id AND (c.input->>'agent_id')::uuid=NEW.agent_id
 ) THEN RAISE EXCEPTION 'DELIVERY_REASSIGNMENT_INCOMPLETE' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER delivery_agent_reassignment_complete AFTER UPDATE ON shipit.delivery_attempts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION shipit.check_delivery_agent_reassignment_complete();
REVOKE ALL ON FUNCTION shipit.check_delivery_agent_reassignment_complete() FROM PUBLIC;


-- Exceptional review belongs to the acknowledged physical assignment, never a prior holder.
-- Legacy deliveries retain one NULL generation without manufacturing historical receipts.
ALTER TABLE shipit.custody_receipts ADD CONSTRAINT custody_receipts_attempt_owner_key UNIQUE(organization_id,franchise_id,id,parcel_id,attempt_id);
ALTER TABLE shipit.delivery_exception_requests ADD COLUMN assignment_receipt_id uuid;
DO $constraint$
DECLARE old_key text;
BEGIN
 SELECT c.conname INTO STRICT old_key FROM pg_constraint c WHERE c.conrelid='shipit.delivery_exception_requests'::regclass AND c.contype='u'
  AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(num,ordinality)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num)=ARRAY['organization_id','franchise_id','attempt_id'];
 EXECUTE format('ALTER TABLE shipit.delivery_exception_requests DROP CONSTRAINT %I',old_key);
END $constraint$;
ALTER TABLE shipit.delivery_exception_requests ADD CONSTRAINT delivery_exception_assignment_key
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,attempt_id,assignment_receipt_id);
ALTER TABLE shipit.delivery_exception_requests ADD CONSTRAINT delivery_exception_receipt_owner_fk
 FOREIGN KEY(organization_id,franchise_id,assignment_receipt_id,parcel_id,attempt_id)
 REFERENCES shipit.custody_receipts(organization_id,franchise_id,id,parcel_id,attempt_id) ON DELETE RESTRICT;
CREATE FUNCTION shipit.guard_custody_exception_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.custody_receipts;
BEGIN
 -- All delivery and custody writers lock the parcel before reading the receipt generation.
 PERFORM 1 FROM shipit.parcels WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.parcel_id FOR UPDATE;
 SELECT * INTO source FROM shipit.custody_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id ORDER BY sequence DESC LIMIT 1;
 IF TG_OP='INSERT' THEN
  IF NEW.assignment_receipt_id IS NOT NULL AND NEW.assignment_receipt_id IS DISTINCT FROM source.id THEN
   RAISE EXCEPTION 'DELIVERY_PHYSICAL_CUSTODY_CONFLICT' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';
  END IF;
  NEW.assignment_receipt_id:=source.id;
 ELSE
  IF (NEW.id,NEW.organization_id,NEW.franchise_id,NEW.parcel_id,NEW.attempt_id,NEW.requester_id,NEW.assignment_receipt_id,NEW.reason_code,NEW.evidence_id,NEW.requested_at,NEW.request_command_id)
   IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.franchise_id,OLD.parcel_id,OLD.attempt_id,OLD.requester_id,OLD.assignment_receipt_id,OLD.reason_code,OLD.evidence_id,OLD.requested_at,OLD.request_command_id) THEN
   RAISE EXCEPTION 'DELIVERY_EXCEPTION_HISTORY_IMMUTABLE' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT
   ((OLD.state='pending' AND NEW.state IN ('approved','denied','invalidated')) OR (OLD.state='approved' AND NEW.state='invalidated')) THEN
   RAISE EXCEPTION 'DELIVERY_EXCEPTION_HISTORY_IMMUTABLE' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';
  END IF;
 END IF;
 IF NEW.state IN ('pending','approved') AND
  (NEW.assignment_receipt_id IS DISTINCT FROM source.id OR
   (source.id IS NOT NULL AND (source.kind<>'agent_received' OR source.agent_id IS DISTINCT FROM NEW.requester_id OR source.attempt_id<>NEW.attempt_id))) THEN
  RAISE EXCEPTION 'DELIVERY_PHYSICAL_CUSTODY_CONFLICT' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER delivery_exception_custody BEFORE INSERT OR UPDATE ON shipit.delivery_exception_requests FOR EACH ROW EXECUTE FUNCTION shipit.guard_custody_exception_request();
CREATE TRIGGER delivery_exception_custody_history BEFORE DELETE ON shipit.delivery_exception_requests FOR EACH ROW EXECUTE FUNCTION shipit.guard_delivery_history();
CREATE FUNCTION shipit.invalidate_custody_exception_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.kind<>'recipient_received' THEN
  UPDATE shipit.delivery_exception_requests SET state='invalidated',decided_at=transaction_timestamp()
   WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id
    AND state IN ('pending','approved') AND assignment_receipt_id IS DISTINCT FROM NEW.id;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER custody_exception_invalidation AFTER INSERT ON shipit.custody_receipts FOR EACH ROW EXECUTE FUNCTION shipit.invalidate_custody_exception_requests();
REVOKE ALL ON FUNCTION shipit.guard_custody_exception_request(),shipit.invalidate_custody_exception_requests() FROM PUBLIC;

-- Existing #42 proof remains the sole delivery source. Its owned transition writes custody too.
CREATE FUNCTION shipit.guard_tracked_delivery_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.custody_receipts;
BEGIN
 SELECT * INTO source FROM shipit.custody_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.parcel_id ORDER BY sequence DESC LIMIT 1;
 IF source.id IS NOT NULL AND (source.kind<>'agent_received' OR source.agent_id IS DISTINCT FROM NEW.completed_by OR source.attempt_id<>NEW.attempt_id)
 THEN RAISE EXCEPTION 'DELIVERY_PHYSICAL_CUSTODY_CONFLICT' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 IF NEW.proof_method='exceptional' AND NOT EXISTS(
  SELECT 1 FROM shipit.delivery_exception_approvals a JOIN shipit.delivery_exception_requests r
   ON r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.id=a.request_id
  WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.id=NEW.approval_id
   AND r.state='approved' AND r.assignment_receipt_id IS NOT DISTINCT FROM source.id AND r.requester_id=NEW.completed_by
 ) THEN RAISE EXCEPTION 'DELIVERY_PHYSICAL_CUSTODY_CONFLICT' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER delivery_tracked_custody BEFORE INSERT ON shipit.delivery_proofs FOR EACH ROW EXECUTE FUNCTION shipit.guard_tracked_delivery_proof();

CREATE FUNCTION shipit.release_tracked_delivery_custody() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.custody_receipts;proof shipit.delivery_proofs;delivery_command shipit.delivery_commands;
 receipt uuid;command uuid;identity text;result jsonb;
BEGIN
 IF NEW.status<>'delivered' OR OLD.status='delivered' THEN RETURN NEW;END IF;
 SELECT * INTO source FROM shipit.custody_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.id ORDER BY sequence DESC LIMIT 1;
 IF source.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO proof FROM shipit.delivery_proofs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND parcel_id=NEW.id AND command_id=NEW.last_command_id;
 SELECT * INTO delivery_command FROM shipit.delivery_commands WHERE id=proof.command_id AND organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id;
 IF proof.id IS NULL OR delivery_command.id IS NULL OR source.kind<>'agent_received' OR source.agent_id IS DISTINCT FROM proof.completed_by
 THEN RAISE EXCEPTION 'DELIVERY_PHYSICAL_CUSTODY_CONFLICT' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 receipt=gen_random_uuid();command=gen_random_uuid();
 INSERT INTO shipit.custody_receipts(id,organization_id,franchise_id,booking_id,parcel_id,attempt_id,sequence,previous_receipt_id,kind,proof_id,actor_id,discrepancy,command_id)
 VALUES(receipt,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.id,proof.attempt_id,source.sequence+1,source.id,'recipient_received',proof.id,proof.completed_by,'none',command);
 identity=encode(sha256(convert_to('custody.delivery:'||proof.id::text,'UTF8')),'hex');
 result=jsonb_build_object('command_id',command,'resource_id',receipt,'receipt_ids',jsonb_build_array(receipt),
  'recorded_at',to_char(date_trunc('milliseconds',transaction_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO shipit.custody_commands(id,organization_id,franchise_id,actor_id,operation,correlation_id,key_digest,fingerprint,input,result)
 VALUES(command,NEW.organization_id,NEW.franchise_id,proof.completed_by,'delivery',delivery_command.correlation_id,identity,identity,jsonb_build_object('proof_id',proof.id,'parcel_id',NEW.id),result);
 INSERT INTO shipit.custody_events(id,organization_id,franchise_id,command_id,resource_id,receipt_ids)
 VALUES(gen_random_uuid(),NEW.organization_id,NEW.franchise_id,command,receipt,ARRAY[receipt]);
 RETURN NEW;
END $fn$;
CREATE TRIGGER delivery_tracked_custody_release AFTER UPDATE ON shipit.parcels FOR EACH ROW EXECUTE FUNCTION shipit.release_tracked_delivery_custody();
CREATE FUNCTION shipit.check_tracked_delivery_custody_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM shipit.custody_receipts r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.parcel_id=NEW.parcel_id AND r.kind<>'recipient_received')
 AND NOT EXISTS(SELECT 1 FROM shipit.custody_receipts r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.parcel_id=NEW.parcel_id
  AND r.proof_id=NEW.id AND r.kind='recipient_received' AND r.actor_id=NEW.completed_by)
 THEN RAISE EXCEPTION 'DELIVERY_CUSTODY_INCOMPLETE' USING ERRCODE='23514',CONSTRAINT='delivery_tracked_custody_guard';END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER delivery_tracked_custody_complete AFTER INSERT ON shipit.delivery_proofs DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION shipit.check_tracked_delivery_custody_complete();
REVOKE ALL ON FUNCTION shipit.guard_tracked_delivery_proof(),shipit.release_tracked_delivery_custody(),shipit.check_tracked_delivery_custody_complete() FROM PUBLIC;

`);
exports.down=()=>{throw new Error('Forward-only migration');};
