import type { DatabasePool, QueryExecutor } from './pool.ts';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'EXECUTE';
export interface AccessRequirement {
  kind: 'table' | 'function';
  object: string;
  privilege: Privilege;
  column_name?: string;
}
export interface AccessProfile {
  description: string;
  requirements: readonly AccessRequirement[];
}
const tables = (names: string, privilege: Privilege = 'SELECT'): AccessRequirement[] =>
  names.split(' ').map(name => ({ kind: 'table', object: `shipit.${name}`, privilege }));
const insertColumns = (table: string, columns: string): AccessRequirement[] => columns.split(',').map(column_name =>
  ({ kind: 'table', object: `shipit.${table}`, privilege: 'INSERT', column_name }));
const updateColumns = (table: string, columns: string): AccessRequirement[] => columns.split(',').map(column_name =>
  ({ kind: 'table', object: `shipit.${table}`, privilege: 'UPDATE', column_name }));
const functions = (...signatures: string[]): AccessRequirement[] => signatures.map(signature =>
  ({ kind: 'function', object: `shipit.${signature}`, privilege: 'EXECUTE' }));

// Explicit coverage, not a promise that a whole workflow is ready. Most profiles
// check reads only; subsequent domain changes must review their own write access.
// Derived from the owning repositories and existing restricted-role test setup.
export const runtimeAccessProfiles: Readonly<Record<string, AccessProfile>> = {
  settings: { description: 'Settings reads and immutable version/command inserts', requirements: [
    ...tables('settings_versions settings_commands settings_events'),
    ...tables('settings_versions settings_commands', 'INSERT'),
    ...tables('receiving_account_revisions financial_policy_revisions agent_fee_term_revisions'),
  ] },
  receiving_accounts: { description: 'Receiving-account reads and column-limited setup inserts', requirements: [
    ...tables('receiving_accounts receiving_account_revisions'),
    ...insertColumns('receiving_accounts', 'id,organization_id,franchise_id'),
    ...insertColumns('receiving_account_revisions', 'id,organization_id,franchise_id,account_id,version,name,methods,other_method_name,active,actor_id,correlation_id,key_digest,fingerprint'),
    { kind: 'function', object: 'shipit.valid_receiving_methods(text[])', privilege: 'EXECUTE' },
  ] },
  // Recording money received (and so marking a counter booking paid). MONEY_RECEIPTS_ENABLED only
  // lets the API try; without these grants every receipt is refused by the database. Kept apart
  // from the read-only money_receipts profile so turning writes on stays a deliberate step.
  // Mirrors prepareMoneyReceipts in test/support.ts.
  money_receipt_writes: { description: 'Recording money receipts and applying them to bookings; needs receiving_accounts for setup', requirements: [
    ...tables('money_receipts money_receipt_commands money_receipt_allocations customer_account_bookings cod_receipt_allocations cod_receipt_positions advance_refund_commands'),
    ...tables('money_receipt_allocations advance_refund_commands', 'INSERT'),
    ...insertColumns('money_receipt_commands', 'id,organization_id,franchise_id,receipt_id,principal_id,operation_id,version,key_digest,fingerprint,input,correlation_id'),
    ...insertColumns('money_receipts', 'id,organization_id,franchise_id,command_id,customer_id,account_id,account_revision_id,amount_paise,currency,method,receiver_id,initial_custodian_id,occurred_at,external_reference'),
    ...updateColumns('money_receipt_commands', 'state,result,committed_at'),
    ...updateColumns('money_receipts', 'id'),
    { kind: 'function', object: 'shipit.money_receipt_result(uuid,uuid,uuid)', privilege: 'EXECUTE' },
  ] },
  customer_accounts: { description: 'Customer account read dependencies only', requirements:
    tables('customer_accounts customer_account_revisions customer_account_rates customer_account_bookings customer_account_customer_links customer_account_audit_events customer_credit_approvals customer_credit_requests cod_receipt_positions') },
  cashbook: { description: 'Cashbook read dependencies only', requirements:
    tables('cash_locations cash_location_revisions cashbook_requests cashbook_request_decisions cashbook_effects cashbook_effect_legs cashbook_source_versions cashbook_source_facts cash_handovers cash_handover_commands cash_handover_legs cash_handover_positions receiving_account_revisions') },
  money_receipts: { description: 'Money receipt read dependencies only', requirements:
    tables('receiving_accounts receiving_account_revisions money_receipts money_receipt_commands money_receipt_allocations advance_refund_commands') },
  agent_money: { description: 'Settlement and agent-money read dependencies only', requirements:
    tables('agent_settlement_submissions agent_settlement_decisions agent_settlement_events agent_daily_cash_captures agent_money_commands cod_beneficiaries cod_beneficiary_revisions cod_obligations cod_obligation_revisions cod_receipt_allocations agent_fee_term_revisions agent_fee_earnings agent_fee_positions agent_advance_positions agent_fee_applied_requests cash_receipt_component_captures cash_receipt_components cash_handover_attributions') },
  pickups: { description: 'Pickup read dependencies only', requirements:
    tables('pickup_requests pickup_events pickup_commands customer_quotes customer_quote_policies customer_conversations whatsapp_inbox whatsapp_installations whatsapp_outbound') },
  support: { description: 'Support read dependencies only', requirements:
    tables('support_cases support_events support_commands customer_conversations customer_conversation_turns whatsapp_outbound') },
  whatsapp: { description: 'WhatsApp installation, history and policy reads only; no send grants', requirements:
    tables('whatsapp_installations whatsapp_templates whatsapp_commands whatsapp_inbox whatsapp_inbox_attempts whatsapp_delivery_observations whatsapp_outbound whatsapp_outbound_attempts whatsapp_outbound_redrives whatsapp_consent_state whatsapp_consent_receipts notification_policy_activations notification_automation_decisions') },
  bookings: { description: 'Core booking and counter-entry reads only', requirements:
    tables('bookings parcels counter_bookings counter_booking_events customers booking_obligations') },
  lots_routes: { description: 'Lot and route planning reads only', requirements:
    tables('lots lot_memberships lot_commands routes route_commands route_lots route_parcels route_manifests route_manifest_parcels route_manifest_sources domain_events') },
  // The counter's own write path. Without it a local API can price and tax a booking but every
  // save is refused by the database (reported to the operator as "Outcome uncertain"), and every
  // counter draft is refused too. Mirrors the restricted-role grants in test/support.ts.
  booking_creation: { description: 'Counter booking and draft creation; no cancellation, parcel-state or payment mutations', requirements: [
    ...tables('bookings parcels booking_commands booking_obligations domain_events counter_bookings counter_booking_events'),
    ...tables('bookings parcels booking_commands booking_obligations domain_events counter_bookings counter_booking_events', 'INSERT'),
    ...updateColumns('booking_commands', 'state,http_status,result,committed_at,retain_until'),
    // Spelled as Postgres reports argument types, not "timestamptz": the check matches text.
    { kind: 'function', object: 'shipit.append_booking_audit(uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone)', privilege: 'EXECUTE' },
  ] },
  dispatch_creation: { description: 'Empty lot and route creation; no parcel, journey, membership or provider mutations', requirements: [
    ...tables('lots lot_memberships lot_commands routes route_commands route_lots route_parcels route_manifests route_manifest_parcels route_manifest_sources domain_events counter_bookings'),
    ...tables('lots lot_commands routes route_commands route_manifests route_manifest_parcels route_manifest_sources domain_events', 'INSERT'),
    ...updateColumns('lot_commands', 'state,http_status,result,committed_at,retain_until'),
    ...updateColumns('route_commands', 'state,http_status,result,committed_at,retain_until'),
    { kind: 'function', object: 'shipit.append_lot_audit(uuid,uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
    { kind: 'function', object: 'shipit.append_route_audit(uuid,uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
  ] },
  // Instant cancellation. The charge reversal, refunds and parcel state change happen inside the
  // SECURITY DEFINER cancellation trigger, so the runtime role only records the cancellation and
  // runs its preview; a parcel in a bag is first taken out through the ordinary lot command.
  // Mirrors prepareBookings/prepareLots in test/support.ts.
  booking_cancellation: { description: 'Instant booking cancellation, including taking parcels out of their bag; money changes run as the trigger owner', requirements: [
    ...tables('bookings parcels booking_cancellations lots lot_memberships lot_commands routes route_lots route_parcels domain_events'),
    ...tables('booking_cancellations lot_commands domain_events', 'INSERT'),
    ...updateColumns('lots', 'version,updated_at,last_command_id'),
    ...updateColumns('lot_memberships', 'ended_at,end_command_id,end_reason'),
    ...updateColumns('lot_commands', 'state,http_status,result,committed_at,retain_until'),
    { kind: 'function', object: 'shipit.booking_cancellation_preview(uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
    { kind: 'function', object: 'shipit.booking_cancellation_lot_memberships(uuid,uuid,uuid)', privilege: 'EXECUTE' },
    { kind: 'function', object: 'shipit.append_lot_audit(uuid,uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
  ] },
  reconciliation: { description: 'Reconciliation read dependencies only', requirements:
    tables('reconciliation_commands reconciliation_config_versions reconciliation_mapping_versions reconciliation_imports reconciliation_transactions reconciliation_row_outcomes reconciliation_batches reconciliation_matches reconciliation_match_transactions reconciliation_match_sources reconciliation_unmatches reconciliation_classifications reconciliation_review_revisions reconciliation_access_events reconciliation_recorded_sources receiving_accounts receiving_account_revisions cashbook_source_facts') },
  custody: { description: 'Custody reads and required read-access audit inserts; no custody commands', requirements: [
    ...tables('custody_access_events custody_commands custody_assignment_instructions custody_manifests custody_manifest_items custody_receipts custody_discrepancies custody_transfer_grants custody_grant_revocations custody_releases custody_manifest_cancellations custody_events delivery_attempts delivery_proofs parcel_failed_attempts parcels'),
    ...tables('custody_access_events', 'INSERT'),
  ] },
  deliveries: { description: 'Delivery worklist and evidence reads only; no proof or state-change grants', requirements:
    tables('delivery_commands delivery_recipients delivery_attempts delivery_challenges delivery_challenge_sends delivery_exception_requests delivery_exception_approvals delivery_proofs delivery_audit_events parcels bookings attachments') },
  eway: { description: 'E-way overview and detailed record reads only', requirements:
    tables('eway_records eway_record_revisions eway_commands eway_policies bookings') },
  financial: { description: 'Financial policy and request reads only', requirements:
    tables('financial_changes financial_access_events financial_adjustment_requests financial_deletion_denials financial_document_links financial_policy_revisions financial_refund_evidence financial_request_decisions issued_receipts payment_entries receiving_account_revisions cash_locations cash_location_revisions') },
  cash_close: { description: 'Saved cash-close evidence reads only; no closing commands', requirements:
    tables('cash_close_sessions cash_close_dependencies cash_close_commands') },
  shipment_costs: { description: 'Shipment cost evidence reads only', requirements:
    tables('shipment_cost_sources shipment_cost_revisions shipment_cost_commands shipment_cost_allocations shipment_cost_aliases') },
  // Write and worker access, one profile per feature. Generated on 2026-11-21 from the grants
  // packages/db/test/support.ts (prepare*) gives the runtime role across the whole test suite,
  // minus what the profiles above already declare. Keep them in step when a migration adds a
  // table or a prepare* function adds a grant, so db:doctor keeps reporting what is missing.
  reports: { description: 'Unpaid-balance (ageing), sales, finance and delivery report snapshots and their reads. Mirrors prepareReports.', requirements: [
    ...tables('parcel_dispatch_manifests pricing_audit_events report_access_events report_snapshots'),
    ...tables('report_access_events report_snapshots', 'INSERT'),
    ...updateColumns('report_snapshots', 'metadata,rows'),
    // The receipt, account and finance reads prepareReports also grants, so this profile
    // repairs the reports on its own (they repeat requirements in other profiles).
    ...tables('money_receipts money_receipt_commands cod_receipt_positions advance_refund_commands customer_account_bookings'),
    ...tables('financial_adjustment_requests financial_request_decisions financial_document_links financial_deletion_denials financial_refund_evidence'),
  ] },
  core_access: { description: 'Sign-in, organizations, franchises, memberships, invitations, onboarding and their audit appends', requirements: [
    ...tables('audit_history auth_challenges auth_delivery_jobs auth_identifiers auth_rate_limits auth_sessions auth_users business_membership_scopes franchises invitation_franchise_scopes membership_franchise_scopes membership_invitations memberships onboarding_commands organizations'),
    ...tables('auth_challenges auth_delivery_jobs auth_identifiers auth_rate_limits auth_security_events auth_sessions auth_users franchises invitation_franchise_scopes membership_audit_events membership_franchise_scopes membership_invitations memberships onboarding_commands organizations', 'INSERT'),
    ...tables('auth_challenges auth_delivery_jobs auth_identifiers auth_rate_limits auth_sessions auth_users', 'UPDATE'),
    ...tables('auth_challenges auth_delivery_jobs auth_identifiers auth_rate_limits auth_sessions auth_users membership_franchise_scopes', 'DELETE'),
    ...updateColumns('franchises', 'display_name,lifecycle,lifecycle_changed_at,updated_at,version'),
    ...updateColumns('membership_invitations', 'accepted_at,revoked_at,state,updated_at,version'),
    ...updateColumns('memberships', 'lifecycle,revoked_at,role,updated_at,version'),
    ...updateColumns('organizations', 'display_name,lifecycle,lifecycle_changed_at,updated_at,version'),
    ...functions('append_security_denial(text,text,text,text,text,uuid)', 'append_tenancy_audit(uuid,uuid,text,text,text,text,uuid,text,uuid,timestamp with time zone,text,text,integer)'),
  ] },
  counter_writes: { description: 'Customers, pricing, tax and booking writes used at the counter', requirements: [
    ...tables('booking_services customer_commands pricing_cards pricing_commands pricing_quotes pricing_rules pricing_versions tax_calculations tax_cards tax_commands tax_intents tax_resolutions tax_versions'),
    ...tables('booking_services customer_commands customers pricing_cards pricing_commands pricing_quotes pricing_rules pricing_versions tax_calculations tax_cards tax_commands tax_intents tax_resolutions tax_versions', 'INSERT'),
    ...tables('pricing_rules', 'DELETE'),
    ...updateColumns('booking_obligations', 'id'),
    ...updateColumns('bookings', 'id'),
    ...updateColumns('customers', 'address,name,phone_display,phone_normalized,updated_at,version'),
    ...updateColumns('pricing_versions', 'approval_ref,effective_from,effective_to,override_tolerance_paise,published_at,published_by,quote_validity_seconds,revision,source_ref,state'),
    ...updateColumns('tax_versions', 'effective_from,effective_to,policy,published_by,revision,state'),
    ...functions('append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid)', 'append_pricing_audit(uuid,uuid,uuid,uuid,uuid,text,text,integer,uuid)'),
  ] },
  payment_writes: { description: 'Payments, issued receipts and financial changes', requirements: [
    ...tables('payment_commands'),
    ...tables('financial_access_events financial_changes financial_policy_revisions payment_commands payment_entries', 'INSERT'),
    ...insertColumns('issued_receipts', 'actor_id,booking_id,booking_receipt_id,correction_of,correlation_id,franchise_id,id,kind,obligation_id,organization_id,payment_entry_id'),
    ...updateColumns('payment_commands', 'committed_at,entry_id,http_status,result,retain_until,state'),
    ...functions('append_payment_audit(uuid,uuid,uuid,uuid,uuid)'),
  ] },
  parcel_writes: { description: 'Parcel check-in, dispatch, transit, bulk requests and RTO approvals', requirements: [
    ...tables('parcel_bulk_requests parcel_commands parcel_rto_approvals parcel_transitions'),
    ...tables('parcel_bulk_requests parcel_commands parcel_failed_attempts parcel_rto_approvals parcel_transitions', 'INSERT'),
    ...updateColumns('parcel_commands', 'committed_at,http_status,result,retain_until,state'),
    ...updateColumns('parcels', 'active_attempt_id,assigned_agent_id,attempts_started,custody,failed_attempt_count,last_command_id,status,updated_at,version'),
  ] },
  lot_route_writes: { description: 'Lot and route commands, route delay messages and reminders', requirements: [
    ...tables('lot_message_requests route_delay_fanout_items route_delay_fanouts route_delay_reminder_commands route_delay_reminder_events route_message_requests route_parcel_effects'),
    ...tables('lot_memberships lot_message_requests route_delay_fanout_items route_delay_fanouts route_delay_reminder_commands route_delay_reminder_events route_lots route_message_requests route_parcel_effects route_parcels', 'INSERT'),
    ...tables('lot_message_requests route_message_requests', 'UPDATE'),
    ...updateColumns('lots', 'archived_at,name,state'),
    ...updateColumns('route_delay_fanouts', 'attempt_count,completed_at,completed_count,cursor_parcel_id,failed_count,reason_code,skipped_count,started_at,state'),
    ...updateColumns('route_delay_reminder_commands', 'committed_at,result,state'),
    ...updateColumns('route_lots', 'end_command_id,ended_at'),
    ...updateColumns('route_parcels', 'end_command_id,ended_at'),
    ...updateColumns('routes', 'base_eta_at,carrier_code,current_manifest_id,destination,execution_state,last_command_id,last_effective_at,mode,origin,scheduled_departure_at,state,total_delay_minutes,updated_at,version'),
    ...functions('route_delay_fanout_scope(timestamp with time zone)'),
  ] },
  delivery_writes: { description: 'Delivery attempts, challenges, proofs and exceptions', requirements: [
    ...tables('delivery_attempts delivery_audit_events delivery_challenge_sends delivery_challenges delivery_commands delivery_exception_approvals delivery_exception_requests delivery_proofs delivery_recipients', 'INSERT'),
    ...updateColumns('delivery_attempts', 'agent_id,close_delivery_command_id,close_parcel_command_id,closed_at,failed_verifications,locked_at,resend_count,state,version'),
    ...updateColumns('delivery_challenges', 'closed_at,consumed_at,encrypted_secret,superseded_at,superseded_by,verifier'),
    ...updateColumns('delivery_commands', 'committed_at,http_status,result,retain_until,state'),
    ...updateColumns('delivery_exception_requests', 'decided_at,decision_command_id,state'),
    ...functions('delivery_challenge_cleanup_scope(timestamp with time zone)'),
  ] },
  custody_writes: { description: 'Custody manifests, receipts, transfers and releases', requirements: [
    ...tables('custody_assignment_instructions custody_commands custody_discrepancies custody_events custody_grant_revocations custody_manifest_cancellations custody_manifest_items custody_manifests custody_receipts custody_releases custody_transfer_grants', 'INSERT'),
  ] },
  cashbook_writes: { description: 'Cash locations, cashbook requests and cash handovers', requirements: [
    ...tables('cash_handover_commands cash_handover_legs cash_handovers cash_location_revisions cash_locations cashbook_effect_legs cashbook_effects cashbook_request_decisions cashbook_requests', 'INSERT'),
  ] },
  cash_close_writes: { description: 'Cash-close commands and source frames', requirements: [
    ...tables('cash_close_commands', 'INSERT'),
    ...functions('cash_close_instant(timestamp with time zone)', 'cash_close_source_frame(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)', 'cash_close_source_identity(jsonb)'),
  ] },
  agent_money_writes: { description: 'Agent fees, daily cash, settlements and COD', requirements: [
    ...tables('agent_daily_cash_captures agent_fee_earnings agent_fee_term_revisions agent_money_commands agent_settlement_decisions agent_settlement_submissions cod_beneficiaries cod_beneficiary_revisions cod_obligation_revisions cod_obligations cod_receipt_allocations', 'INSERT'),
    ...updateColumns('cod_obligations', 'id'),
  ] },
  customer_account_writes: { description: 'Customer accounts, credit and monthly statements', requirements: [
    ...tables('account_statement_lines account_statements'),
    ...tables('account_statement_lines account_statements customer_account_bookings customer_account_rates customer_account_revisions customer_accounts customer_credit_approvals customer_credit_requests', 'INSERT'),
    ...updateColumns('customer_accounts', 'id'),
    ...updateColumns('customer_credit_approvals', 'id'),
    ...updateColumns('customer_credit_requests', 'id'),
  ] },
  reconciliation_writes: { description: 'Manual reconciliation imports, matches and reviews', requirements: [
    ...tables('reconciliation_access_events reconciliation_batches reconciliation_classifications reconciliation_commands reconciliation_config_versions reconciliation_imports reconciliation_mapping_versions reconciliation_match_sources reconciliation_match_transactions reconciliation_matches reconciliation_review_revisions reconciliation_row_outcomes reconciliation_transactions reconciliation_unmatches', 'INSERT'),
  ] },
  shipment_cost_writes: { description: 'Shipment cost sources and revisions', requirements: [
    ...tables('shipment_cost_commands shipment_cost_revisions shipment_cost_sources', 'INSERT'),
    ...updateColumns('shipment_cost_sources', 'id'),
  ] },
  carriers: { description: 'Carrier installations, rates, imports, dockets and tracking', requirements: [
    ...tables('carrier_commands carrier_dockets carrier_import_commits carrier_import_outcomes carrier_import_runs carrier_installations carrier_mappings carrier_observations carrier_rate_approvals carrier_rate_commands carrier_rate_imports carrier_references carrier_tracking_checkpoints carrier_tracking_decisions carrier_tracking_records'),
    ...tables('carrier_commands carrier_dockets carrier_import_commits carrier_import_outcomes carrier_import_runs carrier_installations carrier_mappings carrier_observations carrier_rate_approvals carrier_rate_commands carrier_rate_imports carrier_references carrier_tracking_checkpoints carrier_tracking_decisions carrier_tracking_records', 'INSERT'),
  ] },
  eway_writes: { description: 'E-way record commands', requirements: [
    ...tables('eway_commands eway_records', 'INSERT'),
    ...updateColumns('eway_records', 'actor_id,captured_at,command_id,correlation_id,declaration_source_ref,declared_goods_value_paise,distance_km,estimate,estimate_policy_id,external_reference,issuer,official_valid_until,reason_code,reason_ref,source_issued_at,source_ref,validity_evidence_ref,vehicle_number,version'),
  ] },
  attachments: { description: 'Attachment uploads and cleanup', requirements: [
    ...tables('attachment_commands'),
    ...tables('attachment_commands attachments', 'INSERT'),
    ...updateColumns('attachments', 'actor_id,actor_type,actual_size,cleanup_attempts,cleanup_due_at,correlation_id,deleted_at,detected_type,digest,linked_at,scan_state,state,upload_attempt,upload_lease_until,uploaded_at,validated_at,version'),
    ...functions('attachment_cleanup_scope(timestamp with time zone)'),
  ] },
  pickup_writes: { description: 'Pickup request writes', requirements: [
    ...tables('pickup_commands pickup_events pickup_requests', 'INSERT'),
    ...updateColumns('pickup_requests', 'agreed_end,agreed_start,assigned_staff_id,state,updated_at,version'),
  ] },
  support_writes: { description: 'Support cases', requirements: [
    ...tables('support_cases support_commands support_events', 'INSERT'),
    ...updateColumns('support_cases', 'assigned_staff_id,inbox_id,state,updated_at,version'),
  ] },
  customer_quotes: { description: 'Customer quote policies and quotes', requirements: [
    ...tables('customer_quote_policy_commands'),
    ...tables('customer_quote_policies customer_quote_policy_commands customer_quotes', 'INSERT'),
  ] },
  customer_access: { description: 'Customer access bindings and tracking grants', requirements: [
    ...tables('customer_access_bindings customer_access_commands customer_tracking_grants'),
    ...tables('customer_access_bindings customer_access_commands customer_tracking_grants', 'INSERT'),
    ...updateColumns('customer_access_bindings', 'actor_id,contact_key,contact_version,correlation_id,customer_id,evidence_ref,expires_at,inbox_id,installation_id,verified_at,version'),
    ...functions('customer_tracking_scope(text)'),
  ] },
  conversations: { description: 'Customer conversations and assistant inferences', requirements: [
    ...tables('conversation_inference_budgets conversation_inferences'),
    ...tables('conversation_inference_budgets conversation_inferences customer_conversation_turns customer_conversations', 'INSERT'),
    ...updateColumns('conversation_inference_budgets', 'day_calls,day_start,minute_calls,minute_start,reserved_micro_usd'),
    ...updateColumns('conversation_inferences', 'estimated_micro_usd,input_tokens,latency_ms,output_tokens,state'),
    ...updateColumns('customer_conversations', 'expires_at,locale,locale_explicit,pending_intent,pickup_draft,quote_draft,selected_docket,state,version'),
    ...functions('customer_conversation_next()'),
  ] },
  whatsapp_writes: { description: 'WhatsApp installations, templates, inbox, consent and outbound messages', requirements: [
    ...tables('notification_automation_decisions whatsapp_commands whatsapp_installations whatsapp_outbound whatsapp_outbound_attempts whatsapp_outbound_redrives whatsapp_templates', 'INSERT'),
    ...updateColumns('whatsapp_installations', 'binding_key,command_id,credential_ref,credential_revision,state,validated_at,version'),
    ...updateColumns('whatsapp_outbound', 'attempt_id,attempts,available_at,cycle_attempts,lease_until,reason_code,sealed_payload,state,version'),
    ...functions('notification_policy_activate(uuid,uuid,jsonb)', 'whatsapp_consent_apply(uuid,uuid,uuid,text,text,text,text,text)', 'whatsapp_consent_next()', 'whatsapp_inbox_next()', 'whatsapp_inbox_process(uuid,uuid,uuid)', 'whatsapp_outbound_disclose(uuid,uuid,uuid)', 'whatsapp_outbound_scope(uuid,timestamp with time zone,boolean)', 'whatsapp_receive(jsonb,text[],uuid)'),
  ] },
  outbox: { description: 'Background job outbox used by the worker', requirements: [
    ...tables('outbox_attempts outbox_jobs outbox_receipts outbox_redrives outbox_streams'),
    ...tables('outbox_streams', 'INSERT'),
    ...updateColumns('outbox_jobs', 'id'),
    ...updateColumns('outbox_streams', 'high_water'),
    ...functions('outbox_claim(uuid,uuid,text,timestamp with time zone)', 'outbox_finish(uuid,uuid,uuid,uuid,text,integer,timestamp with time zone)', 'outbox_job_scope(uuid)', 'outbox_next_scope(text,text[],text,timestamp with time zone)', 'outbox_receipt(uuid,uuid,uuid,uuid,text,timestamp with time zone)', 'outbox_redrive(uuid,uuid,uuid,uuid,uuid,text,text,integer,text)', 'outbox_relay(uuid,uuid,text,text[])'),
  ] },
  owner_reports: { description: 'Owner summary schedules, runs and deliveries', requirements: [
    ...tables('owner_report_access_events owner_report_alerts owner_report_commands owner_report_consents owner_report_deliveries owner_report_delivery_history owner_report_franchises owner_report_recipients owner_report_runs owner_report_schedules'),
    ...tables('owner_report_access_events owner_report_alerts owner_report_commands owner_report_consents owner_report_deliveries owner_report_franchises owner_report_recipients owner_report_runs owner_report_schedules', 'INSERT'),
    ...tables('owner_report_alerts owner_report_consents owner_report_deliveries owner_report_schedules', 'UPDATE'),
    ...tables('owner_report_franchises owner_report_recipients', 'DELETE'),
    ...updateColumns('owner_report_runs', 'payload'),
    ...functions('owner_report_delivery_scope(uuid,uuid)', 'owner_report_next(boolean)', 'owner_report_purge(uuid,uuid)', 'owner_report_schedule_scope(uuid)'),
  ] },
  // Approvals and refunds: proposing, deciding and applying a financial request. The tests grant
  // these inline (financial-workflow.test.ts, account-statements.test.ts), not in a prepare* step.
  financial_writes: { description: 'Financial adjustment and refund requests, decisions, evidence and document links', requirements: [
    ...tables('financial_adjustment_requests financial_request_decisions financial_document_links financial_refund_evidence financial_deletion_denials', 'INSERT'),
  ] },
};
// Everything above in one profile: `pnpm db:access --apply application` repairs a local
// database in one step, and db:doctor reports `application` blocked if anything is missing.
{
  const seen = new Set<string>(), requirements: AccessRequirement[] = [];
  for (const profile of Object.values(runtimeAccessProfiles)) for (const requirement of profile.requirements) {
    const id = [requirement.kind, requirement.object, requirement.privilege, requirement.column_name ?? ''].join('|');
    if (!seen.has(id)) { seen.add(id); requirements.push(requirement); }
  }
  (runtimeAccessProfiles as Record<string, AccessProfile>).application = {
    description: 'Every runtime grant the application is tested with (all profiles together)', requirements };
}
for (const profile of Object.values(runtimeAccessProfiles)) {
  profile.requirements.forEach(Object.freeze);
  Object.freeze(profile.requirements);
  Object.freeze(profile);
}
Object.freeze(runtimeAccessProfiles);

export interface AccessCheck extends AccessRequirement { status: 'granted' | 'missing_object' | 'missing_privilege' }
export interface RuntimeAccessReport {
  role_safe: boolean;
  schema_usage: boolean;
  profiles: Record<string, { description: string; status: 'granted' | 'blocked'; checks: AccessCheck[] }>;
}
function selectedProfiles(names: readonly string[]) {
  if (!names.length || names.length > Object.keys(runtimeAccessProfiles).length || new Set(names).size !== names.length ||
      names.some(name => !Object.hasOwn(runtimeAccessProfiles, name))) throw new Error('ACCESS_PROFILE_INVALID');
  return names.map(name => [name, runtimeAccessProfiles[name]!] as const);
}
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('ACCESS_IDENTIFIER_INVALID');
  return `"${value}"`;
};

async function roleSafety(db: QueryExecutor, role: string) {
  const result = await db.query<{ safe: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)
    AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
      AND pg_has_role($1,r.oid,'MEMBER'))
    AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND pg_has_role($1,d.datdba,'MEMBER'))
    AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='shipit' AND has_schema_privilege($1,n.oid,'CREATE'))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='shipit' AND pg_has_role($1,c.relowner,'MEMBER')) AS safe`, [role]);
  return result.rows[0]?.safe === true;
}

async function inspect(db: QueryExecutor, role: string, names: readonly string[]): Promise<RuntimeAccessReport> {
  const schema = await db.query<{ allowed: boolean }>(`SELECT COALESCE(has_schema_privilege($1,to_regnamespace('shipit'),'USAGE'),false) AS allowed`, [role]);
  const profiles: RuntimeAccessReport['profiles'] = {};
  for (const [name, profile] of selectedProfiles(names)) {
    const result = await db.query<AccessCheck>(`WITH requested AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(kind text,object text,privilege text,column_name text)
    ), objects AS (
      SELECT *,CASE WHEN kind='table' THEN (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname||'.'||c.relname=object AND c.relkind IN ('r','p','v','m','f')
      ) ELSE (
        -- oidvectortypes separates arguments with ', ' while declared requirements use ','.
        -- Comparing the raw strings matched only single-argument functions, so every
        -- multi-argument requirement reported missing_object and db:doctor failed on
        -- functions that exist and are already granted. Normalise the separator; keep the
        -- lookup itself exactly as it was, so nothing else about resolution changes.
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'=object
      ) END AS oid FROM requested
    ) SELECT kind,object,privilege,column_name,
      CASE WHEN oid IS NULL OR (column_name IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM pg_attribute WHERE attrelid=oid AND attname=column_name AND attnum>0 AND NOT attisdropped)) THEN 'missing_object'
      WHEN CASE WHEN kind='function' THEN has_function_privilege($1,oid,privilege)
        WHEN column_name IS NOT NULL THEN has_column_privilege($1,oid,column_name,privilege)
        ELSE has_table_privilege($1,oid,privilege) END THEN 'granted' ELSE 'missing_privilege' END AS status
      FROM objects ORDER BY kind,object,privilege,column_name`, [role, JSON.stringify(profile.requirements)]);
    profiles[name] = { description: profile.description,
      status: result.rows.every(row => row.status === 'granted') ? 'granted' : 'blocked', checks: result.rows };
  }
  return { role_safe: await roleSafety(db, role), schema_usage: schema.rows[0]?.allowed === true, profiles };
}

export async function checkRuntimeAccess(pool: DatabasePool, names = Object.keys(runtimeAccessProfiles)): Promise<RuntimeAccessReport> {
  selectedProfiles(names);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const role = (await client.query<{ role: string }>('SELECT current_user AS role')).rows[0]!.role;
    const report = await inspect(client, role, names);
    await client.query('ROLLBACK');
    return report;
  } finally { client.release(true); }
}

/** Provisioning operation only. Caller must guard environment/target before connecting. */
export async function repairRuntimeAccess(owner: DatabasePool, target: { role: string; database: string }, names: readonly string[]) {
  const profiles = selectedProfiles(names);
  const role = identifier(target.role);
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    const identity = (await client.query<{ database: string; role: string }>('SELECT current_database() AS database,current_user AS role')).rows[0]!;
    if (identity.database !== target.database || identity.role === target.role) throw new Error('ACCESS_TARGET_MISMATCH');
    if (!await roleSafety(client, target.role)) throw new Error('ACCESS_RUNTIME_ROLE_UNSAFE');
    await client.query(`GRANT USAGE ON SCHEMA shipit TO ${role}`);
    for (const [, profile] of profiles) for (const requirement of profile.requirements) {
      const [schema, object] = requirement.object.split('.');
      const qualified = `${identifier(schema!)}.${requirement.kind === 'table' ? identifier(object!) : object}`;
      const privilege = requirement.column_name ? `${requirement.privilege} (${identifier(requirement.column_name)})` : requirement.privilege;
      await client.query(`GRANT ${privilege} ON ${requirement.kind === 'function' ? 'FUNCTION' : 'TABLE'} ${qualified} TO ${role}`);
    }
    const result = await inspect(client, target.role, names);
    if (!result.schema_usage || Object.values(result.profiles).some(profile => profile.status !== 'granted')) throw new Error('ACCESS_REPAIR_INCOMPLETE');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(true); }
}
