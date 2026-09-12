import { randomUUID } from 'node:crypto';
import type { PricingDraftInput, PricingQuoteDto, PricingVersionDto } from '@shippingco/shared';
import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { PricingOperation, RuleRow, VersionRow } from './types.ts';
const columns='id,card_id,version_number,revision,state,effective_from,effective_to,quote_validity_seconds,override_tolerance_paise,approval_ref,source_ref,created_at,published_at,published_by';
export async function visible(scope:TenantAccess) {
  const row=(await scopedQuery(scope,['pricing.read','pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],
    `SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}`)).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function find(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope);
  return (await scopedQuery<VersionRow>(scope,['pricing.read','pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],
    `SELECT ${columns} FROM shipit.pricing_versions WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND (state='published' OR $2::boolean)`,[id,c.action==='pricing.draft'||c.action==='pricing.publish'])).rows[0];
}
export async function rules(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope);
  return (await scopedQuery<RuleRow>(scope,['pricing.read','pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],
    `SELECT r.id,r.destination_key,r.service,r.min_weight_grams,r.max_weight_grams,r.freight_paise,r.packing_paise FROM shipit.pricing_rules r
      JOIN shipit.pricing_versions v ON v.organization_id=r.organization_id AND v.franchise_id=r.franchise_id AND v.id=r.version_id
      WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.version_id=$1 AND (v.state='published' OR $2::boolean)
      ORDER BY r.destination_key COLLATE "C",r.service COLLATE "C",r.min_weight_grams,r.id`,[id,c.action==='pricing.draft'||c.action==='pricing.publish'])).rows;
}
export async function effective(scope:TenantAccess,now:Date) {
  const rows=(await scopedQuery<VersionRow>(scope,['pricing.read','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],
    `SELECT ${columns} FROM shipit.pricing_versions WHERE {{franchise:organization_id:franchise_id}}
      AND state='published' AND effective_from<=$1 AND effective_to>$1 LIMIT 2`,[now])).rows;
  if(rows.length!==1)throw new HttpError(rows.length?'RATE_CONFLICT':'NO_RATE');
  return rows[0]!;
}
export async function create(scope:TenantAccess,b:PricingDraftInput) {
  const c=assertTenantAccess(scope,['pricing.draft']),franchise=c.permittedFranchiseIds[0]!;
  let card=(await scopedQuery<{id:string}>(scope,['pricing.draft'],`SELECT id FROM shipit.pricing_cards WHERE {{franchise:organization_id:franchise_id}}`)).rows[0];
  if(!card)card=(await scopedQuery<{id:string}>(scope,['pricing.draft'],`INSERT INTO shipit.pricing_cards(id,organization_id,franchise_id)
    SELECT $1,{{organization}},$2 WHERE {{franchise:$3:$2}} RETURNING id`,[randomUUID(),franchise,c.organizationId])).rows[0]!;
  const result=(await scopedQuery<VersionRow>(scope,['pricing.draft'],`INSERT INTO shipit.pricing_versions
    (id,organization_id,franchise_id,card_id,version_number,effective_from,effective_to,quote_validity_seconds,override_tolerance_paise,approval_ref,source_ref)
    SELECT $1,{{organization}},$2,$3,COALESCE((SELECT max(version_number) FROM shipit.pricing_versions WHERE {{franchise:organization_id:franchise_id}}),0)+1,$4,$5,$6,$7,$8,$9
    WHERE {{franchise:$10:$2}} RETURNING ${columns}`,
  [randomUUID(),franchise,card.id,b.effective_from,b.effective_to,b.quote_validity_seconds,b.override_tolerance_paise,b.approval_ref,b.source_ref,c.organizationId])).rows[0]!;
  await replaceRules(scope,result.id,b);return result;
}
export async function replaceRules(scope:TenantAccess,id:string,b:PricingDraftInput) {
  await scopedQuery(scope,['pricing.draft'],`DELETE FROM shipit.pricing_rules WHERE {{franchise:organization_id:franchise_id}} AND version_id=$1`,[id]);
  for(const r of b.rules)await scopedQuery(scope,['pricing.draft'],`INSERT INTO shipit.pricing_rules
    (id,organization_id,franchise_id,version_id,destination_key,service,min_weight_grams,max_weight_grams,freight_paise,packing_paise)
    SELECT $1,organization_id,franchise_id,id,$3,$4,$5,$6,$7,$8 FROM shipit.pricing_versions WHERE {{franchise:organization_id:franchise_id}} AND id=$2`,
  [randomUUID(),id,r.destination_key,r.service,r.min_weight_grams,r.max_weight_grams,r.freight_paise,r.packing_paise]);
}
export async function replace(scope:TenantAccess,id:string,b:PricingDraftInput & {expected_version?:number}) {
  const row=(await scopedQuery<VersionRow>(scope,['pricing.draft'],`UPDATE shipit.pricing_versions SET effective_from=$2,effective_to=$3,
    quote_validity_seconds=$4,override_tolerance_paise=$5,approval_ref=$6,source_ref=$7,revision=revision+1
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND revision=$8 AND state='draft' RETURNING ${columns}`,
  [id,b.effective_from,b.effective_to,b.quote_validity_seconds,b.override_tolerance_paise,b.approval_ref,b.source_ref,b.expected_version])).rows[0];
  if(!row)throw new HttpError('VERSION_CONFLICT');
  await replaceRules(scope,id,b);return row;
}
export async function publicationConflict(scope:TenantAccess,row:VersionRow) {
  return (await scopedQuery(scope,['pricing.publish'],`SELECT id FROM shipit.pricing_versions WHERE {{franchise:organization_id:franchise_id}}
    AND state='published' AND (version_number >= $1 OR (effective_from<$3 AND $2<effective_to)) LIMIT 1`,
  [row.version_number,row.effective_from,row.effective_to])).rows.length>0;
}
export async function publish(scope:TenantAccess,id:string,expected:number) {
  const c=assertTenantAccess(scope,['pricing.publish']);
  const row=(await scopedQuery<VersionRow>(scope,['pricing.publish'],`UPDATE shipit.pricing_versions SET state='published',revision=revision+1,
    published_at=date_trunc('milliseconds',clock_timestamp()),published_by=$3
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND revision=$2 AND state='draft' RETURNING ${columns}`,[id,expected,c.actor.id])).rows[0];
  if(!row)throw new HttpError('VERSION_CONFLICT');return row;
}
export async function saveQuote(scope:TenantAccess,result:PricingQuoteDto) {
  const c=assertTenantAccess(scope,['pricing.quote','pricing.override','pricing.override.approve']);
  await scopedQuery(scope,['pricing.quote','pricing.override','pricing.override.approve'],`INSERT INTO shipit.pricing_quotes
    (id,organization_id,franchise_id,actor_id,version_id,rule_id,result,created_at,expires_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
  [result.id,c.permittedFranchiseIds[0],c.actor.id,result.rate_version_id,result.rule_id,result,result.created_at,result.expires_at,c.organizationId]);
}
export async function quote(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,['pricing.quote','pricing.override','pricing.override.approve','pricing.validate']);
  return (await scopedQuery<{result:PricingQuoteDto}>(scope,['pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],
    `SELECT result FROM shipit.pricing_quotes WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND actor_id=$2`,[id,c.actor.id])).rows[0]?.result;
}
export async function receipt(scope:TenantAccess,operation:PricingOperation,key:string) {
  const c=assertTenantAccess(scope,['pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve']);
  return (await scopedQuery<{fingerprint:string;version_id:string;quote_id:string|null;result:PricingVersionDto|PricingQuoteDto}>(scope,
    ['pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve'],`SELECT fingerprint,version_id,quote_id,result FROM shipit.pricing_commands
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation_id=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
}
export async function saveReceipt(scope:TenantAccess,operation:PricingOperation,key:string,intent:string,result:PricingVersionDto|PricingQuoteDto) {
  const c=assertTenantAccess(scope,['pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve']);
  await scopedQuery(scope,['pricing.draft','pricing.publish','pricing.quote','pricing.override','pricing.override.approve'],`INSERT INTO shipit.pricing_commands
    (command_id,actor_id,organization_id,franchise_id,operation_id,key_digest,fingerprint,normalization_version,version_id,quote_id,result)
    SELECT $1,$2,{{organization}},$3,$4,$5,$6,1,$7,$8,$9 WHERE {{franchise:$10:$3}}`,
  [randomUUID(),c.actor.id,c.permittedFranchiseIds[0],operation,key,intent,'rate_version_id' in result?result.rate_version_id:result.id,
    'rate_version_id' in result?result.id:null,result,c.organizationId]);
}
