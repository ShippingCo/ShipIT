import type { DatabasePool, QueryExecutor } from './pool.ts';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'EXECUTE';
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
  dispatch_creation: { description: 'Empty lot and route creation; no parcel, journey, membership or provider mutations', requirements: [
    ...tables('lots lot_memberships lot_commands routes route_commands route_lots route_parcels route_manifests route_manifest_parcels route_manifest_sources domain_events counter_bookings'),
    ...tables('lots lot_commands routes route_commands route_manifests route_manifest_parcels route_manifest_sources domain_events', 'INSERT'),
    ...updateColumns('lot_commands', 'state,http_status,result,committed_at,retain_until'),
    ...updateColumns('route_commands', 'state,http_status,result,committed_at,retain_until'),
    { kind: 'function', object: 'shipit.append_lot_audit(uuid,uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
    { kind: 'function', object: 'shipit.append_route_audit(uuid,uuid,uuid,uuid,uuid)', privilege: 'EXECUTE' },
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
};
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
        -- functions that exist and are already granted. Compare resolved identities instead.
        SELECT to_regprocedure(object)::oid
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
