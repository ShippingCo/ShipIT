import type {TenantAccess} from '../security/scope.ts';
import {assertTenantAccess,scopedQuery} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {digest} from '../pricing/idempotency.ts';
/** Only a new owning-domain fact validates the current suggestion. Old snapshots/replays never re-resolve it. */
export async function validateSettingSuggestion(scope:TenantAccess,key:'booking_defaults'|'report_scope',versionId:string|undefined,value:unknown){
 if(versionId===undefined)return;
 const c=assertTenantAccess(scope,['pricing.quote','pricing.override','pricing.override.approve','reports.capture']),franchise=c.permittedFranchiseIds[0]!;
 const owned=(await scopedQuery(scope,['pricing.quote','pricing.override','pricing.override.approve','reports.capture'],`SELECT id FROM shipit.settings_versions WHERE {{organization:organization_id}} AND (franchise_id IS NULL OR franchise_id=$1::uuid) AND id=$2`,[franchise,versionId])).rows[0];
 if(!owned)throw new HttpError('RESOURCE_NOT_FOUND');
 const effective=(await scopedQuery<{source_id:string;value:unknown}>(scope,['pricing.quote','pricing.override','pricing.override.approve','reports.capture'],`SELECT source.id AS source_id,head.payload->$2 AS value FROM (SELECT DISTINCT ON (franchise_id) franchise_id,payload,source_versions FROM shipit.settings_versions WHERE {{organization:organization_id}} AND (franchise_id IS NULL OR franchise_id=$1::uuid) ORDER BY franchise_id,version DESC) head JOIN shipit.settings_versions source ON source.organization_id={{organization}} AND source.franchise_id IS NOT DISTINCT FROM head.franchise_id AND source.version=(head.source_versions->>$2)::integer WHERE head.payload ? $2 ORDER BY head.franchise_id NULLS LAST LIMIT 1`,[franchise,key])).rows[0];
 if(!effective||effective.source_id!==versionId||digest(effective.value)!==digest(value))throw new HttpError('VERSION_CONFLICT');
}

/** Branch defaults precede organization defaults; explicit customer language still wins. */
export async function assistantSettings(scope:TenantAccess){
 const result=await scopedQuery<{key:string;value:unknown}>(scope,['whatsapp.inbox.work'],`SELECT DISTINCT ON (entry.key) entry.key,entry.value FROM (SELECT DISTINCT ON(franchise_id) franchise_id,payload,version FROM shipit.settings_versions WHERE {{organization:organization_id}} AND (franchise_id IS NULL OR franchise_id=$1::uuid) ORDER BY franchise_id,version DESC) head CROSS JOIN LATERAL jsonb_each(head.payload) entry
 WHERE entry.key IN ('identity','language')
 ORDER BY entry.key,head.franchise_id NULLS LAST,head.version DESC`,[scope.context.permittedFranchiseIds[0]]);
 const identity=result.rows.find(r=>r.key==='identity')?.value as {shop?:{assistant_name?:string}}|undefined,language=result.rows.find(r=>r.key==='language')?.value as {locale?:string}|undefined;
 return {name:identity?.shop?.assistant_name??'',locale:language?.locale==='hi'?'hi' as const:'en' as const};
}
