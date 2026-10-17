// #146 optional evidence reconciliation. No ledger producer or historical verification backfill.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.reconciliation_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),action text NOT NULL CHECK(action IN ('configure','mapping','preview','import','resolve_row','batch','match','unmatch','classify','review')),
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 resource_id uuid NOT NULL,result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=1048576),
 correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,action,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.reconciliation_config_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 enabled boolean NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,version),UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_mapping_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,profile_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object' AND octet_length(mapping::text)<=8192),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,profile_id,version),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_imports (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,account_revision_id uuid NOT NULL,
 mapping_id uuid NOT NULL,period_from date NOT NULL CHECK(isfinite(period_from)),period_to date NOT NULL CHECK(isfinite(period_to) AND period_to>=period_from),
 file_sha256 text NOT NULL CHECK(file_sha256~'^[a-f0-9]{64}$'),rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 200 AND octet_length(rows::text)<=262144),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,account_id,account_revision_id) REFERENCES shipit.receiving_account_revisions(organization_id,franchise_id,account_id,id),
 FOREIGN KEY(organization_id,franchise_id,mapping_id) REFERENCES shipit.reconciliation_mapping_versions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_transactions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,currency text NOT NULL CHECK(currency='INR'),
 business_date date NOT NULL CHECK(isfinite(business_date)),direction text NOT NULL CHECK(direction IN ('credit','debit')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 external_reference text CHECK(length(external_reference) BETWEEN 1 AND 128),external_id text CHECK(length(external_id) BETWEEN 1 AND 128),
 identity_namespace text NOT NULL CHECK(identity_namespace~'^[A-Z][A-Z0-9_-]{0,47}$'),
 origin_import_id uuid NOT NULL,origin_row integer NOT NULL CHECK(origin_row BETWEEN 2 AND 201),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,origin_import_id,origin_row),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,origin_import_id) REFERENCES shipit.reconciliation_imports(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
-- A reused proven identity with another amount/account is a conflict, not a second transaction.
CREATE UNIQUE INDEX reconciliation_proven_identity ON shipit.reconciliation_transactions(organization_id,franchise_id,identity_namespace,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX reconciliation_transaction_account_date ON shipit.reconciliation_transactions(organization_id,franchise_id,account_id,business_date,id);
CREATE TABLE shipit.reconciliation_row_outcomes (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,import_id uuid NOT NULL,row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 201),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN ('imported','duplicate','needs_review','conflict','rejected')),
 transaction_id uuid,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),command_id uuid NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,import_id,row_number,version),
 CHECK((state IN ('imported','duplicate'))=(transaction_id IS NOT NULL)),
 FOREIGN KEY(organization_id,franchise_id,import_id) REFERENCES shipit.reconciliation_imports(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,transaction_id) REFERENCES shipit.reconciliation_transactions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
-- Canonical recorded sources: allocations never reduce original receipt inflow; refunds and expenses use correction heads.
CREATE VIEW shipit.reconciliation_recorded_sources AS
 WITH RECURSIVE cash_heads AS (
 SELECT r.organization_id,r.franchise_id,r.id root_id,r.id FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.correction_of IS NULL
 UNION ALL
 SELECT h.organization_id,h.franchise_id,h.root_id,r.id FROM cash_heads h JOIN shipit.cashbook_requests r ON r.organization_id=h.organization_id AND r.franchise_id=h.franchise_id AND r.correction_of=h.id JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 ),cash_current AS (
 SELECT h.root_id,r.*,e.recorded_at applied_at FROM cash_heads h JOIN shipit.cashbook_requests r ON r.organization_id=h.organization_id AND r.franchise_id=h.franchise_id AND r.id=h.id
 JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests n JOIN shipit.cashbook_effects ne ON ne.organization_id=n.organization_id AND ne.franchise_id=n.franchise_id AND ne.request_id=n.id WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.correction_of=r.id)
 )
 SELECT r.organization_id,r.franchise_id,'receipt:'||r.id::text id,'receipt'::text source_kind,r.id source_id,r.command_id::text version,r.account_id,
 'credit'::text direction,r.amount_paise::numeric amount_paise,'INR'::text currency,r.method,r.external_reference,(r.occurred_at AT TIME ZONE 'Asia/Kolkata')::date business_date,c.committed_at recorded_at
 FROM shipit.money_receipts r JOIN shipit.money_receipt_commands c ON c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.id=r.command_id AND c.state='committed' WHERE r.method<>'cash'
 UNION ALL
 SELECT c.organization_id,c.franchise_id,'refund:'||c.id::text,'refund',c.id,c.id::text||':'||COALESCE(x.version,0)::text,e.source_account_id,
 'debit',c.refund::numeric-COALESCE(x.corrected,0),'INR',e.method,e.transfer_ref,(e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date,GREATEST(c.occurred_at,x.recorded_at)
 FROM shipit.financial_changes c JOIN shipit.financial_refund_evidence e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.id=c.id
 LEFT JOIN LATERAL(SELECT sum(f.refund::numeric) corrected,max(f.version) version,max(f.occurred_at) recorded_at FROM shipit.financial_changes f WHERE f.organization_id=c.organization_id AND f.franchise_id=c.franchise_id AND f.refund_correction_of=c.id AND f.kind='refund_correction') x ON true
 WHERE c.kind='refund' AND e.method<>'cash'
 UNION ALL
 SELECT r.organization_id,r.franchise_id,'cashbook:'||r.root_id::text||':'||l.id::text,r.kind,r.root_id,r.id::text,l.account_id,
 CASE WHEN r.kind='owner_funds' OR l.id=r.target_location_id THEN 'credit' ELSE 'debit' END,r.amount_paise::numeric,'INR',r.payment_method,NULL::text,(r.occurred_at AT TIME ZONE 'Asia/Kolkata')::date,r.applied_at
 FROM cash_current r JOIN shipit.cash_locations l ON l.organization_id=r.organization_id AND l.franchise_id=r.franchise_id AND l.id IN (r.source_location_id,r.target_location_id) AND l.kind='noncash'
 WHERE r.kind IN ('expense','owner_funds','deposit','withdrawal');
CREATE TABLE shipit.reconciliation_batches (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,batch_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 account_id uuid NOT NULL,expected_date date NOT NULL CHECK(isfinite(expected_date)),reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 128),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 receipts jsonb NOT NULL CHECK(jsonb_typeof(receipts)='array' AND jsonb_array_length(receipts) BETWEEN 1 AND 100),fees jsonb NOT NULL CHECK(jsonb_typeof(fees)='array' AND jsonb_array_length(fees)<=100),
 command_id uuid NOT NULL,UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,batch_id,version),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_matches (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('exact','manual')),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),batch_id uuid,
 direction text NOT NULL CHECK(direction IN ('credit','debit')),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.receiving_accounts(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,batch_id) REFERENCES shipit.reconciliation_batches(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_match_transactions (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,match_id uuid NOT NULL,transaction_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,franchise_id,match_id,transaction_id),
 FOREIGN KEY(organization_id,franchise_id,match_id) REFERENCES shipit.reconciliation_matches(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,transaction_id) REFERENCES shipit.reconciliation_transactions(organization_id,franchise_id,id)
);
CREATE TABLE shipit.reconciliation_match_sources (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,match_id uuid NOT NULL,source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 source_version text NOT NULL CHECK(length(source_version) BETWEEN 1 AND 128),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),is_fee boolean NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,match_id,source_id),
 FOREIGN KEY(organization_id,franchise_id,match_id) REFERENCES shipit.reconciliation_matches(organization_id,franchise_id,id)
);
CREATE INDEX reconciliation_source_allocations ON shipit.reconciliation_match_sources(organization_id,franchise_id,source_id,match_id);
CREATE INDEX reconciliation_external_allocations ON shipit.reconciliation_match_transactions(organization_id,franchise_id,transaction_id,match_id);
CREATE TABLE shipit.reconciliation_unmatches (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,match_id uuid NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,match_id),
 FOREIGN KEY(organization_id,franchise_id,match_id) REFERENCES shipit.reconciliation_matches(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_classifications (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,transaction_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 classification text NOT NULL CHECK(classification IN ('unassigned','customer_payment','advance','owner_funds','transfer','fee','other')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,transaction_id,version),
 FOREIGN KEY(organization_id,franchise_id,transaction_id) REFERENCES shipit.reconciliation_transactions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.reconciliation_review_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,case_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 source_id text,transaction_id uuid,import_id uuid,row_number integer,
 state text NOT NULL CHECK(state IN ('open','resolved')),kind text NOT NULL CHECK(kind IN ('missing_payment','unexplained_credit','wrong_amount','identity_conflict','changed_source','other')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),command_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,case_id,version),
 CHECK(source_id IS NOT NULL OR transaction_id IS NOT NULL OR import_id IS NOT NULL),CHECK((import_id IS NULL)=(row_number IS NULL)),
 FOREIGN KEY(organization_id,franchise_id,transaction_id) REFERENCES shipit.reconciliation_transactions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,import_id) REFERENCES shipit.reconciliation_imports(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.reconciliation_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION shipit.guard_reconciliation_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='franchise_admin' OR m.role='accountant' AND NEW.action NOT IN ('configure','mapping','unmatch')))
 THEN RAISE EXCEPTION 'RECONCILIATION_ACTOR' USING ERRCODE='42501';END IF;
 IF NEW.action<>'configure' AND NOT COALESCE((SELECT enabled FROM shipit.reconciliation_config_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id ORDER BY version DESC LIMIT 1),false)
 THEN RAISE EXCEPTION 'RECONCILIATION_DISABLED' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_command_guard BEFORE INSERT ON shipit.reconciliation_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_command();
CREATE FUNCTION shipit.guard_reconciliation_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id FOR UPDATE;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 CASE TG_TABLE_NAME
 WHEN 'reconciliation_config_versions' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_config_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id;
 WHEN 'reconciliation_mapping_versions' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_mapping_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND profile_id=NEW.profile_id;
 WHEN 'reconciliation_row_outcomes' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_row_outcomes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND import_id=NEW.import_id AND row_number=NEW.row_number;
 WHEN 'reconciliation_batches' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_batches WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND batch_id=NEW.batch_id;
 WHEN 'reconciliation_classifications' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_classifications WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND transaction_id=NEW.transaction_id;
 WHEN 'reconciliation_review_revisions' THEN SELECT COALESCE(max(version),0) INTO previous FROM shipit.reconciliation_review_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND case_id=NEW.case_id;
 END CASE;
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'RECONCILIATION_VERSION' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE FUNCTION shipit.check_reconciliation_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE m shipit.reconciliation_matches;gross numeric;fees numeric;net numeric;source_count integer;external_count integer;
BEGIN
 IF TG_TABLE_NAME='reconciliation_matches' THEN
  SELECT * INTO m FROM shipit.reconciliation_matches WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.id;
 ELSE
  SELECT * INTO m FROM shipit.reconciliation_matches WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.match_id;
 END IF;
 PERFORM id FROM shipit.organizations WHERE id=m.organization_id FOR UPDATE;
 PERFORM id FROM shipit.franchises WHERE organization_id=m.organization_id AND id=m.franchise_id FOR UPDATE;
 SELECT count(*),COALESCE(sum(amount_paise) FILTER(WHERE NOT is_fee),0),COALESCE(sum(amount_paise) FILTER(WHERE is_fee),0) INTO source_count,gross,fees FROM shipit.reconciliation_match_sources WHERE organization_id=m.organization_id AND franchise_id=m.franchise_id AND match_id=m.id;
 SELECT count(*),COALESCE(sum(amount_paise),0) INTO external_count,net FROM shipit.reconciliation_match_transactions WHERE organization_id=m.organization_id AND franchise_id=m.franchise_id AND match_id=m.id;
 IF source_count NOT BETWEEN 1 AND 200 OR external_count NOT BETWEEN 1 AND 100 OR net<=0 OR gross<>net+fees OR fees>0 AND (m.direction<>'credit' OR m.batch_id IS NULL)
 THEN RAISE EXCEPTION 'RECONCILIATION_EQUATION' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM shipit.reconciliation_match_transactions a JOIN shipit.reconciliation_transactions t ON t.organization_id=a.organization_id AND t.franchise_id=a.franchise_id AND t.id=a.transaction_id WHERE a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.match_id=m.id AND (t.account_id<>m.account_id OR t.direction<>m.direction OR t.currency<>'INR' OR t.amount_paise<(
 SELECT COALESCE(sum(x.amount_paise),0) FROM shipit.reconciliation_match_transactions x WHERE x.organization_id=t.organization_id AND x.franchise_id=t.franchise_id AND x.transaction_id=t.id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=x.organization_id AND u.franchise_id=x.franchise_id AND u.match_id=x.match_id))))
 THEN RAISE EXCEPTION 'RECONCILIATION_EXTERNAL_CAPACITY' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM shipit.reconciliation_match_sources a LEFT JOIN shipit.reconciliation_recorded_sources s ON s.organization_id=a.organization_id AND s.franchise_id=a.franchise_id AND s.id=a.source_id WHERE a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.match_id=m.id AND (s.id IS NULL OR s.account_id<>m.account_id OR s.currency<>'INR' OR s.version<>a.source_version OR s.direction<>CASE WHEN a.is_fee THEN 'debit' ELSE m.direction END OR a.is_fee AND s.source_kind<>'expense' OR s.amount_paise<(
 SELECT COALESCE(sum(x.amount_paise),0) FROM shipit.reconciliation_match_sources x WHERE x.organization_id=s.organization_id AND x.franchise_id=s.franchise_id AND x.source_id=s.id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=x.organization_id AND u.franchise_id=x.franchise_id AND u.match_id=x.match_id))))
 THEN RAISE EXCEPTION 'RECONCILIATION_SOURCE_CAPACITY' USING ERRCODE='23514';END IF;
 IF m.batch_id IS NOT NULL THEN
  IF m.direction<>'credit' OR NOT EXISTS(SELECT 1 FROM shipit.reconciliation_batches b WHERE b.organization_id=m.organization_id AND b.franchise_id=m.franchise_id AND b.id=m.batch_id AND b.account_id=m.account_id AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_batches n WHERE n.organization_id=b.organization_id AND n.franchise_id=b.franchise_id AND n.batch_id=b.batch_id AND n.version>b.version)
   AND NOT EXISTS((SELECT a.source_id,a.source_version,a.amount_paise,a.is_fee FROM shipit.reconciliation_match_sources a WHERE a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.match_id=m.id) EXCEPT (SELECT line->>'source_id',line->>'source_version',(line->>'amount_paise')::bigint,false FROM jsonb_array_elements(b.receipts) line UNION ALL SELECT line->>'source_id',line->>'source_version',(line->>'amount_paise')::bigint,true FROM jsonb_array_elements(b.fees) line))
   AND source_count=jsonb_array_length(b.receipts)+jsonb_array_length(b.fees))
  THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_CHANGED' USING ERRCODE='23514';END IF;
 END IF;
 IF m.method='exact' AND (external_count<>1 OR source_count<>1 OR fees<>0 OR m.batch_id IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM shipit.reconciliation_match_sources a JOIN shipit.reconciliation_recorded_sources s ON s.organization_id=a.organization_id AND s.franchise_id=a.franchise_id AND s.id=a.source_id
 JOIN shipit.reconciliation_match_transactions x ON x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.match_id=a.match_id JOIN shipit.reconciliation_transactions t ON t.organization_id=x.organization_id AND t.franchise_id=x.franchise_id AND t.id=x.transaction_id
 WHERE a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.match_id=m.id AND s.external_reference IS NOT NULL AND s.external_reference=t.external_reference AND s.amount_paise=t.amount_paise AND a.amount_paise=s.amount_paise
 AND (SELECT count(*) FROM shipit.reconciliation_recorded_sources other WHERE other.organization_id=s.organization_id AND other.franchise_id=s.franchise_id AND other.account_id=s.account_id AND other.direction=s.direction AND other.external_reference=s.external_reference AND other.amount_paise=s.amount_paise)=1
 AND (SELECT count(*) FROM shipit.reconciliation_transactions other WHERE other.organization_id=t.organization_id AND other.franchise_id=t.franchise_id AND other.account_id=t.account_id AND other.direction=t.direction AND other.external_reference=t.external_reference AND other.amount_paise=t.amount_paise)=1))
 THEN RAISE EXCEPTION 'RECONCILIATION_EXACT_UNPROVEN' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER reconciliation_match_complete AFTER INSERT ON shipit.reconciliation_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_reconciliation_match();
CREATE CONSTRAINT TRIGGER reconciliation_match_external_guard AFTER INSERT ON shipit.reconciliation_match_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_reconciliation_match();
CREATE CONSTRAINT TRIGGER reconciliation_match_source_guard AFTER INSERT ON shipit.reconciliation_match_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_reconciliation_match();
CREATE FUNCTION shipit.guard_reconciliation_batch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE line jsonb;source shipit.reconciliation_recorded_sources;amount numeric;gross numeric:=0;fees numeric:=0;previous_account uuid;seen text[]:=ARRAY[]::text[];is_fee boolean;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id FOR UPDATE;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT account_id INTO previous_account FROM shipit.reconciliation_batches WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND batch_id=NEW.batch_id LIMIT 1;
 IF previous_account IS NOT NULL AND previous_account<>NEW.account_id THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_ACCOUNT' USING ERRCODE='23514';END IF;
 FOREACH is_fee IN ARRAY ARRAY[false,true] LOOP
  FOR line IN SELECT value FROM jsonb_array_elements(CASE WHEN is_fee THEN NEW.fees ELSE NEW.receipts END) LOOP
   IF (jsonb_typeof(line)='object' AND line ?& ARRAY['source_id','source_version','amount_paise'] AND line-ARRAY['source_id','source_version','amount_paise']='{}'::jsonb AND jsonb_typeof(line->'source_id')='string' AND jsonb_typeof(line->'source_version')='string' AND jsonb_typeof(line->'amount_paise')='number') IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_LINE' USING ERRCODE='23514';END IF;
   amount:=(line->>'amount_paise')::numeric;
   IF amount<>trunc(amount) OR amount NOT BETWEEN 1 AND 9007199254740991 OR line->>'source_id'=ANY(seen) THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_AMOUNT' USING ERRCODE='23514';END IF;
   seen:=array_append(seen,line->>'source_id');
   SELECT * INTO source FROM shipit.reconciliation_recorded_sources WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=line->>'source_id';
   IF source.id IS NULL OR source.account_id<>NEW.account_id OR source.version<>line->>'source_version' OR amount>source.amount_paise OR (is_fee AND (source.source_kind<>'expense' OR source.direction<>'debit')) OR (NOT is_fee AND (source.source_kind<>'receipt' OR source.method<>'card' OR source.direction<>'credit')) THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_SOURCE' USING ERRCODE='23514';END IF;
   IF is_fee THEN fees:=fees+amount;ELSE gross:=gross+amount;END IF;
  END LOOP;
 END LOOP;
 IF gross<=fees THEN RAISE EXCEPTION 'RECONCILIATION_BATCH_EQUATION' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_batch_guard BEFORE INSERT ON shipit.reconciliation_batches FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_batch();
CREATE FUNCTION shipit.guard_reconciliation_new_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM shipit.reconciliation_commands c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.command_id)
 THEN RAISE EXCEPTION 'RECONCILIATION_COMMAND_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE FUNCTION shipit.check_reconciliation_record_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE command shipit.reconciliation_commands;allowed text[];
BEGIN
 SELECT * INTO command FROM shipit.reconciliation_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id;
 allowed:=CASE TG_TABLE_NAME WHEN 'reconciliation_config_versions' THEN ARRAY['configure'] WHEN 'reconciliation_mapping_versions' THEN ARRAY['mapping'] WHEN 'reconciliation_imports' THEN ARRAY['preview'] WHEN 'reconciliation_transactions' THEN ARRAY['import','resolve_row'] WHEN 'reconciliation_row_outcomes' THEN ARRAY['import','resolve_row'] WHEN 'reconciliation_batches' THEN ARRAY['batch'] WHEN 'reconciliation_matches' THEN ARRAY['match'] WHEN 'reconciliation_unmatches' THEN ARRAY['unmatch'] WHEN 'reconciliation_classifications' THEN ARRAY['classify'] WHEN 'reconciliation_review_revisions' THEN ARRAY['review'] END;
 IF command.id IS NULL OR NOT(command.action=ANY(allowed)) THEN RAISE EXCEPTION 'RECONCILIATION_COMMAND_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $fn$;
CREATE FUNCTION shipit.guard_reconciliation_match_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM shipit.reconciliation_matches m JOIN shipit.reconciliation_commands c ON c.organization_id=m.organization_id AND c.franchise_id=m.franchise_id AND c.id=m.command_id WHERE m.organization_id=NEW.organization_id AND m.franchise_id=NEW.franchise_id AND m.id=NEW.match_id)
 THEN RAISE EXCEPTION 'RECONCILIATION_MATCH_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_external_line_immutable BEFORE INSERT ON shipit.reconciliation_match_transactions FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_match_line();
CREATE TRIGGER reconciliation_source_line_immutable BEFORE INSERT ON shipit.reconciliation_match_sources FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_match_line();
DO $guards$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['reconciliation_commands','reconciliation_config_versions','reconciliation_mapping_versions','reconciliation_imports','reconciliation_transactions','reconciliation_row_outcomes','reconciliation_batches','reconciliation_matches','reconciliation_match_transactions','reconciliation_match_sources','reconciliation_unmatches','reconciliation_classifications','reconciliation_review_revisions'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation()',table_name||'_immutable',table_name);
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['reconciliation_config_versions','reconciliation_mapping_versions','reconciliation_imports','reconciliation_transactions','reconciliation_row_outcomes','reconciliation_batches','reconciliation_matches','reconciliation_unmatches','reconciliation_classifications','reconciliation_review_revisions'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON shipit.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_reconciliation_record_command()',table_name||'_command',table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_new_command()',table_name||'_new_command',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['reconciliation_config_versions','reconciliation_mapping_versions','reconciliation_row_outcomes','reconciliation_batches','reconciliation_classifications','reconciliation_review_revisions'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_version()',table_name||'_version',table_name);
 END LOOP;
END $guards$;
CREATE TABLE shipit.reconciliation_access_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 resource_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('reconciliation.read','reconciliation.preview_columns')),correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TRIGGER reconciliation_access_immutable BEFORE UPDATE OR DELETE ON shipit.reconciliation_access_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
REVOKE ALL ON shipit.reconciliation_access_events FROM PUBLIC;
CREATE INDEX reconciliation_import_account ON shipit.reconciliation_imports(organization_id,franchise_id,account_id,id);
CREATE INDEX reconciliation_match_account ON shipit.reconciliation_matches(organization_id,franchise_id,account_id,id);
CREATE INDEX reconciliation_command_resource ON shipit.reconciliation_commands(organization_id,franchise_id,resource_id,id);
CREATE FUNCTION shipit.valid_reconciliation_text(value jsonb,maximum integer,nullable boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT CASE WHEN value='null'::jsonb THEN nullable ELSE jsonb_typeof(value)='string' AND char_length(value#>>'{}') BETWEEN 1 AND maximum AND (value#>>'{}')=btrim(value#>>'{}') AND (value#>>'{}') !~ '[\x01-\x1f\x7f-\x9f]' END IS TRUE
$fn$;
CREATE FUNCTION shipit.guard_reconciliation_mapping() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE m jsonb:=NEW.mapping;a jsonb:=m->'amount';k text;
BEGIN
 IF (m ?& ARRAY['expected_version','name','identity_namespace','date_column','date_format','amount','reference_column','identity_column','currency_column'] AND m-ARRAY['expected_version','name','identity_namespace','date_column','date_format','amount','reference_column','identity_column','currency_column']='{}'::jsonb AND jsonb_typeof(m->'expected_version')='number' AND (m->>'expected_version')::numeric=NEW.version-1 AND m->>'date_format' IN ('yyyy-mm-dd','dd/mm/yyyy','dd-mm-yyyy') AND m->>'identity_namespace'~'^[A-Z][A-Z0-9_-]{0,47}$' AND jsonb_typeof(a)='object' AND a->>'unit' IN ('rupees','paise')) IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING' USING ERRCODE='23514';END IF;
 FOREACH k IN ARRAY ARRAY['name','date_column'] LOOP IF NOT shipit.valid_reconciliation_text(m->k,120) THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_TEXT' USING ERRCODE='23514';END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['reference_column','identity_column','currency_column'] LOOP IF NOT shipit.valid_reconciliation_text(m->k,120,true) THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_TEXT' USING ERRCODE='23514';END IF;END LOOP;
 IF a->>'mode'='signed' THEN
  IF (a ?& ARRAY['mode','unit','amount_column','positive_direction'] AND a-ARRAY['mode','unit','amount_column','positive_direction']='{}'::jsonb AND shipit.valid_reconciliation_text(a->'amount_column',120) AND a->>'positive_direction' IN ('credit','debit')) IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_AMOUNT' USING ERRCODE='23514';END IF;
 ELSIF a->>'mode'='credit_debit' THEN
  IF (a ?& ARRAY['mode','unit','credit_column','debit_column'] AND a-ARRAY['mode','unit','credit_column','debit_column']='{}'::jsonb AND shipit.valid_reconciliation_text(a->'credit_column',120) AND shipit.valid_reconciliation_text(a->'debit_column',120) AND a->>'credit_column'<>a->>'debit_column') IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_AMOUNT' USING ERRCODE='23514';END IF;
 ELSIF a->>'mode'='direction' THEN
  IF (a ?& ARRAY['mode','unit','amount_column','direction_column','credit_value','debit_value'] AND a-ARRAY['mode','unit','amount_column','direction_column','credit_value','debit_value']='{}'::jsonb AND a->>'credit_value'<>a->>'debit_value') IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_AMOUNT' USING ERRCODE='23514';END IF;
  FOREACH k IN ARRAY ARRAY['amount_column','direction_column','credit_value','debit_value'] LOOP IF NOT shipit.valid_reconciliation_text(a->k,120) THEN RAISE EXCEPTION 'RECONCILIATION_MAPPING_TEXT' USING ERRCODE='23514';END IF;END LOOP;
 ELSE RAISE EXCEPTION 'RECONCILIATION_MAPPING_MODE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_mapping_shape BEFORE INSERT ON shipit.reconciliation_mapping_versions FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_mapping();
CREATE FUNCTION shipit.guard_reconciliation_import() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE row jsonb;c jsonb;n integer:=2;amount numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions a WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.account_id=NEW.account_id AND a.id=NEW.account_revision_id AND NOT ('cash'=ANY(a.methods))) THEN RAISE EXCEPTION 'RECONCILIATION_ACCOUNT' USING ERRCODE='23514';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(NEW.rows) LOOP
  IF (jsonb_typeof(row)='object' AND row ?& ARRAY['row','error','candidate'] AND row-ARRAY['row','error','candidate']='{}'::jsonb AND row->'row'=to_jsonb(n)) IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_ROW' USING ERRCODE='23514';END IF;
  c:=row->'candidate';
  IF row->'error'<>'null'::jsonb THEN
   IF (row->>'error' IN ('COLUMN_COUNT','INVALID_DATE','OUTSIDE_PERIOD','INVALID_AMOUNT','INVALID_DIRECTION','INVALID_REFERENCE','INVALID_IDENTITY','CURRENCY_MISMATCH') AND c='null'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_INVALID_ROW' USING ERRCODE='23514';END IF;
  ELSE
   IF (jsonb_typeof(c)='object' AND c ?& ARRAY['business_date','direction','amount_paise','currency','external_reference','external_id'] AND c-ARRAY['business_date','direction','amount_paise','currency','external_reference','external_id']='{}'::jsonb AND c->>'business_date'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (c->>'business_date')::date BETWEEN NEW.period_from AND NEW.period_to AND c->>'direction' IN ('credit','debit') AND c->>'currency'='INR' AND jsonb_typeof(c->'amount_paise')='number' AND shipit.valid_reconciliation_text(c->'external_reference',128,true) AND shipit.valid_reconciliation_text(c->'external_id',128,true)) IS NOT TRUE THEN RAISE EXCEPTION 'RECONCILIATION_CANDIDATE' USING ERRCODE='23514';END IF;
   amount:=(c->>'amount_paise')::numeric;
   IF amount<>trunc(amount) OR amount NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'RECONCILIATION_AMOUNT' USING ERRCODE='23514';END IF;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_import_shape BEFORE INSERT ON shipit.reconciliation_imports FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_import();
CREATE FUNCTION shipit.guard_reconciliation_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE i shipit.reconciliation_imports;c jsonb;previous shipit.reconciliation_row_outcomes;t shipit.reconciliation_transactions;m shipit.reconciliation_mapping_versions;
BEGIN
 IF TG_TABLE_NAME='reconciliation_transactions' THEN
  SELECT * INTO i FROM shipit.reconciliation_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.origin_import_id;
  SELECT * INTO m FROM shipit.reconciliation_mapping_versions WHERE organization_id=i.organization_id AND franchise_id=i.franchise_id AND id=i.mapping_id;
  c:=i.rows->(NEW.origin_row-2)->'candidate';
  IF i.id IS NULL OR NEW.account_id<>i.account_id OR NEW.identity_namespace IS DISTINCT FROM m.mapping->>'identity_namespace' OR c IS DISTINCT FROM jsonb_build_object('business_date',NEW.business_date,'direction',NEW.direction,'amount_paise',NEW.amount_paise,'currency',NEW.currency,'external_reference',NEW.external_reference,'external_id',NEW.external_id) THEN RAISE EXCEPTION 'RECONCILIATION_PROVENANCE' USING ERRCODE='23514';END IF;
  IF NEW.external_id IS NULL AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_row_outcomes o WHERE o.organization_id=NEW.organization_id AND o.franchise_id=NEW.franchise_id AND o.import_id=NEW.origin_import_id AND o.row_number=NEW.origin_row AND o.state='needs_review') THEN RAISE EXCEPTION 'RECONCILIATION_IDENTITY_REVIEW' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO i FROM shipit.reconciliation_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.import_id;
  IF i.id IS NULL OR NEW.row_number-2>=jsonb_array_length(i.rows) THEN RAISE EXCEPTION 'RECONCILIATION_ROW' USING ERRCODE='23514';END IF;
  SELECT * INTO previous FROM shipit.reconciliation_row_outcomes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND import_id=NEW.import_id AND row_number=NEW.row_number ORDER BY version DESC LIMIT 1;
  IF previous.version IS NOT NULL AND (previous.state NOT IN ('needs_review','conflict') OR NEW.state NOT IN ('imported','duplicate','rejected') OR previous.state='conflict' AND NEW.state<>'rejected') THEN RAISE EXCEPTION 'RECONCILIATION_ROW_STATE' USING ERRCODE='23514';END IF;
  c:=i.rows->(NEW.row_number-2)->'candidate';
  IF NEW.state IN ('imported','duplicate') THEN
   SELECT * INTO t FROM shipit.reconciliation_transactions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.transaction_id;
   IF t.id IS NULL OR t.account_id<>i.account_id OR c IS NULL OR c='null'::jsonb OR t.currency IS DISTINCT FROM c->>'currency' OR t.direction IS DISTINCT FROM c->>'direction' OR t.amount_paise IS DISTINCT FROM (c->>'amount_paise')::bigint OR NEW.state='imported' AND (t.origin_import_id<>i.id OR t.origin_row<>NEW.row_number) THEN RAISE EXCEPTION 'RECONCILIATION_ROW_TARGET' USING ERRCODE='23514';END IF;
  ELSIF NEW.state='needs_review' AND (c IS NULL OR c='null'::jsonb OR c->'external_id'<>'null'::jsonb) THEN RAISE EXCEPTION 'RECONCILIATION_ROW_IDENTITY' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_transaction_provenance BEFORE INSERT ON shipit.reconciliation_transactions FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_provenance();
CREATE TRIGGER reconciliation_outcome_provenance BEFORE INSERT ON shipit.reconciliation_row_outcomes FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_provenance();
CREATE FUNCTION shipit.guard_reconciliation_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous shipit.reconciliation_review_revisions;
BEGIN
 IF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_recorded_sources WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.source_id) THEN RAISE EXCEPTION 'RECONCILIATION_REVIEW_SOURCE' USING ERRCODE='23514';END IF;
 IF NEW.import_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.import_id AND NEW.row_number BETWEEN 2 AND jsonb_array_length(rows)+1) THEN RAISE EXCEPTION 'RECONCILIATION_REVIEW_ROW' USING ERRCODE='23514';END IF;
 SELECT * INTO previous FROM shipit.reconciliation_review_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND case_id=NEW.case_id ORDER BY version DESC LIMIT 1;
 IF previous.id IS NULL THEN
  IF NEW.state<>'open' THEN RAISE EXCEPTION 'RECONCILIATION_REVIEW_STATE' USING ERRCODE='23514';END IF;
 ELSIF ROW(NEW.source_id,NEW.transaction_id,NEW.import_id,NEW.row_number,NEW.kind) IS DISTINCT FROM ROW(previous.source_id,previous.transaction_id,previous.import_id,previous.row_number,previous.kind) THEN RAISE EXCEPTION 'RECONCILIATION_REVIEW_IDENTITY' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_review_guard BEFORE INSERT ON shipit.reconciliation_review_revisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_review();
CREATE FUNCTION shipit.guard_reconciliation_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='org_admin' AND NEW.action='reconciliation.read' OR m.role IN ('franchise_admin','accountant') AND EXISTS(SELECT 1 FROM shipit.membership_franchise_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=NEW.franchise_id))) THEN RAISE EXCEPTION 'RECONCILIATION_ACCESS_ACTOR' USING ERRCODE='42501';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER reconciliation_access_guard BEFORE INSERT ON shipit.reconciliation_access_events FOR EACH ROW EXECUTE FUNCTION shipit.guard_reconciliation_access();
REVOKE ALL ON FUNCTION shipit.valid_reconciliation_text(jsonb,integer,boolean),shipit.guard_reconciliation_mapping(),shipit.guard_reconciliation_import(),shipit.guard_reconciliation_provenance(),shipit.guard_reconciliation_review(),shipit.guard_reconciliation_access() FROM PUBLIC;

DO $audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'reconciliation:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'reconciliation.'||action,'reconciliation',resource_id,'success','evidence_revision',correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.reconciliation_commands
 UNION ALL SELECT 'reconciliation-access:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'reconciliation',resource_id,'success','evidence_access',correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.reconciliation_access_events$view$;
END $audit$;
REVOKE ALL ON shipit.reconciliation_recorded_sources FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_reconciliation_command(),shipit.guard_reconciliation_version(),shipit.check_reconciliation_match(),shipit.check_reconciliation_record_command(),shipit.guard_reconciliation_match_line(),shipit.guard_reconciliation_new_command(),shipit.guard_reconciliation_batch() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only: retain financial reconciliation evidence');};
