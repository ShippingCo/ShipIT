import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withCarrierScope } from '../memberships/service.ts';
import { digest } from '../pricing/idempotency.ts';
import { publishImportedPricing, importedPricingConflict } from '../pricing/service.ts';
import { assertRules } from '../pricing/calculation.ts';
import { integer } from '../pricing/validation.ts';
import type { TenantAccess } from '../security/scope.ts';
import { rateUpload, type RateConfig, type RateRow } from './rate-validation.ts';
import * as v from './validation.ts';
import * as carriers from './repository.ts';
import * as r from './rate-repository.ts';

async function mappings(s:TenantAccess,installation:string,config:RateConfig) {
  const origin=await r.mapping(s,installation,config.origin_mapping_id);
  if(origin.kind!=='location')throw new HttpError('VALIDATION_FAILED');
  const services=await Promise.all(config.services.map(async b=>({...await r.mapping(s,installation,b.mapping_id),target:b.target})));
  const locations=await Promise.all(config.locations.map(async b=>({...await r.mapping(s,installation,b.mapping_id),target:b.target})));
  if(services.some(m=>m.kind!=='service')||locations.some(m=>m.kind!=='location'))throw new HttpError('VALIDATION_FAILED');
  for(const list of [services,locations]){
    if(new Set(list.map(m=>m.source_code)).size!==list.length)throw new HttpError('VALIDATION_FAILED');
    // One internal identity has one pricing meaning; aliases may share that meaning.
    for(const a of list)for(const b of list)if((a.normalized_id===b.normalized_id)!==(a.target===b.target))throw new HttpError('VALIDATION_FAILED');
  }
  for(const m of [origin,...services,...locations])if((await carriers.latestMapping(s,installation,m.kind,m.source_code))?.id!==m.id)throw new HttpError('VERSION_CONFLICT');
  return {origin,services,locations};
}
function issues(rows:RateRow[],config:RateConfig) {
  const result:string[]=[];
  if(rows.some(row=>row.error))result.push('INVALID_ROWS');
  const rules=rows.filter(row=>!row.error).map(row=>row.rule!);
  try {assertRules({rules:rules.map(rule=>({...rule,id:''}))});}catch {result.push('OVERLAPPING_SLABS');}
  if(config.expected_lanes.some(l=>!rules.some(r=>r.destination_key===l.destination_key&&r.service===l.service)))result.push('MISSING_LANES');
  if(rules.some(r=>!config.expected_lanes.some(l=>l.destination_key===r.destination_key&&l.service===r.service)))result.push('UNEXPECTED_LANES');
  return result;
}
async function summary(s:TenantAccess,id:string) {
  const run=await r.get(s,id),approval=await r.approval(s,id);
  const weightGaps: {destination_key:string;service:string;from_grams:number;to_grams:number|null}[]=[];
  for(const lane of run.config.expected_lanes){
    const rules=run.rows.filter(r=>!r.error&&r.rule?.destination_key===lane.destination_key&&r.rule.service===lane.service).map(r=>r.rule!).sort((a,b)=>a.min_weight_grams-b.min_weight_grams);
    let from:number|null=1;
    for(const rule of rules){if(from===null)break;if(rule.min_weight_grams>from)weightGaps.push({...lane,from_grams:from,to_grams:rule.min_weight_grams});from=rule.max_weight_grams===null?null:Math.max(from,rule.max_weight_grams);}
    if(from!==null)weightGaps.push({...lane,from_grams:from,to_grams:null});
  }
  return {id:run.id,version:approval?2:1,state:approval?'approved':run.issues.length?'rejected':'ready',purpose:run.config.purpose,
    installation_id:run.installation_id,courier_id:run.courier_id,file_sha256:run.file_sha256,normalization_version:run.normalization_version,
    policy:run.config.policy,expected_lanes:run.config.expected_lanes,issues:run.issues,weight_gaps:weightGaps,rows:run.rows,
    approval:approval?{id:approval.id,pricing_version_id:approval.pricing_version_id,approved_at:approval.approved_at.toISOString()}:null,
    actual_cost:{state:'unknown' as const},source_ref:'carrier-rate:'+id};
}
export function createCarrierRateService(database:DatabasePool,clock=()=>new Date()) {
  const scoped=<T>(session:string,query:unknown,correlation:string,work:Parameters<typeof withCarrierScope<T>>[6])=>{
    const q=v.selection(query);
    // Full candidate sheets are W26/W27 administration, never the broad R19 carrier projection.
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.write',correlation,async scope=>{
      if(!scope.pricingDraft||!scope.pricingPublish)throw new HttpError('ACTION_FORBIDDEN');return work(scope);
    });
  };
  return {
    create(session:string,installationInput:unknown,keyInput:unknown,input:unknown,query:unknown,correlation:string) {
      const installationId=v.uuid(installationInput,'$'),key=v.keyDigest(v.idempotencyKey(keyInput));
      return scoped(session,query,correlation,async({access:s,pricingPublish})=>{
        await carriers.fileInstallation(s,installationId);
        const parsed=rateUpload(input),fingerprint=digest({installationId,input});
        const prior=await r.prior(s,'preview',key,fingerprint);
        if(prior)return summary(s,prior.import_id);
        const normalization=digest({format:1,config:parsed.config}),existing=await r.duplicate(s,installationId,parsed.file_sha256,normalization);
        let id=existing?.id;
        if(!id){
          const map=await mappings(s,installationId,parsed.config);
          for(const row of parsed.rows){
            if(row.error)continue;
            const service=map.services.find(m=>m.source_code===row.source!.service),location=map.locations.find(m=>m.source_code===row.source!.destination);
            if(!service||!location||map.origin.source_code!==row.source!.origin){row.error='UNMAPPED_LANE';row.rule=null;continue;}
            row.rule={...row.rule!,service:service.target as NonNullable<RateRow['rule']>['service'],destination_key:location.target};
            row.mapping_ids=[map.origin.id,service.id,location.id];
            row.canonical_ids={origin:map.origin.normalized_id,service:service.normalized_id,destination:location.normalized_id};
          }
          const problems=issues(parsed.rows,parsed.config);
          if(Date.parse(parsed.config.policy.effective_from)<clock().getTime())problems.push('PAST_EFFECTIVE_DATE');
          if(parsed.config.purpose==='customer_selling'&&await importedPricingConflict(pricingPublish!,parsed.config.policy.effective_from,parsed.config.policy.effective_to))problems.push('EFFECTIVE_OVERLAP');
          if(parsed.config.purpose==='courier_purchase_estimate'&&await r.purchaseConflict(s,{installation_id:installationId,config:parsed.config}))problems.push('EFFECTIVE_OVERLAP');
          id=randomUUID();await r.insert(s,id,installationId,parsed.file_sha256,normalization,parsed.config,parsed.rows,problems,clock());
        }
        await r.receipt(s,id,'preview',key,fingerprint,clock());return summary(s,id);
      });
    },
    read(session:string,idInput:unknown,query:unknown,correlation:string) {
      const id=v.uuid(idInput,'$');return scoped(session,query,correlation,({access:s})=>summary(s,id));
    },
    approve(session:string,idInput:unknown,keyInput:unknown,input:unknown,query:unknown,correlation:string) {
      const id=v.uuid(idInput,'$'),key=v.keyDigest(v.idempotencyKey(keyInput)),body=v.object(input,['expected_version']);
      const expected=integer(body.expected_version,'expected_version',1,2),fingerprint=digest({id,expected});
      return scoped(session,query,correlation,async({access:s,pricingDraft,pricingPublish})=>{
        const run=await r.get(s,id);await carriers.fileInstallation(s,run.installation_id);
        if(await r.prior(s,'approve',key,fingerprint))return summary(s,id);
        const approved=await r.approval(s,id);
        if(approved||expected!==1)throw new HttpError('VERSION_CONFLICT');
        if(run.issues.length||Date.parse(run.config.policy.effective_from)<clock().getTime())throw new HttpError('RATE_CONFLICT');
        await mappings(s,run.installation_id,run.config);
        let pricing:string|null=null;
        if(run.config.purpose==='customer_selling')pricing=(await publishImportedPricing(pricingDraft!,pricingPublish!,{
          ...run.config.policy,source_ref:'carrier-rate:'+id,rules:run.rows.map(row=>row.rule!)},clock())).id;
        else if(await r.purchaseConflict(s,run))throw new HttpError('RATE_CONFLICT');
        await r.approve(s,run,pricing,clock());await r.receipt(s,id,'approve',key,fingerprint,clock());return summary(s,id);
      });
    },
  };
}
