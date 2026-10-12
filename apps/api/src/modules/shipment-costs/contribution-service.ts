import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {shipmentCostCategories,contributionColumns,reportLimits,type ContributionRow,type ContributionSnapshot,type ContributionTotals,type ContributionGroup,type ContributionPage} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {selection,idempotencyKey,object,uuid} from '../pricing/validation.ts';
import {HttpError} from '../../plugins/errors.ts';
import * as reports from '../reports/repository.ts';
import {csvCell} from '../reports/rules.ts';
import {filter as parseFilter} from './validation.ts';
import {digest} from './repository.ts';
import {capture,type ContributionFrame} from './contribution-repository.ts';
export function contributionRow(row:ContributionFrame['rows'][number]):ContributionRow {
 const coverage={} as ContributionRow['coverage'];
 for(const category of shipmentCostCategories){const all=row.costs.filter(c=>c.category===category),monetary=all.filter(c=>c.state!=='not_applicable');coverage[category]=!all.length||monetary.some(c=>BigInt(c.remainder_paise)!==0n)?'missing':!monetary.length?'not_applicable':monetary.some(c=>c.state==='estimated')?'estimated':'actual';}
 const actual=row.costs.reduce((n,c)=>n+(c.state==='actual'?BigInt(c.amount_paise):0n),0n),estimated=row.costs.reduce((n,c)=>n+(c.state==='estimated'?BigInt(c.amount_paise):0n),0n);
 const state=Object.values(coverage).includes('missing')?'incomplete':Object.values(coverage).includes('estimated')?'estimated':'actual';
 return {...row,coverage,state,actual_cost_paise:String(actual),estimated_cost_paise:String(estimated),contribution_paise:state==='actual'?String(BigInt(row.revenue_paise)-actual):null,estimated_contribution_paise:state==='incomplete'?null:String(BigInt(row.revenue_paise)-actual-estimated)};
}
export function contributionTotals(rows:ContributionRow[]):ContributionTotals {
 const sum=(key:'revenue_paise'|'actual_cost_paise'|'estimated_cost_paise')=>String(rows.reduce((n,r)=>n+BigInt(r[key]),0n));
 return {count:rows.length,revenue_paise:sum('revenue_paise'),actual_cost_paise:sum('actual_cost_paise'),estimated_cost_paise:sum('estimated_cost_paise'),contribution_paise:rows.some(r=>r.contribution_paise===null)?null:String(rows.reduce((n,r)=>n+BigInt(r.contribution_paise!),0n)),estimated_contribution_paise:rows.some(r=>r.estimated_contribution_paise===null)?null:String(rows.reduce((n,r)=>n+BigInt(r.estimated_contribution_paise!),0n)),actual_count:rows.filter(r=>r.state==='actual').length,estimated_count:rows.filter(r=>r.state==='estimated').length,missing_count:rows.filter(r=>r.state==='incomplete').length};
}
export function contributionGroups(rows:ContributionRow[]):ContributionGroup[]{
 const result:ContributionGroup[]=[];
 for(const dimension of ['courier','service','customer','destination','period'] as const){const groups=new Map<string,ContributionRow[]>();for(const row of rows){const value=dimension==='period'?new Date(Date.parse(row.confirmed_at)+19800000).toISOString().slice(0,10):dimension==='customer'?row.customer_id:row[dimension]??'unknown';groups.set(value,[...groups.get(value)??[],row]);}for(const[value,subset]of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)))result.push({dimension,value,...contributionTotals(subset)});}
 return result;
}
export function contributionCsv(snapshot:ContributionSnapshot,rows:ContributionRow[]){
 const records=rows.map(r=>[snapshot.id,snapshot.as_of,snapshot.effective_at,snapshot.recorded_at,snapshot.definition,r.id,r.franchise_id,r.confirmed_at,r.customer_id,r.service??'unknown',r.destination??'unknown',r.courier,r.revenue_paise,r.actual_cost_paise,r.estimated_cost_paise,r.contribution_paise??'unknown',r.estimated_contribution_paise??'unknown',r.state,...shipmentCostCategories.map(c=>r.coverage[c]),r.costs.map(c=>c.source_id).join('|'),r.costs.map(c=>c.revision_id??'native').join('|'),r.costs.map(c=>c.expense_head_id??'').join('|'),r.financial_change_ids.join('|'),r.dispatch_command_ids.join('|')]);
 const csv=[contributionColumns,...records].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return csv;
}
const page=(snapshot:ContributionSnapshot,rows:ContributionRow[],offset=0):ContributionPage=>({snapshot,rows:rows.slice(offset,offset+100),next_offset:offset+100<rows.length?offset+100:null});
export function createContributionService(database:DatabasePool){return {
 async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),filter=parseFilter(body,q.franchiseId),key=digest('contribution:'+idempotencyKey(keyInput,headers)),fingerprint=digest(filter);
  return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
   await reports.lock(scope);const prior=await reports.replay<ContributionSnapshot,ContributionRow>(scope,key);
   if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(prior.expired)throw new HttpError('REPORT_EXPIRED');return page(prior.metadata,prior.rows);}
   const frame=await capture(scope,filter),rows=frame.rows.map(contributionRow);
   const snapshot:ContributionSnapshot={id:randomUUID(),schema_version:1,definition:'shipment_contribution_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,timezone:'Asia/Kolkata',filter,as_of:frame.as_of,effective_at:frame.effective_at,recorded_at:frame.recorded_at,expires_at:new Date(Date.parse(frame.as_of)+86400000).toISOString().slice(0,23)+frame.as_of.slice(23),count:rows.length,totals:contributionTotals(rows),groups:contributionGroups(rows),shop_expenses:frame.expenses};
   if(Buffer.byteLength(JSON.stringify({snapshot,rows}))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');contributionCsv(snapshot,rows);await reports.save(scope,key,fingerprint,snapshot,rows);await reports.audit(scope,snapshot.id,'report.capture');return page(snapshot,rows);
  },filter.franchise_ids);
 },
 async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false){
  const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$'),offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
  if(offset<0||offset>reportLimits.rows||offset%100)throw new HttpError('VALIDATION_FAILED');
  const filter=await withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{const saved=await reports.get<ContributionSnapshot,ContributionRow>(scope,id);if(saved.metadata.definition!=='shipment_contribution_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');return saved.metadata.filter;});
  return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{const saved=await reports.get<ContributionSnapshot,ContributionRow>(scope,id);await reports.audit(scope,id,exporting?'report.export':'report.read');return exporting?{snapshot:saved.metadata,columns:contributionColumns,csv:contributionCsv(saved.metadata,saved.rows)}:page(saved.metadata,saved.rows,offset);},filter.franchise_ids);
 }
};}
