exports.up=pgm=>pgm.sql(`
ALTER TABLE shipit.account_statements
 ADD COLUMN account_id uuid,
 ADD COLUMN previous_statement_id uuid,
 ADD COLUMN revision integer,
 ADD COLUMN source_digest text,
 ADD CONSTRAINT statement_account_fk FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.customer_accounts(organization_id,franchise_id,id),
 ADD CONSTRAINT statement_previous_fk FOREIGN KEY(organization_id,franchise_id,previous_statement_id) REFERENCES shipit.account_statements(organization_id,franchise_id,id),
 ADD CONSTRAINT statement_account_version UNIQUE(organization_id,franchise_id,account_id,revision),
 ADD CONSTRAINT statement_account_shape CHECK((account_id IS NULL AND revision IS NULL AND source_digest IS NULL AND previous_statement_id IS NULL) OR
 (account_id IS NOT NULL AND revision IS NOT NULL AND revision>0 AND source_digest IS NOT NULL AND source_digest ~ '^[a-f0-9]{64}$' AND snapshot->>'kind' IS NOT DISTINCT FROM 'account_statement_v2'));
CREATE INDEX statement_account_history ON shipit.account_statements(organization_id,franchise_id,account_id,revision DESC);
CREATE INDEX statement_source_lines ON shipit.account_statement_lines(organization_id,franchise_id,statement_id);
CREATE FUNCTION shipit.guard_account_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous shipit.account_statements; debtor uuid;
BEGIN
 IF NEW.account_id IS NULL THEN RETURN NEW; END IF;
 SELECT debtor_customer_id INTO debtor FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO previous FROM shipit.account_statements WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY revision DESC LIMIT 1;
 IF debtor IS DISTINCT FROM NEW.customer_id OR NEW.revision<>COALESCE(previous.revision,0)+1 OR NEW.previous_statement_id IS DISTINCT FROM previous.id
 OR NEW.snapshot->>'account_id' IS DISTINCT FROM NEW.account_id::text OR NEW.snapshot->>'id' IS DISTINCT FROM NEW.id::text
 OR NEW.snapshot->>'customer_id' IS DISTINCT FROM NEW.customer_id::text OR NEW.snapshot->>'version' IS DISTINCT FROM NEW.revision::text
 OR NEW.snapshot->>'previous_statement_id' IS DISTINCT FROM NEW.previous_statement_id::text OR NEW.snapshot->>'source_digest' IS DISTINCT FROM NEW.source_digest
 THEN RAISE EXCEPTION 'STATEMENT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER account_statement_guard BEFORE INSERT ON shipit.account_statements FOR EACH ROW EXECUTE FUNCTION shipit.guard_account_statement();
REVOKE ALL ON FUNCTION shipit.guard_account_statement() FROM PUBLIC;
CREATE OR REPLACE FUNCTION shipit.guard_statement_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.account_statements s JOIN shipit.bookings b ON b.organization_id=s.organization_id AND b.franchise_id=s.franchise_id
 LEFT JOIN shipit.customer_account_bookings ab ON ab.organization_id=b.organization_id AND ab.franchise_id=b.franchise_id AND ab.booking_id=b.id
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.id=NEW.statement_id AND b.id=NEW.booking_id
 AND ((s.account_id IS NULL AND b.customer_id=s.customer_id AND b.confirmed_at>=s.from_day::timestamp AT TIME ZONE 'Asia/Kolkata')
 OR (s.account_id=ab.account_id AND ab.debtor_customer_id=s.customer_id))
 AND b.confirmed_at<(s.to_day+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
 THEN RAISE EXCEPTION 'STATEMENT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;RETURN NEW;
END $fn$;
CREATE TABLE shipit.advance_refund_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,request_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 3),operation text NOT NULL CHECK(operation IN ('request','approve','reject','return')),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=4096),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),receipt_version integer NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),source_account_id uuid,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,request_id,version),
 UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id,receipt_id) REFERENCES shipit.money_receipts(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.advance_refund_commands(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,source_account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id),
 CHECK((operation='return')=(source_account_id IS NOT NULL))
);
CREATE INDEX advance_refund_receipt ON shipit.advance_refund_commands(organization_id,franchise_id,receipt_id,id);
CREATE UNIQUE INDEX advance_refund_transfer_once ON shipit.advance_refund_commands(organization_id,franchise_id,source_account_id,(input->>'method'),(input->>'transfer_ref')) WHERE operation='return';
CREATE FUNCTION shipit.guard_advance_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r shipit.money_receipts;root shipit.advance_refund_commands;head shipit.advance_refund_commands;
 allocated numeric;cod numeric;returned numeric;location shipit.cash_location_revisions;account shipit.receiving_account_revisions;
 available numeric;pending numeric;unknown_refund numeric;admin boolean;operator boolean;lifecycle_state text;location_kind text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ADVANCE_REFUND_IMMUTABLE' USING ERRCODE='23514';END IF;
 SELECT f.lifecycle INTO lifecycle_state FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id AND o.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.id=NEW.franchise_id FOR UPDATE OF f;
 IF lifecycle_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'ADVANCE_REFUND_DISABLED' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'ADVANCE_REFUND_NOT_FOUND' USING ERRCODE='42501';END IF;
 SELECT COALESCE(bool_or(m.role='franchise_admin'),false),COALESCE(bool_or(m.role='operator'),false) INTO admin,operator
 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active';
 IF NOT admin AND (NEW.operation<>'request' OR NOT operator) THEN RAISE EXCEPTION 'ADVANCE_REFUND_ROLE' USING ERRCODE='42501';END IF;
 SELECT COALESCE(max(version),0) INTO NEW.receipt_version FROM shipit.money_receipt_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=r.id AND state='committed';
 NEW.recorded_at=clock_timestamp();
 NEW.source_account_id=NULL;
 IF NEW.operation='request' THEN
  IF NEW.id<>NEW.request_id OR NEW.version<>1 OR NEW.input-ARRAY['amount_paise','expected_receipt_version','reason']<>'{}'::jsonb
   OR NOT (NEW.input ?& ARRAY['amount_paise','expected_receipt_version','reason'])
   OR (NEW.input->>'expected_receipt_version')::integer IS DISTINCT FROM NEW.receipt_version
   OR (NEW.input->>'amount_paise')::bigint IS DISTINCT FROM NEW.amount_paise
  THEN RAISE EXCEPTION 'ADVANCE_REFUND_VERSION' USING ERRCODE='40001';END IF;
 ELSE
  SELECT * INTO root FROM shipit.advance_refund_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id AND receipt_id=r.id AND operation='request';
  SELECT * INTO head FROM shipit.advance_refund_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND request_id=NEW.request_id ORDER BY version DESC LIMIT 1;
  IF root.id IS NULL OR head.version IS DISTINCT FROM (NEW.input->>'expected_version')::integer OR NEW.version<>head.version+1
   OR NEW.amount_paise<>root.amount_paise THEN RAISE EXCEPTION 'ADVANCE_REFUND_VERSION' USING ERRCODE='40001';END IF;
  IF NEW.operation IN ('approve','reject') THEN
   IF head.operation<>'request' OR root.actor_id=NEW.actor_id OR NEW.input-ARRAY['expected_version','reason']<>'{}'::jsonb
    OR NOT (NEW.input ?& ARRAY['expected_version','reason'])
   THEN RAISE EXCEPTION 'ADVANCE_REFUND_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
  ELSE
   IF head.operation<>'approve' OR NEW.input-ARRAY['expected_version','source_location_id','source_revision_id','method','occurred_at','transfer_ref','returned_to_ref','reason']<>'{}'::jsonb
    OR NOT (NEW.input ?& ARRAY['expected_version','source_location_id','source_revision_id','method','occurred_at','transfer_ref','returned_to_ref','reason'])
   THEN RAISE EXCEPTION 'ADVANCE_REFUND_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
   SELECT * INTO location FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=(NEW.input->>'source_location_id')::uuid ORDER BY version DESC LIMIT 1;
   SELECT kind INTO location_kind FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=location.location_id;
   SELECT * INTO account FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=location.account_id ORDER BY version DESC LIMIT 1;
   IF location.id IS NULL OR NOT location.active OR NOT account.active OR location.id IS DISTINCT FROM (NEW.input->>'source_revision_id')::uuid
    OR NOT (NEW.input->>'method'=ANY(account.methods)) OR (location_kind='cash') IS DISTINCT FROM (NEW.input->>'method'='cash')
    OR NOT isfinite((NEW.input->>'occurred_at')::timestamptz) OR (NEW.input->>'occurred_at')::timestamptz>NEW.recorded_at
    OR NEW.input->>'occurred_at' IS NULL OR NEW.input->>'transfer_ref' IS NULL
    OR NEW.input->>'returned_to_ref' IS NULL
    OR (NEW.input->>'occurred_at')::timestamptz<root.recorded_at
    OR NEW.input->>'transfer_ref' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'
    OR NEW.input->>'returned_to_ref' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'
   THEN RAISE EXCEPTION 'ADVANCE_REFUND_EVIDENCE_INVALID' USING ERRCODE='23514';END IF;
   NEW.source_account_id=location.account_id;
   IF EXISTS(SELECT 1 FROM shipit.advance_refund_commands f WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.source_account_id=location.account_id AND f.operation='return' AND f.input->>'method'=NEW.input->>'method' AND f.input->>'transfer_ref'=NEW.input->>'transfer_ref')
    OR EXISTS(SELECT 1 FROM shipit.financial_refund_evidence f WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.source_account_id=location.account_id AND f.method=NEW.input->>'method' AND f.transfer_ref=NEW.input->>'transfer_ref')
   THEN RAISE EXCEPTION 'FINANCIAL_REFUND_REFERENCE_CONFLICT' USING ERRCODE='P0142';END IF;
   SELECT recorded,reserved,c.unknown_refund INTO available,pending,unknown_refund FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,location.location_id,NULL) c;
   IF available-pending<NEW.amount_paise OR unknown_refund>0 THEN RAISE EXCEPTION 'ADVANCE_REFUND_CUSTODY_CAPACITY' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 IF length(NEW.input->>'reason') NOT BETWEEN 3 AND 500 OR NEW.input->>'reason' IS NULL OR NEW.input->>'reason' ~ '[\\x01-\\x1f\\x7f-\\x9f]'
 THEN RAISE EXCEPTION 'ADVANCE_REFUND_REASON' USING ERRCODE='23514';END IF;
 IF NEW.operation IN ('request','return') THEN
  SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO allocated FROM shipit.money_receipt_allocations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=r.id;
  SELECT COALESCE(sum(reserved_paise),0) INTO cod FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=r.id;
  SELECT COALESCE(sum(amount_paise::numeric),0) INTO returned FROM shipit.advance_refund_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=r.id AND operation='return';
  IF allocated+cod+returned+NEW.amount_paise>r.amount_paise THEN RAISE EXCEPTION 'ADVANCE_REFUND_CAPACITY' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.operation='return' THEN
  INSERT INTO shipit.cashbook_source_versions(organization_id,franchise_id,version) VALUES(NEW.organization_id,NEW.franchise_id,1)
  ON CONFLICT(organization_id,franchise_id) DO UPDATE SET version=shipit.cashbook_source_versions.version+1;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER advance_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.advance_refund_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_advance_refund();
CREATE FUNCTION shipit.guard_booking_advance_refund_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM shipit.advance_refund_commands f WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.source_account_id=NEW.source_account_id AND f.operation='return' AND f.input->>'method'=NEW.method AND f.input->>'transfer_ref'=NEW.transfer_ref)
 THEN RAISE EXCEPTION 'FINANCIAL_REFUND_REFERENCE_CONFLICT' USING ERRCODE='P0142';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER aaa_advance_refund_reference BEFORE INSERT ON shipit.financial_refund_evidence FOR EACH ROW EXECUTE FUNCTION shipit.guard_booking_advance_refund_reference();
-- Both freight and seller COD producers share receipt/franchise locks with actual returns.
CREATE FUNCTION shipit.guard_receipt_return_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE total numeric;allocated numeric;cod numeric;returned numeric;
BEGIN
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT amount_paise INTO total FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
 IF TG_TABLE_NAME='money_receipt_allocations' THEN IF NEW.kind='release' THEN RETURN NEW;END IF;END IF;
 SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO allocated FROM shipit.money_receipt_allocations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
 SELECT COALESCE(sum(reserved_paise),0) INTO cod FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
 SELECT COALESCE(sum(amount_paise::numeric),0) INTO returned FROM shipit.advance_refund_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id AND operation='return';
 IF total IS NULL OR allocated+cod+returned+NEW.amount_paise>total THEN RAISE EXCEPTION 'ADVANCE_REFUND_CAPACITY' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER aab_receipt_return_capacity BEFORE INSERT ON shipit.money_receipt_allocations FOR EACH ROW EXECUTE FUNCTION shipit.guard_receipt_return_capacity();
CREATE TRIGGER aaa_cod_return_capacity BEFORE INSERT ON shipit.cod_receipt_allocations FOR EACH ROW EXECUTE FUNCTION shipit.guard_receipt_return_capacity();
-- Historical command results stay byte-for-byte stable; only subsequent receipt versions include returns.
-- Keep the existing function identity/privileges and one SQL evaluation per result.
CREATE OR REPLACE FUNCTION shipit.money_receipt_result(org uuid,franchise uuid,command uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('receipt_id',r.id,'customer_id',r.customer_id,'version',c.version,'currency','INR','received_paise',r.amount_paise,
 'allocated_paise',n.net,'unallocated_paise',r.amount_paise-n.net-f.amount,'allocations',COALESCE(items.rows,'[]'::jsonb))
 || CASE WHEN f.amount=0 THEN '{}'::jsonb ELSE jsonb_build_object('returned_paise',f.amount) END
 FROM shipit.money_receipt_commands c JOIN shipit.money_receipts r ON r.organization_id=c.organization_id AND r.franchise_id=c.franchise_id AND r.id=c.receipt_id
 CROSS JOIN LATERAL(SELECT COALESCE(sum(CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END),0) net
  FROM shipit.money_receipt_allocations a WHERE a.organization_id=org AND a.franchise_id=franchise AND a.receipt_id=r.id AND a.command_version<=c.version) n
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',a.id,'booking_id',a.booking_id,'payment_entry_id',a.payment_entry_id,'kind',a.kind,'amount_paise',a.amount_paise,'release_of',a.release_of) ORDER BY a.booking_id) rows
  FROM shipit.money_receipt_allocations a WHERE a.organization_id=org AND a.franchise_id=franchise AND a.command_id=c.id) items
 CROSS JOIN LATERAL(SELECT COALESCE(sum(f.amount_paise::numeric),0) amount FROM shipit.advance_refund_commands f WHERE f.organization_id=org AND f.franchise_id=franchise AND f.receipt_id=c.receipt_id AND f.operation='return' AND f.receipt_version<c.version) f
 WHERE c.organization_id=org AND c.franchise_id=franchise AND c.id=command
$fn$;
DO $views$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.cashbook_source_facts'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.cashbook_source_facts AS '||rtrim(source,E';\\n ')||$view$
 UNION ALL SELECT f.organization_id,f.franchise_id,'refund',f.id,l.id,l.account_id,'out',f.amount_paise,
 (f.input->>'occurred_at')::timestamptz,f.recorded_at,f.actor_id,f.request_id,NULL::uuid,NULL::text,f.input->>'method'
 FROM shipit.advance_refund_commands f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=(f.input->>'source_location_id')::uuid WHERE f.operation='return'
 $view$;
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\\n ')||$view$
 UNION ALL SELECT 'advance-refund:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 'money_receipts.refund.'||operation,'money_receipt',receipt_id,'success','advance_refund_'||operation,
 correlation_id,recorded_at,NULL,NULL,version,NULL FROM shipit.advance_refund_commands
 $view$;
 SELECT pg_get_viewdef('shipit.reconciliation_recorded_sources'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.reconciliation_recorded_sources AS '||rtrim(source,E';\\n ')||$view$
 UNION ALL SELECT f.organization_id,f.franchise_id,'advance_refund:'||f.id::text,'refund',f.id,f.id::text,l.account_id,
 'debit',f.amount_paise::numeric,'INR',f.input->>'method',f.input->>'transfer_ref',((f.input->>'occurred_at')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,f.recorded_at
 FROM shipit.advance_refund_commands f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=(f.input->>'source_location_id')::uuid WHERE f.operation='return' AND f.input->>'method'<>'cash'
 $view$;
END $views$;
REVOKE ALL ON shipit.advance_refund_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_advance_refund(),shipit.guard_receipt_return_capacity(),shipit.guard_booking_advance_refund_reference(),shipit.money_receipt_result(uuid,uuid,uuid) FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only migration');};
