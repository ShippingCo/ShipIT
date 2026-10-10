// Forward-only #139. No policy preset, approval backfill or historical ledger rewrite.
exports.up = pgm => pgm.sql(String.raw`
CREATE INDEX financial_booked_quote_link ON shipit.bookings(organization_id,franchise_id,pricing_quote_id,id);
ALTER TABLE shipit.financial_changes ADD COLUMN refund_correction_of uuid;
ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_change_owned_booking_id UNIQUE(organization_id,franchise_id,booking_id,id);
ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_refund_correction_source FOREIGN KEY(organization_id,franchise_id,booking_id,refund_correction_of) REFERENCES shipit.financial_changes(organization_id,franchise_id,booking_id,id);
ALTER TABLE shipit.financial_changes DROP CONSTRAINT financial_changes_kind_check;
ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_changes_kind_check CHECK(kind IN ('discount','cancellation','correction','refund','refund_correction'));
ALTER TABLE shipit.financial_changes DROP CONSTRAINT financial_changes_reason_check;
ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_changes_reason_check CHECK(reason IN ('customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund','incorrect_refund_recording'));
ALTER TABLE shipit.financial_changes DROP CONSTRAINT financial_changes_check1;
ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_changes_check1 CHECK(
 (kind='refund' AND refund>0 AND returned_to_ref IS NOT NULL AND refund_correction_of IS NULL AND pre_tax::numeric+taxable+cgst+sgst+igst+abs(rounding)=0)
 OR (kind='refund_correction' AND reason='incorrect_refund_recording' AND refund>0 AND returned_to_ref IS NULL AND refund_correction_of IS NOT NULL AND pre_tax::numeric+taxable+cgst+sgst+igst+abs(rounding)=0)
 OR (kind NOT IN ('refund','refund_correction') AND refund=0 AND returned_to_ref IS NULL AND refund_correction_of IS NULL AND pre_tax::numeric+cgst+sgst+igst+rounding>0));

CREATE TABLE shipit.financial_policy_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
 discount_review_threshold_paise bigint CHECK(discount_review_threshold_paise BETWEEN 0 AND 9007199254740991),
 allow_self_approval boolean NOT NULL,enabled boolean NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,version),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE FUNCTION shipit.guard_financial_policy_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT COALESCE(max(version),0) INTO previous FROM shipit.financial_policy_revisions
 WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id;
 IF NEW.version<>previous+1 THEN RAISE EXCEPTION 'FINANCIAL_POLICY_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER financial_policy_revision_guard BEFORE INSERT OR UPDATE OR DELETE
 ON shipit.financial_policy_revisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_policy_revision();

CREATE TABLE shipit.financial_adjustment_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),policy_id uuid,supersedes_id uuid,refund_correction_of uuid,creation_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 expected_financial_version integer NOT NULL CHECK(expected_financial_version BETWEEN 0 AND 99),
 expected_payment_version integer NOT NULL CHECK(expected_payment_version>=0),
 kind text NOT NULL CHECK(kind IN ('discount','cancellation','correction','refund','refund_correction')),
 reason text NOT NULL CHECK(reason IN ('customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund','incorrect_refund_recording')),
 pre_tax bigint NOT NULL CHECK(pre_tax BETWEEN 0 AND 9007199254740991),
 taxable bigint NOT NULL CHECK(taxable BETWEEN 0 AND pre_tax),
 cgst bigint NOT NULL CHECK(cgst BETWEEN 0 AND 9007199254740991),
 sgst bigint NOT NULL CHECK(sgst BETWEEN 0 AND 9007199254740991),
 igst bigint NOT NULL CHECK(igst BETWEEN 0 AND 9007199254740991),
 rounding bigint NOT NULL CHECK(rounding BETWEEN -99 AND 99),
 refund bigint NOT NULL CHECK(refund BETWEEN 0 AND 9007199254740991),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,supersedes_id),UNIQUE(organization_id,franchise_id,booking_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,policy_id) REFERENCES shipit.financial_policy_revisions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,supersedes_id) REFERENCES shipit.financial_adjustment_requests(organization_id,franchise_id,booking_id,id),
 CHECK(supersedes_id IS NULL OR supersedes_id<>id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,refund_correction_of) REFERENCES shipit.financial_changes(organization_id,franchise_id,booking_id,id),
 CHECK((kind='refund' AND refund>0 AND refund_correction_of IS NULL AND pre_tax::numeric+taxable+cgst+sgst+igst+abs(rounding)=0)
 OR (kind='refund_correction' AND reason='incorrect_refund_recording' AND refund>0 AND refund_correction_of IS NOT NULL AND pre_tax::numeric+taxable+cgst+sgst+igst+abs(rounding)=0)
 OR (kind NOT IN ('refund','refund_correction') AND refund=0 AND refund_correction_of IS NULL AND pre_tax::numeric+cgst+sgst+igst+rounding BETWEEN 1 AND 9007199254740991))
);
CREATE INDEX financial_request_owner_queue ON shipit.financial_adjustment_requests(organization_id,franchise_id,recorded_at,id);
CREATE INDEX financial_request_booking ON shipit.financial_adjustment_requests(organization_id,franchise_id,booking_id,recorded_at,id);
CREATE FUNCTION shipit.guard_financial_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE fv integer;pv integer; latest uuid;original shipit.financial_adjustment_requests;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 PERFORM id FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id FOR UPDATE;
 SELECT COALESCE(max(version),0) INTO fv FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT COALESCE(max(sequence),0) INTO pv FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT id INTO latest FROM shipit.financial_policy_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id ORDER BY version DESC LIMIT 1;
 IF fv<>NEW.expected_financial_version OR pv<>NEW.expected_payment_version OR latest IS DISTINCT FROM NEW.policy_id
 THEN RAISE EXCEPTION 'FINANCIAL_REQUEST_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 IF NEW.supersedes_id IS NOT NULL THEN
  SELECT * INTO original FROM shipit.financial_adjustment_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.supersedes_id;
  IF original.id IS NULL OR original.actor_id<>NEW.actor_id OR EXISTS(SELECT 1 FROM shipit.financial_request_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND request_id=original.id)
  THEN RAISE EXCEPTION 'FINANCIAL_AMENDMENT_CONFLICT' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.creation_xid=pg_current_xact_id();NEW.recorded_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER financial_request_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.financial_adjustment_requests
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_request();

ALTER TABLE shipit.financial_changes ADD CONSTRAINT financial_change_owned_id UNIQUE(organization_id,franchise_id,id);
CREATE TABLE shipit.financial_request_decisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),version integer NOT NULL CHECK(version IN (1,2)),
 outcome text NOT NULL CHECK(outcome IN ('approved','rejected','applied','superseded')),
 financial_change_id uuid,reason text NOT NULL CHECK(reason IN ('review_approved','review_rejected','approved_change_applied','request_amended')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,request_id,version),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),UNIQUE(organization_id,franchise_id,financial_change_id),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.financial_adjustment_requests(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,financial_change_id) REFERENCES shipit.financial_changes(organization_id,franchise_id,id),
 CHECK((outcome='approved' AND reason='review_approved' AND financial_change_id IS NULL AND version=1)
 OR (outcome='rejected' AND reason='review_rejected' AND financial_change_id IS NULL AND version=1)
 OR (outcome='superseded' AND reason='request_amended' AND financial_change_id IS NULL AND version=1)
 OR (outcome='applied' AND reason='approved_change_applied' AND financial_change_id IS NOT NULL AND version=2))
);
CREATE FUNCTION shipit.guard_financial_request_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r shipit.financial_adjustment_requests;p shipit.financial_policy_revisions;prior text;
 c shipit.financial_changes;fv integer;pv integer;latest uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT * INTO r FROM shipit.financial_adjustment_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_REQUEST_NOT_FOUND' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.booking_obligations WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND booking_id=r.booking_id FOR UPDATE;
 SELECT outcome INTO prior FROM shipit.financial_request_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND request_id=r.id ORDER BY version DESC LIMIT 1;
 IF (NEW.version=1 AND prior IS NOT NULL) OR (NEW.version=2 AND prior IS DISTINCT FROM 'approved')
 THEN RAISE EXCEPTION 'FINANCIAL_REQUEST_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 IF NEW.outcome='superseded' THEN
  IF NEW.actor_id<>r.actor_id OR NOT EXISTS(SELECT 1 FROM shipit.financial_adjustment_requests n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.supersedes_id=r.id AND n.actor_id=r.actor_id AND n.creation_xid=pg_current_xact_id())
  THEN RAISE EXCEPTION 'FINANCIAL_AMENDMENT_CONFLICT' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.outcome IN ('approved','applied') THEN
  SELECT * INTO p FROM shipit.financial_policy_revisions WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND id=r.policy_id;
  SELECT id INTO latest FROM shipit.financial_policy_revisions WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id ORDER BY version DESC LIMIT 1;
  IF p.id IS NULL OR NOT p.enabled OR latest IS DISTINCT FROM p.id OR (NEW.outcome='approved' AND NOT p.allow_self_approval AND NEW.actor_id=r.actor_id)
  THEN RAISE EXCEPTION 'FINANCIAL_APPROVAL_POLICY_CONFLICT' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(max(sequence),0) INTO pv FROM shipit.payment_entries WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND booking_id=r.booking_id;
  SELECT COALESCE(max(version),0) INTO fv FROM shipit.financial_changes WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND booking_id=r.booking_id;
  IF NEW.outcome='approved' THEN
   IF fv<>r.expected_financial_version OR pv<>r.expected_payment_version THEN RAISE EXCEPTION 'FINANCIAL_REQUEST_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO c FROM shipit.financial_changes WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND id=NEW.financial_change_id;
   IF c.id IS NULL OR c.booking_id<>r.booking_id OR c.actor_id<>NEW.actor_id OR c.approval_ref<>r.id::text OR c.version<>r.expected_financial_version+1
    OR c.payment_version<>r.expected_payment_version OR fv<>c.version OR pv<>c.payment_version
    OR ROW(c.kind,c.reason,c.pre_tax,c.taxable,c.cgst,c.sgst,c.igst,c.rounding,c.refund,c.refund_correction_of)
     IS DISTINCT FROM ROW(r.kind,r.reason,r.pre_tax,r.taxable,r.cgst,r.sgst,r.igst,r.rounding,r.refund,r.refund_correction_of)
   THEN RAISE EXCEPTION 'FINANCIAL_APPLIED_SOURCE_CONFLICT' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW.recorded_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER financial_request_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.financial_request_decisions
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_request_decision();

CREATE FUNCTION shipit.guard_financial_amendment_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.financial_request_decisions d WHERE d.organization_id=NEW.organization_id AND d.franchise_id=NEW.franchise_id AND d.request_id=NEW.supersedes_id AND d.outcome='superseded' AND d.actor_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'FINANCIAL_AMENDMENT_INCOMPLETE' USING ERRCODE='23514'; END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER financial_amendment_complete AFTER INSERT ON shipit.financial_adjustment_requests
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_amendment_complete();
REVOKE ALL ON FUNCTION shipit.guard_financial_amendment_complete() FROM PUBLIC;
CREATE TABLE shipit.financial_refund_evidence (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),source_account_id uuid NOT NULL,source_revision_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','upi','bank_transfer','card','other')),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 returned_to_ref text NOT NULL CHECK(returned_to_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
 transfer_ref text NOT NULL CHECK(transfer_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,request_id),
 UNIQUE(organization_id,franchise_id,source_account_id,method,transfer_ref),
 FOREIGN KEY(organization_id,franchise_id,id) REFERENCES shipit.financial_changes(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.financial_adjustment_requests(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,source_account_id,source_revision_id) REFERENCES shipit.receiving_account_revisions(organization_id,franchise_id,account_id,id)
);
CREATE FUNCTION shipit.guard_financial_refund_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.financial_changes;a shipit.receiving_account_revisions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT * INTO c FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.id;
 SELECT * INTO a FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.source_account_id ORDER BY version DESC LIMIT 1;
 IF c.id IS NULL OR c.kind<>'refund' OR c.actor_id<>NEW.actor_id OR c.approval_ref<>NEW.request_id::text OR c.returned_to_ref<>NEW.returned_to_ref
  OR a.id IS NULL OR a.id<>NEW.source_revision_id OR NOT a.active OR NOT (NEW.method=ANY(a.methods)) OR NEW.occurred_at>clock_timestamp()
 THEN RAISE EXCEPTION 'FINANCIAL_REFUND_EVIDENCE_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER financial_refund_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.financial_refund_evidence
 FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_refund_evidence();
CREATE FUNCTION shipit.guard_financial_workflow_effect_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 -- Disabling configured workflow writes must not reopen the manual legacy path.
 IF EXISTS(SELECT 1 FROM shipit.financial_policy_revisions p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id) AND (NOT EXISTS(SELECT 1 FROM shipit.financial_request_decisions d WHERE d.organization_id=NEW.organization_id AND d.franchise_id=NEW.franchise_id AND d.financial_change_id=NEW.id AND d.outcome='applied')
  OR (NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM shipit.financial_refund_evidence e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.id=NEW.id)))
 THEN RAISE EXCEPTION 'FINANCIAL_WORKFLOW_EFFECT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER financial_workflow_effect_complete AFTER INSERT ON shipit.financial_changes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_workflow_effect_complete();
REVOKE ALL ON shipit.financial_refund_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_financial_refund_evidence(),shipit.guard_financial_workflow_effect_complete() FROM PUBLIC;


CREATE TABLE shipit.financial_document_links (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,request_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 10),
 kind text NOT NULL CHECK(kind IN ('issued_receipt','external_invoice','external_credit_note')),
 receipt_id uuid,external_ref text CHECK(external_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
 PRIMARY KEY(organization_id,franchise_id,request_id,ordinal),
 FOREIGN KEY(organization_id,franchise_id,booking_id,request_id) REFERENCES shipit.financial_adjustment_requests(organization_id,franchise_id,booking_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,receipt_id) REFERENCES shipit.issued_receipts(organization_id,franchise_id,booking_id,id),
 CHECK((kind='issued_receipt' AND receipt_id IS NOT NULL AND external_ref IS NULL) OR (kind<>'issued_receipt' AND receipt_id IS NULL AND external_ref IS NOT NULL))
);
CREATE FUNCTION shipit.guard_financial_document_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE original xid8;next_ordinal integer;
BEGIN
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT creation_xid INTO original FROM shipit.financial_adjustment_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.request_id;
 SELECT COALESCE(max(ordinal),0)+1 INTO next_ordinal FROM shipit.financial_document_links WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND request_id=NEW.request_id;
 IF original IS DISTINCT FROM pg_current_xact_id() OR NEW.ordinal<>next_ordinal THEN RAISE EXCEPTION 'FINANCIAL_DOCUMENT_LINK_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER financial_document_link_insert_guard BEFORE INSERT ON shipit.financial_document_links FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_document_link();
REVOKE ALL ON FUNCTION shipit.guard_financial_document_link() FROM PUBLIC;
CREATE TRIGGER financial_document_link_immutable BEFORE UPDATE OR DELETE ON shipit.financial_document_links
 FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
REVOKE ALL ON shipit.financial_document_links FROM PUBLIC;
CREATE TABLE shipit.financial_deletion_denials (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,actor_id,correlation_id),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.financial_adjustment_requests(organization_id,franchise_id,id)
);
CREATE TRIGGER financial_deletion_denial_immutable BEFORE UPDATE OR DELETE ON shipit.financial_deletion_denials
 FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
REVOKE ALL ON shipit.financial_deletion_denials FROM PUBLIC;

CREATE OR REPLACE FUNCTION shipit.guard_financial_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE b shipit.bookings; a record; net numeric; pv integer; gross numeric;original shipit.financial_changes;corrected numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id FOR UPDATE;
 SELECT * INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 SELECT COALESCE(sum(pre_tax),0) pre_tax,COALESCE(sum(taxable),0) taxable,COALESCE(sum(cgst),0) cgst,COALESCE(sum(sgst),0) sgst,COALESCE(sum(igst),0) igst,COALESCE(sum(rounding),0) rounding,COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) refund,COALESCE(max(version),0) version
 INTO a FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0),COALESCE(max(sequence),0) INTO net,pv FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 gross=b.final_payable_paise-a.pre_tax-a.cgst-a.sgst-a.igst-a.rounding;
 IF b.id IS NULL OR NEW.version<>a.version+1 OR NEW.payment_version<>pv THEN RAISE EXCEPTION 'FINANCIAL_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 IF NEW.kind='refund_correction' THEN
  SELECT * INTO original FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.refund_correction_of AND kind='refund';
  SELECT COALESCE(sum(refund),0) INTO corrected FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND refund_correction_of=NEW.refund_correction_of AND kind='refund_correction';
  IF original.id IS NULL OR NEW.refund>original.refund-corrected OR NEW.refund>a.refund THEN RAISE EXCEPTION 'FINANCIAL_REFUND_CORRECTION_EXCEEDED' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='refund' THEN
  IF NEW.refund>greatest(net-a.refund-gross,0) THEN RAISE EXCEPTION 'FINANCIAL_REFUND_EXCEEDED' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.pre_tax+a.pre_tax>(b.tax_snapshot->>'pre_tax_paise')::numeric OR NEW.taxable+a.taxable>(b.tax_snapshot->>'taxable_basis_paise')::numeric
   OR NEW.pre_tax-NEW.taxable+a.pre_tax-a.taxable>(b.tax_snapshot->>'pre_tax_paise')::numeric-(b.tax_snapshot->>'taxable_basis_paise')::numeric
   OR NEW.cgst+a.cgst>(b.tax_snapshot->>'cgst_paise')::numeric OR NEW.sgst+a.sgst>(b.tax_snapshot->>'sgst_paise')::numeric OR NEW.igst+a.igst>(b.tax_snapshot->>'igst_paise')::numeric
   OR abs((b.tax_snapshot->>'rounding_adjustment_paise')::numeric-a.rounding-NEW.rounding)>99
   OR NEW.pre_tax+NEW.cgst+NEW.sgst+NEW.igst+NEW.rounding>gross
   OR (NEW.kind='cancellation' AND (NEW.pre_tax+NEW.cgst+NEW.sgst+NEW.igst+NEW.rounding<>gross
    OR NEW.pre_tax+a.pre_tax<>(b.tax_snapshot->>'pre_tax_paise')::numeric OR NEW.taxable+a.taxable<>(b.tax_snapshot->>'taxable_basis_paise')::numeric
    OR NEW.cgst+a.cgst<>(b.tax_snapshot->>'cgst_paise')::numeric OR NEW.sgst+a.sgst<>(b.tax_snapshot->>'sgst_paise')::numeric
    OR NEW.igst+a.igst<>(b.tax_snapshot->>'igst_paise')::numeric OR NEW.rounding+a.rounding<>(b.tax_snapshot->>'rounding_adjustment_paise')::numeric))
  THEN RAISE EXCEPTION 'FINANCIAL_ADJUSTMENT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.occurred_at=clock_timestamp();RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.payment_result(org uuid,franchise uuid,entry uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_set(old.result,'{payment}',(old.result->'payment')||jsonb_build_object('gross_paise',v.gross,'collected_paise',v.net,'outstanding_paise',greatest(v.gross-v.net,0),
 'state',CASE WHEN v.net>=v.gross THEN 'settled' WHEN v.net=0 THEN 'uncollected' ELSE 'partially_collected' END)||CASE WHEN v.net>v.gross THEN jsonb_build_object('refundable_credit_paise',v.net-v.gross) ELSE '{}'::jsonb END)
 FROM shipit.payment_entries e CROSS JOIN LATERAL (SELECT shipit.payment_result_before_finance(org,franchise,entry) result) old
 CROSS JOIN LATERAL (SELECT COALESCE(sum(c.pre_tax+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refund FROM shipit.financial_changes c
 WHERE c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.booking_id=e.booking_id AND c.payment_version<e.sequence) a
 CROSS JOIN LATERAL (SELECT (old.result->'payment'->>'gross_paise')::numeric-a.reduction gross,(old.result->'payment'->>'collected_paise')::numeric-a.refund net) v
 WHERE e.organization_id=org AND e.franchise_id=franchise AND e.id=entry
$fn$;
CREATE OR REPLACE FUNCTION shipit.guard_payment_finance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE gross numeric;net numeric;refunds numeric;
BEGIN
 SELECT total_paise INTO gross FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.obligation_id FOR UPDATE;
 SELECT gross-COALESCE(sum(pre_tax+cgst+sgst+igst+rounding),0),COALESCE(sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END),0) INTO gross,refunds FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0)-refunds INTO net FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 IF (NEW.kind='collection' AND net+NEW.amount_paise>gross) OR (NEW.kind='reversal' AND net-NEW.amount_paise<0) THEN RAISE EXCEPTION 'FINANCIAL_PAYMENT_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
-- Immutable workflow sources are the durable safe audit facts; never expose refund references.
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'financial_request:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'financial.request','financial_request',id,'success',reason,correlation_id,recorded_at,NULL,NULL,1,NULL FROM shipit.financial_adjustment_requests
 UNION ALL SELECT 'financial_decision:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'financial.'||outcome,'financial_request',request_id,'success',reason,correlation_id,recorded_at,NULL,NULL,version,NULL FROM shipit.financial_request_decisions
 UNION ALL SELECT 'financial_policy:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'financial.policy.configure','financial_policy',id,'success','financial_policy_revision',correlation_id,recorded_at,NULL,NULL,version,NULL FROM shipit.financial_policy_revisions
 UNION ALL SELECT 'financial_delete_denial:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'financial.delete.denied','financial_request',request_id,'denied','deletion_not_permitted',correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.financial_deletion_denials
 UNION ALL SELECT 'financial_refund_evidence:'||e.id::text,e.organization_id,ARRAY[e.franchise_id],'user',e.actor_id::text,
 'financial.refund.record','financial_change',e.id,'success','customer_refund',c.correlation_id,e.recorded_at,NULL,NULL,c.version,NULL
 FROM shipit.financial_refund_evidence e JOIN shipit.financial_changes c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.id$view$;
END $extend$;
REVOKE ALL ON shipit.financial_policy_revisions,shipit.financial_adjustment_requests,shipit.financial_request_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_financial_policy_revision(),shipit.guard_financial_request(),shipit.guard_financial_request_decision() FROM PUBLIC;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
