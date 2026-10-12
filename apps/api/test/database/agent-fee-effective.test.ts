import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingSetup} from '../booking-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';
import {org,A} from '../audit-support.ts';
import {createAgentFeeService} from '../../src/modules/agent-settlements/fee-service.ts';
import {createAgentCashCaptureService} from '../../src/modules/agent-settlements/cash-capture-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];

for(const basis of ['agreed_period','per_delivery'] as const)await test(`${basis} fee payments require their exact effective source and reconcile cash at historical cutoffs`,{timeout:60000},async t=>{
 const s=await bookingSetup(t),admin=await s.grant('franchise_admin',[A]),reviewer=await s.grant('franchise_admin',[A]),agent=await s.grant('delivery_agent',[A]);await s.db.prepareAgentMoney();
 const fees=createAgentFeeService(s.pool,true),captures=createAgentCashCaptureService(s.pool,true),accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true,true),requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true);
 const now=Date.now(),termKey=randomUUID(),terms=await fees.configure(admin.token,agent.id,q,termKey,headers(termKey),{expected_version:0,basis,amount_paise:4000,currency:'INR',active:true,valid_from:new Date(now-2*86400000).toISOString(),valid_until:new Date(now+(basis==='per_delivery'?1:-1)*86400000).toISOString()},randomUUID());
 const accountKey=randomUUID(),account=await accounts.configure(admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic effective fee drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const locationKey=randomUUID(),location=await locations.configure(admin.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:agent.id,name:'Synthetic agent source custody',active:true,expected_version:0},randomUUID());
 const version=async()=>Number((await effects.position(admin.token,q,randomUUID())).source_version);
 const base={source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,amount_paise:10000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic effective earning source'};
 async function submit(input:Record<string,unknown>){const key=randomUUID();return requests.submit(admin.token,q,key,headers(key),{...base,occurred_at:new Date().toISOString(),...input,expected_source_version:await version()},randomUUID());}
 async function apply(id:string){const rk=randomUUID(),decision=await requests.decide(reviewer.token,id,q,rk,headers(rk),{expected_version:1,decision:'approved',reason:'Synthetic independent review'},randomUUID()),key=randomUUID();return effects.apply(admin.token,id,q,key,headers(key),{expected_version:2,decision_id:decision.id},randomUUID());}
 const funds=await submit({kind:'owner_funds'});await apply(funds.id);
 // A standalone advance is permitted before either kind of earning exists.
 const advance=await submit({kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',amount_paise:1000});await apply(advance.id);
 const before=advance.occurred_at;let proofId:string|null=null;
 if(basis==='per_delivery'){
  const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id,live={...s,clock:()=>new Date()},start=await startTestDelivery(live,parcel,agent),code=await testDeliveryCode(live,parcel),key=randomUUID();
  await start.service.complete(agent.token,parcel,q,key,headers(key),{expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code},false,randomUUID());
  proofId=(await s.db.adminQuery('SELECT id FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows[0]!.id;
 }
 const earningKey=randomUUID(),earning=proofId?await fees.earn(admin.token,q,earningKey,headers(earningKey),{proof_id:proofId,term_revision_id:terms.resource_id},randomUUID()):await fees.earnAgreed(admin.token,q,earningKey,headers(earningKey),{term_revision_id:terms.resource_id},randomUUID());
 const boundary=(await s.db.adminQuery<{exact:string;earlier:string;floor:string;eligible:string;fractional:boolean}>(`WITH source AS(SELECT CASE e.basis WHEN 'per_delivery' THEN p.completed_at ELSE e.recorded_at END at FROM shipit.agent_fee_earnings e LEFT JOIN shipit.delivery_proofs p ON p.id=e.proof_id WHERE e.id=$1)
  SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') exact,to_char((at-interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') earlier,
  to_char(date_trunc('milliseconds',at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') floor,
  to_char((CASE WHEN at=date_trunc('milliseconds',at) THEN at ELSE date_trunc('milliseconds',at)+interval '1 millisecond' END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') eligible,
  at<>date_trunc('milliseconds',at) fractional FROM source`,[earning.resource_id])).rows[0]!;
 assert.ok(Date.parse(boundary.eligible)>Date.parse(before));if(basis==='per_delivery')assert.equal(boundary.fractional,false);
 const fee={kind:'expense',agent_payee_id:agent.id,payment_method:'cash',amount_paise:4000,category:'transport',payee:'Synthetic earned fee',fee_earning_id:earning.resource_id,fee_cash_paise:1000,fee_advance_paise:1000,fee_advance_request_id:advance.id};
 const facts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.cashbook_requests) requests,(SELECT count(*)::int FROM shipit.cashbook_request_decisions) decisions,(SELECT count(*)::int FROM shipit.cashbook_effects) effects,(SELECT count(*)::int FROM shipit.cashbook_effect_legs) legs,(SELECT count(*)::int FROM shipit.audit_history) audits,(SELECT count(*)::int FROM shipit.domain_events) events`)).rows[0];
 const initial=await facts();
 const deniedAt=boundary.fractional?boundary.floor:new Date(Date.parse(boundary.floor)-1).toISOString();
 await assert.rejects(submit({...fee,occurred_at:deniedAt}),{code:'CASHBOOK_CONFLICT'});assert.deepEqual(await facts(),initial);
 const expense=await submit({...fee,occurred_at:boundary.eligible});
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const columns=['id','organization_id','franchise_id','kind','source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','category','payee','responsible_employee_id','reason','occurred_at','actor_id','correlation_id','key_digest','fingerprint','payment_method','agent_payee_id','fee_earning_id','fee_cash_paise','fee_advance_paise','fee_advance_request_id'];
 const expressions=columns.map(c=>c==='id'?'$1':c==='correlation_id'?'$2':c==='key_digest'||c==='fingerprint'?'$3':c==='occurred_at'?'$4':'r.'+c);
 const raw=(at:string)=>owner.query('INSERT INTO shipit.cashbook_requests('+columns.join(',')+') SELECT '+expressions.join(',')+' FROM shipit.cashbook_requests r WHERE r.id=$5 RETURNING id',[randomUUID(),randomUUID(),randomUUID().replaceAll('-','').repeat(2),at,expense.id]);
 const beforeRaw=await facts();await assert.rejects(raw(boundary.earlier),{sqlState:'23514'});assert.deepEqual(await facts(),beforeRaw);
 assert.equal((await raw(boundary.exact)).rows.length,1); // Exact PostgreSQL equality, including agreed-source microseconds.
 assert.deepEqual((await apply(expense.id)).legs,[{location_id:location.id,direction:'out',amount_paise:'1000'}]);
 const later=new Date().toISOString(),payment={...fee,kind:'agent_fee_payment',category:null,payee:null,amount_paise:1000,fee_advance_paise:0,fee_advance_request_id:null};
 const beforeLater=await facts();await assert.rejects(submit({...payment,occurred_at:deniedAt}),{code:'CASHBOOK_CONFLICT'});assert.deepEqual(await facts(),beforeLater);
 const paid=await submit({...payment,occurred_at:later});assert.deepEqual((await apply(paid.id)).legs,[{location_id:location.id,direction:'out',amount_paise:'1000'}]);
 type Frame={finance:{totals:{earned_fee_paise:string;fee_expense_paise:string;fee_direct_paid_paise:string;fee_advance_applied_paise:string;advance_paid_paise:string}};cash:{cash_facts:{request_id:string|null;direction:string;amount_paise:string}[]}};
 for(const [counted_at,gross,direct,applied] of [[before,'0','0','0'],[boundary.eligible,'4000','1000','1000'],[later,'4000','2000','1000']]){
  const at=counted_at!,day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),key=randomUUID(),capture=await captures.capture(agent.token,q,key,headers(key),{agent_id:agent.id,day,counted_at:at,counted_paise:7000,reason:'Synthetic same-cutoff source reconciliation'},randomUUID()),frame=capture.source_snapshot as unknown as Frame;
  assert.equal(frame.finance.totals.advance_paid_paise,'1000');assert.equal(frame.finance.totals.earned_fee_paise,gross);assert.equal(frame.finance.totals.fee_expense_paise,gross);assert.equal(frame.finance.totals.fee_direct_paid_paise,direct);assert.equal(frame.finance.totals.fee_advance_applied_paise,applied);
  const feeLegs=frame.cash.cash_facts.filter(f=>f.request_id===expense.id||f.request_id===paid.id);assert.ok(feeLegs.every(f=>f.direction==='out'));assert.equal(feeLegs.reduce((n,f)=>n+BigInt(f.amount_paise),0n),BigInt(direct!));
 }
});
