import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupAgentMoney} from '../agent-money-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
import {org,A,B} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
await test('approved COD reservation reversal releases classification capacity without changing cash, and cannot restore allocated or remitted principal',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),reviewer=await s.grant('franchise_admin',[A]),foreign=await s.grant('franchise_admin',[B]);
 const requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true);
 const before=(await s.db.adminQuery('SELECT * FROM shipit.money_receipts ORDER BY id')).rows;
 const version=async()=>(await s.position()).source_version;
 const totals=async()=>(await s.db.adminQuery('SELECT collected_paise::text,remitted_paise::text,reversed_paise::text,reserved_paise::text,remaining_paise::text FROM shipit.cod_receipt_positions WHERE allocation_id=$1',[s.reservation.resource_id])).rows[0];
 const base={kind:'cod_reservation_reversal',cod_allocation_id:s.reservation.resource_id,payment_reference:null,payment_method:null,source_location_id:s.held.id,source_revision_id:s.held.revision_id,target_location_id:null,target_revision_id:null,amount_paise:1000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic seller statement confirms ten rupees were misclassified as COD',occurred_at:new Date(Date.now()-1000).toISOString()};
 async function submit(input:Record<string,unknown>={}){const k=randomUUID();return requests.submit(s.local.token,q,k,headers(k),{...base,...input,expected_source_version:await version()},randomUUID());}
 async function approve(id:string){const k=randomUUID();return requests.decide(reviewer.token,id,q,k,headers(k),{expected_version:1,decision:'approved',reason:'Independent seller classification review'},randomUUID());}
 async function apply(id:string,decision:string){const k=randomUUID();return effects.apply(s.local.token,id,q,k,headers(k),{expected_version:2,decision_id:decision},randomUUID());}
 await assert.rejects(submit({cod_allocation_id:randomUUID()}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(submit({source_location_id:s.other.id,source_revision_id:s.other.revision_id}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(submit({amount_paise:200001}),{code:'CASHBOOK_CONFLICT'});
 await assert.rejects(submit({payment_method:'cash'}),{code:'VALIDATION_FAILED'});
 const fk=randomUUID();await assert.rejects(requests.submit(foreign.token,{organization_id:org,franchise_id:B},fk,headers(fk),{...base,expected_source_version:await version()},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const ak=randomUUID();await assert.rejects(requests.submit(s.agent.token,q,ak,headers(ak),{...base,expected_source_version:await version()},randomUUID()),{code:'ACTION_FORBIDDEN'});
 // Agent departure does not make the immutable original classification uncorrectable.
 await s.memberships.revokeMembership(s.admin.token,s.agent.member.id,{expected_version:s.agent.member.version});
 const {createAgentCashCaptureService}=await import('../../src/modules/agent-settlements/cash-capture-service.ts'),captures=createAgentCashCaptureService(s.pool,true);
 const capture=async()=>{const at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),key=randomUUID();return captures.capture(s.local.token,q,key,headers(key),{agent_id:s.agent.id,day,counted_at:at,counted_paise:210000,reason:'Synthetic historical seller classification count'},randomUUID());};
 const initialCapture=await capture();
 const first=await submit(),self=randomUUID();await assert.rejects(requests.decide(s.local.token,first.id,q,self,headers(self),{expected_version:1,decision:'approved',reason:'Synthetic self approval'},randomUUID()),{code:'CASHBOOK_APPROVAL_REQUIRED'});
 const decision=await approve(first.id),input={expected_version:2,decision_id:decision.id};assert.equal((await totals())!.reversed_paise,'0');
 const fault=randomUUID();await assert.rejects(createCashbookEffectService(paymentFault(s.pool,'INSERT INTO shipit.cashbook_effects','before'),true,true).apply(s.local.token,first.id,q,fault,headers(fault),input,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await totals())!.reversed_paise,'0');
 const key=randomUUID();await assert.rejects(createCashbookEffectService(paymentFault(s.pool,'COMMIT'),true,true).apply(s.local.token,first.id,q,key,headers(key),input,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const result=await createCashbookEffectService(s.pool,true).apply(s.local.token,first.id,q,key,headers(key),input,randomUUID());assert.deepEqual(result.legs,[]);
 assert.deepEqual(await Promise.all([effects.apply(s.local.token,first.id,q,key,headers(key),input,randomUUID()),effects.apply(s.local.token,first.id,q,key,headers(key),input,randomUUID())]),[result,result]);
 assert.deepEqual(await totals(),{collected_paise:'200000',remitted_paise:'0',reversed_paise:'1000',reserved_paise:'199000',remaining_paise:'199000'});
 const reversedCapture=await capture(),reversedFinance=reversedCapture.source_snapshot.finance as {totals:{cod_reversed_paise:string;origin_receipt_seller_liability_paise:string};receipt_positions:{unallocated_paise:string}[]};
 assert.equal(reversedFinance.totals.cod_reversed_paise,'1000');assert.equal(reversedFinance.totals.origin_receipt_seller_liability_paise,'199000');assert.equal(reversedFinance.receipt_positions[0]!.unallocated_paise,'1000');
 const historicalOwner=s.db.ownerPool();t.after(()=>historicalOwner.close());const historic=(await historicalOwner.query<{frame:typeof reversedFinance}>('SELECT shipit.agent_statement_finance_frame($1,$2,$3,$4,$5) frame',[org,A,s.agent.id,reversedCapture.counted_at,initialCapture.recorded_at])).rows[0]!.frame;
 assert.equal(historic.totals.cod_reversed_paise,'0');assert.equal(historic.totals.origin_receipt_seller_liability_paise,'200000');assert.equal((reversedCapture.source_snapshot.totals as {expected_paise:string}).expected_paise,'210000');

 assert.equal((await s.position()).locations.find(l=>l.location_id===s.held.id)!.known_recorded_paise,'210000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effect_legs')).rows[0]!.n,0);
 const allocationKey=randomUUID();await s.receipts.allocate(s.local.token,s.receipt.receipt_id,q,allocationKey,headers(allocationKey),{expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:1000,context:'to_pay',expected_payment_version:1}]},randomUUID());
 await assert.rejects(submit({correction_of:first.id,amount_paise:0}),{code:'ALLOCATION_CONFLICT'});
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const columns=['id','organization_id','franchise_id','kind','source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','category','payee','responsible_employee_id','reason','occurred_at','actor_id','correlation_id','key_digest','fingerprint','correction_of','payment_method','cod_allocation_id','payment_reference'];
 const raw=async(wrongSource:boolean)=>{
  const expressions=columns.map(c=>c==='id'?'$1':c==='correlation_id'?'$2':c==='key_digest'||c==='fingerprint'?'$3':c==='expected_source_version'?'$4':c==='amount_paise'?wrongSource?'1000':'0':c==='correction_of'?'r.id':wrongSource&&c==='source_location_id'?'$6':wrongSource&&c==='source_revision_id'?'$7':'r.'+c);
  return owner.query('INSERT INTO shipit.cashbook_requests('+columns.join(',')+') SELECT '+expressions.join(',')+' FROM shipit.cashbook_requests r WHERE r.id=$5',[randomUUID(),randomUUID(),'b'.repeat(64),await version(),first.id,...(wrongSource?[s.other.id,s.other.revision_id]:[])]);
 };
 await assert.rejects(raw(false),{sqlState:'23514'});await assert.rejects(raw(true),{sqlState:'23514'});
 // A valid zero-leg correction remains possible while retaining the freight capacity.
 const unchanged=await submit({correction_of:first.id,amount_paise:1000});assert.deepEqual((await apply(unchanged.id,(await approve(unchanged.id)).id)).legs,[]);

 // Genuine historical-custody recovery is a separate acknowledged cash movement.
 const hk=randomUUID(),handover=await s.handovers.request(s.local.token,q,hk,headers(hk),await s.requestBody(),randomUUID());
 const current=await s.handovers.read(s.operator.token,handover.id,q,randomUUID()),receive=randomUUID();await s.handovers.respond(s.operator.token,handover.id,q,receive,headers(receive),{kind:'accept',expected_version:1,expected_source_version:current.current_source_version,amount_paise:210000,currency:'INR',reason:'Synthetic genuine recovery of departed agent cash'},randomUUID());
 const paid=await submit({kind:'cod_remittance',source_location_id:s.office.id,source_revision_id:s.office.revision_id,amount_paise:180000,payment_method:'cash',payment_reference:'SYNTHETIC-SELLER-PAID'});await apply(paid.id,(await approve(paid.id)).id);
 assert.equal((await totals())!.remaining_paise,'19000');await assert.rejects(submit({amount_paise:19001}),{code:'CASHBOOK_CONFLICT'});
 const one=await submit({amount_paise:19000}),two=await submit({amount_paise:19000}),a=await approve(one.id),b=await approve(two.id);
 const race=await Promise.allSettled([apply(one.id,a.id),apply(two.id,b.id)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);for(const x of race)if(x.status==='rejected')assert.equal(x.reason.code,'VERSION_CONFLICT');
 assert.deepEqual(await totals(),{collected_paise:'200000',remitted_paise:'180000',reversed_paise:'20000',reserved_paise:'180000',remaining_paise:'0'});
 assert.equal((await s.position()).locations.find(l=>l.location_id===s.office.id)!.known_recorded_paise,'30000');
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.money_receipts ORDER BY id')).rows,before);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.cashbook_requests WHERE kind='expense'")).rows[0]!.n,0);
 await assert.rejects(owner.query('UPDATE shipit.cashbook_requests SET cod_allocation_id=NULL WHERE id=$1',[first.id]),{sqlState:'23514'});
 await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});await assert.rejects(effects.apply(s.local.token,first.id,q,key,headers(key),input,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
