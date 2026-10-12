import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingSetup} from '../booking-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
import {createAgentFeeService} from '../../src/modules/agent-settlements/fee-service.ts';
import {createAgentCashCaptureService} from '../../src/modules/agent-settlements/cash-capture-service.ts';
import {org,A} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
await test('agent advance pays actual approved shop cash once without earned expense or customer netting and preserves bounded corrections',{timeout:60000},async t=>{
 const s=await bookingSetup(t),admin=await s.grant('franchise_admin',[A]),reviewer=await s.grant('franchise_admin',[A]),agent=await s.grant('delivery_agent',[A]);await s.db.prepareAgentMoney();
 const booked=await s.book();assert.equal(booked.statusCode,201);const obligation=(await s.db.adminQuery('SELECT outstanding_paise::text FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id])).rows[0];
 const accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true),disabledRequests=createCashbookRequestService(s.pool,true),disabledEffects=createCashbookEffectService(s.pool,true);
 const accountKey=randomUUID(),account=await accounts.configure(admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic shop cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const locationKey=randomUUID(),location=await locations.configure(admin.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:s.operator.id,name:'Synthetic office paid cash',active:true,expected_version:0},randomUUID());
 const version=async()=>Number((await effects.position(admin.token,q,randomUUID())).source_version);
 const base={kind:'owner_funds',source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:await version(),amount_paise:10000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic actual owner funds',occurred_at:new Date(Date.now()-1000).toISOString()};
 async function approve(id:string,actor=reviewer){const key=randomUUID();return requests.decide(actor.token,id,q,key,headers(key),{expected_version:1,decision:'approved',reason:'Synthetic independent voucher review'},randomUUID());}
 async function apply(id:string,decision:string){const key=randomUUID();return effects.apply(admin.token,id,q,key,headers(key),{expected_version:2,decision_id:decision},randomUUID());}
 const fundKey=randomUUID(),fund=await requests.submit(s.operator.token,q,fundKey,headers(fundKey),base,randomUUID());await apply(fund.id,(await approve(fund.id)).id);
 const input={...base,kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',expected_source_version:await version(),amount_paise:1000,reason:'Synthetic actual advance voucher'},key=randomUUID();
 await assert.rejects(disabledRequests.submit(admin.token,q,key,headers(key),input,randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 await assert.rejects(requests.submit(agent.token,q,key,headers(key),input,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const advance=await requests.submit(admin.token,q,key,headers(key),input,randomUUID());assert.equal(advance.agent_payee_id,agent.id);
 assert.deepEqual(await disabledRequests.submit(admin.token,q,key,headers(key),input,randomUUID()),advance);
 const selfKey=randomUUID();await assert.rejects(requests.decide(admin.token,advance.id,q,selfKey,headers(selfKey),{expected_version:1,decision:'approved',reason:'Synthetic self review'},randomUUID()),{code:'CASHBOOK_APPROVAL_REQUIRED'});
 const decision=await approve(advance.id),applyKey=randomUUID(),body={expected_version:2,decision_id:decision.id};
 await assert.rejects(disabledEffects.apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 await assert.rejects(createCashbookEffectService(paymentFault(s.pool,'COMMIT'),true,true).apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const effect=await disabledEffects.apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID());
 assert.deepEqual(effect.legs,[{location_id:location.id,direction:'out',amount_paise:'1000'}]);
 assert.deepEqual(await Promise.all([effects.apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID()),effects.apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID())]),[effect,effect]);
 const position=await effects.position(admin.token,q,randomUUID());assert.equal(position.locations.find(l=>l.location_id===location.id)!.known_recorded_paise,'9000');
 const facts=(await s.db.adminQuery("SELECT source_kind,amount_paise::text,payment_method FROM shipit.cashbook_source_facts WHERE source_kind='agent_advance'")).rows;
 assert.deepEqual(facts,[{source_kind:'agent_advance',amount_paise:'1000',payment_method:'cash'}]);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.cashbook_requests WHERE kind='expense'")).rows[0]!.n,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_fee_earnings')).rows[0]!.n,0);
 assert.deepEqual((await s.db.adminQuery('SELECT outstanding_paise::text FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id])).rows[0],obligation);
 const excessiveKey=randomUUID(),excessive=await requests.submit(admin.token,q,excessiveKey,headers(excessiveKey),{...input,expected_source_version:await version(),amount_paise:10000},randomUUID()),excessiveApproval=await approve(excessive.id);
 await assert.rejects(apply(excessive.id,excessiveApproval.id),{code:'CASHBOOK_CONFLICT'});
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query(`INSERT INTO shipit.cashbook_effects(id,organization_id,franchise_id,request_id,decision_id,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,[randomUUID(),org,A,excessive.id,excessiveApproval.id,admin.id,randomUUID(),'a'.repeat(64)]),{sqlState:'23514'});
 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 const newKey=randomUUID();await assert.rejects(requests.submit(admin.token,q,newKey,headers(newKey),{...input,expected_source_version:await version()},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.deepEqual(await disabledEffects.apply(admin.token,advance.id,q,applyKey,headers(applyKey),body,randomUUID()),effect);
 const correctionKey=randomUUID(),corrected=await requests.submit(admin.token,q,correctionKey,headers(correctionKey),{...input,expected_source_version:await version(),correction_of:advance.id,amount_paise:800,reason:'Synthetic source voucher confirms only eight rupees were originally paid'},randomUUID());
 const correctedEffect=await apply(corrected.id,(await approve(corrected.id)).id);assert.deepEqual(correctedEffect.legs,[{location_id:location.id,direction:'in',amount_paise:'200'}]);
 assert.equal((await effects.position(admin.token,q,randomUUID())).locations.find(l=>l.location_id===location.id)!.known_recorded_paise,'9200');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects WHERE request_id=$1',[advance.id])).rows[0]!.n,1);
});

await test('fee applications cannot precede their paid advance and historical cutoffs reconcile equal and later applications',{timeout:60000},async t=>{
 const s=await bookingSetup(t),admin=await s.grant('franchise_admin',[A]),reviewer=await s.grant('franchise_admin',[A]),agent=await s.grant('delivery_agent',[A]);await s.db.prepareAgentMoney();
 const fees=createAgentFeeService(s.pool,true),captures=createAgentCashCaptureService(s.pool,true),accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true);
 const requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true);
 const now=Date.now();
 const termKey=randomUUID(),terms=await fees.configure(admin.token,agent.id,q,termKey,headers(termKey),{expected_version:0,basis:'agreed_period',amount_paise:4000,currency:'INR',active:true,
  valid_from:new Date(now-2*86400000).toISOString(),valid_until:new Date(now-86400000).toISOString()},randomUUID());
 const earningKey=randomUUID(),earning=await fees.earnAgreed(admin.token,q,earningKey,headers(earningKey),{term_revision_id:terms.resource_id},randomUUID());
 const accountKey=randomUUID(),account=await accounts.configure(admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic advance drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const locationKey=randomUUID(),location=await locations.configure(admin.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:s.operator.id,name:'Synthetic advance source',active:true,expected_version:0},randomUUID());
 const version=async()=>Number((await effects.position(admin.token,q,randomUUID())).source_version);
 // All three occurrence boundaries use the source database clock, including its native
 // earning precision. Host/VM clock skew must not put the first cutoff before earning.
 async function instantAfter(previous:string|null=null){
  for(let attempt=0;;attempt++){
   const row=(await s.db.adminQuery(`WITH moment AS MATERIALIZED(SELECT date_trunc('milliseconds',clock_timestamp()) at)
    SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') at,
    at>GREATEST((SELECT max(recorded_at) FROM shipit.agent_fee_earnings),COALESCE($1::timestamptz,'-infinity'::timestamptz)) ready FROM moment`,[previous])).rows[0]!;
   if(row.ready)return String(row.at);assert(attempt<100,'Database source boundary did not advance');await new Promise(resolve=>setTimeout(resolve,2));
  }
 }
 const before=await instantAfter(),base={source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,amount_paise:10000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic causal advance evidence',occurred_at:before};
 async function submit(input:Record<string,unknown>){const key=randomUUID();return requests.submit(admin.token,q,key,headers(key),{...base,...input,expected_source_version:await version()},randomUUID());}
 async function apply(id:string){
  const reviewKey=randomUUID(),decision=await requests.decide(reviewer.token,id,q,reviewKey,headers(reviewKey),{expected_version:1,decision:'approved',reason:'Synthetic independent review'},randomUUID());
  const applyKey=randomUUID();return effects.apply(admin.token,id,q,applyKey,headers(applyKey),{expected_version:2,decision_id:decision.id},randomUUID());
 }
 const fund=await submit({kind:'owner_funds'});await apply(fund.id);
 const advanceAt=await instantAfter(before);assert.ok(Date.parse(advanceAt)>Date.parse(before));
 const advance=await submit({kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',amount_paise:1000,occurred_at:advanceAt});await apply(advance.id);
 const fee={kind:'expense',agent_payee_id:agent.id,payment_method:'cash',amount_paise:4000,category:'transport',payee:'Synthetic agreed earning',fee_earning_id:earning.resource_id,fee_cash_paise:0,fee_advance_paise:500,fee_advance_request_id:advance.id};
 const facts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.cashbook_requests) requests,(SELECT count(*)::int FROM shipit.cashbook_request_decisions) decisions,
  (SELECT count(*)::int FROM shipit.cashbook_effects) effects,(SELECT count(*)::int FROM shipit.cashbook_effect_legs) legs,(SELECT count(*)::int FROM shipit.audit_history) audits,(SELECT count(*)::int FROM shipit.domain_events) events`)).rows[0];
 const beforeDenied=await facts();await assert.rejects(submit({...fee,occurred_at:before}),{code:'CASHBOOK_CONFLICT'});assert.deepEqual(await facts(),beforeDenied);
 // Equal instants are allowed, including a different input timezone representation.
 const equalOffset=new Date(Date.parse(advanceAt)+330*60_000).toISOString().replace('Z','+05:30');
 const expense=await submit({...fee,occurred_at:equalOffset});assert.equal(expense.occurred_at,advanceAt);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const columns=['id','organization_id','franchise_id','kind','source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','category','payee','responsible_employee_id','reason','occurred_at','actor_id','correlation_id','key_digest','fingerprint','payment_method','agent_payee_id','fee_earning_id','fee_cash_paise','fee_advance_paise','fee_advance_request_id'];
 const expressions=columns.map(c=>c==='id'?'$1':c==='correlation_id'?'$2':c==='key_digest'||c==='fingerprint'?'$3':c==='occurred_at'?'$4':'r.'+c);
 const beforeRaw=await facts();await assert.rejects(owner.query('INSERT INTO shipit.cashbook_requests('+columns.join(',')+') SELECT '+expressions.join(',')+' FROM shipit.cashbook_requests r WHERE r.id=$5',
  [randomUUID(),randomUUID(),randomUUID().replaceAll('-','').repeat(2),before,expense.id]),{sqlState:'23514'});assert.deepEqual(await facts(),beforeRaw);
 assert.deepEqual((await apply(expense.id)).legs,[]);
 const later=await instantAfter(advanceAt);assert.ok(Date.parse(later)>Date.parse(advanceAt));
 const payment=await submit({...fee,kind:'agent_fee_payment',amount_paise:500,category:null,payee:null,occurred_at:later});assert.deepEqual((await apply(payment.id)).legs,[]);
 type Frame={totals:{advance_paid_paise:string;fee_advance_applied_paise:string;unapplied_advance_paise:string;remaining_fee_paise:string};advance_positions:{paid_paise:string;applied_paise:string;unapplied_paise:string}[]};
 async function frame(counted_at:string){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(counted_at)),key=randomUUID();
  return (await captures.capture(agent.token,q,key,headers(key),{agent_id:agent.id,day,counted_at,counted_paise:0,reason:'Synthetic historical funding cutoff'},randomUUID())).source_snapshot.finance as Frame;
 }
 for(const [cutoff,paid,applied,unapplied,remaining] of [[before,'0','0','0','4000'],[advanceAt,'1000','500','500','3500'],[later,'1000','1000','0','3000']]){
  const f=await frame(cutoff!);assert.equal(f.totals.advance_paid_paise,paid);assert.equal(f.totals.fee_advance_applied_paise,applied);assert.equal(f.totals.unapplied_advance_paise,unapplied);assert.equal(f.totals.remaining_fee_paise,remaining);
  assert.equal(f.advance_positions.length,paid==='0'?0:1);assert.equal(f.advance_positions.reduce((n,p)=>n+BigInt(p.applied_paise),0n),BigInt(f.totals.fee_advance_applied_paise));
 }
 assert.equal((await effects.position(admin.token,q,randomUUID())).locations.find(l=>l.location_id===location.id)!.known_recorded_paise,'9000');
});
