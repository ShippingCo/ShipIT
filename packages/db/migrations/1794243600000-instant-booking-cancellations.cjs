// Instant, money-correct booking cancellation.
//
// Anyone holding `bookings.cancel` cancels a booking at once, with no review step, while every
// parcel is still `booked`, or `checked_in` at the hub and not yet on a trip, route or carrier.
// In the same transaction as the cancellation record:
//  - one `cancellation` financial change reverses the booking's remaining charge exactly, per tax
//    component, so the outstanding amount becomes 0 (skipped when nothing remains);
//  - every rupee still held for the booking is recorded as refunded to the customer by the way it
//    came in: one `refund` change plus refund evidence per (receiving account, method). Cash comes
//    out of the cancelling person's own drawer when it holds enough, else the drawer that took
//    it in, and never blocks the cancellation (see booking_cancellation_refund_sources).
// Receipt allocations are never released and advance refunds are never used, so receipts, the
// cashbook, reports and customer balances count the money exactly once.
//
// Only finance rows written by this trigger, referencing a cancellation created in the same
// transaction for the same booking, actor and correlation, skip the review workflow. Every other
// finance write keeps its review rules.
//
// Parcels in an active lot report `in_lot` (lowest priority); the API ends the lot membership through
// the ordinary lot command first, because ending one needs a complete lot
// command (lot version, audit and domain events, committed result), which this trigger cannot
// produce honestly for the lot owner. The parcel must leave the lot first.

const oldCancelledShape = "((status = 'cancelled'::text) AND (custody = 'awaiting_intake'::text) AND (version = 2) AND (attempts_started = 0) AND (failed_attempt_count = 0) AND (active_attempt_id IS NULL) AND (assigned_agent_id IS NULL) AND (last_command_id IS NULL))";
const newCancelledShape = "((status = 'cancelled'::text) AND (custody = ANY (ARRAY['awaiting_intake'::text, 'franchise_office'::text])) AND (version >= 2) AND (attempts_started = 0) AND (failed_attempt_count = 0) AND (active_attempt_id IS NULL) AND (assigned_agent_id IS NULL))";

exports.up = pgm => pgm.sql(`
ALTER TABLE shipit.booking_cancellations
 DROP CONSTRAINT booking_cancellations_payment_version_check,
 ADD CONSTRAINT booking_cancellations_payment_version_check CHECK(payment_version>=0),
 ADD COLUMN reversed_paise bigint NOT NULL DEFAULT 0 CHECK(reversed_paise>=0),
 ADD COLUMN refunded_paise bigint NOT NULL DEFAULT 0 CHECK(refunded_paise>=0),
 ADD COLUMN refunds jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(refunds)='array' AND octet_length(refunds::text)<=2048),
 ADD COLUMN creation_xid xid8,
 ADD CONSTRAINT booking_cancellation_owned_id UNIQUE(organization_id,franchise_id,id);

CREATE FUNCTION shipit.stamp_booking_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN NEW.creation_xid=pg_current_xact_id(); RETURN NEW; END $fn$;
CREATE TRIGGER booking_cancellation_stamp BEFORE INSERT ON shipit.booking_cancellations FOR EACH ROW EXECUTE FUNCTION shipit.stamp_booking_cancellation();

DO $migration$ DECLARE current_shape text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT current_shape FROM pg_constraint
 WHERE conrelid='shipit.parcels'::regclass AND conname='parcels_state_shape_check';
 IF position(${quote(oldCancelledShape)} IN current_shape)=0 THEN RAISE EXCEPTION 'Unexpected parcel shape'; END IF;
 ALTER TABLE shipit.parcels DROP CONSTRAINT parcels_state_shape_check;
 EXECUTE format('ALTER TABLE shipit.parcels ADD CONSTRAINT parcels_state_shape_check CHECK (%s)',
  replace(current_shape,${quote(oldCancelledShape)},${quote(newCancelledShape)}));
END $migration$;

CREATE OR REPLACE FUNCTION shipit.guard_whole_booking_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE audit_row shipit.booking_cancellations;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN
  SELECT * INTO audit_row FROM shipit.booking_cancellations WHERE organization_id=OLD.organization_id AND franchise_id=OLD.franchise_id AND booking_id=OLD.id;
  IF OLD.state<>'active' OR NEW.state<>'cancelled' OR NEW.version<>OLD.version+1 OR
     (to_jsonb(NEW)-ARRAY['state','version'])<>(to_jsonb(OLD)-ARRAY['state','version']) THEN RAISE EXCEPTION 'Invalid booking change' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO audit_row FROM shipit.booking_cancellations WHERE organization_id=OLD.organization_id AND franchise_id=OLD.franchise_id AND booking_id=OLD.booking_id;
  IF NOT ((OLD.status='booked' AND OLD.custody='awaiting_intake') OR (OLD.status='checked_in' AND OLD.custody='franchise_office'))
     OR NEW.status<>'cancelled' OR NEW.version<>OLD.version+1 OR NEW.updated_at IS DISTINCT FROM audit_row.cancelled_at OR
     (to_jsonb(NEW)-ARRAY['status','version','updated_at'])<>(to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN RAISE EXCEPTION 'Invalid parcel cancellation' USING ERRCODE='23514'; END IF;
 END IF;
 IF audit_row.id IS NULL THEN RAISE EXCEPTION 'Missing cancellation evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;

-- A custodian's cash drawer for an account, when a cash refund may name it: the drawer is
-- active on the account's current revision and its custodian is an active operator or
-- franchise admin here (the same rules guard_refund_cash_location enforces).
CREATE FUNCTION shipit.booking_cancellation_cash_location(org uuid, branch uuid, account uuid, account_revision uuid, custodian uuid)
RETURNS TABLE(location_id uuid,revision_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT l.id,r.id FROM shipit.cash_locations l
  CROSS JOIN LATERAL (SELECT x.* FROM shipit.cash_location_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY x.version DESC LIMIT 1) r
 WHERE l.organization_id=org AND l.franchise_id=branch AND l.account_id=account AND l.kind='cash' AND l.custodian_id=custodian
  AND r.active AND r.account_revision_id=account_revision
  AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
   JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE f.organization_id=org AND f.franchise_id=branch AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id=custodian)
 LIMIT 1;
$fn$;

-- One row per (receiving account, method) still holding money for the booking. Receipt-backed
-- money keeps its receipt's account and method; legacy collections use the branch's single active
-- account for that method. Reversals follow the entry they reverse. Refunds already recorded with
-- evidence are taken off their own group. problem is NULL when the group can be refunded now.
CREATE FUNCTION shipit.booking_cancellation_refund_sources(org uuid, branch uuid, booking uuid, actor uuid)
RETURNS TABLE(account_id uuid,account_revision_id uuid,method text,amount_paise numeric,cash_location_id uuid,cash_location_revision_id uuid,problem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
#variable_conflict use_column
DECLARE g record; acct shipit.receiving_account_revisions; here record; there record; took record;
 cap record; unknown numeric;
BEGIN
 SELECT COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) INTO unknown
 FROM shipit.financial_changes c LEFT JOIN shipit.financial_refund_evidence e
  ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.id=COALESCE(c.refund_correction_of,c.id)
 WHERE (c.organization_id,c.franchise_id,c.booking_id)=(org,branch,booking) AND c.kind IN ('refund','refund_correction') AND e.id IS NULL;
 IF unknown<>0 THEN
  account_id=NULL;account_revision_id=NULL;method=NULL;amount_paise=unknown;cash_location_id=NULL;cash_location_revision_id=NULL;problem='refund_source_missing';RETURN NEXT;
 END IF;
 FOR g IN
  WITH latest AS (SELECT DISTINCT ON (r.account_id) r.* FROM shipit.receiving_account_revisions r
   WHERE r.organization_id=org AND r.franchise_id=branch ORDER BY r.account_id,r.version DESC),
  money AS (
   SELECT rc.account_id,src.method,CASE WHEN e.kind='collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END amount
   FROM shipit.payment_entries e
   JOIN shipit.payment_entries src ON src.organization_id=e.organization_id AND src.franchise_id=e.franchise_id AND src.booking_id=e.booking_id AND src.id=COALESCE(e.reversal_of,e.id)
   LEFT JOIN shipit.money_receipt_allocations a ON a.organization_id=src.organization_id AND a.franchise_id=src.franchise_id AND a.payment_entry_id=src.id AND a.kind='allocation'
   LEFT JOIN shipit.money_receipts rc ON rc.organization_id=a.organization_id AND rc.franchise_id=a.franchise_id AND rc.id=a.receipt_id
   WHERE (e.organization_id,e.franchise_id,e.booking_id)=(org,branch,booking)),
  resolved AS (
   SELECT COALESCE(m.account_id,(SELECT CASE WHEN count(*)=1 THEN (array_agg(l.account_id))[1] END FROM latest l WHERE l.active AND m.method=ANY(l.methods))) account_id,m.method,m.amount
   FROM money m
   UNION ALL
   SELECT ev.source_account_id,ev.method,-(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END)
   FROM shipit.financial_changes c JOIN shipit.financial_refund_evidence ev
    ON ev.organization_id=c.organization_id AND ev.franchise_id=c.franchise_id AND ev.id=COALESCE(c.refund_correction_of,c.id)
   WHERE (c.organization_id,c.franchise_id,c.booking_id)=(org,branch,booking) AND c.kind IN ('refund','refund_correction'))
  SELECT x.account_id,x.method,sum(x.amount) amount FROM resolved x GROUP BY x.account_id,x.method HAVING sum(x.amount)<>0 ORDER BY x.method,x.account_id
 LOOP
  account_id=g.account_id;method=g.method;amount_paise=g.amount;account_revision_id=NULL;cash_location_id=NULL;cash_location_revision_id=NULL;problem=NULL;
  acct=NULL;here=NULL;there=NULL;took=NULL;
  IF g.account_id IS NOT NULL THEN
   SELECT * INTO acct FROM shipit.receiving_account_revisions r WHERE r.organization_id=org AND r.franchise_id=branch AND r.account_id=g.account_id ORDER BY r.version DESC LIMIT 1;
  END IF;
  IF g.amount<0 OR acct.id IS NULL OR NOT acct.active OR NOT (g.method=ANY(acct.methods)) THEN problem='refund_source_missing';
  ELSE
   account_revision_id=acct.id;
   -- Cash never blocks a cancellation. It leaves, in order: the canceller's own drawer when
   -- it holds enough; otherwise the drawer that took the money in, even if that leaves it
   -- short in the books; otherwise the canceller's drawer anyway; and when the money never
   -- reached any drawer, it goes back out the same way, with custody unknown, so the cash
   -- book's unassigned money in and out still match.
   IF g.method='cash' THEN
    SELECT * INTO here FROM shipit.booking_cancellation_cash_location(org,branch,g.account_id,acct.id,actor);
    IF here.location_id IS NOT NULL THEN
     SELECT * INTO cap FROM shipit.cashbook_custody_capacity(org,branch,here.location_id,NULL);
     IF cap.recorded-cap.reserved<g.amount OR cap.unknown_refund>0 THEN
      SELECT o.* INTO took FROM (SELECT rc.initial_custodian_id custodian,sum(a.amount_paise) amount
        FROM shipit.money_receipt_allocations a JOIN shipit.money_receipts rc ON rc.organization_id=a.organization_id AND rc.franchise_id=a.franchise_id AND rc.id=a.receipt_id
        WHERE (a.organization_id,a.franchise_id,a.booking_id)=(org,branch,booking) AND a.kind='allocation' AND rc.method='cash' AND rc.account_id=g.account_id
        GROUP BY rc.initial_custodian_id) o ORDER BY o.amount DESC,o.custodian LIMIT 1;
      IF took.custodian IS NOT NULL AND took.custodian<>actor THEN
       SELECT * INTO there FROM shipit.booking_cancellation_cash_location(org,branch,g.account_id,acct.id,took.custodian);
       IF there.location_id IS NOT NULL THEN here=there; END IF;
      END IF;
     END IF;
    ELSE
     SELECT o.* INTO took FROM (SELECT rc.initial_custodian_id custodian,sum(a.amount_paise) amount
       FROM shipit.money_receipt_allocations a JOIN shipit.money_receipts rc ON rc.organization_id=a.organization_id AND rc.franchise_id=a.franchise_id AND rc.id=a.receipt_id
       WHERE (a.organization_id,a.franchise_id,a.booking_id)=(org,branch,booking) AND a.kind='allocation' AND rc.method='cash' AND rc.account_id=g.account_id
       GROUP BY rc.initial_custodian_id) o ORDER BY o.amount DESC,o.custodian LIMIT 1;
     IF took.custodian IS NOT NULL THEN
      SELECT * INTO here FROM shipit.booking_cancellation_cash_location(org,branch,g.account_id,acct.id,took.custodian);
     END IF;
    END IF;
    cash_location_id=here.location_id;cash_location_revision_id=here.revision_id;
   END IF;
  END IF;
  RETURN NEXT;
 END LOOP;
END $fn$;

DROP FUNCTION shipit.booking_cancellation_preview(uuid,uuid,uuid);
CREATE FUNCTION shipit.booking_cancellation_preview(org uuid, branch uuid, booking uuid, actor uuid)
RETURNS TABLE(booking_id uuid,parcel_count integer,outstanding_paise bigint,reversed_paise bigint,refund_paise bigint,refunds jsonb,
 financial_version integer,payment_version integer,blocked_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT b.id,b.parcel_count,greatest(0,b.final_payable_paise-f.reductions-p.collections+f.refunds)::bigint,
 greatest(0,b.final_payable_paise-f.reductions)::bigint,COALESCE(s.total,0)::bigint,COALESCE(s.refunds,'[]'::jsonb),f.version,p.version,
 CASE WHEN b.state='cancelled' THEN 'already_cancelled'
 WHEN EXISTS(SELECT 1 FROM shipit.parcels x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)
  AND NOT ((x.status='booked' AND x.custody='awaiting_intake') OR (x.status='checked_in' AND x.custody='franchise_office'))) THEN 'parcel_processed'
 WHEN EXISTS(SELECT 1 FROM shipit.route_parcels x JOIN shipit.parcels y ON y.organization_id=x.organization_id AND y.franchise_id=x.franchise_id AND y.id=x.parcel_id
  WHERE (y.organization_id,y.franchise_id,y.booking_id)=(org,branch,booking) AND x.ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM shipit.carrier_dockets x JOIN shipit.parcels y ON y.organization_id=x.organization_id AND y.franchise_id=x.franchise_id AND y.id=x.parcel_id
  WHERE (y.organization_id,y.franchise_id,y.booking_id)=(org,branch,booking))
 OR EXISTS(SELECT 1 FROM shipit.eway_records x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)) THEN 'operational_commitment'
 WHEN EXISTS(SELECT 1 FROM shipit.account_statement_lines x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking)) THEN 'account_billed'
 WHEN s.missing THEN 'refund_source_missing'
 WHEN s.unavailable THEN 'refund_cash_unavailable'
 -- Last on purpose: a bag is the one obstacle the cancel request clears itself, so it is
 -- reported only when nothing else would still stop the cancellation.
 WHEN EXISTS(SELECT 1 FROM shipit.lot_memberships x WHERE (x.organization_id,x.franchise_id,x.booking_id)=(org,branch,booking) AND x.ended_at IS NULL) THEN 'in_lot'
 END
 FROM shipit.bookings b CROSS JOIN LATERAL (SELECT COALESCE(max(c.version),0) version,
 COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reductions,
 COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refunds
 FROM shipit.financial_changes c WHERE (c.organization_id,c.franchise_id,c.booking_id)=(org,branch,booking)) f
 CROSS JOIN LATERAL (SELECT COALESCE(max(e.sequence),0)::integer version, COALESCE(sum(CASE WHEN e.kind='collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0) collections
 FROM shipit.payment_entries e WHERE (e.organization_id,e.franchise_id,e.booking_id)=(org,branch,booking)) p
 LEFT JOIN LATERAL (SELECT sum(m.amount) total,bool_or(m.missing) missing,bool_or(m.unavailable) unavailable,
  jsonb_agg(jsonb_build_object('method',m.method,'amount_paise',m.amount::text) ORDER BY m.method) FILTER (WHERE m.method IS NOT NULL) refunds
  FROM (SELECT r.method,sum(r.amount_paise) amount,bool_or(r.problem='refund_source_missing') missing,bool_or(r.problem='refund_cash_unavailable') unavailable
   FROM shipit.booking_cancellation_refund_sources(org,branch,booking,actor) r GROUP BY r.method) m) s ON b.state='active'
 WHERE (b.organization_id,b.franchise_id,b.id)=(org,branch,booking);
$fn$;

CREATE OR REPLACE FUNCTION shipit.apply_whole_booking_cancellation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE snapshot record; changed integer; b shipit.bookings; a record; g record; next_version integer; change uuid; ref text; returned text;
BEGIN
 -- Match the finance lock order before checking current charge/collection evidence.
 PERFORM 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Branch inactive' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 PERFORM 1 FROM shipit.booking_obligations WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id) FOR UPDATE;
 PERFORM 1 FROM shipit.parcels WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id) ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT snapshot FROM shipit.booking_cancellation_preview(NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.actor_id);
 IF snapshot.blocked_reason IS NOT NULL THEN RAISE EXCEPTION 'Cancellation blocked' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 IF (snapshot.financial_version,snapshot.payment_version,snapshot.outstanding_paise,snapshot.parcel_count,snapshot.reversed_paise,snapshot.refund_paise,snapshot.refunds) IS DISTINCT FROM
 (NEW.financial_version,NEW.payment_version,NEW.outstanding_paise,NEW.parcel_count,NEW.reversed_paise,NEW.refunded_paise,NEW.refunds) THEN RAISE EXCEPTION 'Cancellation stale' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_stale'; END IF;
 UPDATE shipit.bookings SET state='cancelled',version=2 WHERE (organization_id,franchise_id,id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id) RETURNING * INTO STRICT b;
 UPDATE shipit.parcels SET status='cancelled',version=version+1,updated_at=NEW.cancelled_at WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>NEW.parcel_count THEN RAISE EXCEPTION 'Parcel set mismatch' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;

 ref='booking_cancellation:'||NEW.id::text;returned='customer:'||b.customer_id::text;next_version=NEW.financial_version;
 IF NEW.reversed_paise>0 THEN
  SELECT COALESCE(sum(pre_tax),0) pre_tax,COALESCE(sum(taxable),0) taxable,COALESCE(sum(cgst),0) cgst,COALESCE(sum(sgst),0) sgst,
   COALESCE(sum(igst),0) igst,COALESCE(sum(rounding),0) rounding INTO a
  FROM shipit.financial_changes WHERE (organization_id,franchise_id,booking_id)=(NEW.organization_id,NEW.franchise_id,NEW.booking_id);
  next_version=next_version+1;
  INSERT INTO shipit.financial_changes(id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,
   pre_tax,taxable,cgst,sgst,igst,rounding,correlation_id)
  VALUES(gen_random_uuid(),NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.actor_id,
   encode(sha256(convert_to(ref||':charge','UTF8')),'hex'),encode(sha256(convert_to(ref||':charge:'||NEW.fingerprint,'UTF8')),'hex'),
   next_version,NEW.payment_version,'cancellation','booking_cancelled',ref,
   (b.tax_snapshot->>'pre_tax_paise')::bigint-a.pre_tax,(b.tax_snapshot->>'taxable_basis_paise')::bigint-a.taxable,
   (b.tax_snapshot->>'cgst_paise')::bigint-a.cgst,(b.tax_snapshot->>'sgst_paise')::bigint-a.sgst,(b.tax_snapshot->>'igst_paise')::bigint-a.igst,
   (b.tax_snapshot->>'rounding_adjustment_paise')::bigint-a.rounding,NEW.correlation_id);
 END IF;
 FOR g IN SELECT * FROM shipit.booking_cancellation_refund_sources(NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.actor_id) s WHERE s.amount_paise>0 ORDER BY s.method,s.account_id LOOP
  IF g.problem IS NOT NULL THEN RAISE EXCEPTION 'Cancellation blocked' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
  next_version=next_version+1;change=gen_random_uuid();
  INSERT INTO shipit.financial_changes(id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,
   refund,returned_to_ref,correlation_id)
  VALUES(change,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.actor_id,
   encode(sha256(convert_to(ref||':refund:'||g.account_id::text||':'||g.method,'UTF8')),'hex'),
   encode(sha256(convert_to(ref||':refund:'||g.account_id::text||':'||g.method||':'||NEW.fingerprint,'UTF8')),'hex'),
   next_version,NEW.payment_version,'refund','booking_cancelled',ref,g.amount_paise::bigint,returned,NEW.correlation_id);
  INSERT INTO shipit.financial_refund_evidence(id,organization_id,franchise_id,request_id,cancellation_id,actor_id,source_account_id,source_revision_id,method,
   occurred_at,returned_to_ref,transfer_ref,cash_location_id,cash_location_revision_id)
  VALUES(change,NEW.organization_id,NEW.franchise_id,NULL,NEW.id,NEW.actor_id,g.account_id,g.account_revision_id,g.method,
   LEAST(NEW.cancelled_at,clock_timestamp()),returned,ref,g.cash_location_id,g.cash_location_revision_id);
 END LOOP;
 RETURN NULL;
END $fn$;

-- Finance rows written by a booking cancellation inside the cancelling transaction itself.
CREATE FUNCTION shipit.is_booking_cancellation_finance(c shipit.financial_changes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT c.kind IN ('cancellation','refund') AND c.reason='booking_cancelled' AND EXISTS(SELECT 1 FROM shipit.booking_cancellations x
  WHERE x.organization_id=c.organization_id AND x.franchise_id=c.franchise_id AND 'booking_cancellation:'||x.id::text=c.approval_ref
  AND x.booking_id=c.booking_id AND x.actor_id=c.actor_id AND x.correlation_id=c.correlation_id AND x.creation_xid=pg_current_xact_id());
$fn$;

CREATE OR REPLACE FUNCTION shipit.guard_financial_workflow_effect_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 -- A booking cancellation's own reversal and refunds are its approval; they still need refund evidence.
 IF shipit.is_booking_cancellation_finance(NEW) THEN
  IF NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM shipit.financial_refund_evidence e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.id=NEW.id)
  THEN RAISE EXCEPTION 'FINANCIAL_WORKFLOW_EFFECT_INCOMPLETE' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 -- Disabling configured workflow writes must not reopen the manual legacy path.
 IF EXISTS(SELECT 1 FROM shipit.financial_policy_revisions p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id) AND (NOT EXISTS(SELECT 1 FROM shipit.financial_request_decisions d WHERE d.organization_id=NEW.organization_id AND d.franchise_id=NEW.franchise_id AND d.financial_change_id=NEW.id AND d.outcome='applied')
  OR (NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM shipit.financial_refund_evidence e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.id=NEW.id)))
 THEN RAISE EXCEPTION 'FINANCIAL_WORKFLOW_EFFECT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;

ALTER TABLE shipit.financial_refund_evidence ALTER COLUMN request_id DROP NOT NULL,
 ADD COLUMN cancellation_id uuid,
 ADD CONSTRAINT financial_refund_evidence_cancellation_fkey FOREIGN KEY(organization_id,franchise_id,cancellation_id)
  REFERENCES shipit.booking_cancellations(organization_id,franchise_id,id),
 ADD CONSTRAINT financial_refund_evidence_source CHECK(num_nonnulls(request_id,cancellation_id)=1);

CREATE OR REPLACE FUNCTION shipit.guard_financial_refund_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.financial_changes;a shipit.receiving_account_revisions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT * INTO c FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.id;
 SELECT * INTO a FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.source_account_id ORDER BY version DESC LIMIT 1;
 IF c.id IS NULL OR c.kind<>'refund' OR c.actor_id<>NEW.actor_id OR c.returned_to_ref<>NEW.returned_to_ref
  OR (NEW.request_id IS NOT NULL AND c.approval_ref<>NEW.request_id::text)
  OR (NEW.cancellation_id IS NOT NULL AND (c.approval_ref<>'booking_cancellation:'||NEW.cancellation_id::text OR NOT shipit.is_booking_cancellation_finance(c)))
  OR a.id IS NULL OR a.id<>NEW.source_revision_id OR NOT a.active OR NOT (NEW.method=ANY(a.methods)) OR NEW.occurred_at>clock_timestamp()
 THEN RAISE EXCEPTION 'FINANCIAL_REFUND_EVIDENCE_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=clock_timestamp();RETURN NEW;
END $fn$;

-- Money held for a cancelled booking is settled by its cancellation refunds. Releasing a receipt
-- allocation or recording a new collection or reversal afterwards would count it twice.
CREATE FUNCTION shipit.reject_cancelled_booking_money() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM shipit.bookings b WHERE b.organization_id=NEW.organization_id AND b.franchise_id=NEW.franchise_id AND b.id=NEW.booking_id AND b.state='cancelled')
 THEN RAISE EXCEPTION 'BOOKING_CANCELLED_MONEY_LOCKED' USING ERRCODE='23514',CONSTRAINT='booking_cancellation_blocked'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER aa_cancelled_booking_money BEFORE INSERT ON shipit.money_receipt_allocations FOR EACH ROW EXECUTE FUNCTION shipit.reject_cancelled_booking_money();
CREATE TRIGGER aa_cancelled_booking_money BEFORE INSERT ON shipit.payment_entries FOR EACH ROW EXECUTE FUNCTION shipit.reject_cancelled_booking_money();

-- The bags a booking's parcels are in, so the cancel request can take them out first through
-- the ordinary lot command (version, audit and event included) before cancelling.
CREATE FUNCTION shipit.booking_cancellation_lot_memberships(org uuid, branch uuid, booking uuid)
RETURNS TABLE(lot_id uuid,lot_version integer,membership_id uuid,parcel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT m.lot_id,l.version,m.id,m.parcel_id FROM shipit.lot_memberships m
  JOIN shipit.lots l ON l.organization_id=m.organization_id AND l.franchise_id=m.franchise_id AND l.id=m.lot_id
 WHERE (m.organization_id,m.franchise_id,m.booking_id)=(org,branch,booking) AND m.ended_at IS NULL ORDER BY m.lot_id,m.id;
$fn$;

REVOKE ALL ON FUNCTION shipit.booking_cancellation_lot_memberships(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.booking_cancellation_cash_location(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.booking_cancellation_preview(uuid,uuid,uuid,uuid),shipit.booking_cancellation_refund_sources(uuid,uuid,uuid,uuid),
 shipit.is_booking_cancellation_finance(shipit.financial_changes),shipit.stamp_booking_cancellation(),shipit.reject_cancelled_booking_money() FROM PUBLIC;
`);

// Forward-only: once a booking is cancelled with a reversal and refunds, removing the
// cancellation-sourced refund evidence or restoring the old parcel shape would destroy money
// history (cashbook, reports and statements already count it). Corrections are new migrations.
exports.down = () => { throw new Error('Forward-only: preserve cancellation and refund evidence'); };

function quote(text) { return `'${text.replaceAll("'", "''")}'`; }
