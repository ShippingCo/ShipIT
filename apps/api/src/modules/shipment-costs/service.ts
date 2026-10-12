import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import type {ShipmentCostPreview,ShipmentCostApply} from '@shippingco/shared';
import {withShipmentCostScope,withReportScope} from '../memberships/service.ts';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {selection,idempotencyKey,uuid,object} from '../pricing/validation.ts';
import {HttpError} from '../../plugins/errors.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
export function createShipmentCostService(database:DatabasePool,writesEnabled=false){
 async function mutate<T>(session:string,query:unknown,keyInput:unknown,headers:readonly string[],operation:'record'|'preview'|'apply',body:unknown,correlation:string,work:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T>{
  const q=selection(query),key=r.digest(idempotencyKey(keyInput,headers)),fingerprint=r.digest(body);
  return withShipmentCostScope(database,session,q.organizationId,q.franchiseId,correlation,async scope=>{
   const c=assertTenantAccess(scope,['shipment_costs.write']);
   const prior=(await scopedQuery<{fingerprint:string;result:T}>(scope,['shipment_costs.write'],`SELECT fingerprint,result FROM shipit.shipment_cost_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
   if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
   if(!writesEnabled)throw new HttpError('SHIPMENT_COST_DISABLED');
   const id=randomUUID();
   try {const result=await work(scope,id);await scopedQuery(scope,['shipment_costs.write'],`INSERT INTO shipit.shipment_cost_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,result,correlation_id) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,q.franchiseId,c.actor.id,operation,key,fingerprint,JSON.stringify(result),correlation,q.organizationId]);return result;}
   catch(error){if(error instanceof DatabaseError){if(error.sqlState==='40001'||error.sqlState==='23505'||error.sqlState==='23514')throw new HttpError('SHIPMENT_COST_CONFLICT');if(error.sqlState==='23503'||error.sqlState==='42501')throw new HttpError('RESOURCE_NOT_FOUND');}throw error;}
  });
 }
 return {
  record(session:string,query:unknown,idInput:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){const input=v.input(body);if(idInput!==null&&uuid(idInput,'$')!==input.source_id)v.fail();return mutate(session,query,key,headers,'record',input,correlation,async(s,id)=>r.record(s,id,await r.resolve(s,input)));},
  preview(session:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){const inputs=v.upload(body);return mutate<ShipmentCostPreview>(session,query,key,headers,'preview',inputs,correlation,async(s,id)=>{
   const rows:ShipmentCostPreview['rows']=[];
   for(const [index,input]of inputs.entries()){try{const resolved=await r.resolve(s,input);rows.push({row:index+1,input,amount_paise:resolved.amount_paise,evidence:resolved.evidence,error:null});}catch(error){if(!(error instanceof HttpError))throw error;rows.push({row:index+1,input,amount_paise:String(input.amount_paise),evidence:r.emptyEvidence(),error:error.code});}}
   return {id,schema_version:1,rows,valid:rows.every(row=>row.error===null)};
  });},
  apply(session:string,query:unknown,idInput:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){object(body,[]);const id=uuid(idInput,'$');return mutate<ShipmentCostApply>(session,query,key,headers,'apply',{id},correlation,async(s,command)=>{
   const actor=assertTenantAccess(s,['shipment_costs.write']).actor.id;
   const preview=(await scopedQuery<{result:ShipmentCostPreview}>(s,['shipment_costs.write'],`SELECT result FROM shipit.shipment_cost_commands WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND actor_id=$2 AND operation='preview'`,[id,actor])).rows[0]?.result;
   if(!preview)throw new HttpError('RESOURCE_NOT_FOUND');if(!preview.valid)throw new HttpError('SHIPMENT_COST_CONFLICT');
   const items:ShipmentCostApply['items']=[];
   for(const row of preview.rows){const current=await r.resolve(s,row.input);if(r.digest(current.evidence)!==r.digest(row.evidence)||current.amount_paise!==row.amount_paise)throw new HttpError('SHIPMENT_COST_CONFLICT');items.push(await r.record(s,command,current));}return {preview_id:id,items};
  });},
  read(session:string,query:unknown,idInput:unknown,correlation:string){const q=selection(query),id=uuid(idInput,'$');return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async s=>{const rows=await r.revisions(s,id);await r.auditRead(s,'read',id);return {id,category:rows[0]!.category,version:rows[0]!.version,revisions:rows};});},
  list(session:string,query:unknown,correlation:string,selectors=false){const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),cursor=b.cursor==null?null:uuid(b.cursor,'$');return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async s=>{const result=selectors?await r.selectors(s,cursor):await r.list(s,cursor);await r.auditRead(s,selectors?'selectors':'list',null);return result;});},
 };
}
