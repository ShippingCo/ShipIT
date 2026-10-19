import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type AccountantRow,type AccountantFilter,type AccountantSnapshot,type AccountantPage} from '@shippingco/shared';
import {withReportScope} from '../memberships/service.ts';
import {selection,uuid,idempotencyKey,object} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {salesFilter} from './sales-service.ts';
import {accountantRows,reconcileControls,accountantFiles,reconciliationEvidence} from './accountant-rules.ts';
import {captureAccountant,capturePositions,captureAdvances,captureCodPositions,captureAgentPositions,reconciliationAccounts} from './accountant-repository.ts';
import {capture as captureReconciliation} from '../reconciliation/report-repository.ts';
import * as repository from './repository.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function accountantFilter(input:unknown,franchise:string):AccountantFilter {
 const b=object(input,['from_day','to_day','franchise_ids','include_references','format']);
 const f=salesFilter({from_day:b.from_day,to_day:b.to_day,franchise_ids:b.franchise_ids,sort:'confirmed_asc'},franchise);
 if(b.include_references!==undefined&&typeof b.include_references!=='boolean'||b.format!==undefined&&b.format!=='generic_csv_v1')throw new FieldValidationError('$','INVALID_FORMAT');
 return {from_day:f.from_day,to_day:f.to_day,sort:'confirmed_asc',franchise_ids:f.franchise_ids,include_references:b.include_references===true,format:'generic_csv_v1'};
}
function page(snapshot:AccountantSnapshot,rows:AccountantRow[],offset=0,family?:string,id?:string,control?:number):AccountantPage {
 let selected=rows.filter(r=>(family===undefined||r.family===family)&&(id===undefined||r.id===id));
 if(control!==undefined){
  const c=snapshot.controls[control];if(!c)throw new HttpError('RESOURCE_NOT_FOUND');
  const [group,source,kind,direction]=c.family.split(':');
  selected=selected.filter(r=>r.family===group&&(group==='reconciliation'?r.fields.account_id===source&&r.fields.kind===kind&&r.fields.direction===direction:source?r.fields.source_id===source&&r.fields.position===c.basis:r.basis===c.basis));
 }
 if(id!==undefined&&selected.length!==1)throw new HttpError('RESOURCE_NOT_FOUND');
 return {snapshot,rows:selected.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<selected.length?offset+reportLimits.page:null};
}
export function createAccountantService(database:DatabasePool) {
 return {
  async create(token:string,query:unknown,keyInput:unknown,headers:readonly string[],input:unknown,correlation:string) {
   const q=selection(query),filter=accountantFilter(input,q.franchiseId),key=digest('accountant:v1:'+idempotencyKey(keyInput,headers)),fingerprint=digest(JSON.stringify(filter));
   const capture=()=>withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async(scope,cutoff)=>{
    await repository.lock(scope);const previous=await repository.replay<AccountantSnapshot,AccountantRow>(scope,key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');if(previous.metadata.definition!=='accountant_register_v1')throw new HttpError('RESOURCE_NOT_FOUND');return page(previous.metadata,previous.rows);}
    const captured=await captureAccountant(scope,filter),rows=accountantRows(captured.rows,filter.include_references),controls=reconcileControls(rows,captured.controls);
    const positions=await capturePositions(scope,filter);
    // Reconcile the independently queried booking position to source-event files, per booking and cutoff.
    for(const p of positions){
     const relevant=rows.filter(r=>r.fields.booking_id===p.id&&(p.basis==='closing'||r.basis==='opening'));
     const sum=(family:string,column:string)=>relevant.filter(r=>r.family===family).reduce((n,r)=>n+BigInt(r.fields[column]??0),0n);
     const gross=sum('sales','gross_paise')-sum('adjustments','gross_reduction_paise'),allocated=sum('allocations','allocated_paise')+sum('legacy_receipts','received_paise'),refund=sum('refunds','refunded_paise'),debt=gross-allocated+refund;
     const values={gross_paise:gross,allocated_paise:allocated,refund_paise:refund,outstanding_paise:debt>0n?debt:0n,refundable_paise:debt<0n?-debt:0n};
     for(const [column,value] of Object.entries(values))if(String(value)!==p[column as keyof typeof values])throw new HttpError('TEMPORARILY_UNAVAILABLE');
     rows.push({id:digest('position:'+p.franchise_id+':'+p.id+':'+p.basis),family:'booking_positions',meaning:'reference_position:not_new_debt',basis:p.basis==='opening'?'opening':'period',fields:{source_id:p.id,franchise_id:p.franchise_id,source_version:p.payment_version+':'+p.financial_version,position:p.basis,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,String(v)]))}});
     for(const [column,value] of Object.entries(values))controls.push({family:'booking_positions:'+p.id,basis:p.basis,column,source_paise:p[column as keyof typeof values],export_paise:String(value),difference_paise:'0'});
    }
    const advances=await captureAdvances(scope,filter);
    for(const a of advances){
     const relevant=rows.filter(r=>r.fields.receipt_id===a.id&&(a.basis==='closing'||r.basis==='opening'));
     const sum=(family:string,column:string)=>relevant.filter(r=>r.family===family).reduce((n,r)=>n+BigInt(r.fields[column]??0),0n);
     const reserved=sum('cod_reservations','reserved_paise')-rows.filter(r=>r.family==='cashbook'&&r.fields.kind==='cod_reservation_reversal'&&(a.basis==='closing'||r.basis==='opening')&&relevant.some(c=>c.family==='cod_reservations'&&c.fields.source_id===r.fields.cod_allocation_id)).reduce((n,r)=>n+BigInt(r.fields.movement_paise??0),0n);
     const value=sum('receipts','received_paise')-sum('allocations','allocated_paise')-reserved-sum('advance_returns','returned_paise');
     if(String(value)!==a.unallocated_paise||value<0n)throw new HttpError('TEMPORARILY_UNAVAILABLE');
     rows.push({id:digest('advance:'+a.franchise_id+':'+a.id+':'+a.basis),family:'advance_positions',meaning:'reference_liability:not_revenue',basis:a.basis==='opening'?'opening':'period',fields:{source_id:a.id,franchise_id:a.franchise_id,source_version:a.version,position:a.basis,received_paise:a.received_paise,allocated_paise:a.allocated_paise,cod_reserved_paise:a.cod_reserved_paise,returned_paise:a.returned_paise,unallocated_paise:a.unallocated_paise}});
     controls.push({family:'advance_positions:'+a.id,basis:a.basis,column:'unallocated_paise',source_paise:a.unallocated_paise,export_paise:String(value),difference_paise:'0'});
    }
    for(const c of await captureCodPositions(scope,filter)){
     const relevant=rows.filter(r=>r.family==='cashbook'&&r.fields.cod_allocation_id===c.id&&(c.basis==='closing'||r.basis==='opening'));
     const sum=(kind:string)=>relevant.filter(r=>r.fields.kind===kind).reduce((n,r)=>n+BigInt(r.fields.movement_paise??0),0n);
     const remaining=BigInt(c.reserved_paise)-sum('cod_remittance')-sum('cod_reservation_reversal');
     if(String(remaining)!==c.remaining_paise||remaining<0n)throw new HttpError('TEMPORARILY_UNAVAILABLE');
     rows.push({id:digest('cod:'+c.franchise_id+':'+c.id+':'+c.basis),family:'cod_positions',meaning:'reference_seller_liability:not_revenue',basis:c.basis==='opening'?'opening':'period',fields:{source_id:c.id,franchise_id:c.franchise_id,position:c.basis,reserved_paise:c.reserved_paise,remitted_paise:c.remitted_paise,reversed_paise:c.reversed_paise,remaining_paise:c.remaining_paise}});
     controls.push({family:'cod_positions:'+c.id,basis:c.basis,column:'remaining_paise',source_paise:c.remaining_paise,export_paise:String(remaining),difference_paise:'0'});
    }
    for(const p of await captureAgentPositions(scope,filter)){
     const cashbook=rows.filter(r=>r.family==='cashbook'&&(p.basis==='closing'||r.basis==='opening'));
     const source=rows.find(r=>r.family==='agent_fees'&&r.fields.source_id===p.id);
     const sum=(selected:AccountantRow[],column:string)=>selected.reduce((n,r)=>n+BigInt(r.fields[column]??0),0n);
     let values:Record<string,bigint>;
     if(p.family==='agent_fee_positions'){
      const fees=cashbook.filter(r=>r.fields.fee_earning_id===p.id),recognized=sum(fees,'expense_paise'),paid=sum(fees,'fee_cash_paise'),applied=sum(fees,'fee_advance_paise');
      values={earned_paise:BigInt(source?.fields.earned_paise??0),recognized_paise:recognized,paid_paise:paid,advance_applied_paise:applied,payable_paise:recognized-paid-applied};
     }else{
      const descendants=new Set([p.id]);let changed=true;
      while(changed){changed=false;for(const r of cashbook)if(r.fields.kind==='agent_advance'&&r.fields.correction_of&&descendants.has(r.fields.correction_of)&&!descendants.has(r.fields.source_id!)){descendants.add(r.fields.source_id!);changed=true;}}
      const advanced=sum(cashbook.filter(r=>descendants.has(r.fields.source_id!)),'movement_paise'),applied=sum(cashbook.filter(r=>r.fields.fee_advance_request_id===p.id),'fee_advance_paise');
      values={advanced_paise:advanced,applied_paise:applied,recoverable_paise:advanced-applied};
     }
     for(const [column,value] of Object.entries(values)){if(String(value)!==p.fields[column])throw new HttpError('TEMPORARILY_UNAVAILABLE');controls.push({family:p.family+':'+p.id,basis:p.basis,column,source_paise:p.fields[column]!,export_paise:String(value),difference_paise:'0'});}
     rows.push({id:digest(p.family+':'+p.id+':'+p.basis),family:p.family,meaning:'reference_position:not_new_expense',basis:p.basis==='opening'?'opening':'period',fields:{source_id:p.id,franchise_id:p.franchise_id,agent_id:p.agent_id,source_version:digest(JSON.stringify(p.fields)),position:p.basis,...p.fields}});
    }
    const accounts=await reconciliationAccounts(scope);
    for(const account of accounts){
     rows.push({id:digest('reconciliation_state:'+account.id),family:'reconciliation_state',meaning:'reference_configuration',basis:'period',fields:{source_id:account.id,franchise_id:account.franchise_id,state:account.enabled?'enabled':'disabled',qualification:'manual_evidence_only'}});
     // Disabling new reconciliation work does not erase previously recorded evidence.
     const report=await captureReconciliation(scope,{account_id:account.id,from_day:filter.from_day,to_day:filter.to_day});
     for(const r of report.rows)rows.push({id:digest('reconciliation:'+account.id+':'+r.id),family:'reconciliation',meaning:'reference_matching:not_receipt',basis:'period',fields:{source_id:r.id,franchise_id:account.franchise_id,account_id:account.id,source_version:digest(JSON.stringify(reconciliationEvidence(r.evidence))),resource_id:r.resource_id,kind:r.kind,business_date:r.business_date,direction:r.direction,recorded_paise:r.amount_paise,matched_paise:r.matched_paise,remaining_paise:r.remaining_paise,state:r.status,classification:r.classification,external_reference:filter.include_references?r.external_reference:null,evidence:JSON.stringify(reconciliationEvidence(r.evidence))}});
     for(const c of report.controls){for(const column of ['amount_paise','matched_paise','remaining_paise'] as const){const exported=report.rows.filter(r=>r.kind===c.kind&&r.direction===c.direction).reduce((n,r)=>n+BigInt(r[column]??0),0n);if(exported!==BigInt(c[column]??0))throw new HttpError('TEMPORARILY_UNAVAILABLE');controls.push({family:'reconciliation:'+account.id+':'+c.kind+':'+c.direction,basis:'period',column,source_paise:c[column]??'0',export_paise:String(exported),difference_paise:'0'});}}
     if(rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
    }
    if(rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
    const as_of=cutoff!,snapshot:AccountantSnapshot={id:randomUUID(),schema_version:1,definition:'accountant_register_v1',mapping_version:'generic_csv_v1',timezone:'Asia/Kolkata',organization_id:q.organizationId,franchise_id:q.franchiseId,filter,as_of,expires_at:new Date(Date.parse(as_of)+86400000).toISOString().slice(0,19)+as_of.slice(19),count:rows.length,controls,qualification:'generic_only',reconciliation_state:accounts.length===0?'unavailable:no_receiving_accounts':accounts.every(a=>!a.enabled)?'disabled':accounts.every(a=>a.enabled)?'enabled':'partially_disabled'};
    accountantFiles(snapshot,rows);
    if(Buffer.byteLength(JSON.stringify({snapshot,rows}))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
    await repository.save(scope,key,fingerprint,snapshot,rows);await repository.audit(scope,snapshot.id,'report.capture');return page(snapshot,rows);
   },filter.franchise_ids,'microseconds');
   // A serializable contender can wait on the lock with an older snapshot.
   // Restart once with the identical key after a rolled-back conflict or lost acknowledgement.
   // Every attempt rechecks current grants; no economic source mutation occurs here.
   let result:AccountantPage;
   try{result=await capture();}catch(error){if(!(error instanceof HttpError)||error.code!=='TEMPORARILY_UNAVAILABLE')throw error;result=await capture();}
   // A fresh authorization transaction also covers revocation committed during capture.
   return withReportScope(database,token,q.organizationId,q.franchiseId,false,correlation,async()=>result,filter.franchise_ids);
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
   const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset','family','row','control'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
   const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
   const control=b.control===undefined?undefined:typeof b.control==='string'&&/^\d{1,5}$/.test(b.control)?Number(b.control):-1;
   if(control===-1)throw new FieldValidationError('$','OUT_OF_RANGE');
   if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
   if(b.family!==undefined&&(typeof b.family!=='string'||!/^\w{1,40}$/.test(b.family))||b.row!==undefined&&(typeof b.row!=='string'||!/^([a-f0-9]{64})$/.test(b.row)))throw new FieldValidationError('$','INVALID_FORMAT');
   const ids=await withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await repository.get<AccountantSnapshot,AccountantRow>(scope,id);if(saved.metadata.definition!=='accountant_register_v1'||saved.metadata.mapping_version!=='generic_csv_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');return saved.metadata.filter.franchise_ids;
   });
   return withReportScope(database,token,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
    const saved=await repository.get<AccountantSnapshot,AccountantRow>(scope,id);await repository.audit(scope,id,exporting?'report.export':'report.read');
    return exporting?{snapshot:saved.metadata,files:accountantFiles(saved.metadata,saved.rows)}:page(saved.metadata,saved.rows,offset,b.family as string|undefined,b.row as string|undefined,control);
   },ids);
  },
 };
}
