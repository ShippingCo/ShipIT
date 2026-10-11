import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {bookingSetup} from '../booking-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createAgentFeeService} from '../../src/modules/agent-settlements/fee-service.ts';
import {org,A,B} from '../audit-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
await test('gross earned fee uses explicit advance and cash once with independent approval and bounded corrections',{timeout:60000},async t=>{
 const s=await bookingSetup(t),agent=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A]),other=await s.grant('franchise_admin',[B]);
 await s.db.prepareAgentMoney();const service=createAgentFeeService(s.pool,true),disabled=createAgentFeeService(s.pool);
 const now=Date.now(),body={expected_version:0,basis:'per_delivery',amount_paise:4000,currency:'INR',valid_from:new Date(now-86400000).toISOString(),valid_until:new Date(now+86400000).toISOString(),active:true};
 const key=randomUUID();const terms=await service.configure(admin.token,agent.id,q,key,headers(key),body,randomUUID());
 assert.deepEqual(await disabled.configure(admin.token,agent.id,q,key,headers(key),body,randomUUID()),terms);
 await assert.rejects(service.configure(admin.token,agent.id,q,key,headers(key),{...body,amount_paise:4100},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const deniedKey=randomUUID();await assert.rejects(service.configure(agent.token,agent.id,q,deniedKey,headers(deniedKey),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.configure(other.token,agent.id,q,deniedKey,headers(deniedKey),body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const booked=await s.book();assert.equal(booked.statusCode,201);const parcel=booked.json().parcels[0].id;
 const live={...s,clock:()=>new Date()},start=await startTestDelivery(live,parcel,agent);
 const attempt=(await s.db.adminQuery('SELECT id FROM shipit.delivery_attempts WHERE parcel_id=$1 AND state=\'active\'',[parcel])).rows[0]!.id;
 const invalidKey=randomUUID();await assert.rejects(service.earn(admin.token,q,invalidKey,headers(invalidKey),{proof_id:attempt,term_revision_id:terms.resource_id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_fee_earnings')).rows[0]!.n,0);
 const code=await testDeliveryCode(live,parcel),completeKey=randomUUID();
 await start.service.complete(agent.token,parcel,q,completeKey,headers(completeKey),{expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code},false,randomUUID());
 const proof=(await s.db.adminQuery('SELECT id,completed_by,proof_method FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows[0]!;
 assert.equal(proof.completed_by,agent.id);assert.equal(proof.proof_method,'otp_verified');

 const earnKey=randomUUID(),earned=await service.earn(admin.token,q,earnKey,headers(earnKey),{proof_id:proof.id,term_revision_id:terms.resource_id},randomUUID());
 const {createAgentCashCaptureService}=await import('../../src/modules/agent-settlements/cash-capture-service.ts'),captures=createAgentCashCaptureService(s.pool,true);
 const capture=async()=>{const at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),key=randomUUID();return captures.capture(agent.token,q,key,headers(key),{agent_id:agent.id,day,counted_at:at,counted_paise:0,reason:'Synthetic actual fee and cash count'},randomUUID());};
 type FeeFrame={as_of:string;totals:{earned_fee_paise:string;fee_expense_paise:string;fee_cash_paid_paise:string;fee_advance_applied_paise:string;remaining_fee_paise:string;advance_paid_paise:string;unapplied_advance_paise:string};fee_positions:{earning_id:string;proof_id:string|null}[]};
 const unpaidCapture=await capture(),unpaidFrame=unpaidCapture.source_snapshot.finance as FeeFrame;
 assert.equal(unpaidFrame.totals.earned_fee_paise,'4000');assert.equal(unpaidFrame.totals.remaining_fee_paise,'4000');assert.equal(unpaidFrame.totals.fee_expense_paise,'0');assert.equal(unpaidFrame.fee_positions[0]!.proof_id,proof.id);
 const reviewer=await s.grant('franchise_admin',[A]);
 const accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),requests=createCashbookRequestService(s.pool,true,true),effects=createCashbookEffectService(s.pool,true,true);
 const accountKey=randomUUID(),account=await accounts.configure(admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic fee cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const locationKey=randomUUID(),location=await locations.configure(admin.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:s.operator.id,name:'Synthetic fee shop drawer',active:true,expected_version:0},randomUUID());
 const version=async()=>Number((await effects.position(admin.token,q,randomUUID())).source_version);
 const base={kind:'owner_funds',source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:await version(),amount_paise:10000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic owner funds for actual fee cash',occurred_at:new Date(Date.now()-1000).toISOString()};
 async function submit(input:Record<string,unknown>){const key=randomUUID();return requests.submit(admin.token,q,key,headers(key),{...base,...input,expected_source_version:await version()},randomUUID());}
 async function approve(id:string){const key=randomUUID();return requests.decide(reviewer.token,id,q,key,headers(key),{expected_version:1,decision:'approved',reason:'Synthetic distinct-admin fee review'},randomUUID());}
 async function apply(id:string,decision:string){const key=randomUUID();return effects.apply(admin.token,id,q,key,headers(key),{expected_version:2,decision_id:decision},randomUUID());}
 const fund=await submit({});await apply(fund.id,(await approve(fund.id)).id);
 const advance=await submit({kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',amount_paise:1000});await apply(advance.id,(await approve(advance.id)).id);
 const advanceCapture=await capture(),advanceFrame=advanceCapture.source_snapshot.finance as FeeFrame;assert.equal(advanceFrame.totals.advance_paid_paise,'1000');assert.equal(advanceFrame.totals.unapplied_advance_paise,'1000');assert.equal(advanceFrame.totals.remaining_fee_paise,'4000');
 const debt=await s.db.adminQuery('SELECT * FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id]);
 const fee={kind:'expense',agent_payee_id:agent.id,payment_method:'cash',amount_paise:4000,category:'transport',payee:'Synthetic delivery agent',fee_earning_id:earned.resource_id,fee_cash_paise:3000,fee_advance_paise:1000,fee_advance_request_id:advance.id};
 const badKey=randomUUID();await assert.rejects(createCashbookRequestService(s.pool,true).submit(admin.token,q,badKey,headers(badKey),{...base,...fee,expected_source_version:await version()},randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 await assert.rejects(submit({...fee,fee_advance_paise:1001,fee_cash_paise:2999}),{code:'CASHBOOK_CONFLICT'});
 const expense=await submit(fee),selfKey=randomUUID();await assert.rejects(requests.decide(admin.token,expense.id,q,selfKey,headers(selfKey),{expected_version:1,decision:'approved',reason:'Synthetic self approval'},randomUUID()),{code:'CASHBOOK_APPROVAL_REQUIRED'});
 const approved=await approve(expense.id),applyKey=randomUUID(),applyBody={expected_version:2,decision_id:approved.id};
 await assert.rejects(createCashbookEffectService(paymentFault(s.pool,'INSERT INTO shipit.cashbook_effects','before'),true,true).apply(admin.token,expense.id,q,randomUUID(),headers(randomUUID()),applyBody,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects WHERE request_id=$1',[expense.id])).rows[0]!.n,0);
 await assert.rejects(createCashbookEffectService(paymentFault(s.pool,'COMMIT'),true,true).apply(admin.token,expense.id,q,applyKey,headers(applyKey),applyBody,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const paid=await createCashbookEffectService(s.pool,true).apply(admin.token,expense.id,q,applyKey,headers(applyKey),applyBody,randomUUID());
 assert.deepEqual(paid.legs,[{location_id:location.id,direction:'out',amount_paise:'3000'}]);
 const paidCapture=await capture(),paidFrame=paidCapture.source_snapshot.finance as FeeFrame;
 assert.deepEqual(paidFrame.totals,{earned_fee_paise:'4000',fee_expense_paise:'4000',fee_cash_paid_paise:'3000',fee_direct_paid_paise:'3000',fee_noncash_paid_paise:'0',fee_advance_applied_paise:'1000',remaining_fee_paise:'0',advance_paid_paise:'1000',unapplied_advance_paise:'0',received_paise:'0',freight_applied_paise:'0',cod_collected_paise:'0',cod_remitted_paise:'0',cod_reversed_paise:'0',origin_receipt_seller_liability_paise:'0'});
 assert.equal(unpaidFrame.totals.remaining_fee_paise,'4000');
 const historyOwner=s.db.ownerPool();t.after(()=>historyOwner.close());
 const historic=(await historyOwner.query<{frame:FeeFrame}>('SELECT shipit.agent_statement_finance_frame($1,$2,$3,$4,$5) frame',[org,A,agent.id,paidCapture.counted_at,unpaidFrame.as_of])).rows[0]!.frame;
 assert.equal(historic.totals.fee_expense_paise,'0');assert.equal(historic.totals.advance_paid_paise,'0');assert.equal(historic.totals.remaining_fee_paise,'4000');

 assert.deepEqual(await Promise.all([effects.apply(admin.token,expense.id,q,applyKey,headers(applyKey),applyBody,randomUUID()),effects.apply(admin.token,expense.id,q,applyKey,headers(applyKey),applyBody,randomUUID())]),[paid,paid]);

 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const columns=['id','organization_id','franchise_id','kind','source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','category','payee','responsible_employee_id','reason','occurred_at','actor_id','correlation_id','key_digest','fingerprint','correction_of','payment_method','agent_payee_id','fee_earning_id','fee_cash_paise','fee_advance_paise','fee_advance_request_id'];
 async function rawCorrection(stripFee:boolean){
  const expressions=columns.map(c=>c==='id'?'$1':c==='correlation_id'?'$2':c==='key_digest'||c==='fingerprint'?'$3':c==='correction_of'?'r.id':c==='expected_source_version'?'$4':stripFee&&['agent_payee_id','fee_earning_id','fee_cash_paise','fee_advance_paise','fee_advance_request_id'].includes(c)?'NULL':'r.'+c);
  return owner.query('INSERT INTO shipit.cashbook_requests('+columns.join(',')+') SELECT '+expressions.join(',')+' FROM shipit.cashbook_requests r WHERE r.id=$5 RETURNING id',[randomUUID(),randomUUID(),randomUUID().replaceAll('-','').repeat(2),await version(),expense.id]);
 }
 await assert.rejects(rawCorrection(true),{sqlState:'23514'});assert.equal((await rawCorrection(false)).rows.length,1);
 const totals=async()=>(await s.db.adminQuery('SELECT earned_paise::text,expense_paise::text,cash_paid_paise::text,advance_applied_paise::text,remaining_paise::text FROM shipit.agent_fee_positions WHERE earning_id=$1',[earned.resource_id])).rows[0];
 assert.deepEqual(await totals(),{earned_paise:'4000',expense_paise:'4000',cash_paid_paise:'3000',advance_applied_paise:'1000',remaining_paise:'0'});
 assert.equal((await effects.position(admin.token,q,randomUUID())).locations.find(l=>l.location_id===location.id)!.known_recorded_paise,'6000');
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations WHERE booking_id=$1',[booked.json().id])).rows,debt.rows);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,0);
 await assert.rejects(submit(fee),{code:'CASHBOOK_CONFLICT'});
 await assert.rejects(submit({kind:'agent_fee_payment',agent_payee_id:agent.id,payment_method:'cash',amount_paise:1,fee_earning_id:earned.resource_id,fee_cash_paise:1,fee_advance_paise:0}),{code:'CASHBOOK_CONFLICT'});
 await assert.rejects(submit({kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',amount_paise:999,correction_of:advance.id}),{code:'CASHBOOK_CONFLICT'});
 const correction=await submit({...fee,fee_cash_paise:2000,correction_of:expense.id});
 assert.deepEqual((await apply(correction.id,(await approve(correction.id)).id)).legs,[{location_id:location.id,direction:'in',amount_paise:'1000'}]);
 assert.deepEqual(await totals(),{earned_paise:'4000',expense_paise:'4000',cash_paid_paise:'2000',advance_applied_paise:'1000',remaining_paise:'1000'});
 const correctedCapture=await capture(),correctedFrame=correctedCapture.source_snapshot.finance as FeeFrame;assert.equal(correctedFrame.totals.fee_cash_paid_paise,'2000');assert.equal(correctedFrame.totals.remaining_fee_paise,'1000');
 const beforeCorrection=(await historyOwner.query<{frame:FeeFrame}>('SELECT shipit.agent_statement_finance_frame($1,$2,$3,$4,$5) frame',[org,A,agent.id,correctedCapture.counted_at,paidFrame.as_of])).rows[0]!.frame;
 assert.equal(beforeCorrection.totals.fee_cash_paid_paise,'3000');assert.equal(beforeCorrection.totals.remaining_fee_paise,'0');

 const laterInput={kind:'agent_fee_payment',agent_payee_id:agent.id,payment_method:'cash',amount_paise:1000,fee_earning_id:earned.resource_id,fee_cash_paise:1000,fee_advance_paise:0};
 const later=await submit(laterInput),competitor=await submit(laterInput),laterApproval=await approve(later.id),competingApproval=await approve(competitor.id);
 const race=await Promise.allSettled([apply(later.id,laterApproval.id),apply(competitor.id,competingApproval.id)]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);
 for(const result of race){if(result.status==='fulfilled')assert.deepEqual(result.value.legs,[{location_id:location.id,direction:'out',amount_paise:'1000'}]);else assert.equal(result.reason.code,'VERSION_CONFLICT');}
 assert.deepEqual(await totals(),{earned_paise:'4000',expense_paise:'4000',cash_paid_paise:'3000',advance_applied_paise:'1000',remaining_paise:'0'});
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.cashbook_requests WHERE kind='expense' AND correction_of IS NULL")).rows[0]!.n,1);
 const unapply=await submit({...fee,fee_cash_paise:2000,fee_advance_paise:0,correction_of:correction.id});assert.deepEqual((await apply(unapply.id,(await approve(unapply.id)).id)).legs,[]);
 assert.equal((await s.db.adminQuery('SELECT remaining_paise::text FROM shipit.agent_advance_positions WHERE origin_id=$1',[advance.id])).rows[0]!.remaining_paise,'1000');
 const correctedAdvance=await submit({kind:'agent_advance',agent_payee_id:agent.id,payment_method:'cash',amount_paise:800,correction_of:advance.id});assert.deepEqual((await apply(correctedAdvance.id,(await approve(correctedAdvance.id)).id)).legs,[{location_id:location.id,direction:'in',amount_paise:'200'}]);
 const reducedAdvanceCapture=await capture(),reducedAdvanceFrame=reducedAdvanceCapture.source_snapshot.finance as FeeFrame;assert.equal(reducedAdvanceFrame.totals.advance_paid_paise,'800');assert.equal(reducedAdvanceFrame.totals.fee_advance_applied_paise,'0');assert.equal(reducedAdvanceFrame.totals.unapplied_advance_paise,'800');assert.equal(reducedAdvanceFrame.totals.remaining_fee_paise,'1000');
 const beforeUnapply=(await historyOwner.query<{frame:FeeFrame}>('SELECT shipit.agent_statement_finance_frame($1,$2,$3,$4,$5) frame',[org,A,agent.id,reducedAdvanceCapture.counted_at,paidFrame.as_of])).rows[0]!.frame;
 assert.equal(beforeUnapply.totals.advance_paid_paise,'1000');assert.equal(beforeUnapply.totals.fee_advance_applied_paise,'1000');assert.equal(beforeUnapply.totals.remaining_fee_paise,'0');

 const agreementKey=randomUUID(),agreement=await service.configure(admin.token,agent.id,q,agreementKey,headers(agreementKey),{...body,expected_version:1,basis:'agreed_period',amount_paise:6000},randomUUID());
 const agreementEarnKey=randomUUID();await assert.rejects(service.earnAgreed(admin.token,q,agreementEarnKey,headers(agreementEarnKey),{term_revision_id:agreement.resource_id},randomUUID()),{code:'CASHBOOK_CONFLICT'});
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_fee_earnings(id,organization_id,franchise_id,agent_id,term_revision_id,basis,covered_from,covered_until,amount_paise,currency,command_id)
 VALUES($1,$2,$3,$4,$5,'agreed_period',$6,$7,6000,'INR',$8)`,[randomUUID(),org,A,agent.id,agreement.resource_id,body.valid_from,body.valid_until,randomUUID()]),{sqlState:'23514'});

 const coveredFrom=new Date().toISOString(),coveredUntil=new Date(Date.now()+86400000).toISOString(),coveredKey=randomUUID();
 const covered=await service.configure(admin.token,agent.id,q,coveredKey,headers(coveredKey),{...body,expected_version:2,basis:'agreed_period',amount_paise:6000,valid_from:coveredFrom,valid_until:coveredUntil},randomUUID());
 const secondBooked=await s.book();assert.equal(secondBooked.statusCode,201);const secondParcel=secondBooked.json().parcels[0].id,secondStart=await startTestDelivery(live,secondParcel,agent),secondCode=await testDeliveryCode(live,secondParcel),secondCompleteKey=randomUUID();
 await secondStart.service.complete(agent.token,secondParcel,q,secondCompleteKey,headers(secondCompleteKey),{expected_version:5,challenge_ref:secondStart.state.challenge_ref,challenge_version:secondStart.state.challenge_version,proof:secondCode},false,randomUUID());
 const secondProof=(await s.db.adminQuery('SELECT id FROM shipit.delivery_proofs WHERE parcel_id=$1',[secondParcel])).rows[0]!.id;
 const coveredEarnKey=randomUUID();await service.earnAgreed(admin.token,q,coveredEarnKey,headers(coveredEarnKey),{term_revision_id:covered.resource_id},randomUUID());
 const deliveryTermKey=randomUUID(),deliveryTerm=await service.configure(admin.token,agent.id,q,deliveryTermKey,headers(deliveryTermKey),{...body,expected_version:3,valid_from:coveredFrom,valid_until:coveredUntil},randomUUID());
 const coveredDeliveryKey=randomUUID();await assert.rejects(service.earn(admin.token,q,coveredDeliveryKey,headers(coveredDeliveryKey),{proof_id:secondProof,term_revision_id:deliveryTerm.resource_id},randomUUID()),{code:'CASHBOOK_CONFLICT'});
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_fee_earnings(id,organization_id,franchise_id,agent_id,term_revision_id,proof_id,parcel_id,amount_paise,currency,command_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,4000,'INR',$8)`,[randomUUID(),org,A,agent.id,deliveryTerm.resource_id,secondProof,secondParcel,randomUUID()]),{sqlState:'23514'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_fee_earnings WHERE agent_id=$1',[agent.id])).rows[0]!.n,2);
 const agreedCapture=await capture(),agreedFrame=agreedCapture.source_snapshot.finance as FeeFrame;assert.equal(agreedFrame.totals.earned_fee_paise,'10000');assert.equal(agreedFrame.totals.remaining_fee_paise,'7000');assert.equal(agreedFrame.fee_positions.find(f=>f.proof_id===null)!.earning_id,(await s.db.adminQuery("SELECT id FROM shipit.agent_fee_earnings WHERE agent_id=$1 AND basis='agreed_period'",[agent.id])).rows[0]!.id);

 const agreedEarning=(await s.db.adminQuery("SELECT id FROM shipit.agent_fee_earnings WHERE agent_id=$1 AND basis='agreed_period'",[agent.id])).rows[0]!.id;
 const bankAccountKey=randomUUID(),bankAccount=await accounts.configure(admin.token,null,q,bankAccountKey,headers(bankAccountKey),{name:'Synthetic agent payout bank',methods:['upi'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const bankLocationKey=randomUUID(),bankLocation=await locations.configure(admin.token,null,q,bankLocationKey,headers(bankLocationKey),{account_id:bankAccount.id,expected_account_version:1,custodian_id:null,name:'Synthetic agent payout UPI',active:true,expected_version:0},randomUUID());
 const bankSource={source_location_id:bankLocation.id,source_revision_id:bankLocation.revision_id},bankFunds=await submit({...bankSource,kind:'owner_funds',amount_paise:10000});await apply(bankFunds.id,(await approve(bankFunds.id)).id);
 const bankFee=await submit({...bankSource,kind:'expense',agent_payee_id:agent.id,payment_method:'upi',amount_paise:6000,category:'transport',payee:'Synthetic agent agreed fee',fee_earning_id:agreedEarning,fee_cash_paise:6000,fee_advance_paise:0});
 const bankPaid=await apply(bankFee.id,(await approve(bankFee.id)).id);assert.deepEqual(bankPaid.legs,[{location_id:bankLocation.id,direction:'out',amount_paise:'6000'}]);
 const bankCapture=await capture(),bankFrame=bankCapture.source_snapshot.finance as {totals:{fee_direct_paid_paise:string;fee_cash_paid_paise:string;fee_noncash_paid_paise:string;remaining_fee_paise:string};fee_positions:{earning_id:string;direct_paid_paise:string;cash_paid_paise:string;noncash_paid_paise:string}[];financial_effects:{fee_earning_id:string|null;payment_method:string|null}[]};
 assert.equal(bankFrame.totals.fee_direct_paid_paise,'9000');assert.equal(bankFrame.totals.fee_cash_paid_paise,'3000');assert.equal(bankFrame.totals.fee_noncash_paid_paise,'6000');assert.equal(bankFrame.totals.remaining_fee_paise,'1000');
 assert.deepEqual(bankFrame.fee_positions.find(f=>f.earning_id===agreedEarning)&&{direct:bankFrame.fee_positions.find(f=>f.earning_id===agreedEarning)!.direct_paid_paise,cash:bankFrame.fee_positions.find(f=>f.earning_id===agreedEarning)!.cash_paid_paise,noncash:bankFrame.fee_positions.find(f=>f.earning_id===agreedEarning)!.noncash_paid_paise},{direct:'6000',cash:'0',noncash:'6000'});
 assert.equal(bankFrame.financial_effects.find(f=>f.fee_earning_id===agreedEarning)!.payment_method,'upi');assert.equal((bankCapture.source_snapshot.totals as {expected_paise:string}).expected_paise,'0');

});
