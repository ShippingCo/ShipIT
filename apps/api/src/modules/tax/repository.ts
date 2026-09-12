import { randomUUID } from 'node:crypto';
import type { TaxPolicyInput, TaxIntentInput, TaxIntentDto, TaxResolutionInput, TaxResolutionDto, TaxCalculationDto } from '@shippingco/shared';
import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { PolicyRow, IntentRow, ResolutionRow, TaxOperation, TaxResult } from './types.ts';

export async function visible(scope: TenantAccess, active = false) {
  const row = (await scopedQuery<{ parent: string; child: string }>(scope,
    ['tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate','tax.validate'],
    `SELECT o.lifecycle AS parent,f.lifecycle AS child FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
      WHERE {{franchise:f.organization_id:f.id}} FOR SHARE OF f`,[])).rows[0];
  if (!row) throw new HttpError('RESOURCE_NOT_FOUND');
  if (active && row.parent !== 'active') throw new HttpError('ORGANIZATION_DISABLED');
  if (active && row.child !== 'active') throw new HttpError('FRANCHISE_DISABLED');
}
export async function find(scope: TenantAccess, id: string) {
  const c = assertTenantAccess(scope);
  return (await scopedQuery<PolicyRow>(scope,['tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate','tax.validate'],
    `SELECT id,version_number,revision,state,policy FROM shipit.tax_versions WHERE {{franchise:organization_id:franchise_id}} AND id=$1
      AND (state='published' OR $2::boolean)`,[id,c.action === 'tax.draft' || c.action === 'tax.publish'])).rows[0];
}
export async function current(scope: TenantAccess, now: Date) {
  const rows = (await scopedQuery<PolicyRow>(scope,['tax.read','tax.prepare','tax.resolve','tax.calculate','tax.validate'],
    `SELECT id,version_number,revision,state,policy FROM shipit.tax_versions WHERE {{franchise:organization_id:franchise_id}}
      AND state='published' AND effective_from<=$1 AND effective_to>$1 LIMIT 2`,[now])).rows;
  if (rows.length !== 1) throw new HttpError('TAX_POLICY_UNAVAILABLE');
  return rows[0]!;
}
export async function create(scope: TenantAccess, policy: TaxPolicyInput) {
  const c = assertTenantAccess(scope,['tax.draft']), franchise = c.permittedFranchiseIds[0]!;
  let card = (await scopedQuery<{ id: string }>(scope,['tax.draft'],`SELECT id FROM shipit.tax_cards WHERE {{franchise:organization_id:franchise_id}}`)).rows[0];
  if (!card) card = (await scopedQuery<{ id: string }>(scope,['tax.draft'],`INSERT INTO shipit.tax_cards(id,organization_id,franchise_id)
    SELECT $1,{{organization}},$2 WHERE {{franchise:$3:$2}} RETURNING id`,[randomUUID(),franchise,c.organizationId])).rows[0]!;
  return (await scopedQuery<PolicyRow>(scope,['tax.draft'],`INSERT INTO shipit.tax_versions(id,organization_id,franchise_id,card_id,version_number,effective_from,effective_to,policy)
    SELECT $1,{{organization}},$2,$3,COALESCE((SELECT max(version_number) FROM shipit.tax_versions WHERE {{franchise:organization_id:franchise_id}}),0)+1,$4,$5,$6
    WHERE {{franchise:$7:$2}} RETURNING id,version_number,revision,state,policy`,[randomUUID(),franchise,card.id,policy.effective_from,policy.effective_to,policy,c.organizationId])).rows[0]!;
}
export async function replace(scope: TenantAccess, id: string, expected: number, policy: TaxPolicyInput) {
  const row = (await scopedQuery<PolicyRow>(scope,['tax.draft'],`UPDATE shipit.tax_versions SET policy=$3,effective_from=$4,effective_to=$5,revision=revision+1
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND revision=$2 AND state='draft' RETURNING id,version_number,revision,state,policy`,
  [id,expected,policy,policy.effective_from,policy.effective_to])).rows[0];
  if (!row) throw new HttpError('VERSION_CONFLICT'); return row;
}
export async function publish(scope: TenantAccess, id: string, expected: number) {
  const c = assertTenantAccess(scope,['tax.publish']);
  const row = (await scopedQuery<PolicyRow>(scope,['tax.publish'],`UPDATE shipit.tax_versions SET state='published',published_by=$3,revision=revision+1
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND revision=$2 AND state='draft' RETURNING id,version_number,revision,state,policy`,[id,expected,c.actor.id])).rows[0];
  if (!row) throw new HttpError('VERSION_CONFLICT'); return row;
}
export async function intent(scope: TenantAccess, id: string) {
  const c = assertTenantAccess(scope,['tax.prepare','tax.resolve','tax.calculate','tax.validate']);
  return (await scopedQuery<IntentRow>(scope,['tax.prepare','tax.resolve','tax.calculate','tax.validate'],
    `SELECT id,actor_id,input,result FROM shipit.tax_intents WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND (actor_id=$2 OR $3::boolean)`,
  [id,c.actor.id,c.action === 'tax.resolve'])).rows[0];
}
export async function saveIntent(scope: TenantAccess, input: TaxIntentInput, result: TaxIntentDto) {
  const c = assertTenantAccess(scope,['tax.prepare']);
  await scopedQuery(scope,['tax.prepare'],`INSERT INTO shipit.tax_intents(id,organization_id,franchise_id,actor_id,quote_id,input,result,created_at,expires_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
  [result.id,c.permittedFranchiseIds[0],c.actor.id,input.quote_id,input,result,result.created_at,result.expires_at,c.organizationId]);
}
export async function resolution(scope: TenantAccess, intentId: string) {
  return (await scopedQuery<ResolutionRow>(scope,['tax.resolve','tax.calculate','tax.validate'],
    `SELECT id,actor_id,input,result FROM shipit.tax_resolutions WHERE {{franchise:organization_id:franchise_id}} AND intent_id=$1`,[intentId])).rows[0];
}
export async function saveResolution(scope: TenantAccess, input: TaxResolutionInput, result: TaxResolutionDto) {
  const c = assertTenantAccess(scope,['tax.resolve']);
  await scopedQuery(scope,['tax.resolve'],`INSERT INTO shipit.tax_resolutions(id,organization_id,franchise_id,actor_id,intent_id,policy_id,input,result)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,
  [result.id,c.permittedFranchiseIds[0],c.actor.id,input.intent_id,input.policy_id,input,result,c.organizationId]);
}
export async function calculation(scope: TenantAccess, id: string) {
  const c = assertTenantAccess(scope,['tax.calculate','tax.validate']);
  return (await scopedQuery<{ result: TaxCalculationDto }>(scope,['tax.calculate','tax.validate'],
    `SELECT result FROM shipit.tax_calculations WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND actor_id=$2`,[id,c.actor.id])).rows[0]?.result;
}
export async function saveCalculation(scope: TenantAccess, result: TaxCalculationDto) {
  const c = assertTenantAccess(scope,['tax.calculate']);
  await scopedQuery(scope,['tax.calculate'],`INSERT INTO shipit.tax_calculations(id,organization_id,franchise_id,actor_id,intent_id,policy_id,resolution_id,result)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,
  [result.id,c.permittedFranchiseIds[0],c.actor.id,result.intent_id,result.policy_id,result.resolution_id,result,c.organizationId]);
}
export async function receipt(scope: TenantAccess, operation: TaxOperation, key: string) {
  const c = assertTenantAccess(scope);
  return (await scopedQuery<{ fingerprint: string; result: TaxResult }>(scope,['tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate'],
    `SELECT fingerprint,result FROM shipit.tax_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
}
export async function saveReceipt(scope: TenantAccess, operation: TaxOperation, key: string, fingerprint: string, result: TaxResult) {
  const c = assertTenantAccess(scope);
  await scopedQuery(scope,['tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate'],
    `INSERT INTO shipit.tax_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,result,correlation_id)
      SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$9 WHERE {{franchise:$8:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,operation,key,fingerprint,result,c.organizationId,c.correlationId]);
}
