/* Issue #190 / ADR 0046: additive permissions, original actor and evidence retained. */
exports.up=pgm=>pgm.sql(`
-- One row per real membership and permitted franchise; no roles or memberships are synthesized.
CREATE OR REPLACE VIEW shipit.business_membership_scopes WITH (security_invoker=true) AS
 SELECT membership_id,organization_id,franchise_id FROM shipit.membership_franchise_scopes
 UNION ALL
 SELECT m.id,m.organization_id,f.id FROM shipit.memberships m
 JOIN shipit.franchises f ON f.organization_id=m.organization_id WHERE m.role='org_admin';
REVOKE ALL ON shipit.business_membership_scopes FROM PUBLIC;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
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
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
  JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
  WHERE m.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.receiver_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin'))
 THEN RAISE EXCEPTION 'MONEY_RECEIPT_RECEIVER_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=c.recorded_at;RETURN NEW;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cash_location_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE location shipit.cash_locations;account shipit.receiving_account_revisions;previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_LOCATION_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_LOCATION_GENERATED_FIELDS' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASH_LOCATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin') AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_ACTOR_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO location FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.location_id FOR UPDATE;
 SELECT * INTO account FROM shipit.receiving_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT COALESCE(max(version),0) INTO previous FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.location_id;
 IF location.id IS NULL OR account.id IS NULL OR account.id<>NEW.account_revision_id OR ((NEW.active OR previous=0) AND NOT account.active) OR previous::bigint+1<>NEW.version::bigint
  OR ((NEW.active OR previous=0) AND (location.kind='cash') IS DISTINCT FROM (account.methods=ARRAY['cash']::text[]))
 THEN RAISE EXCEPTION 'CASH_LOCATION_SOURCE_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 IF (NEW.active OR previous=0) AND location.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=location.custodian_id)
 THEN RAISE EXCEPTION 'CASH_LOCATION_CUSTODIAN_INVALID' USING ERRCODE='23514'; END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
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
 IF request.correction_of IS NULL AND request.kind<>'cod_reservation_reversal' AND source.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=source.custodian_id)
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
  IF request.correction_of IS NULL AND target.kind='cash' AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE s.organization_id=request.organization_id AND s.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=target.custodian_id)
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

-- Preserve 1792688400000-expenses-cashbook.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cashbook_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','org_admin') AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','org_admin') AND m.user_id=NEW.responsible_employee_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_EMPLOYEE_INVALID' USING ERRCODE='23514';END IF;
 -- Operators may propose only their own cash location; noncash choices reveal no balances.
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin') AND m.user_id=NEW.actor_id)
 AND EXISTS(SELECT 1 FROM shipit.cash_locations l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id AND l.id IN (NEW.source_location_id,NEW.target_location_id) AND l.kind='cash' AND l.custodian_id<>NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_CUSTODY_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF NEW.correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin'))
 AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.id=NEW.correction_of AND p.actor_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASHBOOK_CORRECTION_OWNER_FORBIDDEN' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cashbook_request_sources(NEW);
 IF NEW.occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'CASHBOOK_REQUEST_TIME_INVALID' USING ERRCODE='23514';END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1792688400000-expenses-cashbook.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cashbook_request_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_DECISION_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.attachment_snapshot IS NOT NULL THEN RAISE EXCEPTION 'CASHBOOK_DECISION_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_DECISION_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.request_id FOR UPDATE;
 IF request.id IS NULL OR request.actor_id=NEW.actor_id OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin') AND m.user_id=NEW.actor_id)
 THEN RAISE EXCEPTION 'CASHBOOK_DIFFERENT_ADMIN_REQUIRED' USING ERRCODE='23514';END IF;
 -- A different admin can reject a stale proposal without changing its original evidence.
 IF NEW.decision='approved' THEN PERFORM shipit.check_cashbook_request_sources(request);END IF;
 IF NEW.decision='approved' AND EXISTS(SELECT 1 FROM shipit.attachments a WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.expense_request_id=NEW.request_id AND a.state IN ('pending_upload','quarantined'))
 THEN RAISE EXCEPTION 'CASHBOOK_ATTACHMENT_UNSETTLED' USING ERRCODE='23514';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'sha256',a.digest) ORDER BY a.id),'[]'::jsonb) INTO NEW.attachment_snapshot
 FROM shipit.attachments a WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.expense_request_id=NEW.request_id AND a.state='ready';

 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
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
  (r.active AND a.active AND r.account_revision_id=a.id AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=l.custodian_id))
  OR (l.id=request.source_location_id AND shipit.custody_member(request.organization_id,request.franchise_id,request.actor_id,'franchise_admin')
   AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id
    WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.role='delivery_agent' AND m.user_id=l.custodian_id))
 );
 IF found<>2 THEN RAISE EXCEPTION 'CASH_HANDOVER_SOURCE_STALE' USING ERRCODE='23514';END IF;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cash_handover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE capacity record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_HANDOVER_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CASH_HANDOVER_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE) THEN RAISE EXCEPTION 'CASH_HANDOVER_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=NEW.actor_id
 AND (m.role IN ('org_admin','franchise_admin') OR EXISTS(SELECT 1 FROM shipit.cash_locations l WHERE l.organization_id=NEW.organization_id AND l.franchise_id=NEW.franchise_id AND l.id=NEW.source_location_id AND l.custodian_id=NEW.actor_id))) THEN RAISE EXCEPTION 'CASH_HANDOVER_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF COALESCE((SELECT version FROM shipit.cashbook_source_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id),0)<>NEW.expected_source_version OR NEW.occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'CASH_HANDOVER_VERSION_TIME_INVALID' USING ERRCODE='23514';END IF;
 PERFORM shipit.check_cash_handover_sources(NEW);
 SELECT * INTO capacity FROM shipit.cashbook_custody_capacity(NEW.organization_id,NEW.franchise_id,NEW.source_location_id,NULL);
 IF capacity.recorded-capacity.reserved<NEW.amount_paise OR capacity.unknown_refund>0 OR abs(capacity.recorded)>9007199254740991 THEN RAISE EXCEPTION 'CASH_HANDOVER_CAPACITY_INVALID' USING ERRCODE='23514';END IF;
 NEW.recorded_at=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
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
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','delivery_agent','org_admin') AND m.user_id=NEW.actor_id
 AND CASE WHEN NEW.kind='cancel' THEN m.role IN ('org_admin','franchise_admin') OR NEW.actor_id=source_custodian ELSE NEW.actor_id=target_custodian END) THEN RAISE EXCEPTION 'CASH_HANDOVER_COMMAND_ACTOR_INVALID' USING ERRCODE='23514';END IF;
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

-- Preserve 1792688400000-expenses-cashbook.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_refund_cash_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE location shipit.cash_locations;revision shipit.cash_location_revisions;
BEGIN
 IF NEW.cash_location_id IS NULL THEN RETURN NEW;END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 SELECT * INTO location FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.cash_location_id;
 SELECT * INTO revision FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=NEW.cash_location_id ORDER BY version DESC LIMIT 1;
 IF NEW.method<>'cash' OR location.id IS NULL OR location.kind<>'cash' OR location.account_id<>NEW.source_account_id OR revision.id IS DISTINCT FROM NEW.cash_location_revision_id OR NOT revision.active OR revision.account_revision_id IS DISTINCT FROM NEW.source_revision_id
 OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE f.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin','org_admin') AND m.user_id=location.custodian_id)
 THEN RAISE EXCEPTION 'REFUND_CASH_LOCATION_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;
END $fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cashbook_effect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;approval shipit.cashbook_request_decisions;available numeric;pending numeric;target_total numeric;leg record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL OR NEW.creation_xid<>pg_current_xact_id() THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_GENERATED_FIELDS' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'CASHBOOK_EFFECT_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.lifecycle='active' AND m.role IN ('org_admin','franchise_admin') AND m.user_id=NEW.actor_id)
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

-- Preserve 1792688400000-expenses-cashbook.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_expense_attachment_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE request shipit.cashbook_requests;n integer;bytes bigint;pending integer;organization_state text;franchise_state text;cleanup boolean;
BEGIN
 IF TG_OP='UPDATE' AND NEW.expense_request_id IS DISTINCT FROM OLD.expense_request_id THEN RAISE EXCEPTION 'ATTACHMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.expense_request_id IS NULL THEN RETURN NEW;END IF;
 -- User authority and disable operations share organization-before-franchise order.
 -- Cleanup deliberately remains possible after parent disable or grant revocation.
 cleanup=TG_OP='UPDATE' AND OLD.state NOT IN ('ready','deleted') AND NEW.state IN ('canceled','cleanup_pending','deleted');
 IF NEW.actor_type<>'service' THEN
  SELECT lifecycle INTO organization_state FROM shipit.organizations WHERE id=NEW.organization_id FOR UPDATE;
 END IF;
 SELECT lifecycle INTO franchise_state FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id FOR UPDATE;
 IF NEW.actor_type<>'service' AND NOT cleanup AND (organization_state IS DISTINCT FROM 'active' OR franchise_state IS DISTINCT FROM 'active')
 THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_PARENT_DISABLED' USING ERRCODE='23514';END IF;
 SELECT * INTO request FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.expense_request_id FOR UPDATE;
 IF request.id IS NULL OR request.kind<>'expense' THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_PARENT_INVALID' USING ERRCODE='23514';END IF;
 IF NEW.actor_type='service' THEN
  IF TG_OP<>'UPDATE' OR NEW.state NOT IN ('cleanup_pending','deleted') OR OLD.state IN ('ready','deleted') THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
   WHERE f.organization_id=request.organization_id AND f.franchise_id=request.franchise_id AND m.lifecycle='active' AND m.user_id::text=NEW.actor_id AND (m.role IN ('org_admin','franchise_admin') OR (m.role='operator' AND m.user_id=request.actor_id)))
  THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_ACTOR_INVALID' USING ERRCODE='23514';END IF;
  IF TG_OP='INSERT' AND NEW.initiated_actor::text<>NEW.actor_id THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM shipit.cashbook_request_decisions d WHERE d.organization_id=request.organization_id AND d.franchise_id=request.franchise_id AND d.request_id=request.id)
 AND NOT cleanup
 THEN RAISE EXCEPTION 'ATTACHMENT_EXPENSE_REVIEWED' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  SELECT count(*),COALESCE(sum(declared_size),0),count(*) FILTER(WHERE state<>'ready') INTO n,bytes,pending FROM shipit.attachments WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND expense_request_id=NEW.expense_request_id AND state<>'deleted';
  IF n>=10 OR bytes+NEW.declared_size>33554432 OR pending>=3 THEN RAISE EXCEPTION 'ATTACHMENT_QUOTA' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $fn$;

-- Preserve 1792774800000-agent-parcel-custody.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.custody_member(o uuid,f uuid,u uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users a ON a.id=m.user_id AND a.lifecycle='active'
 WHERE m.organization_id=o AND s.franchise_id=f AND m.user_id=u AND m.lifecycle='active' AND (m.role=r OR m.role IN ('org_admin','franchise_admin') AND r IN ('franchise_admin','dispatcher')))
$fn$;

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.agent_daily_cash_source_frame(p_org uuid,p_franchise uuid,p_agent uuid,p_day date,p_count timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
SELECT to_jsonb(captured) FROM (

 SELECT * FROM (WITH frame AS (
 SELECT f.organization_id,f.id franchise_id,p_agent::uuid agent_id,p_day::date AS day,p_count::timestamptz counted_at,date_trunc('milliseconds',statement_timestamp()) as_of,
 p_day::date::timestamp AT TIME ZONE 'Asia/Kolkata' day_start
 FROM shipit.franchises f WHERE f.organization_id=p_org AND f.id=p_franchise
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
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

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_agent_daily_cash_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE raw jsonb;bundle jsonb;finance jsonb;parcels jsonb;admin boolean;operator boolean;agent boolean;expected numeric;variance numeric;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.source_snapshot IS NOT NULL OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_SCOPE_INVALID' USING ERRCODE='23514';END IF;
 SELECT COALESCE(bool_or(m.role IN ('org_admin','franchise_admin')),false),COALESCE(bool_or(m.role='operator'),false),COALESCE(bool_or(m.role='delivery_agent'),false) INTO admin,operator,agent
 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active';
 IF NOT (admin OR operator OR agent AND NEW.actor_id=NEW.agent_id) THEN RAISE EXCEPTION 'AGENT_CASH_CAPTURE_ACTOR_INVALID' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
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

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_agent_settlement_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
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
 SELECT COALESCE(bool_or(m.role IN ('org_admin','franchise_admin')),false),COALESCE(bool_or(m.role='operator'),false),COALESCE(bool_or(m.role='delivery_agent'),false) INTO admin,operator,agent
 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active';
 IF NOT (admin OR operator OR agent AND cap.agent_id=NEW.actor_id) OR NOT (admin OR cap.actor_id=NEW.actor_id OR agent AND cap.agent_id=NEW.actor_id) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_ACTOR' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
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

-- Preserve 1792861200000-agent-money-settlements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_agent_settlement_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
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
 IF NEW.actor_id=submitted.actor_id OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active') THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_REVIEWER' USING ERRCODE='23514';END IF;
 IF NEW.expected_version<>submitted.revision OR EXISTS(SELECT 1 FROM shipit.agent_settlement_submissions s WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND s.agent_id=submitted.agent_id AND s.day=submitted.day AND s.revision>submitted.revision)
 OR EXISTS(SELECT 1 FROM shipit.agent_settlement_decisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND submission_id=NEW.submission_id) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_VERSION' USING ERRCODE='40001';END IF;
 IF NEW.kind='approve' THEN
 SELECT * INTO cap FROM shipit.agent_daily_cash_captures WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=submitted.capture_id;
 fresh:=shipit.agent_cash_finance_source_frame(NEW.organization_id,NEW.franchise_id,cap.agent_id,cap.day,cap.counted_at);
 IF shipit.agent_statement_source_identity(fresh) IS DISTINCT FROM shipit.agent_statement_source_identity(cap.source_snapshot) THEN RAISE EXCEPTION 'AGENT_SETTLEMENT_STALE' USING ERRCODE='40001';END IF;
 END IF;
 NEW.recorded_at:=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1792947600000-cash-closing.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_cash_close_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE s shipit.cash_close_sessions;previous shipit.cash_close_sessions;l shipit.cash_locations;lr shipit.cash_location_revisions;
 cap shipit.cash_close_commands;submitted shipit.cash_close_commands;accepted shipit.cash_close_commands;oldcap shipit.cash_close_commands;
 admin boolean;operator boolean;admins integer;opening jsonb;fresh jsonb;reason text;amount numeric;expected numeric;variance numeric;mode text;newstate text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_CLOSE_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.input->>'expected_version' IS DISTINCT FROM NEW.expected_version::text THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION_INPUT' USING ERRCODE='23514';END IF;
 IF NEW.result IS NOT NULL OR NEW.source_frame IS NOT NULL OR NEW.recorded_at IS NOT NULL OR NEW.version IS NOT NULL OR NEW.count_id IS NOT NULL OR NEW.submission_id IS NOT NULL OR NEW.opening_submission_id IS NOT NULL OR NEW.previous_submission_id IS NOT NULL OR NEW.initial_opening_id IS NOT NULL OR NEW.opening_review_id IS NOT NULL THEN RAISE EXCEPTION 'CASH_CLOSE_SERVER_OWNED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASH_CLOSE_SCOPE' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASH_CLOSE_SCOPE' USING ERRCODE='23514';END IF;
 SELECT COALESCE(bool_or(m.role IN ('org_admin','franchise_admin') AND m.user_id=NEW.actor_id),false),COALESCE(bool_or(m.role='operator' AND m.user_id=NEW.actor_id),false),count(DISTINCT m.user_id) FILTER(WHERE m.role IN ('org_admin','franchise_admin')) INTO admin,operator,admins
 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND ms.franchise_id=NEW.franchise_id AND m.lifecycle='active';
 IF NOT(admin OR operator AND NEW.operation IN ('open','count','submit','revise_opening')) THEN RAISE EXCEPTION 'CASH_CLOSE_ACTOR' USING ERRCODE='42501';END IF;
 reason:=NEW.input->>'reason';
 IF reason IS NULL OR char_length(reason) NOT BETWEEN 1 AND 500 OR reason<>btrim(reason) OR reason~'[\x01-\x1f\x7f-\x9f]' THEN RAISE EXCEPTION 'CASH_CLOSE_REASON' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();NEW.version:=NEW.expected_version+1;
 IF NEW.operation='open' THEN
 IF NEW.expected_version<>0 OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>7 THEN RAISE EXCEPTION 'CASH_CLOSE_INPUT' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM shipit.cash_locations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.input->>'location_id')::uuid FOR UPDATE;
 SELECT * INTO lr FROM shipit.cash_location_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=l.id ORDER BY version DESC LIMIT 1;
 IF l.id IS NULL OR l.kind<>'cash' OR NOT lr.active OR lr.id IS DISTINCT FROM (NEW.input->>'location_revision_id')::uuid OR NOT(admin OR l.custodian_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASH_CLOSE_LOCATION' USING ERRCODE='42501';END IF;
 SELECT * INTO previous FROM shipit.cash_close_sessions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND location_id=l.id ORDER BY sequence DESC LIMIT 1;
 IF previous.id IS DISTINCT FROM (NEW.input->>'predecessor_id')::uuid OR previous.id IS NOT NULL AND (previous.state<>'approved' OR previous.accepted_submission_id IS NULL) THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF previous.id IS NULL THEN
 opening:=NEW.input->'initial_opening';amount:=(opening->>'counted_paise')::numeric;
 IF jsonb_typeof(opening) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(opening))<>3 OR amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(opening->'denominations',amount) OR opening->>'counted_at' IS NULL OR (opening->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((opening->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;
 opening:=jsonb_build_object('kind','initial_count','opening_at',shipit.cash_close_instant((opening->>'counted_at')::timestamptz),'counted_paise',amount::text,'denominations',opening->'denominations','actor_id',NEW.actor_id,'reason',reason,'submission_id',NULL,'count_id',NULL,'initial_revision_id',NEW.id,'previous_initial_revision_id',NULL);
 ELSE IF NEW.input->'initial_opening'<>'null'::jsonb THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;END IF;
 INSERT INTO shipit.cash_close_sessions(id,organization_id,franchise_id,location_id,location_revision_id,custodian_id,sequence,day,predecessor_id,initial_opening,actor_id,recorded_at,version,state,initial_opening_id)
 VALUES(NEW.session_id,NEW.organization_id,NEW.franchise_id,l.id,lr.id,l.custodian_id,COALESCE(previous.sequence,0)+1,(NEW.input->>'day')::date,previous.id,opening,NEW.actor_id,NEW.recorded_at,1,'open',CASE WHEN previous.id IS NULL THEN NEW.id ELSE NULL END) RETURNING * INTO s;
 IF opening IS NOT NULL THEN NEW.result:=jsonb_build_object('opening',opening);END IF;
 ELSE
 SELECT * INTO s FROM shipit.cash_close_sessions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.session_id FOR UPDATE;
 IF s.id IS NULL OR NOT(admin OR s.custodian_id=NEW.actor_id) THEN RAISE EXCEPTION 'CASH_CLOSE_SESSION' USING ERRCODE='42501';END IF;
 IF s.version<>NEW.expected_version THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 END IF;
 newstate:=s.state;
 IF s.predecessor_id IS NOT NULL THEN
 SELECT * INTO previous FROM shipit.cash_close_sessions WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.predecessor_id;
 SELECT * INTO accepted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=previous.accepted_submission_id;
 SELECT * INTO oldcap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=accepted.count_id;
 opening:=jsonb_build_object('kind','approved_predecessor','opening_at',oldcap.result->'count'->>'counted_at','counted_paise',oldcap.result->'count'->>'counted_paise','denominations',oldcap.result->'count'->'denominations','actor_id',oldcap.actor_id,'reason','Accepted physical predecessor count','submission_id',accepted.id,'count_id',oldcap.id,'initial_revision_id',NULL,'previous_initial_revision_id',NULL);
 ELSE IF NEW.operation<>'open' THEN SELECT result->'opening' INTO opening FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND session_id=s.id AND id=s.initial_opening_id;END IF;END IF;
 IF NEW.operation='revise_opening' THEN
 IF s.predecessor_id IS NOT NULL OR s.state NOT IN ('open','rejected') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>6 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF s.initial_opening_id IS DISTINCT FROM (NEW.input->>'opening_id')::uuid THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 amount:=(NEW.input->>'counted_paise')::numeric;
 IF amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(NEW.input->'denominations',amount) OR NEW.input->>'counted_at' IS NULL OR (NEW.input->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((NEW.input->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING' USING ERRCODE='23514';END IF;
 opening:=jsonb_build_object('kind','initial_count','opening_at',shipit.cash_close_instant((NEW.input->>'counted_at')::timestamptz),'counted_paise',amount::text,'denominations',NEW.input->'denominations','actor_id',NEW.actor_id,'reason',reason,'submission_id',NULL,'count_id',NULL,'initial_revision_id',NEW.id,'previous_initial_revision_id',s.initial_opening_id);
 s.initial_opening_id:=NEW.id;s.initial_opening_review_id:=NULL;newstate:='open';NEW.result:=jsonb_build_object('opening',opening);
 ELSIF NEW.operation='review_opening' THEN
 IF s.predecessor_id IS NOT NULL OR s.state NOT IN ('open','rejected','submitted') OR s.initial_opening_review_id IS NOT NULL OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>4 OR jsonb_typeof(NEW.input->'sole_admin_acknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 IF s.initial_opening_id IS DISTINCT FROM (NEW.input->>'opening_id')::uuid THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 mode:='independent';IF NEW.actor_id=(opening->>'actor_id')::uuid THEN IF admins<>1 OR NOT (NEW.input->>'sole_admin_acknowledged')::boolean THEN RAISE EXCEPTION 'CASH_CLOSE_REVIEW_REQUIRED' USING ERRCODE='P0147';END IF;mode:='sole_admin_self';END IF;
 s.initial_opening_review_id:=NEW.id;NEW.opening_review_id:=NEW.id;
 NEW.result:=jsonb_build_object('opening_review',jsonb_build_object('id',NEW.id,'opening_id',s.initial_opening_id,'mode',mode,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='count' THEN
 IF s.state NOT IN ('open','rejected') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>5 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 amount:=(NEW.input->>'counted_paise')::numeric;
 IF amount IS NULL OR amount<0 OR amount>9007199254740991 OR amount<>trunc(amount) OR NOT shipit.cash_close_denominations(NEW.input->'denominations',amount) OR NEW.input->>'counted_at' IS NULL OR (NEW.input->>'counted_at')::timestamptz<=(opening->>'opening_at')::timestamptz OR (NEW.input->>'counted_at')::timestamptz>NEW.recorded_at OR NOT isfinite((NEW.input->>'counted_at')::timestamptz) THEN RAISE EXCEPTION 'CASH_CLOSE_COUNT' USING ERRCODE='23514';END IF;
 NEW.source_frame:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(NEW.input->>'counted_at')::timestamptz);
 IF (NEW.source_frame->>'source_count')::int>5000 OR octet_length(NEW.source_frame::text)>8388608 THEN RAISE EXCEPTION 'CASH_CLOSE_LIMIT' USING ERRCODE='54000';END IF;
 expected:=(opening->>'counted_paise')::numeric+(NEW.source_frame->>'inflow_paise')::numeric-(NEW.source_frame->>'outflow_paise')::numeric;variance:=amount-expected;
 NEW.opening_submission_id:=(opening->>'submission_id')::uuid;NEW.previous_submission_id:=s.submission_id;
 NEW.result:=jsonb_build_object('count',jsonb_build_object('id',NEW.id,'opening',opening,'counted_at',NEW.source_frame->'counted_at','counted_paise',amount::text,'denominations',NEW.input->'denominations','reason',reason,'actor_id',NEW.actor_id,'as_of',NEW.source_frame->'as_of','expected_paise',expected::text,'variance_paise',variance::text,'shortage_paise',greatest(-variance,0)::text,'excess_paise',greatest(variance,0)::text,'controls',NEW.source_frame-'rows'-'pending_handovers'));
 s.count_id:=NEW.id;newstate:='open';
 ELSIF NEW.operation='submit' THEN
 IF s.state<>'open' OR s.count_id IS DISTINCT FROM (NEW.input->>'count_id')::uuid OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>3 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 SELECT * INTO cap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.count_id;
 IF cap.actor_id<>NEW.actor_id THEN RAISE EXCEPTION 'CASH_CLOSE_COUNTER' USING ERRCODE='42501';END IF;
 IF cap.opening_submission_id IS DISTINCT FROM (opening->>'submission_id')::uuid OR cap.initial_opening_id IS DISTINCT FROM s.initial_opening_id THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 fresh:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(cap.input->>'counted_at')::timestamptz);
 IF shipit.cash_close_source_identity(fresh) IS DISTINCT FROM shipit.cash_close_source_identity(cap.source_frame) THEN RAISE EXCEPTION 'CASH_CLOSE_SOURCE_CHANGED' USING ERRCODE='P0145';END IF;
 NEW.count_id:=cap.id;NEW.opening_submission_id:=cap.opening_submission_id;NEW.previous_submission_id:=s.submission_id;s.submission_id:=NEW.id;newstate:='submitted';
 NEW.result:=jsonb_build_object('submission',jsonb_build_object('id',NEW.id,'count_id',cap.id,'previous_submission_id',NEW.previous_submission_id,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='decide' THEN
 IF s.state<>'submitted' OR s.submission_id IS DISTINCT FROM (NEW.input->>'submission_id')::uuid OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>5 OR NEW.input->>'kind' NOT IN ('approve','reject') OR jsonb_typeof(NEW.input->'sole_admin_acknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 SELECT * INTO submitted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.submission_id;
 SELECT * INTO cap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=submitted.count_id;
 mode:='independent';
 IF NEW.actor_id=submitted.actor_id OR NEW.actor_id=cap.actor_id OR NEW.input->>'kind'='approve' AND s.initial_opening_id IS NOT NULL AND s.initial_opening_review_id IS NULL AND NEW.actor_id=(opening->>'actor_id')::uuid
 THEN
 IF admins<>1 OR NOT (NEW.input->>'sole_admin_acknowledged')::boolean THEN RAISE EXCEPTION 'CASH_CLOSE_REVIEW_REQUIRED' USING ERRCODE='P0147';END IF;mode:='sole_admin_self';END IF;
 IF NEW.input->>'kind'='approve' THEN
 IF submitted.opening_submission_id IS DISTINCT FROM (opening->>'submission_id')::uuid OR submitted.initial_opening_id IS DISTINCT FROM s.initial_opening_id THEN RAISE EXCEPTION 'CASH_CLOSE_OPENING_CHANGED' USING ERRCODE='P0146';END IF;
 fresh:=shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(opening->>'opening_at')::timestamptz,(cap.input->>'counted_at')::timestamptz);
 IF shipit.cash_close_source_identity(fresh) IS DISTINCT FROM shipit.cash_close_source_identity(cap.source_frame) THEN RAISE EXCEPTION 'CASH_CLOSE_SOURCE_CHANGED' USING ERRCODE='P0145';END IF;
 IF s.accepted_submission_id IS NOT NULL THEN
 SELECT * INTO accepted FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.accepted_submission_id;
 SELECT * INTO oldcap FROM shipit.cash_close_commands WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=accepted.count_id;
 INSERT INTO shipit.cash_close_dependencies VALUES(NEW.id,s.organization_id,s.franchise_id,s.id,s.location_id,s.sequence,s.accepted_submission_id,s.submission_id,
 ROW(oldcap.result->'count'->>'counted_at',oldcap.result->'count'->>'counted_paise') IS DISTINCT FROM ROW(cap.result->'count'->>'counted_at',cap.result->'count'->>'counted_paise'),NEW.recorded_at);
 END IF;
 IF s.initial_opening_id IS NOT NULL AND s.initial_opening_review_id IS NULL THEN s.initial_opening_review_id:=NEW.id;NEW.result:=jsonb_build_object('opening_review',jsonb_build_object('id',NEW.id,'opening_id',s.initial_opening_id,'mode',CASE WHEN NEW.actor_id=(opening->>'actor_id')::uuid THEN 'sole_admin_self' ELSE 'independent' END,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));END IF;
 s.accepted_submission_id:=s.submission_id;newstate:='approved';ELSE newstate:='rejected';END IF;
 NEW.count_id:=cap.id;NEW.submission_id:=s.submission_id;NEW.opening_submission_id:=cap.opening_submission_id;
 NEW.opening_review_id:=s.initial_opening_review_id;
 NEW.result:=COALESCE(NEW.result,'{}'::jsonb)||jsonb_build_object('decision',jsonb_build_object('id',NEW.id,'submission_id',s.submission_id,'opening_revision_id',cap.initial_opening_id,'opening_review_id',CASE WHEN NEW.input->>'kind'='approve' THEN NEW.opening_review_id ELSE NULL END,'kind',NEW.input->>'kind','mode',mode,'actor_id',NEW.actor_id,'reason',reason,'recorded_at',shipit.cash_close_instant(NEW.recorded_at)));
 ELSIF NEW.operation='reopen' THEN
 IF s.state NOT IN ('approved','submitted') OR (SELECT count(*) FROM jsonb_object_keys(NEW.input))<>2 THEN RAISE EXCEPTION 'CASH_CLOSE_VERSION' USING ERRCODE='40001';END IF;
 NEW.previous_submission_id:=s.submission_id;s.count_id:=NULL;newstate:='open';
 END IF;
 NEW.initial_opening_id:=s.initial_opening_id;
 NEW.result:=COALESCE(NEW.result,'{}'::jsonb)||jsonb_build_object('command_id',NEW.id,'session_id',s.id,'operation',NEW.operation,'version',NEW.version,'state',newstate,'recorded_at',shipit.cash_close_instant(NEW.recorded_at));
 UPDATE shipit.cash_close_sessions SET version=NEW.version,state=newstate,count_id=s.count_id,submission_id=s.submission_id,accepted_submission_id=s.accepted_submission_id,initial_opening_id=s.initial_opening_id,initial_opening_review_id=s.initial_opening_review_id WHERE organization_id=s.organization_id AND franchise_id=s.franchise_id AND id=s.id;
 RETURN NEW;
END $fn$;

-- Preserve 1793034000000-shipment-costs.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_shipment_cost_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous shipit.shipment_cost_revisions;source shipit.shipment_cost_sources;a jsonb;total numeric:=0;kind text;identity text;existing uuid;expense shipit.cashbook_requests;root uuid;fee shipit.agent_fee_earnings;rate shipit.carrier_rate_imports;approval shipit.carrier_rate_approvals;booking shipit.bookings;rate_row jsonb;rate_inputs jsonb;rate_amount bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SHIPMENT_COST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_GENERATED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_COST_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active') THEN RAISE EXCEPTION 'SHIPMENT_COST_ACTOR' USING ERRCODE='42501';END IF;
 SELECT * INTO source FROM shipit.shipment_cost_sources WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.source_id FOR UPDATE;
 SELECT * INTO previous FROM shipit.shipment_cost_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND source_id=NEW.source_id ORDER BY version DESC LIMIT 1;
 IF source.id IS NULL OR NEW.version<>COALESCE(previous.version,0)+1 THEN RAISE EXCEPTION 'SHIPMENT_COST_VERSION' USING ERRCODE='40001';END IF;
 NEW.recorded_at:=clock_timestamp();
 IF NEW.effective_at>NEW.recorded_at THEN RAISE EXCEPTION 'SHIPMENT_COST_EFFECTIVE' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'independently_verified' IS DISTINCT FROM 'false' OR NEW.evidence->>'kind' NOT IN ('manual','carrier_rate','applied_expense','declaration') THEN RAISE EXCEPTION 'SHIPMENT_COST_EVIDENCE' USING ERRCODE='23514';END IF;
 IF (NEW.evidence->>'kind'='declaration') IS DISTINCT FROM (NEW.state='not_applicable') OR (NEW.evidence->>'kind'='applied_expense') IS DISTINCT FROM (NEW.evidence->>'expense_head_id' IS NOT NULL AND NEW.evidence->>'expense_root_id' IS NOT NULL) OR (NEW.evidence->>'kind'='carrier_rate') IS DISTINCT FROM (NEW.evidence->>'rate_import_id' IS NOT NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_EVIDENCE' USING ERRCODE='23514';END IF;
 IF (NEW.evidence->>'supplier' IS NULL) IS DISTINCT FROM (NEW.evidence->>'document' IS NULL) OR (NEW.evidence->>'supplier' IS NULL) IS DISTINCT FROM (NEW.evidence->>'line' IS NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_INVOICE' USING ERRCODE='23514';END IF;
 FOR identity IN SELECT NEW.evidence->>'supplier' UNION ALL SELECT NEW.evidence->>'document' UNION ALL SELECT NEW.evidence->>'line' LOOP
  IF identity IS NOT NULL AND (length(identity) NOT BETWEEN 1 AND 128 OR identity IS DISTINCT FROM upper(pg_catalog.normalize(btrim(identity),'NFKC')) OR identity~'[[:cntrl:]]') THEN RAISE EXCEPTION 'SHIPMENT_COST_INVOICE' USING ERRCODE='23514';END IF;
 END LOOP;
 IF NEW.state='not_applicable' AND (NEW.evidence->>'kind'<>'declaration' OR previous.amount_paise>0) THEN RAISE EXCEPTION 'SHIPMENT_COST_DECLARATION' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'expense_head_id' IS NOT NULL THEN
  SELECT r.* INTO expense FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(NEW.evidence->>'expense_head_id')::uuid AND r.kind='expense';
  IF expense.id IS NULL OR EXISTS(SELECT 1 FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.correction_of=expense.id) OR NEW.amount_paise<>expense.amount_paise OR NEW.state<>'actual' OR NEW.effective_at<>expense.occurred_at THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE' USING ERRCODE='23514';END IF;
  root:=expense.id;
  WHILE expense.correction_of IS NOT NULL LOOP SELECT * INTO expense FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=expense.correction_of;root:=expense.id;END LOOP;
  IF root::text IS DISTINCT FROM NEW.evidence->>'expense_root_id' THEN RAISE EXCEPTION 'SHIPMENT_COST_ROOT' USING ERRCODE='23514';END IF;
  IF expense.fee_earning_id IS NOT NULL THEN SELECT * INTO fee FROM shipit.agent_fee_earnings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=expense.fee_earning_id;IF fee.basis='per_delivery' OR source.category<>'agent' THEN RAISE EXCEPTION 'SHIPMENT_COST_AGENT' USING ERRCODE='23514';END IF;END IF;
 END IF;
 IF NEW.evidence->>'kind'='manual' AND (COALESCE(NEW.evidence->>'supplier','')='' OR COALESCE(NEW.evidence->>'document','')='' OR COALESCE(NEW.evidence->>'line','')='' OR NEW.evidence->>'expense_root_id' IS NOT NULL OR NEW.evidence->>'rate_import_id' IS NOT NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_MANUAL' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'kind'='applied_expense' AND NEW.evidence->>'expense_head_id' IS NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'kind'='carrier_rate' THEN
  SELECT * INTO rate FROM shipit.carrier_rate_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.evidence->>'rate_import_id')::uuid AND purpose='courier_purchase_estimate';
  SELECT * INTO approval FROM shipit.carrier_rate_approvals WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND import_id=rate.id;
  SELECT * INTO booking FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.evidence->>'rate_booking_id')::uuid;
  IF rate.id IS NULL OR approval.id IS NULL OR booking.id IS NULL OR source.category<>'courier' OR NEW.state<>'estimated' OR approval.id::text IS DISTINCT FROM NEW.evidence->>'rate_approval_id' OR rate.normalization_version IS DISTINCT FROM NEW.evidence->>'rate_version' OR booking.confirmed_at<(rate.config->'policy'->>'effective_from')::timestamptz OR booking.confirmed_at>=(rate.config->'policy'->>'effective_to')::timestamptz THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE' USING ERRCODE='23514';END IF;
  rate_inputs:=jsonb_build_object('service',booking.pricing_snapshot->'inputs'->>'service','destination_key',booking.pricing_snapshot->'inputs'->>'destination_key','weight_grams',booking.pricing_snapshot->'inputs'->'weight_grams');
  SELECT value INTO rate_row FROM jsonb_array_elements(rate.rows) WHERE (value->>'row')::integer=(NEW.evidence->>'rate_row')::integer;
  IF rate_row IS NULL OR rate_row->>'error' IS NOT NULL OR rate_row->'rule'->>'service' IS DISTINCT FROM rate_inputs->>'service' OR rate_row->'rule'->>'destination_key' IS DISTINCT FROM rate_inputs->>'destination_key' OR (rate_inputs->>'weight_grams')::bigint<(rate_row->'rule'->>'min_weight_grams')::bigint OR (rate_inputs->>'weight_grams')::bigint>=(rate_row->'rule'->>'max_weight_grams')::bigint OR NEW.evidence->'rate_inputs' IS DISTINCT FROM rate_inputs OR NEW.evidence->'rate_mapping_ids' IS DISTINCT FROM rate_row->'mapping_ids' THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE_INPUTS' USING ERRCODE='23514';END IF;
  rate_amount:=(rate_row->'rule'->>'freight_paise')::bigint+(rate_row->'rule'->>'packing_paise')::bigint;
  IF NEW.amount_paise<>rate_amount OR NEW.allocations<>jsonb_build_array(jsonb_build_object('booking_id',booking.id,'parcel_id',NULL,'amount_paise',rate_amount)) THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE_AMOUNT' USING ERRCODE='23514';END IF;
 END IF;
 IF previous.evidence->>'expense_root_id' IS NOT NULL AND previous.evidence->>'expense_root_id' IS DISTINCT FROM NEW.evidence->>'expense_root_id' THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE_UNLINK' USING ERRCODE='23514';END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.allocations) LOOP
  IF jsonb_typeof(a)<>'object' OR a-ARRAY['booking_id','parcel_id','amount_paise']<>'{}'::jsonb OR COALESCE(a->>'amount_paise','')!~'^(0|[1-9][0-9]{0,15})$' OR (a->>'amount_paise')::numeric>9007199254740991 OR (NEW.amount_paise=0) IS DISTINCT FROM ((a->>'amount_paise')::numeric=0) THEN RAISE EXCEPTION 'SHIPMENT_COST_ALLOCATION' USING ERRCODE='23514';END IF;
  total:=total+(a->>'amount_paise')::numeric;
 END LOOP;
 IF total>NEW.amount_paise THEN RAISE EXCEPTION 'SHIPMENT_COST_CAPACITY' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;

-- Preserve 1793034000000-shipment-costs.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_shipment_cost_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_GENERATED' USING ERRCODE='23514';END IF;
 IF NEW.operation IN ('record','preview','apply') THEN
  PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_COST_SCOPE' USING ERRCODE='42501';END IF;
  PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_COST_SCOPE' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active') THEN RAISE EXCEPTION 'SHIPMENT_COST_ACTOR' USING ERRCODE='42501';END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;

-- Preserve 1793120400000-versioned-settings.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_settings_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE prior shipit.settings_versions;k text;v jsonb;allowed text[]:=ARRAY['identity','language','operating_hours','booking_defaults','collection_calendar','receiving_account','approval_policy','agent_fee_policy','close_cutoff','credit_policy','overdue_policy','billing_terms','report_scope','reporting_schedule'];p jsonb;s jsonb;
BEGIN
 IF NEW.effective_at IS NOT NULL OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SETTINGS_GENERATED_TIME' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_SCOPE' USING ERRCODE='42501';END IF;
 IF NEW.franchise_id IS NOT NULL THEN
  PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_SCOPE' USING ERRCODE='42501';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND
  (NEW.franchise_id IS NULL AND m.role='org_admin' OR NEW.franchise_id IS NOT NULL AND m.role IN ('org_admin','franchise_admin') AND EXISTS(SELECT 1 FROM shipit.business_membership_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=NEW.franchise_id))) THEN RAISE EXCEPTION 'SETTINGS_ACTOR' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM shipit.settings_versions WHERE organization_id=NEW.organization_id AND franchise_id IS NOT DISTINCT FROM NEW.franchise_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(prior.version,0)+1 THEN RAISE EXCEPTION 'SETTINGS_VERSION' USING ERRCODE='40001';END IF;
 p:=COALESCE(prior.payload,'{}'::jsonb);s:=COALESCE(prior.source_versions,'{}'::jsonb);
 FOR k,v IN SELECT * FROM jsonb_each(NEW.changes) LOOP
  IF NOT(k=ANY(allowed)) OR NEW.franchise_id IS NULL AND k=ANY(ARRAY['receiving_account','approval_policy','agent_fee_policy']) THEN RAISE EXCEPTION 'SETTINGS_KEY' USING ERRCODE='23514';END IF;
  IF v='null'::jsonb THEN p:=p-k;s:=s-k;
  ELSE
   IF shipit.settings_value_valid(k,v) IS DISTINCT FROM true THEN RAISE EXCEPTION 'SETTINGS_VALUE' USING ERRCODE='23514';END IF;
   IF (k='identity' AND (v-ARRAY['display_name']<>'{}'::jsonb OR jsonb_typeof(v->'display_name') IS DISTINCT FROM 'string')) OR
    (k='language' AND (v-ARRAY['locale']<>'{}'::jsonb OR COALESCE(v->>'locale','') NOT IN ('en','hi'))) OR
    (k='booking_defaults' AND (v-ARRAY['service']<>'{}'::jsonb OR COALESCE(v->>'service','') NOT IN ('standard','express','same_city'))) OR
    (k=ANY(ARRAY['credit_policy','overdue_policy','billing_terms']) AND v<>'{"state":"unconfigured","owner":"account_terms_v1"}'::jsonb) OR
    (k='collection_calendar' AND (v-ARRAY['timezone','weekdays','holidays']<>'{}'::jsonb OR COALESCE(v->>'timezone','')<>'Asia/Kolkata' OR jsonb_typeof(v->'weekdays') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'holidays') IS DISTINCT FROM 'array')) OR
    (k='receiving_account' AND v-ARRAY['account_id','revision_id','method']<>'{}'::jsonb) OR
    (k='approval_policy' AND v-ARRAY['revision_id']<>'{}'::jsonb) OR
    (k='agent_fee_policy' AND v-ARRAY['agent_id','revision_id']<>'{}'::jsonb) OR
    (k='operating_hours' AND v-ARRAY['timezone','days']<>'{}'::jsonb) OR
    (k='close_cutoff' AND v-ARRAY['timezone','minute']<>'{}'::jsonb) OR
    (k='report_scope' AND v-ARRAY['franchise_ids']<>'{}'::jsonb) OR
    (k='reporting_schedule' AND v-ARRAY['report','franchise_ids','timezone','weekday','minute']<>'{}'::jsonb)
    THEN RAISE EXCEPTION 'SETTINGS_VALUE' USING ERRCODE='23514';END IF;
   IF k='receiving_account' AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.account_id=(v->>'account_id')::uuid AND r.id=(v->>'revision_id')::uuid AND r.active AND v->>'method'=ANY(r.methods) AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.account_id=r.account_id AND n.version>r.version)) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k='approval_policy' AND NOT EXISTS(SELECT 1 FROM shipit.financial_policy_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(v->>'revision_id')::uuid AND r.enabled AND NOT r.allow_self_approval AND r.discount_review_threshold_paise IS NULL AND NOT EXISTS(SELECT 1 FROM shipit.financial_policy_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.version>r.version)) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k='agent_fee_policy' AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(v->>'revision_id')::uuid AND r.agent_id=(v->>'agent_id')::uuid AND r.active AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.agent_id=r.agent_id AND n.version>r.version) AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=r.organization_id AND f.franchise_id=r.franchise_id AND m.user_id=r.agent_id AND m.role='delivery_agent' AND m.lifecycle='active')) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k IN ('report_scope','reporting_schedule') THEN
    IF NEW.franchise_id IS NOT NULL AND NOT(v->'franchise_ids' ? NEW.franchise_id::text) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v->'franchise_ids') i WHERE NOT EXISTS(SELECT 1 FROM shipit.franchises f WHERE f.organization_id=NEW.organization_id AND f.id=i::uuid) OR NOT EXISTS(SELECT 1 FROM shipit.memberships m WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='org_admin' OR m.role IN ('franchise_admin','accountant','org_admin') AND EXISTS(SELECT 1 FROM shipit.business_membership_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=i::uuid)))) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   END IF;
   p:=p||jsonb_build_object(k,v);s:=s||jsonb_build_object(k,NEW.version);
  END IF;
 END LOOP;
 IF NEW.payload<>p OR NEW.source_versions<>s THEN RAISE EXCEPTION 'SETTINGS_PROVENANCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();NEW.effective_at:=NEW.recorded_at;
 IF prior.effective_at IS NOT NULL AND NEW.effective_at<=prior.effective_at THEN RAISE EXCEPTION 'SETTINGS_TIME' USING ERRCODE='40001';END IF;
 RETURN NEW;
END $fn$;

-- Preserve 1793206800000-customer-accounts.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_customer_account_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_GENERATED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active')
 THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='customer_account_revisions' THEN
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
 ELSE
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.customer_account_rates WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
  IF NEW.effective_from<date_trunc('milliseconds',clock_timestamp()) THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_RATE_PAST' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_VERSION' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;

-- Preserve 1793206800000-customer-accounts.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_customer_credit_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q shipit.pricing_quotes;t shipit.tax_calculations;r shipit.customer_account_revisions;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active')
 THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.operator_id AND m.role IN ('org_admin','franchise_admin','operator') AND m.lifecycle='active') THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_OPERATOR' USING ERRCODE='42501';END IF;
 IF NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.customer_credit_requests req WHERE req.organization_id=NEW.organization_id AND req.franchise_id=NEW.franchise_id AND req.id=NEW.request_id AND req.operator_id=NEW.operator_id AND req.account_id=NEW.account_id AND req.fingerprint=NEW.intent_fingerprint AND req.booking_intent->'tax_intent'->>'quote_id'=NEW.quote_id::text AND req.booking_intent->>'tax_calculation_id'=NEW.tax_calculation_id::text) THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_REQUEST' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM shipit.pricing_quotes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.quote_id AND actor_id=NEW.operator_id;
 SELECT * INTO t FROM shipit.tax_calculations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.tax_calculation_id AND actor_id=NEW.operator_id;
 IF r.id IS DISTINCT FROM NEW.account_revision_id OR r.state<>'active' OR q.id IS NULL OR t.id IS NULL OR q.result->'account'->>'revision_id' IS DISTINCT FROM r.id::text OR t.result->>'quote_id' IS DISTINCT FROM q.id::text
 OR NEW.amount_paise IS DISTINCT FROM (t.result->>'final_payable_paise')::bigint OR NEW.expires_at IS DISTINCT FROM LEAST(q.expires_at,(t.result->>'expires_at')::timestamptz)
 OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SOURCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;

-- Preserve 1793206800000-customer-accounts.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_customer_account_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE b shipit.bookings;a shipit.customer_accounts;r shipit.customer_account_revisions;p shipit.customer_credit_approvals;outstanding numeric;overdue numeric;
BEGIN
 SELECT * INTO a FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 IF a.id IS NULL OR b.id IS NULL OR r.id IS DISTINCT FROM NEW.account_revision_id OR r.state<>'active' OR NOT(b.customer_id=ANY(r.shipping_customer_ids))
 OR NEW.debtor_customer_id IS DISTINCT FROM a.debtor_customer_id OR b.pricing_snapshot->'account'->>'revision_id' IS DISTINCT FROM r.id::text
 OR b.pricing_snapshot->'account'->>'rate_revision_id' IS DISTINCT FROM NEW.rate_revision_id::text
 OR NEW.snapshot->>'account_id' IS DISTINCT FROM a.id::text OR NEW.snapshot->>'account_revision_id' IS DISTINCT FROM r.id::text
 OR NEW.snapshot->'debtor'->>'source_customer_id' IS DISTINCT FROM a.debtor_customer_id::text OR NEW.snapshot->>'due_date' IS DISTINCT FROM NEW.due_date::text
 OR NEW.snapshot->>'approval_id' IS DISTINCT FROM NEW.approval_id::text OR NEW.snapshot->>'rate_revision_id' IS DISTINCT FROM NEW.rate_revision_id::text
 OR (NEW.snapshot->>'credit_limit_paise')::bigint IS DISTINCT FROM r.credit_limit_paise
 OR (NEW.snapshot->>'closing_day')::integer IS DISTINCT FROM r.closing_day OR (NEW.snapshot->>'due_days')::integer IS DISTINCT FROM r.due_days
 OR (NEW.snapshot->>'account_version')::integer IS DISTINCT FROM r.version
 OR NEW.snapshot->>'rate_source' IS DISTINCT FROM b.pricing_snapshot->'account'->>'rate_source'
 OR NEW.snapshot->'debtor' IS DISTINCT FROM (SELECT jsonb_build_object('source_customer_id',c.id,'source_customer_version',c.version,'name',c.name,'phone',c.phone_normalized,'phone_display',c.phone_display,'address',c.address) FROM shipit.customers c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.debtor_customer_id)
 OR NEW.due_date IS DISTINCT FROM shipit.customer_account_due_date(b.confirmed_at,r.closing_day,r.due_days) THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_SOURCE' USING ERRCODE='23514';END IF;
 SELECT COALESCE(sum(x.due),0),COALESCE(sum(x.due) FILTER(WHERE x.due_date<(b.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date),0) INTO outstanding,overdue
 FROM (SELECT ab.due_date,GREATEST(0,ob.total_paise::numeric-COALESCE(f.reduction,0)-COALESCE(e.collected,0)+COALESCE(f.refund,0)) due
 FROM shipit.customer_account_bookings ab JOIN shipit.booking_obligations ob ON ob.organization_id=ab.organization_id AND ob.franchise_id=ab.franchise_id AND ob.booking_id=ab.booking_id
 LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END) collected FROM shipit.payment_entries WHERE organization_id=ab.organization_id AND franchise_id=ab.franchise_id AND booking_id=ab.booking_id) e ON true
 LEFT JOIN LATERAL(SELECT sum(pre_tax::numeric+cgst+sgst+igst+rounding) reduction,sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END) refund FROM shipit.financial_changes WHERE organization_id=ab.organization_id AND franchise_id=ab.franchise_id AND booking_id=ab.booking_id) f ON true
 WHERE ab.organization_id=NEW.organization_id AND ab.franchise_id=NEW.franchise_id AND ab.account_id=NEW.account_id) x;
 IF overdue>0 OR NEW.snapshot->>'exposure_before_paise' IS DISTINCT FROM outstanding::text THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_EXPOSURE' USING ERRCODE='23514';END IF;
 IF NEW.approval_id IS NOT NULL THEN
  SELECT * INTO p FROM shipit.customer_credit_approvals WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.approval_id FOR UPDATE;
  IF p.id IS NULL OR p.account_id<>a.id OR p.account_revision_id<>r.id OR p.amount_paise<>b.final_payable_paise OR p.expires_at<=b.confirmed_at OR p.quote_id<>b.pricing_quote_id OR p.tax_calculation_id<>b.tax_calculation_id
  OR NOT EXISTS(SELECT 1 FROM shipit.booking_commands c WHERE c.id=b.command_id AND c.principal_id=p.operator_id AND c.fingerprint=p.booking_fingerprint)
  OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=p.actor_id AND m.role IN ('org_admin','franchise_admin') AND m.lifecycle='active')
  THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_APPROVAL' USING ERRCODE='23514';END IF;
 ELSIF outstanding+b.final_payable_paise>r.credit_limit_paise THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_CREDIT' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;

-- Preserve 1793206800000-customer-accounts.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_customer_credit_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q shipit.pricing_quotes;r shipit.customer_account_revisions;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.operator_id AND m.role IN ('org_admin','franchise_admin','operator') AND m.lifecycle='active') THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM shipit.pricing_quotes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.booking_intent->'tax_intent'->>'quote_id')::uuid AND actor_id=NEW.operator_id;
 IF q.id IS NULL OR r.id IS NULL OR r.state<>'active' OR q.expires_at<=clock_timestamp()
 OR q.result->'account'->>'revision_id' IS DISTINCT FROM r.id::text
 OR NOT COALESCE((NEW.booking_intent->>'customer_id')::uuid=ANY(r.shipping_customer_ids),false)
 OR NEW.booking_intent ? 'credit_approval_id'
 OR NOT EXISTS(SELECT 1 FROM shipit.tax_calculations t JOIN shipit.tax_intents i ON i.organization_id=t.organization_id AND i.franchise_id=t.franchise_id AND i.id=t.intent_id WHERE t.organization_id=NEW.organization_id AND t.franchise_id=NEW.franchise_id AND t.id=(NEW.booking_intent->>'tax_calculation_id')::uuid AND t.actor_id=NEW.operator_id AND i.quote_id=q.id AND i.input=NEW.booking_intent->'tax_intent' AND (t.result->>'expires_at')::timestamptz>clock_timestamp())
 THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SOURCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();
 INSERT INTO shipit.customer_account_audit_events VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.account_id,'customer_accounts.request',r.version,NEW.operator_id,NEW.correlation_id,NEW.recorded_at);
 RETURN NEW;
END $fn$;

-- Preserve 1793293200000-manual-reconciliation.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_reconciliation_command() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role IN ('org_admin','franchise_admin') OR m.role='accountant' AND NEW.action NOT IN ('configure','mapping','unmatch')))
 THEN RAISE EXCEPTION 'RECONCILIATION_ACTOR' USING ERRCODE='42501';END IF;
 IF NEW.action<>'configure' AND NOT COALESCE((SELECT enabled FROM shipit.reconciliation_config_versions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id ORDER BY version DESC LIMIT 1),false)
 THEN RAISE EXCEPTION 'RECONCILIATION_DISABLED' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;

-- Preserve 1793293200000-manual-reconciliation.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_reconciliation_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='org_admin' AND NEW.action='reconciliation.read' OR m.role IN ('franchise_admin','accountant','org_admin') AND EXISTS(SELECT 1 FROM shipit.business_membership_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=NEW.franchise_id))) THEN RAISE EXCEPTION 'RECONCILIATION_ACCESS_ACTOR' USING ERRCODE='42501';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;

-- Preserve 1793379600000-monthly-account-statements.cjs; policy-v2 membership predicate only.
CREATE OR REPLACE FUNCTION shipit.guard_advance_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
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
 SELECT COALESCE(bool_or(m.role IN ('org_admin','franchise_admin')),false),COALESCE(bool_or(m.role='operator'),false) INTO admin,operator
 FROM shipit.memberships m JOIN shipit.business_membership_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
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

`);
exports.down=()=>{throw new Error('Forward-only migration');};
