exports.up = pgm => pgm.sql(`
CREATE TABLE shipit.financial_changes (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),version integer NOT NULL CHECK(version BETWEEN 1 AND 100),payment_version integer NOT NULL CHECK(payment_version>=0),
 kind text NOT NULL CHECK(kind IN ('discount','cancellation','correction','refund')),
 reason text NOT NULL CHECK(reason IN ('customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund')),
 approval_ref text NOT NULL CHECK(approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
 pre_tax bigint NOT NULL DEFAULT 0 CHECK(pre_tax>=0),taxable bigint NOT NULL DEFAULT 0 CHECK(taxable>=0 AND taxable<=pre_tax),
 cgst bigint NOT NULL DEFAULT 0 CHECK(cgst>=0),sgst bigint NOT NULL DEFAULT 0 CHECK(sgst>=0),igst bigint NOT NULL DEFAULT 0 CHECK(igst>=0),
 rounding bigint NOT NULL DEFAULT 0 CHECK(rounding BETWEEN -99 AND 99),refund bigint NOT NULL DEFAULT 0 CHECK(refund>=0),
 returned_to_ref text CHECK(returned_to_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,franchise_id,actor_id,key_digest),UNIQUE(organization_id,franchise_id,booking_id,version),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id),
 CHECK((kind='refund' AND refund>0 AND returned_to_ref IS NOT NULL AND pre_tax+taxable+cgst+sgst+igst+abs(rounding)=0)
 OR (kind<>'refund' AND refund=0 AND returned_to_ref IS NULL AND pre_tax+cgst+sgst+igst+rounding>0))
);
CREATE FUNCTION shipit.guard_financial_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE b shipit.bookings; a record; net numeric; pv integer; gross numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id FOR UPDATE;
 SELECT * INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 SELECT COALESCE(sum(pre_tax),0) pre_tax,COALESCE(sum(taxable),0) taxable,COALESCE(sum(cgst),0) cgst,COALESCE(sum(sgst),0) sgst,COALESCE(sum(igst),0) igst,COALESCE(sum(rounding),0) rounding,COALESCE(sum(refund),0) refund,COALESCE(max(version),0) version
 INTO a FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0),COALESCE(max(sequence),0) INTO net,pv FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 gross=b.final_payable_paise-a.pre_tax-a.cgst-a.sgst-a.igst-a.rounding;
 IF b.id IS NULL OR NEW.version<>a.version+1 OR NEW.payment_version<>pv THEN RAISE EXCEPTION 'FINANCIAL_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 IF NEW.kind='refund' THEN
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
CREATE TRIGGER financial_change_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.financial_changes FOR EACH ROW EXECUTE FUNCTION shipit.guard_financial_change();
REVOKE ALL ON FUNCTION shipit.guard_financial_change() FROM PUBLIC;

CREATE TABLE shipit.account_statements (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,customer_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 from_day date NOT NULL,to_day date NOT NULL,CHECK(to_day>=from_day AND to_day-from_day<31),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=8388608),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id)
);
CREATE TABLE shipit.account_statement_lines (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,statement_id uuid NOT NULL,booking_id uuid NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,booking_id),
 FOREIGN KEY(organization_id,franchise_id,statement_id) REFERENCES shipit.account_statements(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.guard_statement_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.account_statements s JOIN shipit.bookings b ON b.organization_id=s.organization_id AND b.franchise_id=s.franchise_id AND b.customer_id=s.customer_id
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.id=NEW.statement_id AND b.id=NEW.booking_id
 AND b.confirmed_at >= s.from_day::timestamp AT TIME ZONE 'Asia/Kolkata' AND b.confirmed_at < (s.to_day+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
 THEN RAISE EXCEPTION 'STATEMENT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER statement_line_guard BEFORE INSERT ON shipit.account_statement_lines FOR EACH ROW EXECUTE FUNCTION shipit.guard_statement_line();
CREATE TRIGGER statement_immutable BEFORE UPDATE OR DELETE ON shipit.account_statements FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
CREATE TRIGGER statement_line_immutable BEFORE UPDATE OR DELETE ON shipit.account_statement_lines FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
REVOKE ALL ON FUNCTION shipit.guard_statement_line() FROM PUBLIC;
CREATE TABLE shipit.financial_access_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 resource_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('financial.read','statement.read')),
 correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TRIGGER financial_access_immutable BEFORE UPDATE OR DELETE ON shipit.financial_access_events FOR EACH ROW EXECUTE FUNCTION shipit.carrier_append_only();
REVOKE ALL ON shipit.financial_access_events FROM PUBLIC;
REVOKE ALL ON shipit.financial_changes,shipit.account_statements,shipit.account_statement_lines FROM PUBLIC;
-- Preserve historical command receipts using ledger order, independent of clock skew.
ALTER FUNCTION shipit.payment_result(uuid,uuid,uuid) RENAME TO payment_result_before_finance;
CREATE FUNCTION shipit.payment_result(org uuid,franchise uuid,entry uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_set(old.result,'{payment}',(old.result->'payment')||jsonb_build_object('gross_paise',v.gross,'collected_paise',v.net,'outstanding_paise',greatest(v.gross-v.net,0),
 'state',CASE WHEN v.net>=v.gross THEN 'settled' WHEN v.net=0 THEN 'uncollected' ELSE 'partially_collected' END)||CASE WHEN v.net>v.gross THEN jsonb_build_object('refundable_credit_paise',v.net-v.gross) ELSE '{}'::jsonb END)
 FROM shipit.payment_entries e CROSS JOIN LATERAL (SELECT shipit.payment_result_before_finance(org,franchise,entry) result) old
 CROSS JOIN LATERAL (SELECT COALESCE(sum(c.pre_tax+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,COALESCE(sum(c.refund),0) refund FROM shipit.financial_changes c
 WHERE c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.booking_id=e.booking_id AND c.payment_version<e.sequence) a
 CROSS JOIN LATERAL (SELECT (old.result->'payment'->>'gross_paise')::numeric-a.reduction gross,(old.result->'payment'->>'collected_paise')::numeric-a.refund net) v
 WHERE e.organization_id=org AND e.franchise_id=franchise AND e.id=entry
$fn$;
REVOKE ALL ON FUNCTION shipit.payment_result(uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION shipit.guard_payment_finance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE gross numeric;net numeric;refunds numeric;
BEGIN
 SELECT total_paise INTO gross FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.obligation_id FOR UPDATE;
 SELECT gross-COALESCE(sum(pre_tax+cgst+sgst+igst+rounding),0),COALESCE(sum(refund),0) INTO gross,refunds FROM shipit.financial_changes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 SELECT COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0)-refunds INTO net FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id;
 IF (NEW.kind='collection' AND net+NEW.amount_paise>gross) OR (NEW.kind='reversal' AND net-NEW.amount_paise<0) THEN RAISE EXCEPTION 'FINANCIAL_PAYMENT_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER payment_finance_guard BEFORE INSERT ON shipit.payment_entries FOR EACH ROW EXECUTE FUNCTION shipit.guard_payment_finance();
REVOKE ALL ON FUNCTION shipit.guard_payment_finance() FROM PUBLIC;
DO $extend$ DECLARE source text; BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\\n ')||$view$
 UNION ALL SELECT 'financial:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'financial.'||kind,'booking',booking_id,'success',reason,correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.financial_changes
 UNION ALL SELECT 'statement:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'statement.issue','account_statement',id,'success','statement_issued',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.account_statements
 UNION ALL SELECT 'financial_access:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 action,CASE WHEN action='statement.read' THEN 'account_statement' ELSE 'booking' END,resource_id,'success','financial_access',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.financial_access_events$view$;
END $extend$;
`);
exports.down = () => { throw new Error('Forward-only migration'); };
