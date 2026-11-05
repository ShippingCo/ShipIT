import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits} from '@shippingco/shared';
import {withReportScope,withPerformanceScope} from '../memberships/service.ts';
import {object,selection} from '../pricing/validation.ts';
import {HttpError} from '../../plugins/errors.ts';
import {reportFilter} from './rules.ts';
import {captureSales} from './sales-repository.ts';
import {capturePerformance} from './performance-repository.ts';
import {audit} from './repository.ts';
import type {TenantAccess} from '../security/scope.ts';
/** Live evidence is bounded and audited; it does not consume saved-snapshot quota. */
export function workspaceFilter(input:unknown){const b=object(input,['from_day','to_day']);const from=reportFilter({from_day:b.from_day,to_day:b.from_day}).from_day,to=reportFilter({from_day:b.to_day,to_day:b.to_day}).to_day;
 if(to<from||(Date.parse(to)-Date.parse(from))/86400000>365)throw new HttpError('VALIDATION_FAILED');return {from_day:from,to_day:to,sort:'confirmed_desc' as const};}
export function workspaceTokens(key:Buffer,clock=()=>Date.now()){
 const secret=createHash('sha256').update('shipit:report-workspace:export:v1\0').update(key).digest(),sign=(s:string)=>createHmac('sha256',secret).update(s).digest();
 return {issue:(binding:string,id:string)=>{const body=Buffer.from(JSON.stringify({binding,id,expires:clock()+900000})).toString('base64url');return body+'.'+sign(body).toString('base64url');},read:(token:unknown,binding:string)=>{try{if(typeof token!=='string'||token.length>4096||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw Error();const [body,signature]=token.split('.'),mac=Buffer.from(signature!,'base64url');if(mac.length!==32||!timingSafeEqual(mac,sign(body!)))throw Error();const p=JSON.parse(Buffer.from(body!,'base64url').toString());if(p.binding!==binding||!Number.isSafeInteger(p.expires)||p.expires<=clock()||p.expires>clock()+900000||!/^[0-9a-f-]{36}$/.test(p.id))throw Error();return p.id as string;}catch{throw new HttpError('REPORT_EXPIRED');}}};
}
export function createReportWorkspace(database:DatabasePool,key:Buffer){const tokens=workspaceTokens(key),binding=(scope:TenantAccess,kind:string)=>JSON.stringify(['workspace:v1',kind,scope.context.actor.id,scope.context.organizationId,scope.context.permittedFranchiseIds]);
 return {async read(kind:'finance'|'delivery',session:string,query:unknown,correlation:string){
  const b=object(query,['organization_id','franchise_id','from_day','to_day']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),filter=workspaceFilter({from_day:b.from_day,to_day:b.to_day});
  async function capture(scope:TenantAccess,agentOnly=false){const id=randomUUID();const result=kind==='finance'?await captureSales(scope,{...filter,rate:null,franchise_ids:[q.franchiseId]}):await capturePerformance(scope,{...filter,eta:'revised'},agentOnly);
   const rows=kind==='finance'?(result as Awaited<ReturnType<typeof captureSales>>).rows.map(r=>({id:r.id,confirmed_at:r.confirmed_at,rate:r.rate,amounts:r.amounts})):(result as Awaited<ReturnType<typeof capturePerformance>>).rows;
   const response={id,organization_id:q.organizationId,franchise_id:q.franchiseId,as_of:result.as_of,filter,rows,export_token:tokens.issue(binding(scope,kind),id)};
   if(Buffer.byteLength(JSON.stringify(response))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');await audit(scope,id,'report.capture');return response;
  }
  return kind==='finance'?withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,scope=>capture(scope),[q.franchiseId],true):withPerformanceScope(database,session,q.organizationId,q.franchiseId,false,correlation,capture);
 },async authorize(kind:'finance'|'delivery',session:string,query:unknown,body:unknown,correlation:string){const q=selection(query),b=object(body,['export_token']);
  async function check(scope:TenantAccess){const id=tokens.read(b.export_token,binding(scope,kind));await audit(scope,id,'report.export');return {id};}
  return kind==='finance'?withReportScope(database,session,q.organizationId,q.franchiseId,true,correlation,check):withPerformanceScope(database,session,q.organizationId,q.franchiseId,true,correlation,check);
 }};
}
