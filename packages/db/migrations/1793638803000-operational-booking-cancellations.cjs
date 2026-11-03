exports.up = pgm => pgm.sql(`
CREATE TABLE shipit.booking_cancellations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 200 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
 key_digest text NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 financial_version integer NOT NULL CHECK(financial_version>=0), payment_version integer NOT NULL CHECK(payment_version=0),
 outstanding_paise bigint NOT NULL CHECK(outstanding_paise>=0), parcel_count integer NOT NULL CHECK(parcel_count BETWEEN 1 AND 50),
 cancelled_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()) CHECK(isfinite(cancelled_at)),
 UNIQUE(organization_id,franchise_id,booking_id), UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id)
);
REVOKE ALL ON shipit.booking_cancellations FROM PUBLIC;
CREATE TRIGGER booking_cancellations_immutable BEFORE UPDATE OR DELETE ON shipit.booking_cancellations
 FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation();

ALTER TABLE shipit.bookings DROP CONSTRAINT bookings_state_check, DROP CONSTRAINT bookings_version_check,
 ADD CHECK ((state='active' AND version=1) OR (state='cancelled' AND version=2));
ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_status_check,
 ADD CHECK(status IN ('booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto','cancelled'));
-- Keep all existing lifecycle shape rules and add one terminal, pre-intake shape.
DO $migration$ DECLARE original_shape text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT original_shape FROM pg_constraint
 WHERE conrelid='shipit.parcels'::regclass AND conname='parcels_state_shape_check';
 ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_state_shape_check;
 EXECUTE format('ALTER TABLE shipit.parcels ADD CONSTRAINT parcels_state_shape_check CHECK ((%s) OR
 (status=''cancelled'' AND custody=''awaiting_intake'' AND version=2 AND attempts_started=0 AND failed_attempt_count=0
 AND active_attempt_id IS NULL AND assigned_agent_id IS NULL AND last_command_id IS NULL))',original_shape);
END $migration$;

CREATE FUNCTION shipit.guard_whole_booking_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE audit_row shipit.booking_cancellations;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN
  SELECT * INTO audit_row FROM shipit.booking_cancellations WHERE organization_id=OLD.organization_id AND franchise_id=OLD.franchise_id AND booking_id=OLD.id;
  IF OLD.state<>'active' OR NEW.state<>'cancelled' OR NEW.version<>OLD.version+1 OR
     (to_jsonb(NEW)-ARRAY['state','version'])<>(to_jsonb(OLD)-ARRAY['state','version']) THEN RAISE EXCEPTION 'Invalid booking change' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO audit_row FROM shipit.booking_cancellations WHERE organization_id=OLD.organization_id AND franchise_id=OLD.franchise_id AND booking_id=OLD.booking_id;
  IF OLD.status<>'booked' OR OLD.version<>1 OR NEW.status<>'cancelled' OR NEW.version<>2 OR NEW.updated_at IS DISTINCT FROM audit_row.cancelled_at OR
     (to_jsonb(NEW)-ARRAY['status','version','updated_at'])<>(to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN RAISE EXCEPTION 'Invalid parcel cancellation' USING ERRCODE='23514'; END IF;
 END IF;
 IF audit_row.id IS NULL THEN RAISE EXCEPTION 'Missing cancellation evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER bookings_active_on_creation BEFORE INSERT ON shipit.bookings FOR EACH ROW WHEN (NEW.state<>'active') EXECUTE FUNCTION shipit.reject_booking_mutation();
CREATE TRIGGER parcels_initial_booking_state BEFORE INSERT ON shipit.parcels FOR EACH ROW WHEN (NEW.status='cancelled') EXECUTE FUNCTION shipit.reject_booking_mutation();
DROP TRIGGER bookings_immutable ON shipit.bookings;
CREATE TRIGGER bookings_immutable BEFORE DELETE ON shipit.bookings FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation();
CREATE TRIGGER bookings_update_guard BEFORE UPDATE ON shipit.bookings FOR EACH ROW EXECUTE FUNCTION shipit.guard_whole_booking_cancellation();
DROP TRIGGER parcels_lifecycle_guard ON shipit.parcels;
CREATE TRIGGER parcels_lifecycle_delete_guard BEFORE DELETE ON shipit.parcels FOR EACH ROW EXECUTE FUNCTION shipit.guard_parcel_lifecycle();
CREATE TRIGGER parcels_lifecycle_guard BEFORE UPDATE ON shipit.parcels FOR EACH ROW WHEN (NEW.status<>'cancelled') EXECUTE FUNCTION shipit.guard_parcel_lifecycle();
CREATE TRIGGER parcels_cancelled_immutable BEFORE UPDATE ON shipit.parcels FOR EACH ROW WHEN (OLD.status='cancelled') EXECUTE FUNCTION shipit.reject_booking_mutation();
CREATE TRIGGER parcels_cancellation_guard BEFORE UPDATE ON shipit.parcels FOR EACH ROW WHEN (NEW.status='cancelled') EXECUTE FUNCTION shipit.guard_whole_booking_cancellation();

CREATE FUNCTION shipit.booking_cancellation_preview(org uuid, branch uuid, booking uuid)
RETURNS TABLE(booking_id uuid,parcel_count integer,outstanding_paise bigint,financial_version integer,payment_version integer,blocked_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT b.id,b.parcel_count,greatest(0,b.final_payable_paise-f.reductions-p.collections+f.refunds)::bigint,f.version,p.version,
 CASE WHEN b.state='cancelled' THEN 'already_cancelled'
 WHEN EXISTS(SELECT 1 FROM shipit.parcels x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)
 AND (x.version<>1 OR x.status<>'booked' OR x.custody<>'awaiting_intake')) THEN 'parcel_processed'
 WHEN p.version>0 THEN 'money_recorded'
 WHEN EXISTS(SELECT 1 FROM shipit.customer_account_bookings x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)) THEN 'account_billed'
 WHEN EXISTS(SELECT 1 FROM shipit.lot_memberships x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking) AND x.ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM shipit.route_parcels x JOIN shipit.parcels y ON y.id=x.parcel_id WHERE (y.organization_id,y.franchise_id,y.booking_id)=(org,branch,booking) AND x.ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM shipit.carrier_dockets x JOIN shipit.parcels y ON y.id=x.parcel_id WHERE (y.organization_id,y.franchise_id,y.booking_id)=(org,branch,booking))
 OR EXISTS(SELECT 1 FROM shipit.eway_records x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)) THEN 'operational_commitment'
 END
 FROM shipit.bookings b CROSS JOIN LATERAL (SELECT COALESCE(max(c.version),0) version,
 COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reductions,
 COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refunds
 FROM shipit.financial_changes c WHERE (c.organization_id,c.franchise_id,c.booking_id)=(org,branch,booking)) f
 CROSS JOIN LATERAL (SELECT COALESCE(max(e.sequence),0)::integer version, COALESCE(sum(CASE WHEN e.kind='collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0) collections
 FROM shipit.payment_entries e WHERE (e.organization_id,e.franchise_id,e.booking_id)=(org,branch,booking)) p
 WHERE (b.organization_id,b.franchise_id,b.id)=(org,branch,booking);
$fn$;

CREATE FUNCTION shipit.apply_whole_booking_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE snapshot record; changed integer;
BEGIN
 -- Match the finance lock order before checking current charge/collection evidence.
 PERFORM 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Branch inactive' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 PERFORM 1 FROM shipit.booking_obligations WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id) FOR UPDATE;
 PERFORM 1 FROM shipit.parcels WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT snapshot FROM shipit.booking_cancellation_preview(NEW.organization_id,NEW.franchise_id,NEW.booking_id);
 IF snapshot.blocked_reason IS NOT NULL THEN RAISE EXCEPTION 'Cancellation blocked' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 IF (snapshot.financial_version,snapshot.payment_version,snapshot.outstanding_paise,snapshot.parcel_count) IS DISTINCT FROM
 (NEW.financial_version,NEW.payment_version,NEW.outstanding_paise,NEW.parcel_count) THEN RAISE EXCEPTION 'Cancellation stale' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_stale'; END IF;
 UPDATE shipit.bookings SET state='cancelled',version=2 WHERE (organization_id,franchise_id,id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id);
 UPDATE shipit.parcels SET status='cancelled',version=2,updated_at=NEW.cancelled_at WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>NEW.parcel_count THEN RAISE EXCEPTION 'Parcel set mismatch' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 RETURN NULL;
END $fn$;
CREATE TRIGGER booking_cancellation_apply AFTER INSERT ON shipit.booking_cancellations FOR EACH ROW EXECUTE FUNCTION shipit.apply_whole_booking_cancellation();
DO $audit$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'booking_cancellation:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'bookings.cancel','booking',booking_id,'success','booking_cancelled',correlation_id,cancelled_at,'active','cancelled',2,NULL FROM shipit.booking_cancellations
 $view$;
END $audit$;
REVOKE ALL ON FUNCTION shipit.booking_cancellation_preview(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_whole_booking_cancellation(),shipit.apply_whole_booking_cancellation() FROM PUBLIC;
`);
exports.down = () => { throw new Error('Forward-only: preserve cancellation evidence'); };
