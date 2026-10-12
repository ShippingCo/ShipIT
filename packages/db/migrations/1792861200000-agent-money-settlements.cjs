// #144 additive seller-owned COD evidence. Existing receipt results stay immutable.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.agent_money_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('configure_beneficiary','configure_cod','reserve_cod','configure_fee_terms','earn_delivery_fee','earn_agreed_fee')),
 correlation_id uuid NOT NULL,key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16384),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cod_beneficiaries (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cod_beneficiary_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,beneficiary_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),name text NOT NULL,
 active boolean NOT NULL,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 CHECK(char_length(name) BETWEEN 1 AND 120 AND name=btrim(name) AND name !~ '[\x01-\x1f\x7f-\x9f]'),
 UNIQUE(organization_id,franchise_id,beneficiary_id,id),UNIQUE(organization_id,franchise_id,beneficiary_id,version),
 FOREIGN KEY(organization_id,franchise_id,beneficiary_id) REFERENCES shipit.cod_beneficiaries(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.agent_money_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.cod_obligations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,parcel_id),
 UNIQUE(organization_id,franchise_id,id,booking_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT
);
CREATE TABLE shipit.cod_obligation_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,obligation_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 beneficiary_id uuid NOT NULL,beneficiary_revision_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 active boolean NOT NULL,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,obligation_id,id),UNIQUE(organization_id,franchise_id,obligation_id,version),
 FOREIGN KEY(organization_id,franchise_id,obligation_id) REFERENCES shipit.cod_obligations(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,beneficiary_id,beneficiary_revision_id) REFERENCES shipit.cod_beneficiary_revisions(organization_id,franchise_id,beneficiary_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.agent_money_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.cod_receipt_allocations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,
 obligation_id uuid NOT NULL,obligation_revision_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 command_id uuid NOT NULL UNIQUE,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,receipt_id) REFERENCES shipit.money_receipts(organization_id,franchise_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,obligation_id,obligation_revision_id) REFERENCES shipit.cod_obligation_revisions(organization_id,franchise_id,obligation_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.agent_money_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX cod_allocations_receipt_idx ON shipit.cod_receipt_allocations(organization_id,franchise_id,receipt_id,id);
CREATE INDEX cod_allocations_obligation_idx ON shipit.cod_receipt_allocations(organization_id,franchise_id,obligation_id,id);
CREATE INDEX cod_obligations_booking_idx ON shipit.cod_obligations(organization_id,franchise_id,booking_id,id);


-- Approved per-delivery terms and genuine-proof earnings; neither is a cash producer.
CREATE TABLE shipit.agent_fee_term_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 basis text NOT NULL CHECK(basis IN ('per_delivery','agreed_period')),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 currency text NOT NULL CHECK(currency='INR'),valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 active boolean NOT NULL,command_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CHECK(isfinite(valid_from) AND isfinite(valid_until) AND valid_from<valid_until AND isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,agent_id,version),UNIQUE(organization_id,franchise_id,id,agent_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.agent_money_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE shipit.agent_fee_earnings (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 agent_id uuid NOT NULL,term_revision_id uuid NOT NULL,proof_id uuid,parcel_id uuid,
 basis text NOT NULL DEFAULT 'per_delivery' CHECK(basis IN ('per_delivery','agreed_period')),covered_from timestamptz,covered_until timestamptz,
 CHECK((basis='per_delivery' AND proof_id IS NOT NULL AND parcel_id IS NOT NULL AND covered_from IS NULL AND covered_until IS NULL) OR
 (basis='agreed_period' AND proof_id IS NULL AND parcel_id IS NULL AND covered_from IS NOT NULL AND covered_until IS NOT NULL AND isfinite(covered_from) AND isfinite(covered_until) AND covered_from<covered_until)),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),currency text NOT NULL CHECK(currency='INR'),
 command_id uuid NOT NULL UNIQUE,recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,proof_id),
 FOREIGN KEY(organization_id,franchise_id,term_revision_id,agent_id) REFERENCES shipit.agent_fee_term_revisions(organization_id,franchise_id,id,agent_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,proof_id,parcel_id) REFERENCES shipit.delivery_proofs(organization_id,franchise_id,id,parcel_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.agent_money_commands(organization_id,franchise_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX agent_fee_earnings_agent_idx ON shipit.agent_fee_earnings(organization_id,franchise_id,agent_id,id);
CREATE FUNCTION shipit.guard_agent_fee_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE term shipit.agent_fee_term_revisions;proof shipit.delivery_proofs;attempt shipit.delivery_attempts;state text;previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_MONEY_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 SELECT f.lifecycle INTO state FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id AND o.lifecycle='active' WHERE f.organization_id=NEW.organization_id AND f.id=NEW.franchise_id FOR UPDATE OF f;
 IF state IS DISTINCT FROM 'active' OR NEW.recorded_at IS DISTINCT FROM transaction_timestamp() OR EXISTS(SELECT 1 FROM shipit.agent_money_commands WHERE id=NEW.command_id)
 THEN RAISE EXCEPTION 'AGENT_FEE_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='agent_fee_term_revisions' THEN
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.agent_fee_term_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND agent_id=NEW.agent_id;
  IF NEW.version::bigint<>previous::bigint+1 OR NOT shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.agent_id,'delivery_agent')
  THEN RAISE EXCEPTION 'AGENT_FEE_TERMS_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO term FROM shipit.agent_fee_term_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND agent_id=NEW.agent_id ORDER BY version DESC LIMIT 1;
  IF term.id IS DISTINCT FROM NEW.term_revision_id OR term.active IS DISTINCT FROM true OR term.basis IS DISTINCT FROM NEW.basis OR NEW.amount_paise<>term.amount_paise
  THEN RAISE EXCEPTION 'AGENT_FEE_TERMS_INVALID' USING ERRCODE='23514';END IF;
  IF NEW.basis='agreed_period' THEN
   IF NEW.covered_from IS DISTINCT FROM term.valid_from OR NEW.covered_until IS DISTINCT FROM term.valid_until OR NEW.proof_id IS NOT NULL OR NEW.parcel_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM shipit.agent_fee_earnings e LEFT JOIN shipit.delivery_proofs p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.proof_id
     WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.agent_id=NEW.agent_id
     AND ((e.basis='agreed_period' AND e.covered_from<NEW.covered_until AND NEW.covered_from<e.covered_until) OR (e.basis='per_delivery' AND p.completed_at>=NEW.covered_from AND p.completed_at<NEW.covered_until)))
   THEN RAISE EXCEPTION 'AGENT_AGREED_FEE_SOURCE_INVALID' USING ERRCODE='23514';END IF;
   RETURN NEW;
  END IF;
  SELECT * INTO proof FROM shipit.delivery_proofs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.proof_id;
  SELECT * INTO attempt FROM shipit.delivery_attempts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=proof.attempt_id;
  IF term.id IS DISTINCT FROM NEW.term_revision_id OR term.active IS DISTINCT FROM true OR proof.id IS NULL
   OR proof.parcel_id<>NEW.parcel_id OR proof.completed_by<>NEW.agent_id OR attempt.agent_id<>NEW.agent_id OR attempt.state<>'completed'
   OR proof.completed_at<term.valid_from OR proof.completed_at>=term.valid_until OR NEW.amount_paise<>term.amount_paise
  THEN RAISE EXCEPTION 'AGENT_FEE_PROOF_INVALID' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM shipit.agent_fee_earnings e WHERE e.organization_id=NEW.organization_id AND e.franchise_id=NEW.franchise_id AND e.agent_id=NEW.agent_id AND e.basis='agreed_period' AND e.covered_from<=proof.completed_at AND proof.completed_at<e.covered_until) THEN RAISE EXCEPTION 'AGENT_FEE_ALREADY_COVERED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER agent_fee_terms_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_fee_term_revisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_fee_fact();
CREATE TRIGGER agent_fee_earnings_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_fee_earnings FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_fee_fact();
REVOKE ALL ON shipit.agent_fee_term_revisions,shipit.agent_fee_earnings FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_agent_fee_fact() FROM PUBLIC;

CREATE FUNCTION shipit.guard_agent_money_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;beneficiary shipit.cod_beneficiary_revisions;obligation shipit.cod_obligation_revisions;
 receipt shipit.money_receipts;collected numeric;freight numeric;customer uuid;state text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_MONEY_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 SELECT f.lifecycle INTO state FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id AND o.lifecycle='active' WHERE f.organization_id=NEW.organization_id AND f.id=NEW.franchise_id FOR UPDATE OF f;
 IF state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'AGENT_MONEY_FRANCHISE_DISABLED' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME IN ('cod_beneficiaries','cod_obligations') THEN RETURN NEW;END IF;
 IF NEW.recorded_at IS DISTINCT FROM transaction_timestamp() OR EXISTS(SELECT 1 FROM shipit.agent_money_commands c WHERE c.id=NEW.command_id)
 THEN RAISE EXCEPTION 'AGENT_MONEY_COMMAND_SEALED' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='cod_beneficiary_revisions' THEN
  PERFORM id FROM shipit.cod_beneficiaries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.beneficiary_id FOR UPDATE;
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.cod_beneficiary_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND beneficiary_id=NEW.beneficiary_id;
  IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'AGENT_MONEY_VERSION_CONFLICT' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='cod_obligation_revisions' THEN
  PERFORM id FROM shipit.cod_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.obligation_id FOR UPDATE;
  SELECT * INTO obligation FROM shipit.cod_obligation_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO beneficiary FROM shipit.cod_beneficiary_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND beneficiary_id=NEW.beneficiary_id ORDER BY version DESC LIMIT 1;
  SELECT COALESCE(sum(reserved_paise),0) INTO collected FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id;
  IF NEW.version::bigint<>COALESCE(obligation.version,0)::bigint+1 OR beneficiary.id IS DISTINCT FROM NEW.beneficiary_revision_id OR (NEW.active AND NOT beneficiary.active)
   OR (collected>0 AND (NEW.beneficiary_id IS DISTINCT FROM obligation.beneficiary_id OR NEW.beneficiary_revision_id IS DISTINCT FROM obligation.beneficiary_revision_id OR NEW.amount_paise IS DISTINCT FROM obligation.amount_paise OR NEW.active IS DISTINCT FROM obligation.active))
  THEN RAISE EXCEPTION 'AGENT_MONEY_COD_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='cod_receipt_allocations' THEN
  SELECT * INTO receipt FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
  PERFORM id FROM shipit.cod_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.obligation_id FOR UPDATE;
  SELECT * INTO obligation FROM shipit.cod_obligation_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id ORDER BY version DESC LIMIT 1;
  SELECT b.customer_id INTO customer FROM shipit.cod_obligations o JOIN shipit.bookings b ON b.organization_id=o.organization_id AND b.franchise_id=o.franchise_id AND b.id=o.booking_id WHERE o.organization_id=NEW.organization_id AND o.franchise_id=NEW.franchise_id AND o.id=NEW.obligation_id;
  IF receipt.id IS NULL OR obligation.id IS DISTINCT FROM NEW.obligation_revision_id OR NOT obligation.active OR customer IS DISTINCT FROM receipt.customer_id
  THEN RAISE EXCEPTION 'AGENT_MONEY_COD_SOURCE_INVALID' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(reserved_paise),0) INTO collected FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND obligation_id=NEW.obligation_id;
  IF collected+NEW.amount_paise>obligation.amount_paise THEN RAISE EXCEPTION 'AGENT_MONEY_COD_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO freight FROM shipit.money_receipt_allocations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
  SELECT COALESCE(sum(reserved_paise),0) INTO collected FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
  IF freight+collected+NEW.amount_paise>receipt.amount_paise THEN RAISE EXCEPTION 'MONEY_RECEIPT_AVAILABILITY_EXCEEDED' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'AGENT_MONEY_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
DO $guards$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['cod_beneficiaries','cod_beneficiary_revisions','cod_obligations','cod_obligation_revisions','cod_receipt_allocations'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON shipit.%I FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_money_fact()',n||'_guard',n);
 END LOOP;
END $guards$;
-- Keep the released freight guard intact; add the other side of the shared capacity equation.
CREATE FUNCTION shipit.guard_receipt_cod_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE receipt shipit.money_receipts;freight numeric;cod numeric;
BEGIN
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 IF TG_TABLE_NAME='money_receipt_commands' THEN RETURN NEW;END IF;
 SELECT * INTO receipt FROM shipit.money_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.receipt_id FOR UPDATE;
 IF NEW.kind='allocation' THEN
  SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO freight FROM shipit.money_receipt_allocations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
  SELECT COALESCE(sum(reserved_paise),0) INTO cod FROM shipit.cod_receipt_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.receipt_id;
  IF receipt.id IS NULL OR freight+cod+NEW.amount_paise>receipt.amount_paise THEN RAISE EXCEPTION 'MONEY_RECEIPT_AVAILABILITY_EXCEEDED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER aaa_receipt_cod_command_lock BEFORE INSERT ON shipit.money_receipt_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_receipt_cod_capacity();
CREATE TRIGGER aaa_receipt_cod_capacity BEFORE INSERT ON shipit.money_receipt_allocations FOR EACH ROW EXECUTE FUNCTION shipit.guard_receipt_cod_capacity();

CREATE FUNCTION shipit.guard_agent_money_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_MONEY_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'AGENT_MONEY_TIME_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 INSERT INTO shipit.cashbook_source_versions(organization_id,franchise_id,version) VALUES(NEW.organization_id,NEW.franchise_id,1)
 ON CONFLICT(organization_id,franchise_id) DO UPDATE SET version=shipit.cashbook_source_versions.version+1;
 RETURN NEW;
END $fn$;
CREATE TRIGGER agent_money_command_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_money_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_money_command();
CREATE FUNCTION shipit.check_agent_money_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE valid boolean:=false;beneficiary shipit.cod_beneficiary_revisions;obligation shipit.cod_obligation_revisions;allocation shipit.cod_receipt_allocations;
 base shipit.cod_obligations;resource uuid;term shipit.agent_fee_term_revisions;earning shipit.agent_fee_earnings;
BEGIN
 resource=(NEW.result->>'resource_id')::uuid;
 IF NEW.result IS DISTINCT FROM jsonb_build_object('command_id',NEW.id,'resource_id',resource,'recorded_at',to_char(NEW.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RAISE EXCEPTION 'AGENT_MONEY_RESULT_INVALID' USING ERRCODE='23514';END IF;
 IF NEW.operation='configure_beneficiary' THEN
  SELECT * INTO beneficiary FROM shipit.cod_beneficiary_revisions WHERE command_id=NEW.id;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') AND beneficiary.id=resource
   AND beneficiary.organization_id=NEW.organization_id AND beneficiary.franchise_id=NEW.franchise_id
   AND NEW.input=jsonb_build_object('beneficiary_id',beneficiary.beneficiary_id,'expected_version',beneficiary.version-1,'name',beneficiary.name,'active',beneficiary.active);
 ELSIF NEW.operation='configure_cod' THEN
  SELECT * INTO obligation FROM shipit.cod_obligation_revisions WHERE command_id=NEW.id;
  SELECT * INTO base FROM shipit.cod_obligations WHERE id=obligation.obligation_id;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') AND obligation.id=resource
   AND obligation.organization_id=NEW.organization_id AND obligation.franchise_id=NEW.franchise_id
   AND NEW.input=jsonb_build_object('obligation_id',obligation.obligation_id,'booking_id',base.booking_id,'parcel_id',base.parcel_id,'expected_version',obligation.version-1,'beneficiary_id',obligation.beneficiary_id,'beneficiary_revision_id',obligation.beneficiary_revision_id,'amount_paise',obligation.amount_paise,'currency',obligation.currency,'active',obligation.active);
 ELSIF NEW.operation='configure_fee_terms' THEN
  SELECT * INTO term FROM shipit.agent_fee_term_revisions WHERE command_id=NEW.id;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') AND term.id=resource
   AND term.organization_id=NEW.organization_id AND term.franchise_id=NEW.franchise_id
   AND NEW.input=jsonb_build_object('agent_id',term.agent_id,'expected_version',term.version-1,'basis',term.basis,'amount_paise',term.amount_paise,'currency',term.currency,
    'valid_from',to_char(term.valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'valid_until',to_char(term.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'active',term.active);
 ELSIF NEW.operation='earn_delivery_fee' THEN
  SELECT * INTO earning FROM shipit.agent_fee_earnings WHERE command_id=NEW.id;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') AND earning.id=resource
   AND earning.organization_id=NEW.organization_id AND earning.franchise_id=NEW.franchise_id
   AND earning.basis='per_delivery' AND NEW.input=jsonb_build_object('proof_id',earning.proof_id,'term_revision_id',earning.term_revision_id);
 ELSIF NEW.operation='earn_agreed_fee' THEN
  SELECT * INTO earning FROM shipit.agent_fee_earnings WHERE command_id=NEW.id;
  valid=shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') AND earning.id=resource
   AND earning.organization_id=NEW.organization_id AND earning.franchise_id=NEW.franchise_id AND earning.basis='agreed_period'
   AND NEW.input=jsonb_build_object('term_revision_id',earning.term_revision_id);
 ELSE
  SELECT * INTO allocation FROM shipit.cod_receipt_allocations WHERE command_id=NEW.id;
  valid=(shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'franchise_admin') OR shipit.custody_member(NEW.organization_id,NEW.franchise_id,NEW.actor_id,'operator')) AND allocation.id=resource
   AND allocation.organization_id=NEW.organization_id AND allocation.franchise_id=NEW.franchise_id
   AND NEW.input=jsonb_build_object('receipt_id',allocation.receipt_id,'obligation_id',allocation.obligation_id,'obligation_revision_id',allocation.obligation_revision_id,'amount_paise',allocation.amount_paise,'currency',allocation.currency);
 END IF;
 IF valid IS DISTINCT FROM true OR
  (SELECT count(*) FROM shipit.cod_beneficiary_revisions WHERE command_id=NEW.id)+(SELECT count(*) FROM shipit.cod_obligation_revisions WHERE command_id=NEW.id)+(SELECT count(*) FROM shipit.cod_receipt_allocations WHERE command_id=NEW.id)+(SELECT count(*) FROM shipit.agent_fee_term_revisions WHERE command_id=NEW.id)+(SELECT count(*) FROM shipit.agent_fee_earnings WHERE command_id=NEW.id)<>1
 THEN RAISE EXCEPTION 'AGENT_MONEY_COMMAND_INCOMPLETE' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER agent_money_command_complete AFTER INSERT ON shipit.agent_money_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_agent_money_command();
-- Identity creation and its first approved revision are one complete transaction.
CREATE FUNCTION shipit.check_cod_identity_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_TABLE_NAME='cod_beneficiaries' THEN
  IF NOT EXISTS(SELECT 1 FROM shipit.cod_beneficiary_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.beneficiary_id=NEW.id AND r.version=1)
  THEN RAISE EXCEPTION 'AGENT_MONEY_IDENTITY_INCOMPLETE' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM shipit.cod_obligation_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.obligation_id=NEW.id AND r.version=1)
  THEN RAISE EXCEPTION 'AGENT_MONEY_IDENTITY_INCOMPLETE' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER cod_beneficiary_complete AFTER INSERT ON shipit.cod_beneficiaries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cod_identity_complete();
CREATE CONSTRAINT TRIGGER cod_obligation_complete AFTER INSERT ON shipit.cod_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cod_identity_complete();
-- Audit derives from immutable complete commands; callers cannot fabricate a parallel history row.
DO $audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'agent-money:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'agent_money.'||operation,'agent_money',(result->>'resource_id')::uuid,'success',
 CASE operation WHEN 'configure_beneficiary' THEN 'beneficiary_configured' WHEN 'configure_cod' THEN 'cod_configured' WHEN 'configure_fee_terms' THEN 'fee_terms_configured' WHEN 'earn_delivery_fee' THEN 'delivery_fee_earned' WHEN 'earn_agreed_fee' THEN 'agreed_fee_earned' ELSE 'cod_reserved' END,
 correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.agent_money_commands$view$;
END $audit$;
REVOKE ALL ON FUNCTION shipit.check_cod_identity_complete() FROM PUBLIC;
DO $private$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['agent_money_commands','cod_beneficiaries','cod_beneficiary_revisions','cod_obligations','cod_obligation_revisions','cod_receipt_allocations'] LOOP
  EXECUTE format('REVOKE ALL ON shipit.%I FROM PUBLIC',n);
 END LOOP;
END $private$;
REVOKE ALL ON FUNCTION shipit.guard_agent_money_fact(),shipit.guard_receipt_cod_capacity(),shipit.guard_agent_money_command(),shipit.check_agent_money_command() FROM PUBLIC;
-- #144 deliberately extends named cash custodians, not general agent receipt/expense rights.
CREATE OR REPLACE FUNCTION shipit.guard_money_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE c shipit.money_receipt_commands;a shipit.receiving_account_revisions;current_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MONEY_RECEIPT_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM shipit.money_receipt_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND receipt_id=NEW.id AND id=NEW.command_id AND state='reserved' AND operation_id='api.v1.money_receipts.record';
 PERFORM id FROM shipit.receiving_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO a FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id AND id=NEW.account_revision_id;
 SELECT max(version) INTO current_version FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
 IF c.id IS NULL OR a.id IS NULL OR NOT a.active OR a.version IS DISTINCT FROM current_version OR NOT (NEW.method=ANY(a.methods))
  OR NEW.recorded_at IS NOT NULL OR NEW.customer_id IS DISTINCT FROM (c.input->>'customer_id')::uuid
  OR NEW.account_id IS DISTINCT FROM (c.input->>'account_id')::uuid OR a.version IS DISTINCT FROM (c.input->>'expected_account_version')::integer
  OR NEW.amount_paise IS DISTINCT FROM (c.input->>'amount_paise')::numeric OR NEW.currency IS DISTINCT FROM c.input->>'currency'
  OR NEW.method IS DISTINCT FROM c.input->>'method' OR NEW.receiver_id IS DISTINCT FROM (c.input->>'receiver_id')::uuid
  OR NEW.initial_custodian_id IS DISTINCT FROM (c.input->>'custodian_id')::uuid OR NEW.occurred_at IS DISTINCT FROM (c.input->>'occurred_at')::timestamptz
  OR NEW.occurred_at>c.recorded_at OR NEW.external_reference IS DISTINCT FROM c.input->>'external_reference'
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
  JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
  WHERE m.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.receiver_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent'))
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_RECEIVER_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=c.recorded_at;RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.guard_cash_location_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE location shipit.cash_locations;account shipit.receiving_account_revisions;previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_LOCATION_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_LOCATION_GENERATED_FIELDS' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASH_LOCATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_ACTOR_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO location FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.location_id FOR UPDATE;
 SELECT * INTO account FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT COALESCE(max(version),0) INTO previous FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.location_id;
 IF location.id IS NULL OR account.id IS NULL OR account.id<>NEW.account_revision_id OR ((NEW.active OR previous=0) AND NOT account.active) OR previous::bigint+1<>NEW.version::bigint
  OR ((NEW.active OR previous=0) AND (location.kind='cash') IS DISTINCT FROM (account.methods=ARRAY['cash']::text[]))
 THEN RAISE EXCEPTION 'CASH_LOCATION_SOURCE_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 IF (NEW.active OR previous=0) AND location.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent') AND m.user_id=location.custodian_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_CUSTODIAN_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.guard_cash_handover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE capacity record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_HANDOVER_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE) THEN RAISE EXCEPTION 'CASH_HANDOVER_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin','delivery_agent') AND m.user_id=NEW.actor_id
 AND (m.role='franchise_admin' OR EXISTS(SELECT 1 FROM shipit.cash_locations l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id AND l.id=NEW.source_location_id AND l.custodian_id=NEW.actor_id))) THEN RAISE EXCEPTION 'CASH_HANDOVER_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id),0)<>NEW.expected_source_version OR NEW.occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'CASH_HANDOVER_VERSION_TIME_INVALID' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cash_handover_sources(NEW);
 SELECT * INTO capacity FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,NEW.source_location_id,NULL);
 IF capacity.recorded-capacity.reserved<NEW.amount_paise OR capacity.unknown_refund>0 OR abs(capacity.recorded)>9007199254740991 THEN RAISE EXCEPTION 'CASH_HANDOVER_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.guard_cash_handover_command() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cash_handovers;position record;capacity record;target_total numeric;source_custodian uuid;target_custodian uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.accepted_paise IS NOT NULL OR NEW.remaining_paise IS NOT NULL OR NEW.ended_paise IS NOT NULL OR NEW.state IS NOT NULL OR NEW.creation_xid<>pg_current_xact_id() THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE) THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cash_handovers WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.handover_id FOR UPDATE;
 SELECT * INTO position FROM shipit.cash_handover_positions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.handover_id;
 IF request.id IS NULL OR NEW.version<>position.version+1 OR position.remaining_paise=0 OR COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id),0)<>NEW.expected_source_version THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_STALE' USING ERRCODE='23514';END IF;
 SELECT custodian_id INTO source_custodian FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=request.source_location_id;
 SELECT custodian_id INTO target_custodian FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=request.target_location_id;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin','delivery_agent') AND m.user_id=NEW.actor_id
 AND CASE WHEN NEW.kind='cancel' THEN m.role='franchise_admin' OR NEW.actor_id=source_custodian ELSE NEW.actor_id=target_custodian END) THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 NEW.accepted_paise=position.accepted_paise;NEW.ended_paise=position.ended_paise;
 IF NEW.kind='accept' THEN
  PERFORM shipit.check_cash_handover_sources(request);
  SELECT * INTO capacity FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.source_location_id,request.id);
  SELECT recorded INTO target_total FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.target_location_id,NULL);
  IF NEW.amount_paise>position.remaining_paise OR NEW.amount_paise>capacity.recorded-capacity.reserved OR capacity.unknown_refund>0 OR target_total+NEW.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
  NEW.accepted_paise=position.accepted_paise+NEW.amount_paise;NEW.remaining_paise=position.remaining_paise-NEW.amount_paise;NEW.state=CASE WHEN NEW.remaining_paise=0 THEN 'accepted' ELSE 'partially_accepted' END;
 ELSE NEW.remaining_paise=0;NEW.ended_paise=position.ended_paise+position.remaining_paise;NEW.state=CASE WHEN NEW.kind='reject' THEN 'rejected' ELSE 'cancelled' END;
 END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.check_cash_handover_sources(request shipit.cash_handovers) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE found integer;
BEGIN
 SELECT count(*) INTO found FROM shipit.cash_locations l
 JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions r WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions a WHERE a.organization_id=l.organization_id AND a.franchise_id=l.franchise_id AND a.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
 WHERE l.organization_id=request.organization_id AND l.franchise_id=request.franchise_id AND l.kind='cash' AND l.id IN(request.source_location_id,request.target_location_id)
 AND r.id=CASE WHEN l.id=request.source_location_id THEN request.source_revision_id ELSE request.target_revision_id END
 AND (
  (r.active AND a.active AND r.account_revision_id=a.id AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin','delivery_agent') AND m.user_id=l.custodian_id))
  OR (l.id=request.source_location_id AND shipit.custody_member(request.organization_id,request.franchise_id,request.actor_id,'franchise_admin')
   AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
    WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.role='delivery_agent' AND m.user_id=l.custodian_id))
 );
 IF found<>2 THEN RAISE EXCEPTION 'CASH_HANDOVER_SOURCE_STALE' USING ERRCODE='23514';END IF;
END $fn$;


-- Agent advances are actual outflows; earned expense and explicit payment remain separate.
ALTER TABLE shipit.cashbook_requests ADD COLUMN agent_payee_id uuid REFERENCES shipit.auth_users(id) ON DELETE RESTRICT;
DO $advance_method$
DECLARE target text;matches integer;
BEGIN
 SELECT count(*),min(c.conname) INTO matches,target FROM pg_constraint c
 WHERE c.conrelid='shipit.cashbook_requests'::regclass AND c.contype='c'
 AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='kind'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='payment_method')]::smallint[];
 IF matches<>1 THEN RAISE EXCEPTION 'AGENT_ADVANCE_METHOD_CONSTRAINT_UNKNOWN';END IF;
 EXECUTE format('ALTER TABLE shipit.cashbook_requests DROP CONSTRAINT %I',target);
END $advance_method$;
-- Gross earned expense, explicit advance application and new cash payment differ.
ALTER TABLE shipit.cashbook_requests ADD COLUMN cod_allocation_id uuid;
ALTER TABLE shipit.cashbook_requests ADD COLUMN payment_reference text CHECK(payment_reference IS NULL OR (char_length(payment_reference) BETWEEN 1 AND 120 AND payment_reference=btrim(payment_reference) AND payment_reference!~'[[:cntrl:]]'));
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_cod_allocation_owned FOREIGN KEY(organization_id,franchise_id,cod_allocation_id) REFERENCES shipit.cod_receipt_allocations(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_cod_remittance_fields CHECK((kind IN ('cod_remittance','cod_reservation_reversal'))=(cod_allocation_id IS NOT NULL) AND (kind='cod_remittance')=(payment_reference IS NOT NULL));
CREATE INDEX cashbook_cod_allocation_idx ON shipit.cashbook_requests(organization_id,franchise_id,cod_allocation_id,id) WHERE cod_allocation_id IS NOT NULL;
ALTER TABLE shipit.cashbook_requests ADD COLUMN fee_earning_id uuid;
ALTER TABLE shipit.cashbook_requests ADD COLUMN fee_cash_paise bigint CHECK(fee_cash_paise BETWEEN 0 AND 9007199254740991);
ALTER TABLE shipit.cashbook_requests ADD COLUMN fee_advance_paise bigint CHECK(fee_advance_paise BETWEEN 0 AND 9007199254740991);
ALTER TABLE shipit.cashbook_requests ADD COLUMN fee_advance_request_id uuid;
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_fee_earning_owned FOREIGN KEY(organization_id,franchise_id,fee_earning_id) REFERENCES shipit.agent_fee_earnings(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_fee_advance_owned FOREIGN KEY(organization_id,franchise_id,fee_advance_request_id) REFERENCES shipit.cashbook_requests(organization_id,franchise_id,id) ON DELETE RESTRICT;
ALTER TABLE shipit.cashbook_requests DROP CONSTRAINT cashbook_requests_kind_check;
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_requests_kind_check CHECK(kind IN ('expense','opening_float','owner_funds','deposit','withdrawal','agent_advance','agent_fee_payment','cod_remittance','cod_reservation_reversal'));
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_request_agent_payee CHECK((kind IN ('agent_advance','agent_fee_payment') OR fee_earning_id IS NOT NULL)=(agent_payee_id IS NOT NULL));
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_request_paid_method CHECK((kind IN ('expense','agent_advance','agent_fee_payment','cod_remittance'))=(payment_method IS NOT NULL));
ALTER TABLE shipit.cashbook_requests ADD CONSTRAINT cashbook_fee_fields CHECK(
 (fee_earning_id IS NULL AND fee_cash_paise IS NULL AND fee_advance_paise IS NULL AND fee_advance_request_id IS NULL AND kind<>'agent_fee_payment') OR
 (fee_earning_id IS NOT NULL AND kind IN ('expense','agent_fee_payment') AND fee_cash_paise IS NOT NULL AND fee_advance_paise IS NOT NULL
  AND ((fee_advance_paise>0 AND fee_advance_request_id IS NOT NULL) OR (fee_advance_paise=0 AND (fee_advance_request_id IS NULL OR correction_of IS NOT NULL))) AND target_location_id IS NULL
  AND (kind='expense' AND fee_cash_paise::numeric+fee_advance_paise<=amount_paise OR kind='agent_fee_payment' AND fee_cash_paise::numeric+fee_advance_paise=amount_paise)));
CREATE INDEX cashbook_fee_earning_idx ON shipit.cashbook_requests(organization_id,franchise_id,fee_earning_id,id) WHERE fee_earning_id IS NOT NULL;
CREATE INDEX cashbook_fee_advance_idx ON shipit.cashbook_requests(organization_id,franchise_id,fee_advance_request_id,id) WHERE fee_advance_request_id IS NOT NULL;
CREATE FUNCTION shipit.check_cashbook_cod_sources(request shipit.cashbook_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE allocation shipit.cod_receipt_allocations;previous shipit.cashbook_requests;remitted numeric;duplicates integer;receipt shipit.money_receipts;source shipit.cash_locations;reserved numeric;freight numeric;replaced numeric:=0;
BEGIN
 IF request.correction_of IS NOT NULL THEN
  SELECT * INTO previous FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of;
  IF previous.cod_allocation_id IS DISTINCT FROM request.cod_allocation_id THEN RAISE EXCEPTION 'COD_REMITTANCE_CORRECTION_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF request.cod_allocation_id IS NULL THEN RETURN;END IF;
 SELECT * INTO allocation FROM shipit.cod_receipt_allocations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.cod_allocation_id;
 IF allocation.id IS NULL OR request.kind NOT IN ('cod_remittance','cod_reservation_reversal') OR (request.kind='cod_remittance' AND request.payment_reference IS NULL) THEN RAISE EXCEPTION 'COD_REMITTANCE_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 SELECT COALESCE(sum(r.amount_paise::numeric),0),count(*) FILTER(WHERE r.payment_reference=request.payment_reference) INTO remitted,duplicates FROM shipit.cashbook_requests r
 JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.cod_allocation_id=request.cod_allocation_id
  AND r.id<>request.id AND r.id IS DISTINCT FROM request.correction_of
  AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id);
 IF duplicates<>0 OR remitted+request.amount_paise>allocation.amount_paise THEN RAISE EXCEPTION 'COD_REMITTANCE_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 IF request.kind='cod_reservation_reversal' THEN
  SELECT * INTO receipt FROM shipit.money_receipts WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=allocation.receipt_id;
  SELECT * INTO source FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.source_location_id;
  IF receipt.id IS NULL OR source.id IS NULL OR source.account_id IS DISTINCT FROM receipt.account_id OR (receipt.method='cash' AND (source.kind<>'cash' OR source.custodian_id IS DISTINCT FROM receipt.initial_custodian_id)) OR (receipt.method<>'cash' AND source.kind<>'noncash')
  THEN RAISE EXCEPTION 'COD_REVERSAL_RECEIPT_SOURCE_INVALID' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(reserved_paise),0) INTO reserved FROM shipit.cod_receipt_positions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND receipt_id=allocation.receipt_id;
  SELECT COALESCE(sum(CASE kind WHEN 'allocation' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO freight FROM shipit.money_receipt_allocations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND receipt_id=allocation.receipt_id;
  IF previous.kind='cod_reservation_reversal' THEN replaced=previous.amount_paise;END IF;
  IF freight+reserved+replaced-request.amount_paise>receipt.amount_paise THEN RAISE EXCEPTION 'COD_REVERSAL_RECEIPT_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION shipit.check_cashbook_cod_sources(shipit.cashbook_requests) FROM PUBLIC;
CREATE FUNCTION shipit.check_cashbook_fee_sources(request shipit.cashbook_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE earning shipit.agent_fee_earnings;advance shipit.cashbook_requests;previous shipit.cashbook_requests;
 origin uuid;used numeric;paid numeric;recognized integer;
BEGIN
 -- Called under the owning franchise lock at submission, review and application.
 IF request.kind='agent_advance' AND request.correction_of IS NOT NULL THEN
  WITH RECURSIVE chain AS (
   SELECT id,correction_of FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of
   UNION ALL SELECT r.id,r.correction_of FROM shipit.cashbook_requests r JOIN chain c ON r.id=c.correction_of WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id
  ) SELECT id INTO origin FROM chain WHERE correction_of IS NULL;
  SELECT COALESCE(sum(r.fee_advance_paise::numeric),0) INTO used FROM shipit.cashbook_requests r
  JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
  WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.fee_advance_request_id=origin
   AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id);
  IF request.amount_paise<used THEN RAISE EXCEPTION 'AGENT_ADVANCE_ALREADY_APPLIED' USING ERRCODE='23514';END IF;
 END IF;
 IF request.correction_of IS NOT NULL THEN
  SELECT * INTO previous FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of;
  IF previous.fee_earning_id IS DISTINCT FROM request.fee_earning_id OR previous.agent_payee_id IS DISTINCT FROM request.agent_payee_id OR previous.fee_advance_request_id IS DISTINCT FROM request.fee_advance_request_id
  THEN RAISE EXCEPTION 'AGENT_FEE_CORRECTION_SOURCE_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF request.fee_earning_id IS NULL THEN RETURN;END IF;
 SELECT * INTO earning FROM shipit.agent_fee_earnings WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.fee_earning_id;
 IF earning.id IS NULL OR earning.agent_id IS DISTINCT FROM request.agent_payee_id OR (request.kind='expense' AND request.amount_paise<>earning.amount_paise)
 THEN RAISE EXCEPTION 'AGENT_FEE_EARNING_SOURCE_INVALID' USING ERRCODE='23514';END IF;

 SELECT COALESCE(sum(r.fee_cash_paise::numeric+r.fee_advance_paise),0),count(*) FILTER(WHERE r.kind='expense') INTO paid,recognized
 FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.fee_earning_id=request.fee_earning_id
  AND r.id<>request.id AND r.id IS DISTINCT FROM request.correction_of
  AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id);
 IF (request.kind='expense' AND recognized<>0) OR (request.kind='agent_fee_payment' AND recognized<>1) OR paid+request.fee_cash_paise+request.fee_advance_paise>earning.amount_paise
 THEN RAISE EXCEPTION 'AGENT_FEE_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 IF request.fee_advance_request_id IS NOT NULL THEN
  WITH RECURSIVE chain AS (
   SELECT r.* FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
   WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.id=request.fee_advance_request_id AND r.kind='agent_advance' AND r.correction_of IS NULL
   UNION ALL SELECT r.* FROM shipit.cashbook_requests r JOIN chain c ON r.correction_of=c.id JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
   WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id
  ) SELECT c.* INTO advance FROM chain c WHERE NOT EXISTS(SELECT 1 FROM chain next WHERE next.correction_of=c.id);
  IF advance.id IS NULL OR advance.agent_payee_id IS DISTINCT FROM request.agent_payee_id
  THEN RAISE EXCEPTION 'AGENT_FEE_ADVANCE_SOURCE_INVALID' USING ERRCODE='23514';END IF;
  IF request.fee_advance_paise>0 AND advance.occurred_at>request.occurred_at
  THEN RAISE EXCEPTION 'AGENT_FEE_ADVANCE_NOT_YET_PAID' USING ERRCODE='23514';END IF;
  SELECT COALESCE(sum(r.fee_advance_paise::numeric),0) INTO used FROM shipit.cashbook_requests r
  JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
  WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.fee_advance_request_id=request.fee_advance_request_id
   AND r.id<>request.id AND r.id IS DISTINCT FROM request.correction_of
   AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id);
  IF used+request.fee_advance_paise>advance.amount_paise THEN RAISE EXCEPTION 'AGENT_FEE_ADVANCE_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION shipit.check_cashbook_fee_sources(shipit.cashbook_requests) FROM PUBLIC;

CREATE OR REPLACE FUNCTION shipit.check_cashbook_request_sources(request shipit.cashbook_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source shipit.cash_locations;target shipit.cash_locations;source_revision shipit.cash_location_revisions;
 target_revision shipit.cash_location_revisions;source_account shipit.receiving_account_revisions;target_account shipit.receiving_account_revisions;method_account shipit.receiving_account_revisions;previous shipit.cashbook_requests;
BEGIN
 IF request.correction_of IS NOT NULL THEN
  SELECT * INTO previous FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of;
  IF previous.id IS NULL OR previous.kind<>request.kind OR previous.source_location_id<>request.source_location_id OR previous.target_location_id IS DISTINCT FROM request.target_location_id OR previous.occurred_at<>request.occurred_at
  OR NOT EXISTS(SELECT 1 FROM shipit.cashbook_effects e WHERE e.organization_id=request.organization_id AND e.franchise_id=request.franchise_id AND e.request_id=previous.id)
  OR EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.request_id=c.id WHERE c.organization_id=request.organization_id AND c.franchise_id=request.franchise_id AND c.correction_of=previous.id AND c.id<>request.id)
  THEN RAISE EXCEPTION 'CASHBOOK_CORRECTION_TARGET_STALE' USING ERRCODE='23514';END IF;
 END IF;
 SELECT * INTO source FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.source_location_id;
 SELECT * INTO source_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.source_location_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO source_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=source.account_id ORDER BY version DESC LIMIT 1;
 IF source.id IS NULL OR source_revision.id IS DISTINCT FROM request.source_revision_id OR (request.correction_of IS NULL AND request.kind<>'cod_reservation_reversal' AND (NOT source_revision.active OR NOT source_account.active OR source_account.id IS DISTINCT FROM source_revision.account_revision_id))
 OR COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id),0)<>request.expected_source_version
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_SOURCE_STALE' USING ERRCODE='23514';END IF;
 IF request.correction_of IS NULL AND request.kind<>'cod_reservation_reversal' AND source.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent') AND m.user_id=source.custodian_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODIAN_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO method_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=source.account_id AND id=source_revision.account_revision_id;
 IF request.kind IN ('expense','agent_advance','agent_fee_payment','cod_remittance') AND ((source.kind='cash') IS DISTINCT FROM (request.payment_method='cash') OR (request.correction_of IS NULL OR previous.payment_method IS DISTINCT FROM request.payment_method) AND NOT COALESCE(request.payment_method=ANY(method_account.methods),false))
 THEN RAISE EXCEPTION 'CASHBOOK_EXPENSE_METHOD_INVALID' USING ERRCODE='23514';END IF;
 IF request.kind='opening_float' AND source.kind<>'cash' THEN RAISE EXCEPTION 'CASHBOOK_FLOAT_REQUIRES_CASH' USING ERRCODE='23514';END IF;
 IF request.target_location_id IS NOT NULL THEN
  SELECT * INTO target FROM shipit.cash_locations WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.target_location_id;
  SELECT * INTO target_revision FROM shipit.cash_location_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND location_id=request.target_location_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO target_account FROM shipit.receiving_account_revisions WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND account_id=target.account_id ORDER BY version DESC LIMIT 1;
  IF target.id IS NULL OR target_revision.id IS DISTINCT FROM request.target_revision_id OR (request.correction_of IS NULL AND (NOT target_revision.active OR NOT target_account.active OR target_account.id IS DISTINCT FROM target_revision.account_revision_id))
   OR (request.kind='deposit' AND (source.kind<>'cash' OR target.kind<>'noncash')) OR (request.kind='withdrawal' AND (source.kind<>'noncash' OR target.kind<>'cash'))
  THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_TARGET_STALE' USING ERRCODE='23514';END IF;
  IF request.correction_of IS NULL AND target.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent') AND m.user_id=target.custodian_id)
  THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODIAN_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF request.kind='agent_advance' THEN
  IF request.agent_payee_id IS NULL OR (request.correction_of IS NOT NULL AND previous.agent_payee_id IS DISTINCT FROM request.agent_payee_id)
   OR (request.correction_of IS NULL AND NOT shipit.custody_member(request.organization_id,request.franchise_id,request.agent_payee_id,'delivery_agent'))
  THEN RAISE EXCEPTION 'AGENT_ADVANCE_PAYEE_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 PERFORM shipit.check_cashbook_cod_sources(request);
 PERFORM shipit.check_cashbook_fee_sources(request);
END $fn$;
CREATE OR REPLACE FUNCTION shipit.cashbook_intended_legs(request shipit.cashbook_requests)
RETURNS TABLE(location_id uuid,direction text,amount_paise bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE delta numeric:=request.amount_paise;previous bigint;source_direction text;previous_cash bigint;
BEGIN
 IF request.kind='cod_reservation_reversal' THEN RETURN;END IF;
 IF request.fee_earning_id IS NOT NULL THEN
  delta:=request.fee_cash_paise;
  IF request.correction_of IS NOT NULL THEN SELECT fee_cash_paise INTO previous_cash FROM shipit.cashbook_requests WHERE organization_id=request.organization_id AND franchise_id=request.franchise_id AND id=request.correction_of;delta:=delta-previous_cash;END IF;
  IF delta<>0 THEN RETURN QUERY SELECT request.source_location_id,CASE WHEN delta>0 THEN 'out'::text ELSE 'in'::text END,abs(delta)::bigint;END IF;
  RETURN;
 END IF;
 IF request.correction_of IS NOT NULL THEN SELECT r.amount_paise INTO previous FROM shipit.cashbook_requests r WHERE r.organization_id=request.organization_id AND r.franchise_id=request.franchise_id AND r.id=request.correction_of;delta:=delta-previous;END IF;
 IF delta=0 THEN RETURN;END IF;
 source_direction:=CASE WHEN (request.kind IN ('opening_float','owner_funds'))=(delta>0) THEN 'in' ELSE 'out' END;
 RETURN QUERY SELECT request.source_location_id,source_direction,abs(delta)::bigint;
 IF request.target_location_id IS NOT NULL THEN RETURN QUERY SELECT request.target_location_id,CASE WHEN source_direction='in' THEN 'out' ELSE 'in' END,abs(delta)::bigint;END IF;
END $fn$;
CREATE OR REPLACE FUNCTION shipit.guard_cashbook_effect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;approval shipit.cashbook_request_decisions;available numeric;pending numeric;target_total numeric;leg record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.creation_xid<>pg_current_xact_id() THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role='franchise_admin' AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id FOR UPDATE;
 SELECT * INTO approval FROM shipit.cashbook_request_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.decision_id;
 IF request.id IS NULL OR approval.request_id IS DISTINCT FROM request.id OR approval.decision IS DISTINCT FROM 'approved' OR approval.actor_id=request.actor_id
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cashbook_request_sources(request);
 SELECT recorded,reserved INTO available,pending FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,request.source_location_id,NULL);
 IF request.kind='cod_reservation_reversal' THEN NULL;
 ELSIF request.correction_of IS NOT NULL THEN
  FOR leg IN SELECT * FROM shipit.cashbook_intended_legs(request) LOOP
   SELECT COALESCE(sum(CASE WHEN direction='in' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO target_total FROM shipit.cashbook_source_facts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=leg.location_id;
   target_total:=target_total+CASE WHEN leg.direction='in' THEN leg.amount_paise ELSE -leg.amount_paise END;
   IF abs(target_total)>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
  END LOOP;
 ELSIF request.kind IN ('expense','agent_advance','agent_fee_payment','cod_remittance','deposit','withdrawal') THEN
  IF COALESCE(request.fee_cash_paise,request.amount_paise)>0 AND (available-pending<COALESCE(request.fee_cash_paise,request.amount_paise) OR (SELECT COALESCE(sum(CASE WHEN f.source_kind='refund' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END),0) FROM shipit.cashbook_source_facts f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=request.source_location_id
   WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND f.location_id IS NULL AND f.source_kind IN ('refund','refund_correction') AND (f.account_id IS NULL OR f.account_id=l.account_id))>0)
  THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  IF available+request.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF request.correction_of IS NULL AND request.target_location_id IS NOT NULL THEN
  SELECT COALESCE(sum(CASE WHEN direction='in' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0) INTO target_total FROM shipit.cashbook_source_facts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=request.target_location_id;
  IF target_total+request.amount_paise>9007199254740991 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

CREATE VIEW shipit.cod_receipt_positions AS
 SELECT a.organization_id,a.franchise_id,a.id allocation_id,a.receipt_id,a.obligation_id,a.obligation_revision_id,o.beneficiary_id,o.beneficiary_revision_id,a.amount_paise collected_paise,
 COALESCE(sum(r.amount_paise::numeric) FILTER(WHERE r.kind='cod_remittance'),0) remitted_paise,COALESCE(sum(r.amount_paise::numeric) FILTER(WHERE r.kind='cod_reservation_reversal'),0) reversed_paise,
 a.amount_paise::numeric-COALESCE(sum(r.amount_paise::numeric) FILTER(WHERE r.kind='cod_reservation_reversal'),0) reserved_paise,a.amount_paise::numeric-COALESCE(sum(r.amount_paise::numeric),0) remaining_paise
 FROM shipit.cod_receipt_allocations a JOIN shipit.cod_obligation_revisions o ON o.organization_id=a.organization_id AND o.franchise_id=a.franchise_id AND o.id=a.obligation_revision_id
 LEFT JOIN (SELECT r.* FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
  WHERE r.kind IN ('cod_remittance','cod_reservation_reversal') AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id)) r
 ON r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.cod_allocation_id=a.id
 GROUP BY a.organization_id,a.franchise_id,a.id,a.receipt_id,a.obligation_id,a.obligation_revision_id,o.beneficiary_id,o.beneficiary_revision_id,a.amount_paise;
REVOKE ALL ON shipit.cod_receipt_positions FROM PUBLIC;
CREATE VIEW shipit.agent_fee_applied_requests AS
 SELECT r.* FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE r.fee_earning_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id);
CREATE VIEW shipit.agent_fee_positions AS
 SELECT f.organization_id,f.franchise_id,f.id earning_id,f.agent_id,f.amount_paise earned_paise,
 COALESCE(sum(r.amount_paise::numeric) FILTER(WHERE r.kind='expense'),0) expense_paise,
 COALESCE(sum(r.fee_cash_paise::numeric),0) cash_paid_paise,COALESCE(sum(r.fee_advance_paise::numeric),0) advance_applied_paise,
 f.amount_paise::numeric-COALESCE(sum(r.fee_cash_paise::numeric+r.fee_advance_paise),0) remaining_paise
 FROM shipit.agent_fee_earnings f LEFT JOIN shipit.agent_fee_applied_requests r ON r.organization_id=f.organization_id AND r.franchise_id=f.franchise_id AND r.fee_earning_id=f.id
 GROUP BY f.organization_id,f.franchise_id,f.id,f.agent_id,f.amount_paise;
CREATE VIEW shipit.agent_advance_positions AS
 WITH RECURSIVE chain AS (
  SELECT r.organization_id,r.franchise_id,r.id origin_id,r.id head_id,r.agent_payee_id agent_id,r.amount_paise FROM shipit.cashbook_requests r
  JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.kind='agent_advance' AND r.correction_of IS NULL
  UNION ALL SELECT r.organization_id,r.franchise_id,c.origin_id,r.id,r.agent_payee_id,r.amount_paise FROM shipit.cashbook_requests r JOIN chain c ON r.organization_id=c.organization_id AND r.franchise_id=c.franchise_id AND r.correction_of=c.head_id
  JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 ),heads AS (SELECT c.* FROM chain c WHERE NOT EXISTS(SELECT 1 FROM chain next WHERE next.organization_id=c.organization_id AND next.franchise_id=c.franchise_id AND next.origin_id=c.origin_id AND next.head_id<>c.head_id AND EXISTS(SELECT 1 FROM shipit.cashbook_requests r WHERE r.id=next.head_id AND r.correction_of=c.head_id)))
 SELECT h.organization_id,h.franchise_id,h.origin_id,h.head_id,h.agent_id,h.amount_paise,
 COALESCE(sum(r.fee_advance_paise::numeric),0) applied_paise,h.amount_paise::numeric-COALESCE(sum(r.fee_advance_paise::numeric),0) remaining_paise
 FROM heads h LEFT JOIN shipit.agent_fee_applied_requests r ON r.organization_id=h.organization_id AND r.franchise_id=h.franchise_id AND r.fee_advance_request_id=h.origin_id
 GROUP BY h.organization_id,h.franchise_id,h.origin_id,h.head_id,h.agent_id,h.amount_paise;
REVOKE ALL ON shipit.agent_fee_applied_requests,shipit.agent_fee_positions,shipit.agent_advance_positions FROM PUBLIC;

-- Fungible cash provenance. Components freeze at first acknowledged attribution;
-- later financial reclassification remains separate immutable evidence.
CREATE TABLE shipit.cash_receipt_component_captures (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,command_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,franchise_id,receipt_id),
 FOREIGN KEY(organization_id,franchise_id,receipt_id) REFERENCES shipit.money_receipts(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.cash_handover_commands(organization_id,franchise_id,id)
);
CREATE TABLE shipit.cash_receipt_components (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,receipt_id uuid NOT NULL,
 component_kind text NOT NULL CHECK(component_kind IN ('freight','cod','unallocated')),component_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 cod_allocation_id uuid,booking_id uuid,
 PRIMARY KEY(organization_id,franchise_id,receipt_id,component_kind,component_id),
 CHECK((component_kind='cod')=(cod_allocation_id IS NOT NULL)),CHECK((component_kind='freight')=(booking_id IS NOT NULL)),
 CHECK(component_id=COALESCE(cod_allocation_id,booking_id,receipt_id)),
 FOREIGN KEY(organization_id,franchise_id,receipt_id) REFERENCES shipit.cash_receipt_component_captures(organization_id,franchise_id,receipt_id),
 FOREIGN KEY(organization_id,franchise_id,cod_allocation_id) REFERENCES shipit.cod_receipt_allocations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id)
);
CREATE TABLE shipit.cash_handover_attributions (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,command_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>0),
 source_kind text NOT NULL,source_id uuid NOT NULL,origin_location_id uuid NOT NULL,origin_recorded_at timestamptz NOT NULL,
 source_credit_kind text NOT NULL,source_credit_id uuid NOT NULL,source_credit_recorded_at timestamptz NOT NULL,
 component_kind text NOT NULL CHECK(component_kind IN ('freight','cod','unallocated','other_funds','unattributed')),component_id uuid NOT NULL,
 receipt_id uuid,cod_allocation_id uuid,booking_id uuid,amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,franchise_id,command_id,ordinal),
 CHECK((source_kind='receipt')=(receipt_id IS NOT NULL)),CHECK(receipt_id IS NULL OR receipt_id=source_id),
 CHECK((component_kind='cod')=(cod_allocation_id IS NOT NULL)),CHECK((component_kind='freight')=(booking_id IS NOT NULL)),
 CHECK((receipt_id IS NOT NULL)=(component_kind IN ('freight','cod','unallocated'))),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.cash_handover_commands(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,origin_location_id) REFERENCES shipit.cash_locations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,receipt_id,component_kind,component_id) REFERENCES shipit.cash_receipt_components(organization_id,franchise_id,receipt_id,component_kind,component_id)
);
CREATE INDEX cash_attribution_root_idx ON shipit.cash_handover_attributions(organization_id,franchise_id,source_kind,source_id,origin_location_id,component_kind,component_id);
CREATE FUNCTION shipit.guard_cash_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'CASH_ATTRIBUTION_IMMUTABLE_SERVER_SOURCE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER cash_receipt_capture_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_receipt_component_captures FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_attribution();
CREATE TRIGGER cash_receipt_component_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_receipt_components FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_attribution();
CREATE TRIGGER cash_attribution_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.cash_handover_attributions FOR EACH ROW EXECUTE FUNCTION shipit.guard_cash_attribution();

CREATE FUNCTION shipit.receipt_cash_components_current(p_org uuid,p_franchise uuid,p_receipt uuid)
RETURNS TABLE(component_kind text,component_id uuid,amount_paise numeric,cod_allocation_id uuid,booking_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 WITH known AS (
  SELECT 'cod'::text component_kind,p.allocation_id component_id,p.reserved_paise amount_paise,p.allocation_id cod_allocation_id,NULL::uuid booking_id
  FROM shipit.cod_receipt_positions p WHERE p.organization_id=p_org AND p.franchise_id=p_franchise AND p.receipt_id=p_receipt AND p.reserved_paise>0
  UNION ALL
  SELECT 'freight',a.booking_id,sum(CASE WHEN a.kind='allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END),NULL::uuid,a.booking_id
  FROM shipit.money_receipt_allocations a WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND a.receipt_id=p_receipt GROUP BY a.booking_id
  HAVING sum(CASE WHEN a.kind='allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END)>0
 ), proposed AS (
  SELECT * FROM known UNION ALL SELECT 'unallocated',r.id,r.amount_paise::numeric-COALESCE((SELECT sum(k.amount_paise) FROM known k),0),NULL::uuid,NULL::uuid
  FROM shipit.money_receipts r WHERE r.organization_id=p_org AND r.franchise_id=p_franchise AND r.id=p_receipt
 )
 SELECT p.* FROM proposed p WHERE p.amount_paise>0
$fn$;
CREATE FUNCTION shipit.receipt_cash_components(p_org uuid,p_franchise uuid,p_receipt uuid)
RETURNS TABLE(component_kind text,component_id uuid,amount_paise numeric,cod_allocation_id uuid,booking_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT c.component_kind,c.component_id,c.amount_paise::numeric,c.cod_allocation_id,c.booking_id FROM shipit.cash_receipt_components c
 WHERE c.organization_id=p_org AND c.franchise_id=p_franchise AND c.receipt_id=p_receipt
 UNION ALL SELECT p.* FROM shipit.receipt_cash_components_current(p_org,p_franchise,p_receipt) p
 WHERE NOT EXISTS(SELECT 1 FROM shipit.cash_receipt_component_captures c WHERE c.organization_id=p_org AND c.franchise_id=p_franchise AND c.receipt_id=p_receipt)
$fn$;

CREATE FUNCTION shipit.cash_source_attribution_capacity(p_org uuid,p_franchise uuid,p_location uuid,p_exclude uuid)
RETURNS TABLE(source_kind text,source_id uuid,origin_location_id uuid,origin_recorded_at timestamptz,source_credit_kind text,source_credit_id uuid,source_credit_recorded_at timestamptz,component_kind text,component_id uuid,receipt_id uuid,cod_allocation_id uuid,booking_id uuid,available_paise numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 WITH facts AS (
  SELECT f.* FROM shipit.cashbook_source_facts f JOIN shipit.cash_locations l ON l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.id=f.location_id AND l.kind='cash'
  WHERE f.organization_id=p_org AND f.franchise_id=p_franchise AND f.location_id=p_location AND NOT(f.source_kind='handover' AND f.source_id IS NOT DISTINCT FROM p_exclude)
 ), stock AS (
  SELECT f.source_kind,f.source_id,f.location_id origin_location_id,f.recorded_at origin_recorded_at,f.source_kind source_credit_kind,f.source_id source_credit_id,f.recorded_at source_credit_recorded_at,c.component_kind,c.component_id,f.source_id receipt_id,c.cod_allocation_id,c.booking_id,c.amount_paise quantity
  FROM facts f CROSS JOIN LATERAL shipit.receipt_cash_components(p_org,p_franchise,f.source_id) c WHERE f.source_kind='receipt' AND f.direction='in'
  UNION ALL
  SELECT f.source_kind,f.source_id,f.location_id,f.recorded_at,f.source_kind,f.source_id,f.recorded_at,CASE WHEN f.source_kind='handover' THEN 'unattributed' ELSE 'other_funds' END,f.source_id,NULL::uuid,NULL::uuid,NULL::uuid,f.amount_paise::numeric
  FROM facts f WHERE f.direction='in' AND f.source_kind<>'receipt' AND (f.source_kind<>'handover' OR NOT EXISTS(SELECT 1 FROM shipit.cash_handover_attributions a WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND a.command_id=f.source_id))
  UNION ALL
  SELECT a.source_kind,a.source_id,a.origin_location_id,a.origin_recorded_at,CASE WHEN h.target_location_id=p_location THEN 'handover' ELSE a.source_credit_kind END,CASE WHEN h.target_location_id=p_location THEN c.id ELSE a.source_credit_id END,CASE WHEN h.target_location_id=p_location THEN c.recorded_at ELSE a.source_credit_recorded_at END,a.component_kind,a.component_id,a.receipt_id,a.cod_allocation_id,a.booking_id,CASE WHEN h.target_location_id=p_location THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END
  FROM shipit.cash_handover_attributions a JOIN shipit.cash_handover_commands c ON c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id AND c.id=a.command_id
  JOIN shipit.cash_handovers h ON h.organization_id=c.organization_id AND h.franchise_id=c.franchise_id AND h.id=c.handover_id
  WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND a.command_id IS DISTINCT FROM p_exclude AND p_location IN(h.source_location_id,h.target_location_id)
 ), net AS (
  SELECT s.source_kind,s.source_id,s.origin_location_id,s.origin_recorded_at,s.source_credit_kind,s.source_credit_id,s.source_credit_recorded_at,s.component_kind,s.component_id,s.receipt_id,s.cod_allocation_id,s.booking_id,sum(s.quantity) quantity
  FROM stock s GROUP BY s.source_kind,s.source_id,s.origin_location_id,s.origin_recorded_at,s.source_credit_kind,s.source_credit_id,s.source_credit_recorded_at,s.component_kind,s.component_id,s.receipt_id,s.cod_allocation_id,s.booking_id HAVING sum(s.quantity)>0
 ), ordered AS (
  SELECT n.*,COALESCE(sum(n.quantity) OVER(ORDER BY n.source_credit_recorded_at,n.source_credit_kind,n.source_credit_id,n.origin_recorded_at,n.source_kind,n.source_id,n.origin_location_id,CASE n.component_kind WHEN 'freight' THEN 0 WHEN 'cod' THEN 1 ELSE 2 END,n.component_kind,n.component_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior
  FROM net n
 ), spent AS (
  SELECT COALESCE(sum(f.amount_paise::numeric),0) amount FROM facts f WHERE f.direction='out' AND (f.source_kind<>'handover' OR NOT EXISTS(SELECT 1 FROM shipit.cash_handover_attributions a WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND a.command_id=f.source_id))
 )
 SELECT o.source_kind,o.source_id,o.origin_location_id,o.origin_recorded_at,o.source_credit_kind,o.source_credit_id,o.source_credit_recorded_at,o.component_kind,o.component_id,o.receipt_id,o.cod_allocation_id,o.booking_id,GREATEST(0,o.quantity-GREATEST(0,s.amount-o.prior))
 FROM ordered o CROSS JOIN spent s WHERE o.quantity>GREATEST(0,s.amount-o.prior)
 ORDER BY o.source_credit_recorded_at,o.source_credit_kind,o.source_credit_id,o.origin_recorded_at,o.source_kind,o.source_id,o.origin_location_id,CASE o.component_kind WHEN 'freight' THEN 0 WHEN 'cod' THEN 1 ELSE 2 END,o.component_kind,o.component_id
$fn$;

CREATE FUNCTION shipit.capture_cash_handover_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE command shipit.cash_handover_commands;handover shipit.cash_handovers;part record;remaining numeric;take numeric;ordinal integer:=0;captured numeric;
BEGIN
 SELECT * INTO command FROM shipit.cash_handover_commands WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.command_id;
 IF command.kind<>'accept' OR (SELECT count(*) FROM shipit.cash_handover_legs WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.command_id)<>2
 OR EXISTS(SELECT 1 FROM shipit.cash_handover_attributions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.command_id) THEN RETURN NULL;END IF;
 SELECT * INTO handover FROM shipit.cash_handovers WHERE organization_id=command.organization_id AND franchise_id=command.franchise_id AND id=command.handover_id;
 -- Reuse the same owning lock as every receipt/effect/acknowledgement writer.
 PERFORM 1 FROM shipit.franchises WHERE organization_id=command.organization_id AND id=command.franchise_id FOR UPDATE;
 remaining:=command.amount_paise;
 FOR part IN SELECT * FROM shipit.cash_source_attribution_capacity(command.organization_id,command.franchise_id,handover.source_location_id,command.id) LOOP
  EXIT WHEN remaining=0;take:=LEAST(remaining,part.available_paise);IF take<=0 THEN CONTINUE;END IF;
  IF part.receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.cash_receipt_component_captures WHERE organization_id=command.organization_id AND franchise_id=command.franchise_id AND receipt_id=part.receipt_id) THEN
   INSERT INTO shipit.cash_receipt_component_captures(organization_id,franchise_id,receipt_id,command_id) VALUES(command.organization_id,command.franchise_id,part.receipt_id,command.id);
   -- Header is present now: use the actual source equations directly for the first capture.
   INSERT INTO shipit.cash_receipt_components(organization_id,franchise_id,receipt_id,component_kind,component_id,amount_paise,cod_allocation_id,booking_id)
   SELECT command.organization_id,command.franchise_id,part.receipt_id,c.component_kind,c.component_id,c.amount_paise::bigint,c.cod_allocation_id,c.booking_id FROM shipit.receipt_cash_components_current(command.organization_id,command.franchise_id,part.receipt_id) c;
   SELECT sum(amount_paise) INTO captured FROM shipit.cash_receipt_components WHERE organization_id=command.organization_id AND franchise_id=command.franchise_id AND receipt_id=part.receipt_id;
   IF captured IS DISTINCT FROM (SELECT amount_paise::numeric FROM shipit.money_receipts WHERE organization_id=command.organization_id AND franchise_id=command.franchise_id AND id=part.receipt_id) THEN RAISE EXCEPTION 'CASH_RECEIPT_COMPONENTS_INCOMPLETE' USING ERRCODE='23514';END IF;
  END IF;
  ordinal:=ordinal+1;
  INSERT INTO shipit.cash_handover_attributions(organization_id,franchise_id,command_id,ordinal,source_kind,source_id,origin_location_id,origin_recorded_at,source_credit_kind,source_credit_id,source_credit_recorded_at,component_kind,component_id,receipt_id,cod_allocation_id,booking_id,amount_paise)
  VALUES(command.organization_id,command.franchise_id,command.id,ordinal,part.source_kind,part.source_id,part.origin_location_id,part.origin_recorded_at,part.source_credit_kind,part.source_credit_id,part.source_credit_recorded_at,part.component_kind,part.component_id,part.receipt_id,part.cod_allocation_id,part.booking_id,take::bigint);
  remaining:=remaining-take;
 END LOOP;
 IF remaining<>0 THEN RAISE EXCEPTION 'CASH_HANDOVER_ATTRIBUTION_CAPACITY' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE TRIGGER cash_handover_attribution AFTER INSERT ON shipit.cash_handover_legs FOR EACH ROW EXECUTE FUNCTION shipit.capture_cash_handover_attribution();
CREATE FUNCTION shipit.check_cash_handover_attribution_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF COALESCE((SELECT sum(amount_paise::numeric) FROM shipit.cash_handover_attributions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND command_id=NEW.id),0)<>NEW.amount_paise THEN RAISE EXCEPTION 'CASH_HANDOVER_ATTRIBUTION_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER zzz_cash_handover_attribution_complete AFTER INSERT ON shipit.cash_handover_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_cash_handover_attribution_complete();
REVOKE ALL ON shipit.cash_receipt_component_captures,shipit.cash_receipt_components,shipit.cash_handover_attributions FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_cash_attribution(),shipit.receipt_cash_components(uuid,uuid,uuid),shipit.receipt_cash_components_current(uuid,uuid,uuid),shipit.cash_source_attribution_capacity(uuid,uuid,uuid,uuid),shipit.capture_cash_handover_attribution(),shipit.check_cash_handover_attribution_complete() FROM PUBLIC;


-- Immutable physical-money capture input. Full settlement submission remains a separate contract.
CREATE TABLE shipit.agent_daily_cash_captures (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 day date NOT NULL CHECK(day BETWEEN DATE '2000-01-01' AND DATE '9998-12-31'),
 counted_at timestamptz NOT NULL CHECK(isfinite(counted_at)),counted_paise bigint NOT NULL CHECK(counted_paise BETWEEN 0 AND 9007199254740991),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 correlation_id uuid NOT NULL,key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=8388608),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX agent_daily_cash_captures_agent_day ON shipit.agent_daily_cash_captures(organization_id,franchise_id,agent_id,day,recorded_at,id);
CREATE FUNCTION shipit.agent_daily_cash_source_frame(p_org uuid,p_franchise uuid,p_agent uuid,p_day date,p_count timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
SELECT to_jsonb(captured) FROM (

 SELECT * FROM (WITH frame AS (
 SELECT f.organization_id,f.id franchise_id,p_agent::uuid agent_id,p_day::date AS day,p_count::timestamptz counted_at,date_trunc('milliseconds',statement_timestamp()) as_of,
 p_day::date::timestamp AT TIME ZONE 'Asia/Kolkata' day_start
 FROM shipit.franchises f WHERE f.organization_id=p_org AND f.id=p_franchise
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 WHERE m.organization_id=f.organization_id AND ms.franchise_id=f.id AND m.user_id=p_agent AND m.role='delivery_agent')
 ), facts AS (
 SELECT sf.* FROM frame p JOIN shipit.cashbook_source_facts sf ON sf.organization_id=p.organization_id AND sf.franchise_id=p.franchise_id
 JOIN shipit.cash_locations l ON l.organization_id=sf.organization_id AND l.franchise_id=sf.franchise_id AND l.id=sf.location_id
 WHERE l.kind='cash' AND l.custodian_id=p.agent_id AND sf.occurred_at<=p.counted_at AND sf.recorded_at<=p.as_of
 ), receipt_sources AS (
 SELECT r.* FROM frame p JOIN shipit.money_receipts r ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id
 WHERE (r.initial_custodian_id=p.agent_id OR r.receiver_id=p.agent_id) AND r.occurred_at<=p.counted_at AND r.recorded_at<=p.as_of
 )
 SELECT p.agent_id,p.day::text,to_char(p.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') counted_at,
 to_char(p.as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as_of,
 COALESCE((SELECT v.version::text FROM shipit.cashbook_source_versions v WHERE v.organization_id=p.organization_id AND v.franchise_id=p.franchise_id),'0') source_version,
 p.counted_at>=p.day_start AND p.counted_at<p.day_start+interval '1 day' AND p.counted_at<=p.as_of valid,
 (SELECT count(*)::int FROM facts)+(SELECT count(*)::int FROM receipt_sources) source_count,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('source_kind',f.source_kind,'source_id',f.source_id,'location_id',f.location_id,'direction',f.direction,'amount_paise',f.amount_paise::text,
 'occurred_at',to_char(f.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(f.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'request_id',f.request_id,'correction_of',f.correction_of) ORDER BY f.occurred_at,f.recorded_at,f.source_kind,f.source_id,f.location_id,f.direction)
 FROM (SELECT * FROM facts ORDER BY occurred_at,recorded_at,source_kind,source_id,location_id,direction LIMIT 5001) f),'[]'::jsonb) cash_facts,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('receipt_id',r.id,'method',r.method,'amount_paise',r.amount_paise::text,'receiver_id',r.receiver_id,'initial_custodian_id',r.initial_custodian_id,
 'occurred_at',to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY r.occurred_at,r.recorded_at,r.id)
 FROM (SELECT * FROM receipt_sources ORDER BY occurred_at,recorded_at,id LIMIT 5001) r),'[]'::jsonb) receipts,
 (SELECT count(*)::int FROM shipit.cashbook_source_facts u WHERE u.organization_id=p.organization_id AND u.franchise_id=p.franchise_id AND u.location_id IS NULL
 AND (u.payment_method='cash' OR u.payment_method IS NULL) AND u.occurred_at<=p.counted_at AND u.recorded_at<=p.as_of) unassigned_franchise_sources_count,
 COALESCE((SELECT sum(CASE direction WHEN 'in' THEN amount_paise::numeric ELSE -amount_paise::numeric END) FROM facts WHERE occurred_at<p.day_start),0)::text opening,
 COALESCE((SELECT sum(amount_paise::numeric) FROM facts WHERE occurred_at>=p.day_start AND direction='in'),0)::text inflow,
 COALESCE((SELECT sum(amount_paise::numeric) FROM facts WHERE occurred_at>=p.day_start AND direction='out'),0)::text outflow
 FROM frame p) captured
) captured
$fn$;
-- Source-linked finance evidence, reconstructed at the count and capture cutoffs.
CREATE FUNCTION shipit.agent_statement_finance_frame(p_org uuid,p_franchise uuid,p_agent uuid,p_count timestamptz,p_as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
WITH RECURSIVE receipts AS (
 SELECT r.id,r.method,r.amount_paise FROM shipit.money_receipts r
 WHERE r.organization_id=p_org AND r.franchise_id=p_franchise AND (r.receiver_id=p_agent OR r.initial_custodian_id=p_agent)
 AND r.occurred_at<=p_count AND r.recorded_at<=p_as_of
), applied AS (
 SELECT r.*,e.id effect_id,e.recorded_at effect_recorded_at FROM shipit.cashbook_requests r
 JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE r.organization_id=p_org AND r.franchise_id=p_franchise AND r.occurred_at<=p_count AND e.recorded_at<=p_as_of
), heads AS (
 SELECT r.* FROM applied r WHERE NOT EXISTS(SELECT 1 FROM applied c WHERE c.correction_of=r.id)
), freight AS (
 SELECT a.id,a.receipt_id,a.booking_id,a.kind,a.amount_paise,a.release_of,c.recorded_at
 FROM shipit.money_receipt_allocations a JOIN receipts r ON r.id=a.receipt_id
 JOIN shipit.money_receipt_commands c ON c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id AND c.id=a.command_id
 WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND c.state='committed' AND c.recorded_at<=p_as_of
), cod AS (
 SELECT a.id allocation_id,a.receipt_id,a.obligation_id,a.obligation_revision_id,o.beneficiary_id,o.beneficiary_revision_id,
 a.amount_paise::numeric collected_paise,a.recorded_at,
 COALESCE((SELECT sum(r.amount_paise::numeric) FROM heads r WHERE r.cod_allocation_id=a.id AND r.kind='cod_remittance'),0) remitted_paise,
 COALESCE((SELECT sum(r.amount_paise::numeric) FROM heads r WHERE r.cod_allocation_id=a.id AND r.kind='cod_reservation_reversal'),0) reversed_paise
 FROM shipit.cod_receipt_allocations a JOIN receipts r ON r.id=a.receipt_id
 JOIN shipit.cod_obligation_revisions o ON o.organization_id=a.organization_id AND o.franchise_id=a.franchise_id AND o.id=a.obligation_revision_id
 WHERE a.organization_id=p_org AND a.franchise_id=p_franchise AND a.recorded_at<=p_as_of
), earnings AS (
 SELECT f.*,CASE f.basis WHEN 'per_delivery' THEN p.completed_at ELSE f.recorded_at END effective_at
 FROM shipit.agent_fee_earnings f LEFT JOIN shipit.delivery_proofs p ON p.organization_id=f.organization_id AND p.franchise_id=f.franchise_id AND p.id=f.proof_id
 WHERE f.organization_id=p_org AND f.franchise_id=p_franchise AND f.agent_id=p_agent AND f.recorded_at<=p_as_of
 AND CASE f.basis WHEN 'per_delivery' THEN p.completed_at ELSE f.recorded_at END<=p_count
), fee_heads AS (
 SELECT h.* FROM heads h JOIN earnings f ON f.id=h.fee_earning_id WHERE h.agent_payee_id=p_agent
), fee_positions AS (
 SELECT f.id earning_id,f.agent_id,f.term_revision_id,f.basis,f.proof_id,f.parcel_id,f.covered_from,f.covered_until,f.effective_at,f.recorded_at,f.amount_paise::numeric earned_paise,
 COALESCE((SELECT sum(r.amount_paise::numeric) FROM fee_heads r WHERE r.fee_earning_id=f.id AND r.kind='expense'),0) expense_paise,
 COALESCE((SELECT sum(r.fee_cash_paise::numeric) FROM fee_heads r WHERE r.fee_earning_id=f.id),0) cash_paid_paise,
 COALESCE((SELECT sum(r.fee_advance_paise::numeric) FROM fee_heads r WHERE r.fee_earning_id=f.id),0) advance_applied_paise,
 COALESCE((SELECT sum(r.fee_cash_paise::numeric) FROM fee_heads r WHERE r.fee_earning_id=f.id AND r.payment_method='cash'),0) physical_cash_paid_paise
 FROM earnings f
), advance_chain AS (
 SELECT r.id origin_id,r.id head_id,r.amount_paise::numeric FROM applied r WHERE r.kind='agent_advance' AND r.agent_payee_id=p_agent AND r.correction_of IS NULL
 UNION ALL SELECT c.origin_id,r.id,r.amount_paise::numeric FROM advance_chain c JOIN applied r ON r.correction_of=c.head_id
), advances AS (
 SELECT c.*,COALESCE((SELECT sum(r.fee_advance_paise::numeric) FROM fee_heads r WHERE r.fee_advance_request_id=c.origin_id),0) applied_paise
 FROM advance_chain c WHERE NOT EXISTS(SELECT 1 FROM applied next WHERE next.correction_of=c.head_id)
), receipt_positions AS (
 SELECT r.*,COALESCE((SELECT sum(CASE f.kind WHEN 'allocation' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END) FROM freight f WHERE f.receipt_id=r.id),0) freight_paise,
 COALESCE((SELECT sum(c.collected_paise-c.reversed_paise) FROM cod c WHERE c.receipt_id=r.id),0) cod_reserved_paise FROM receipts r
), financial_effects AS (
 SELECT r.id request_id,r.effect_id,r.kind,r.payment_method,r.correction_of,r.cod_allocation_id,r.fee_earning_id,r.fee_advance_request_id,r.amount_paise::text amount_paise,
 r.fee_cash_paise::text fee_cash_paise,r.fee_advance_paise::text fee_advance_paise,
 to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') occurred_at,
 to_char(r.effect_recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at,
 EXISTS(SELECT 1 FROM heads h WHERE h.id=r.id) is_current_at_cutoff
 FROM applied r WHERE r.id IN(SELECT head_id FROM advance_chain) OR r.fee_earning_id IN(SELECT id FROM earnings) OR r.cod_allocation_id IN(SELECT allocation_id FROM cod)
), handover_commands AS (
 SELECT c.id FROM shipit.cash_handover_commands c
 JOIN shipit.cash_handovers h ON h.organization_id=c.organization_id AND h.franchise_id=c.franchise_id AND h.id=c.handover_id
 JOIN shipit.cash_locations s ON s.organization_id=h.organization_id AND s.franchise_id=h.franchise_id AND s.id=h.source_location_id
 JOIN shipit.cash_locations t ON t.organization_id=h.organization_id AND t.franchise_id=h.franchise_id AND t.id=h.target_location_id
 WHERE c.organization_id=p_org AND c.franchise_id=p_franchise AND c.amount_paise>0 AND c.recorded_at<=p_count AND c.recorded_at<=p_as_of AND (s.custodian_id=p_agent OR t.custodian_id=p_agent)
), attributions AS (
 SELECT a.command_id,a.ordinal,a.source_kind,a.source_id,a.origin_location_id,a.component_kind,a.component_id,a.receipt_id,a.cod_allocation_id,a.booking_id,a.amount_paise::text amount_paise
 FROM shipit.cash_handover_attributions a JOIN handover_commands h ON h.id=a.command_id WHERE a.organization_id=p_org AND a.franchise_id=p_franchise
)
SELECT jsonb_build_object('schema_version',1,'basis','origin_receipts_and_agent_entitlements','seller_liability_is_agent_debt',false,
 'counted_at',to_char(p_count AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'as_of',to_char(p_as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'source_count',(SELECT count(*) FROM receipt_positions)+(SELECT count(*) FROM freight)+(SELECT count(*) FROM cod)+(SELECT count(*) FROM fee_positions)+(SELECT count(*) FROM advances)+(SELECT count(*) FROM financial_effects)+(SELECT count(*) FROM attributions),
 'receipt_positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('receipt_id',id,'method',method,'received_paise',amount_paise::text,'freight_applied_paise',freight_paise::text,'cod_reserved_paise',cod_reserved_paise::text,'unallocated_paise',(amount_paise-freight_paise-cod_reserved_paise)::text) ORDER BY id) FROM (SELECT * FROM receipt_positions ORDER BY id LIMIT 5001) r),'[]'::jsonb),
 'freight_applications',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'receipt_id',receipt_id,'booking_id',booking_id,'kind',kind,'amount_paise',amount_paise::text,'release_of',release_of,'recorded_at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY recorded_at,id) FROM (SELECT * FROM freight ORDER BY recorded_at,id LIMIT 5001) f),'[]'::jsonb),
 'cod_positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('allocation_id',allocation_id,'receipt_id',receipt_id,'obligation_id',obligation_id,'obligation_revision_id',obligation_revision_id,'beneficiary_id',beneficiary_id,'beneficiary_revision_id',beneficiary_revision_id,
 'collected_paise',collected_paise::text,'remitted_paise',remitted_paise::text,'reversed_paise',reversed_paise::text,'reserved_paise',(collected_paise-reversed_paise)::text,'remaining_paise',(collected_paise-remitted_paise-reversed_paise)::text,'recorded_at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY allocation_id) FROM (SELECT * FROM cod ORDER BY allocation_id LIMIT 5001) c),'[]'::jsonb),
 'fee_positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('earning_id',earning_id,'term_revision_id',term_revision_id,'basis',basis,'proof_id',proof_id,'parcel_id',parcel_id,
 'covered_from',to_char(covered_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'covered_until',to_char(covered_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'effective_at',to_char(effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'earned_paise',earned_paise::text,'expense_paise',expense_paise::text,'direct_paid_paise',cash_paid_paise::text,'cash_paid_paise',physical_cash_paid_paise::text,'noncash_paid_paise',(cash_paid_paise-physical_cash_paid_paise)::text,'advance_applied_paise',advance_applied_paise::text,'remaining_paise',(earned_paise-cash_paid_paise-advance_applied_paise)::text) ORDER BY earning_id) FROM (SELECT * FROM fee_positions ORDER BY earning_id LIMIT 5001) f),'[]'::jsonb),
 'advance_positions',COALESCE((SELECT jsonb_agg(jsonb_build_object('origin_request_id',origin_id,'head_request_id',head_id,'payment_method',(SELECT payment_method FROM applied WHERE id=head_id),'paid_paise',amount_paise::text,'applied_paise',applied_paise::text,'unapplied_paise',(amount_paise-applied_paise)::text) ORDER BY origin_id) FROM (SELECT * FROM advances ORDER BY origin_id LIMIT 5001) a),'[]'::jsonb),
 'financial_effects',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY recorded_at,request_id) FROM (SELECT * FROM financial_effects ORDER BY recorded_at,request_id LIMIT 5001) e),'[]'::jsonb),
 'handover_attributions',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY command_id,ordinal) FROM (SELECT * FROM attributions ORDER BY command_id,ordinal LIMIT 5001) a),'[]'::jsonb),
 'legacy_unattributed_handovers',(SELECT count(*) FROM handover_commands h WHERE NOT EXISTS(SELECT 1 FROM attributions a WHERE a.command_id=h.id)),
 'totals',jsonb_build_object('received_paise',COALESCE((SELECT sum(amount_paise::numeric) FROM receipts),0)::text,'freight_applied_paise',COALESCE((SELECT sum(freight_paise) FROM receipt_positions),0)::text,
 'cod_collected_paise',COALESCE((SELECT sum(collected_paise) FROM cod),0)::text,'cod_remitted_paise',COALESCE((SELECT sum(remitted_paise) FROM cod),0)::text,'cod_reversed_paise',COALESCE((SELECT sum(reversed_paise) FROM cod),0)::text,'origin_receipt_seller_liability_paise',COALESCE((SELECT sum(collected_paise-remitted_paise-reversed_paise) FROM cod),0)::text,
 'earned_fee_paise',COALESCE((SELECT sum(earned_paise) FROM fee_positions),0)::text,'fee_expense_paise',COALESCE((SELECT sum(expense_paise) FROM fee_positions),0)::text,'fee_direct_paid_paise',COALESCE((SELECT sum(cash_paid_paise) FROM fee_positions),0)::text,'fee_cash_paid_paise',COALESCE((SELECT sum(physical_cash_paid_paise) FROM fee_positions),0)::text,'fee_noncash_paid_paise',COALESCE((SELECT sum(cash_paid_paise-physical_cash_paid_paise) FROM fee_positions),0)::text,'fee_advance_applied_paise',COALESCE((SELECT sum(advance_applied_paise) FROM fee_positions),0)::text,'remaining_fee_paise',COALESCE((SELECT sum(earned_paise-cash_paid_paise-advance_applied_paise) FROM fee_positions),0)::text,
 'advance_paid_paise',COALESCE((SELECT sum(amount_paise) FROM advances),0)::text,'unapplied_advance_paise',COALESCE((SELECT sum(amount_paise-applied_paise) FROM advances),0)::text))
$fn$;
CREATE FUNCTION shipit.agent_statement_parcel_frame(p_org uuid,p_franchise uuid,p_agent uuid,p_day date,p_count timestamptz,p_as_of timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
WITH bounds AS (SELECT p_day::timestamp AT TIME ZONE 'Asia/Kolkata' starts), receipts AS MATERIALIZED (
 SELECT r.* FROM shipit.custody_receipts r
 WHERE r.organization_id=p_org AND r.franchise_id=p_franchise AND r.recorded_at<=p_count AND r.recorded_at<=p_as_of
 AND EXISTS(SELECT 1 FROM shipit.custody_receipts own WHERE own.organization_id=p_org AND own.franchise_id=p_franchise
  AND own.parcel_id=r.parcel_id AND own.agent_id=p_agent AND own.kind='agent_received' AND own.recorded_at<=p_count AND own.recorded_at<=p_as_of)
), opening AS (
 SELECT r.* FROM (SELECT DISTINCT ON(parcel_id) * FROM receipts,bounds WHERE recorded_at<starts ORDER BY parcel_id,sequence DESC) r
 WHERE r.kind='agent_received' AND r.agent_id=p_agent
), closing AS (
 SELECT r.* FROM (SELECT DISTINCT ON(parcel_id) * FROM receipts ORDER BY parcel_id,sequence DESC) r
 WHERE r.kind='agent_received' AND r.agent_id=p_agent
), transitions AS (
 SELECT r.id receipt_id,r.parcel_id,r.attempt_id,r.previous_receipt_id,r.proof_id,r.kind,r.discrepancy,
 CASE WHEN r.kind='agent_received' AND r.agent_id=p_agent THEN 'received'
 WHEN r.kind='recipient_received' THEN 'delivered' WHEN r.kind='office_received' THEN 'returned_to_office' ELSE 'transferred_to_agent' END outcome,
 to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at
 FROM receipts r LEFT JOIN receipts prev ON prev.id=r.previous_receipt_id CROSS JOIN bounds
 WHERE r.recorded_at>=starts AND (r.kind='agent_received' AND r.agent_id=p_agent OR prev.kind='agent_received' AND prev.agent_id=p_agent)
), proofs AS (
 SELECT p.id proof_id,p.parcel_id,p.attempt_id,p.proof_method,
 to_char(p.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') completed_at,
 to_char(c.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') committed_at,
 (SELECT r.id FROM receipts r WHERE r.proof_id=p.id AND r.kind='recipient_received') custody_receipt_id
 FROM shipit.delivery_proofs p JOIN shipit.delivery_commands c ON c.organization_id=p.organization_id AND c.franchise_id=p.franchise_id AND c.id=p.command_id
 CROSS JOIN bounds WHERE p.organization_id=p_org AND p.franchise_id=p_franchise AND p.completed_by=p_agent
 AND p.completed_at>=starts AND p.completed_at<=p_count AND c.state='committed' AND c.committed_at<=p_as_of
), discrepancies AS (
 SELECT d.id discrepancy_id,d.parcel_id,d.source_receipt_id,d.reason,
 to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at
 FROM shipit.custody_discrepancies d JOIN receipts r ON r.id=d.source_receipt_id CROSS JOIN bounds
 WHERE d.organization_id=p_org AND d.franchise_id=p_franchise AND r.agent_id=p_agent AND r.kind='agent_received'
 AND d.recorded_at>=starts AND d.recorded_at<=p_count AND d.recorded_at<=p_as_of
), held AS (
 SELECT COALESCE(o.parcel_id,c.parcel_id) parcel_id,o.id opening_receipt_id,c.id closing_receipt_id
 FROM opening o FULL JOIN closing c ON c.parcel_id=o.parcel_id
)
SELECT jsonb_build_object('basis','physical_custody_and_genuine_proof','day',p_day::text,
 'as_of',to_char(p_as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'counted_at',to_char(p_count AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'source_count',(SELECT count(*) FROM held)+(SELECT count(*) FROM transitions)+(SELECT count(*) FROM proofs)+(SELECT count(*) FROM discrepancies),
 'held_positions',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY parcel_id) FROM (SELECT * FROM held ORDER BY parcel_id LIMIT 5001) h),'[]'::jsonb),
 'transitions',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY recorded_at,receipt_id) FROM (SELECT * FROM transitions ORDER BY recorded_at,receipt_id LIMIT 5001) t),'[]'::jsonb),
 'delivery_proofs',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY completed_at,proof_id) FROM (SELECT * FROM proofs ORDER BY completed_at,proof_id LIMIT 5001) p),'[]'::jsonb),
 'discrepancies',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY recorded_at,discrepancy_id) FROM (SELECT * FROM discrepancies ORDER BY recorded_at,discrepancy_id LIMIT 5001) d),'[]'::jsonb),
 'totals',jsonb_build_object('opening_held',(SELECT count(*) FROM opening),'received',(SELECT count(*) FROM transitions WHERE outcome='received'),
 'delivered_from_custody',(SELECT count(*) FROM transitions WHERE outcome='delivered'),'returned_to_office',(SELECT count(*) FROM transitions WHERE outcome='returned_to_office'),
 'transferred_to_agent',(SELECT count(*) FROM transitions WHERE outcome='transferred_to_agent'),'held_at_count',(SELECT count(*) FROM closing),
 'proved_deliveries',(SELECT count(*) FROM proofs),'untracked_proved_deliveries',(SELECT count(*) FROM proofs WHERE custody_receipt_id IS NULL),
 'reported_missing',(SELECT count(*) FROM discrepancies WHERE reason='missing')))
$fn$;
REVOKE ALL ON FUNCTION shipit.agent_statement_parcel_frame(uuid,uuid,uuid,date,timestamptz,timestamptz) FROM PUBLIC;
CREATE FUNCTION shipit.agent_cash_finance_source_frame(p_org uuid,p_franchise uuid,p_agent uuid,p_day date,p_count timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
SELECT jsonb_build_object('cash',cash,'finance',shipit.agent_statement_finance_frame(p_org,p_franchise,p_agent,p_count,(cash->>'as_of')::timestamptz),'parcels',shipit.agent_statement_parcel_frame(p_org,p_franchise,p_agent,p_day,p_count,(cash->>'as_of')::timestamptz))
FROM (SELECT shipit.agent_daily_cash_source_frame(p_org,p_franchise,p_agent,p_day,p_count) cash) source
$fn$;
REVOKE ALL ON FUNCTION shipit.agent_statement_finance_frame(uuid,uuid,uuid,timestamptz,timestamptz),shipit.agent_cash_finance_source_frame(uuid,uuid,uuid,date,timestamptz) FROM PUBLIC;

CREATE FUNCTION shipit.guard_agent_daily_cash_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE raw jsonb;bundle jsonb;finance jsonb;parcels jsonb;admin boolean;operator boolean;agent boolean;expected numeric;variance numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.source_snapshot IS NOT NULL OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT COALESCE(bool_or(m.role='franchise_admin'),false),COALESCE(bool_or(m.role='operator'),false),COALESCE(bool_or(m.role='delivery_agent'),false) INTO admin,operator,agent
 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active';
 IF NOT (admin OR operator OR agent AND NEW.actor_id=NEW.agent_id) THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.agent_id AND m.role='delivery_agent'
 AND (admin OR m.lifecycle='active' AND u.lifecycle='active')) THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_AGENT_INVALID' USING ERRCODE='23514';END IF;
 bundle:=shipit.agent_cash_finance_source_frame(NEW.organization_id,NEW.franchise_id,NEW.agent_id,NEW.day,NEW.counted_at);raw:=bundle->'cash';finance:=bundle->'finance';parcels:=bundle->'parcels';
 IF raw IS NULL OR jsonb_typeof(raw)<>'object' OR (raw->>'valid') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_TIME_INVALID' USING ERRCODE='23514';END IF;
 IF (raw->>'source_count')::bigint+(finance->>'source_count')::bigint+(parcels->>'source_count')::bigint>5000 THEN RAISE EXCEPTION 'AGENT_STATEMENT_SOURCE_LIMIT' USING ERRCODE='54000';END IF;
 expected:=(raw->>'opening')::numeric+(raw->>'inflow')::numeric-(raw->>'outflow')::numeric;variance:=NEW.counted_paise-expected;
 NEW.source_snapshot:=jsonb_build_object('schema_version',1,'kind','physical_cash_capture','timezone','Asia/Kolkata','cash',raw,'finance',finance,'parcels',parcels,
 'totals',jsonb_build_object('opening_known_paise',raw->>'opening','day_in_paise',raw->>'inflow','day_out_paise',raw->>'outflow',
 'expected_paise',expected::text,'counted_paise',NEW.counted_paise::text,'variance_paise',variance::text,'shortage_paise',GREATEST(-variance,0)::text,'excess_paise',GREATEST(variance,0)::text,'ledger_exception',expected<0));
 IF octet_length(NEW.source_snapshot::text)>8388608 THEN RAISE EXCEPTION 'AGENT_STATEMENT_BYTE_LIMIT' USING ERRCODE='54000';END IF;
 NEW.recorded_at:=(raw->>'as_of')::timestamptz;RETURN NEW;
END $fn$;
CREATE TRIGGER agent_daily_cash_capture_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_daily_cash_captures FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_daily_cash_capture();
REVOKE ALL ON shipit.agent_daily_cash_captures FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.agent_daily_cash_source_frame(uuid,uuid,uuid,date,timestamptz),shipit.guard_agent_daily_cash_capture() FROM PUBLIC;


-- D144-1: immutable statement revisions and independent review; no money effects.
CREATE TABLE shipit.agent_settlement_submissions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,agent_id uuid NOT NULL REFERENCES shipit.auth_users(id),day date NOT NULL,
 capture_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),previous_submission_id uuid,expected_version integer NOT NULL CHECK(expected_version BETWEEN 0 AND 2147483646),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),
 correlation_id uuid NOT NULL,key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,agent_id,day,revision),UNIQUE(organization_id,franchise_id,capture_id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,capture_id) REFERENCES shipit.agent_daily_cash_captures(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,previous_submission_id) REFERENCES shipit.agent_settlement_submissions(organization_id,franchise_id,id),
 CHECK((revision=1)=(previous_submission_id IS NULL))
);
CREATE INDEX agent_settlement_submissions_list ON shipit.agent_settlement_submissions(organization_id,franchise_id,recorded_at,id);
CREATE TABLE shipit.agent_settlement_decisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,submission_id uuid NOT NULL,expected_version integer NOT NULL CHECK(expected_version>0),
 kind text NOT NULL CHECK(kind IN ('approve','reject')),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[\x01-\x1f\x7f-\x9f]'),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest~'^[0-9a-f]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id,submission_id),UNIQUE(organization_id,franchise_id,submission_id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,submission_id) REFERENCES shipit.agent_settlement_submissions(organization_id,franchise_id,id)
);
CREATE TABLE shipit.agent_settlement_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,submission_id uuid NOT NULL,decision_id uuid,
 kind text NOT NULL CHECK(kind IN ('submitted','approved','rejected')),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(decision_id),CHECK((kind='submitted')=(decision_id IS NULL)),
 FOREIGN KEY(organization_id,franchise_id,submission_id) REFERENCES shipit.agent_settlement_submissions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,decision_id,submission_id) REFERENCES shipit.agent_settlement_decisions(organization_id,franchise_id,id,submission_id)
);
CREATE UNIQUE INDEX agent_settlement_event_submission ON shipit.agent_settlement_events(submission_id) WHERE decision_id IS NULL;
CREATE FUNCTION shipit.agent_statement_source_identity(bundle jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('cash',(bundle->'cash')-'as_of'-'source_version','finance',(bundle->'finance')-'as_of','parcels',(bundle->'parcels')-'as_of')
$fn$;
CREATE FUNCTION shipit.guard_agent_settlement_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE cap shipit.agent_daily_cash_captures;previous shipit.agent_settlement_submissions;admin boolean;operator boolean;agent boolean;fresh jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.agent_id IS NOT NULL OR NEW.day IS NOT NULL OR NEW.revision IS NOT NULL OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SCOPE' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SCOPE' USING ERRCODE='23514';END IF;
 SELECT * INTO cap FROM shipit.agent_daily_cash_captures WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.capture_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_CAPTURE' USING ERRCODE='23514';END IF;
 SELECT COALESCE(bool_or(m.role='franchise_admin'),false),COALESCE(bool_or(m.role='operator'),false),COALESCE(bool_or(m.role='delivery_agent'),false) INTO admin,operator,agent
 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active';
 IF NOT (admin OR operator OR agent AND cap.agent_id=NEW.actor_id) OR NOT (admin OR cap.actor_id=NEW.actor_id OR agent AND cap.agent_id=NEW.actor_id) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_ACTOR' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=cap.agent_id AND m.role='delivery_agent'
 AND (admin OR m.lifecycle='active' AND u.lifecycle='active')) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_AGENT' USING ERRCODE='23514';END IF;
 SELECT * INTO previous FROM shipit.agent_settlement_submissions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND agent_id=cap.agent_id AND day=cap.day ORDER BY revision DESC LIMIT 1;
 IF previous.id IS NOT NULL AND NOT (admin OR previous.actor_id=NEW.actor_id OR agent AND cap.agent_id=NEW.actor_id) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_PREVIOUS_SCOPE' USING ERRCODE='23514';END IF;
 IF NEW.previous_submission_id IS DISTINCT FROM previous.id OR NEW.expected_version<>COALESCE(previous.revision,0) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_VERSION' USING ERRCODE='40001';END IF;
 IF previous.id IS NOT NULL AND previous.capture_id=NEW.capture_id THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_RECAPTURE' USING ERRCODE='40001';END IF;
 fresh:=shipit.agent_cash_finance_source_frame(NEW.organization_id,NEW.franchise_id,cap.agent_id,cap.day,cap.counted_at);
 IF jsonb_typeof(cap.source_snapshot->'finance') IS DISTINCT FROM 'object' OR jsonb_typeof(cap.source_snapshot->'parcels') IS DISTINCT FROM 'object'
 OR shipit.agent_statement_source_identity(fresh) IS DISTINCT FROM shipit.agent_statement_source_identity(cap.source_snapshot) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_STALE' USING ERRCODE='40001';END IF;
 NEW.agent_id:=cap.agent_id;NEW.day:=cap.day;NEW.revision:=NEW.expected_version+1;NEW.recorded_at:=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE FUNCTION shipit.guard_agent_settlement_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE submitted shipit.agent_settlement_submissions;cap shipit.agent_daily_cash_captures;fresh jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SCOPE' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SCOPE' USING ERRCODE='23514';END IF;
 SELECT * INTO submitted FROM shipit.agent_settlement_submissions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.submission_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_SUBMISSION' USING ERRCODE='23514';END IF;
 IF NEW.actor_id=submitted.actor_id OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role='franchise_admin' AND m.lifecycle='active') THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_REVIEWER' USING ERRCODE='23514';END IF;
 IF NEW.expected_version<>submitted.revision OR EXISTS(SELECT 1 FROM shipit.agent_settlement_submissions s WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.agent_id=submitted.agent_id AND s.day=submitted.day AND s.revision>submitted.revision)
 OR EXISTS(SELECT 1 FROM shipit.agent_settlement_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND submission_id=NEW.submission_id) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_VERSION' USING ERRCODE='40001';END IF;
 IF NEW.kind='approve' THEN
 SELECT * INTO cap FROM shipit.agent_daily_cash_captures WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=submitted.capture_id;
 fresh:=shipit.agent_cash_finance_source_frame(NEW.organization_id,NEW.franchise_id,cap.agent_id,cap.day,cap.counted_at);
 IF shipit.agent_statement_source_identity(fresh) IS DISTINCT FROM shipit.agent_statement_source_identity(cap.source_snapshot) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_STALE' USING ERRCODE='40001';END IF;
 END IF;
 NEW.recorded_at:=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER agent_settlement_submission_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_settlement_submissions FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_settlement_submission();
CREATE TRIGGER agent_settlement_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_settlement_decisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_settlement_decision();
CREATE FUNCTION shipit.guard_agent_settlement_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE source_actor uuid;source_correlation uuid;source_time timestamptz;source_kind text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_EVENT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.decision_id IS NULL THEN
 SELECT actor_id,correlation_id,recorded_at,'submitted' INTO source_actor,source_correlation,source_time,source_kind FROM shipit.agent_settlement_submissions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.submission_id;
 ELSE
 SELECT actor_id,correlation_id,recorded_at,CASE kind WHEN 'approve' THEN 'approved' ELSE 'rejected' END INTO source_actor,source_correlation,source_time,source_kind FROM shipit.agent_settlement_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.decision_id AND submission_id=NEW.submission_id;
 END IF;
 IF source_actor IS NULL OR ROW(NEW.id,NEW.actor_id,NEW.correlation_id,NEW.recorded_at,NEW.kind) IS DISTINCT FROM ROW(COALESCE(NEW.decision_id,NEW.submission_id),source_actor,source_correlation,source_time,source_kind) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_EVENT_SOURCE' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER agent_settlement_event_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.agent_settlement_events FOR EACH ROW EXECUTE FUNCTION shipit.guard_agent_settlement_event();
CREATE FUNCTION shipit.record_agent_settlement_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_TABLE_NAME='agent_settlement_submissions' THEN
 INSERT INTO shipit.agent_settlement_events VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.id,NULL,'submitted',NEW.actor_id,NEW.correlation_id,NEW.recorded_at);
 ELSE
 INSERT INTO shipit.agent_settlement_events VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.submission_id,NEW.id,CASE NEW.kind WHEN 'approve' THEN 'approved' ELSE 'rejected' END,NEW.actor_id,NEW.correlation_id,NEW.recorded_at);
 END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER agent_settlement_submission_event AFTER INSERT ON shipit.agent_settlement_submissions FOR EACH ROW EXECUTE FUNCTION shipit.record_agent_settlement_event();
CREATE TRIGGER agent_settlement_decision_event AFTER INSERT ON shipit.agent_settlement_decisions FOR EACH ROW EXECUTE FUNCTION shipit.record_agent_settlement_event();
REVOKE ALL ON shipit.agent_settlement_submissions,shipit.agent_settlement_decisions,shipit.agent_settlement_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.agent_statement_source_identity(jsonb),shipit.guard_agent_settlement_submission(),shipit.guard_agent_settlement_decision(),shipit.guard_agent_settlement_event(),shipit.record_agent_settlement_event() FROM PUBLIC;
DO $settlement_audit$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'agent-settlement:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'agent_statement.submit','agent_settlement',id,'success','settlement_submitted',correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.agent_settlement_submissions
 UNION ALL SELECT 'agent-settlement-decision:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'agent_statement.decide','agent_settlement',submission_id,'success',CASE kind WHEN 'approve' THEN 'settlement_approved' ELSE 'settlement_rejected' END,correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.agent_settlement_decisions$view$;
END $settlement_audit$;
`);
exports.down=()=>{throw new Error('AGENT_MONEY_FORWARD_ONLY');};
