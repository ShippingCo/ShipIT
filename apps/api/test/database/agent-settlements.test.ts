import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {withTransaction,type QueryExecutor} from '@shippingco/db';
import {provisionDatabase} from '../../../../packages/db/test/support.ts';
import {paymentSetup,paymentFault} from '../payment-support.ts';
import {createAgentCodService} from '../../src/modules/agent-settlements/cod-service.ts';
import {org,A,B} from '../audit-support.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
const headers=(key:string)=>['idempotency-key',key],q={organization_id:org,franchise_id:A};
const hash=()=>createHash('sha256').update(randomUUID()).digest('hex');
await test('agent money migration creates empty private owned sources and supports a no-op rerun',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.equal((await db.migrate()).applied,49);
 for(const table of ['agent_settlement_submissions','agent_settlement_decisions','agent_settlement_events','agent_daily_cash_captures','agent_money_commands','cod_beneficiaries','cod_beneficiary_revisions','cod_obligations','cod_obligation_revisions','cod_receipt_allocations','agent_fee_term_revisions','agent_fee_earnings','cash_receipt_component_captures','cash_receipt_components','cash_handover_attributions']){
  assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
  assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'SELECT\') allowed',[db.runtimeRole,'shipit.'+table])).rows[0]!.allowed,false);
 }
 assert.equal((await db.migrate()).applied,0);
});
await test('real receipt and COD writers share capacity under a race and retain immutable prior receipt replay',{timeout:60000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareAgentMoney();
 const accountService=createReceivingAccountService(s.pool),receipts=createMoneyReceiptService(s.pool),key=randomUUID();
 const account=await accountService.configure(s.local.token,null,q,key,headers(key),{name:'Synthetic COD cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const receiptKey=randomUUID(),body={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:210000,currency:'INR',method:'cash',receiver_id:s.local.id,custodian_id:s.local.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:null,
  allocations:[{booking_id:s.bookingId,amount_paise:10000,context:'to_pay',expected_payment_version:0}]};
 const receipt=await receipts.record(s.local.token,q,receiptKey,headers(receiptKey),body,randomUUID());
 const parcel=(await s.db.adminQuery('SELECT id FROM shipit.parcels WHERE booking_id=$1 ORDER BY id LIMIT 1',[s.bookingId])).rows[0]!.id;
 async function fact(operation:string,resource:string,input:Record<string,unknown>,write:(tx:QueryExecutor,command:string)=>Promise<unknown>,actor=s.local.id){
  return withTransaction(s.pool,async tx=>{
   const command=randomUUID();await write(tx,command);
   await tx.query(`INSERT INTO shipit.agent_money_commands(id,organization_id,franchise_id,actor_id,operation,correlation_id,key_digest,fingerprint,input,result)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,jsonb_build_object('command_id',$1::uuid,'resource_id',$10::uuid,'recorded_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,[command,org,A,actor,operation,randomUUID(),hash(),hash(),JSON.stringify(input),resource]);return command;
  });
 }
 const beneficiary=randomUUID(),beneficiaryRevision=randomUUID();
 await fact('configure_beneficiary',beneficiaryRevision,{beneficiary_id:beneficiary,expected_version:0,name:'Synthetic seller',active:true},async(tx,c)=>{
  await tx.query('INSERT INTO shipit.cod_beneficiaries(id,organization_id,franchise_id) VALUES($1,$2,$3)',[beneficiary,org,A]);
  await tx.query('INSERT INTO shipit.cod_beneficiary_revisions(id,organization_id,franchise_id,beneficiary_id,version,name,active,command_id) VALUES($1,$2,$3,$4,1,$5,true,$6)',[beneficiaryRevision,org,A,beneficiary,'Synthetic seller',c]);
 });
 const obligation=randomUUID(),revision=randomUUID();
 await fact('configure_cod',revision,{obligation_id:obligation,booking_id:s.bookingId,parcel_id:parcel,expected_version:0,beneficiary_id:beneficiary,beneficiary_revision_id:beneficiaryRevision,amount_paise:200000,currency:'INR',active:true},async(tx,c)=>{
  await tx.query('INSERT INTO shipit.cod_obligations(id,organization_id,franchise_id,booking_id,parcel_id) VALUES($1,$2,$3,$4,$5)',[obligation,org,A,s.bookingId,parcel]);
  await tx.query('INSERT INTO shipit.cod_obligation_revisions(id,organization_id,franchise_id,obligation_id,version,beneficiary_id,beneficiary_revision_id,amount_paise,currency,active,command_id) VALUES($1,$2,$3,$4,1,$5,$6,200000,\'INR\',true,$7)',[revision,org,A,obligation,beneficiary,beneficiaryRevision,c]);
 });
 async function reserve(amount:number){const id=randomUUID();return fact('reserve_cod',id,{receipt_id:receipt.receipt_id,obligation_id:obligation,obligation_revision_id:revision,amount_paise:amount,currency:'INR'},(tx,c)=>tx.query('INSERT INTO shipit.cod_receipt_allocations(id,organization_id,franchise_id,receipt_id,obligation_id,obligation_revision_id,amount_paise,currency,command_id) VALUES($1,$2,$3,$4,$5,$6,$7,\'INR\',$8)',[id,org,A,receipt.receipt_id,obligation,revision,amount,c]));}
 await reserve(199000);
 const race=await Promise.allSettled([reserve(1000),reserve(1000)]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected'&&x.reason.sqlState==='23514').length,1);
 assert.equal((await s.db.adminQuery('SELECT sum(amount_paise)::text n FROM shipit.cod_receipt_allocations')).rows[0]!.n,'200000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_money_commands')).rows[0]!.n,4);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action LIKE 'agent_money.%'")).rows[0]!.n,4);
 const moreKey=randomUUID();await assert.rejects(receipts.allocate(s.local.token,receipt.receipt_id,q,moreKey,headers(moreKey),{expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:1,context:'to_pay',expected_payment_version:1}]},randomUUID()),{code:'ALLOCATION_CONFLICT'});
 assert.equal((await s.db.adminQuery('SELECT sum(amount_paise)::text n FROM shipit.money_receipt_allocations')).rows[0]!.n,'10000');
 assert.deepEqual(await receipts.record(s.local.token,q,receiptKey,headers(receiptKey),body,randomUUID()),receipt);
 assert.equal(receipt.unallocated_paise,200000); // Original result is historical, not free COD capacity.
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,1);
 await assert.rejects(s.pool.query('UPDATE shipit.cod_receipt_allocations SET amount_paise=1'),{sqlState:'42501'});
 const owner=s.db.ownerPool();
 await assert.rejects(owner.query('UPDATE shipit.cod_receipt_allocations SET amount_paise=1'),{sqlState:'23514'});
 await assert.rejects(s.pool.query('DELETE FROM shipit.cod_obligation_revisions'),{sqlState:'42501'});
 await assert.rejects(owner.query('DELETE FROM shipit.cod_obligation_revisions'),{sqlState:'23514'});await owner.close();
 await assert.rejects(s.pool.query('INSERT INTO shipit.cod_receipt_allocations(id,organization_id,franchise_id,receipt_id,obligation_id,obligation_revision_id,amount_paise,currency,command_id) SELECT $1,$2,$3,$4,$5,$6,1,\'INR\',$7',[randomUUID(),org,B,receipt.receipt_id,obligation,revision,randomUUID()]));
 await assert.rejects(fact('reserve_cod',randomUUID(),{},async()=>{}),{code:'DB_COMMIT_UNCERTAIN'});
 await assert.rejects(s.pool.query('INSERT INTO shipit.cod_beneficiaries(id,organization_id,franchise_id) VALUES($1,$2,$3)',[randomUUID(),org,A]),{sqlState:'23514'});
 const invalidRevision=randomUUID();await assert.rejects(fact('configure_cod',invalidRevision,{obligation_id:obligation,booking_id:s.bookingId,parcel_id:parcel,expected_version:1,beneficiary_id:beneficiary,beneficiary_revision_id:beneficiaryRevision,amount_paise:200001,currency:'INR',active:true},(tx,c)=>tx.query('INSERT INTO shipit.cod_obligation_revisions(id,organization_id,franchise_id,obligation_id,version,beneficiary_id,beneficiary_revision_id,amount_paise,currency,active,command_id) VALUES($1,$2,$3,$4,2,$5,$6,200001,\'INR\',true,$7)',[invalidRevision,org,A,obligation,beneficiary,beneficiaryRevision,c])));
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_money_commands')).rows[0]!.n,4);
});

await test('COD services enforce current roles and source ownership, preserve exact retries and roll back or recover uncertain commands',{timeout:60000},async t=>{
 const s=await paymentSetup(t,50000);await s.db.prepareAgentMoney();
 const service=createAgentCodService(s.pool,true),disabled=createAgentCodService(s.pool),operator=await s.grant('operator',[A]),sibling=await s.grant('franchise_admin',[B]);
 const beneficiaryBody={expected_version:0,name:'Synthetic seller',active:true},beneficiaryKey=randomUUID();
 const beneficiary=await service.configureBeneficiary(s.local.token,null,q,beneficiaryKey,headers(beneficiaryKey),beneficiaryBody,randomUUID());assert.match(beneficiary.recorded_at,/\.\d{3}Z$/);
 assert.deepEqual(await disabled.configureBeneficiary(s.local.token,null,q,beneficiaryKey,headers(beneficiaryKey),beneficiaryBody,randomUUID()),beneficiary);
 await assert.rejects(disabled.configureBeneficiary(s.local.token,null,q,randomUUID(),headers('disabled'),beneficiaryBody,randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 await assert.rejects(service.configureBeneficiary(s.local.token,null,q,beneficiaryKey,headers(beneficiaryKey),{...beneficiaryBody,name:'Different seller'},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 for(const actor of [operator,s.admin])await assert.rejects(service.configureBeneficiary(actor.token,null,q,randomUUID(),headers('denied'),beneficiaryBody,randomUUID()),{code:'ACTION_FORBIDDEN'});
 for(const role of ['accountant','read_only','dispatcher','delivery_agent']){
  const actor=await s.grant(role,[A]);await assert.rejects(service.configureBeneficiary(actor.token,null,q,randomUUID(),headers('denied'),beneficiaryBody,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(service.reserve(actor.token,q,randomUUID(),headers('denied'),{receipt_id:randomUUID(),obligation_id:randomUUID(),obligation_revision_id:randomUUID(),amount_paise:1,currency:'INR'},randomUUID()),{code:'ACTION_FORBIDDEN'});
 }
 const beneficiaryId=(await s.db.adminQuery('SELECT beneficiary_id FROM shipit.cod_beneficiary_revisions WHERE id=$1',[beneficiary.resource_id])).rows[0]!.beneficiary_id;
 const parcel=(await s.db.adminQuery('SELECT id FROM shipit.parcels WHERE booking_id=$1 ORDER BY id LIMIT 1',[s.bookingId])).rows[0]!.id;
 const codBody={booking_id:s.bookingId,parcel_id:parcel,expected_version:0,beneficiary_id:beneficiaryId,beneficiary_revision_id:beneficiary.resource_id,amount_paise:200000,currency:'INR',active:true},codKey=randomUUID();
 await assert.rejects(service.configureCod(sibling.token,null,{...q,franchise_id:B},codKey,headers(codKey),codBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const cod=await service.configureCod(s.local.token,null,q,codKey,headers(codKey),codBody,randomUUID());
 const obligation=(await s.db.adminQuery('SELECT obligation_id FROM shipit.cod_obligation_revisions WHERE id=$1',[cod.resource_id])).rows[0]!.obligation_id;
 const accountKey=randomUUID(),account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic actual cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const receiptKey=randomUUID(),receipt=await createMoneyReceiptService(s.pool).record(s.local.token,q,receiptKey,headers(receiptKey),{customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:210000,currency:'INR',method:'cash',receiver_id:s.local.id,custodian_id:s.local.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:null,allocations:[{booking_id:s.bookingId,amount_paise:10000,context:'to_pay',expected_payment_version:0}]},randomUUID());
 const reserveBody={receipt_id:receipt.receipt_id,obligation_id:obligation,obligation_revision_id:cod.resource_id,amount_paise:200000,currency:'INR'},reserveKey=randomUUID();
 const counts=async()=>(await s.db.adminQuery('SELECT (SELECT count(*)::int FROM shipit.agent_money_commands) commands,(SELECT count(*)::int FROM shipit.cod_receipt_allocations) allocations,(SELECT sum(amount_paise)::text FROM shipit.cod_receipt_allocations) total')).rows[0];
 const before=await counts();await assert.rejects(createAgentCodService(paymentFault(s.pool,'INSERT INTO shipit.cod_receipt_allocations','before'),true).reserve(operator.token,q,reserveKey,headers(reserveKey),reserveBody,randomUUID()));assert.deepEqual(await counts(),before);
 const duplicates=await Promise.all([0,1].map(()=>service.reserve(operator.token,q,reserveKey,headers(reserveKey),reserveBody,randomUUID())));assert.deepEqual(duplicates[0],duplicates[1]);
 assert.deepEqual(await counts(),{commands:3,allocations:1,total:'200000'});
 assert.deepEqual(await disabled.reserve(operator.token,q,reserveKey,headers(reserveKey),reserveBody,randomUUID()),duplicates[0]);
 await assert.rejects(service.reserve(operator.token,q,reserveKey,headers(reserveKey),{...reserveBody,amount_paise:199999},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(service.reserve(operator.token,q,randomUUID(),headers('full'),{...reserveBody,amount_paise:1},randomUUID()),{code:'ALLOCATION_CONFLICT'});
 await assert.rejects(service.reserve(sibling.token,{...q,franchise_id:B},reserveKey,headers(reserveKey),reserveBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await s.memberships.revokeMembership(s.admin.token,operator.member.id,{expected_version:operator.member.version});
 await assert.rejects(service.reserve(operator.token,q,reserveKey,headers(reserveKey),reserveBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const uncertainKey=randomUUID(),uncertainBody={...beneficiaryBody,name:'Synthetic second seller'};
 await assert.rejects(createAgentCodService(paymentFault(s.pool,'COMMIT','after'),true).configureBeneficiary(s.local.token,null,q,uncertainKey,headers(uncertainKey),uncertainBody,randomUUID()));
 const committed=await counts();assert.equal(committed!.commands,4);
 const recovered=await disabled.configureBeneficiary(s.local.token,null,q,uncertainKey,headers(uncertainKey),uncertainBody,randomUUID());assert.ok(recovered.resource_id);assert.deepEqual(await counts(),committed);
});

await test('populated migration47 upgrades preserve genuine customer money and leave historic COD unknown',{timeout:60000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:47}),{applied:47});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});t.after(()=>{db.migrate=migrate;});
 const s=await paymentSetup(t,50000,db);await db.prepareMoneyReceipts();
 const accountKey=randomUUID(),account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,accountKey,headers(accountKey),{name:'Synthetic legacy cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const receiptKey=randomUUID(),body={customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:210000,currency:'INR',method:'cash',receiver_id:s.local.id,custodian_id:s.local.id,occurred_at:new Date(Date.now()-1000).toISOString(),external_reference:null,allocations:[{booking_id:s.bookingId,amount_paise:10000,context:'to_pay',expected_payment_version:0}]};
 const service=createMoneyReceiptService(s.pool),receipt=await service.record(s.local.token,q,receiptKey,headers(receiptKey),body,randomUUID());
 // Populate genuine released47 expense evidence through its original SQL guards.
 // Current request submission includes a new48 column and cannot target old47.
 await db.prepareCashbook();const {createCashLocationService}=await import('../../src/modules/cashbook/location-service.ts'),{createCashbookRequestService}=await import('../../src/modules/cashbook/request-service.ts'),{createCashbookEffectService}=await import('../../src/modules/cashbook/effect-service.ts');
 const locations=createCashLocationService(s.pool,true),requests=createCashbookRequestService(s.pool,true),effects=createCashbookEffectService(s.pool,true),reviewer=await s.grant('franchise_admin',[A]);
 const locationKey=randomUUID(),location=await locations.configure(s.local.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:s.local.id,name:'Synthetic released47 till',active:true,expected_version:0},randomUUID());
 const request=randomUUID(),generation=(await effects.position(s.local.token,q,randomUUID())).source_version;
 await withTransaction(s.pool,tx=>tx.query(`INSERT INTO shipit.cashbook_requests(id,organization_id,franchise_id,kind,source_location_id,source_revision_id,expected_source_version,amount_paise,currency,payment_method,category,payee,responsible_employee_id,reason,occurred_at,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,'expense',$4,$5,$6,500,'INR','cash','supplies','Synthetic released47 supplier',$7,'Synthetic actual expense voucher',clock_timestamp()-interval '1 second',$7,$8,$9,$10)`,[request,org,A,location.id,location.revision_id,generation,s.local.id,randomUUID(),hash(),hash()]));
 const reviewKey=randomUUID(),decision=await requests.decide(reviewer.token,request,q,reviewKey,headers(reviewKey),{expected_version:1,decision:'approved',reason:'Synthetic different-admin voucher check'},randomUUID());
 const applyKey=randomUUID(),applied=await effects.apply(s.local.token,request,q,applyKey,headers(applyKey),{expected_version:2,decision_id:decision.id},randomUUID());assert.deepEqual(applied.legs,[{location_id:location.id,direction:'out',amount_paise:'500'}]);
 const expenses=async()=>({requests:(await db.adminQuery("SELECT to_jsonb(r)-ARRAY['agent_payee_id','fee_earning_id','fee_cash_paise','fee_advance_paise','fee_advance_request_id','cod_allocation_id','payment_reference'] fact FROM shipit.cashbook_requests r ORDER BY id")).rows,decisions:(await db.adminQuery('SELECT * FROM shipit.cashbook_request_decisions ORDER BY id')).rows,effects:(await db.adminQuery('SELECT * FROM shipit.cashbook_effects ORDER BY id')).rows,legs:(await db.adminQuery('SELECT * FROM shipit.cashbook_effect_legs ORDER BY effect_id,location_id')).rows});
 const beforeExpenses=await expenses();
 const snapshot=async()=>({receipts:(await db.adminQuery('SELECT * FROM shipit.money_receipts ORDER BY id')).rows,allocations:(await db.adminQuery('SELECT * FROM shipit.money_receipt_allocations ORDER BY id')).rows,commands:(await db.adminQuery('SELECT * FROM shipit.money_receipt_commands ORDER BY id')).rows,payments:(await db.adminQuery('SELECT * FROM shipit.payment_entries ORDER BY id')).rows,events:(await db.adminQuery('SELECT * FROM shipit.domain_events ORDER BY event_id')).rows});
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await snapshot(),before);assert.deepEqual(await expenses(),beforeExpenses);assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_requests WHERE agent_payee_id IS NOT NULL OR fee_earning_id IS NOT NULL OR fee_cash_paise IS NOT NULL OR fee_advance_paise IS NOT NULL OR fee_advance_request_id IS NOT NULL OR cod_allocation_id IS NOT NULL OR payment_reference IS NOT NULL')).rows[0]!.n,0);
 assert.deepEqual(await createCashbookEffectService(s.pool).apply(s.local.token,request,q,applyKey,headers(applyKey),{expected_version:2,decision_id:decision.id},randomUUID()),applied);
 for(const table of ['cod_beneficiaries','cod_obligations','cod_receipt_allocations','agent_money_commands','agent_fee_term_revisions','agent_fee_earnings'])assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.'+table)).rows[0]!.n,0);
 assert.deepEqual(await service.record(s.local.token,q,receiptKey,headers(receiptKey),body,randomUUID()),receipt);
 await db.prepareMoneyReceipts();const allocationKey=randomUUID();
 const allocated=await service.allocate(s.local.token,receipt.receipt_id,q,allocationKey,headers(allocationKey),{expected_version:1,allocations:[{booking_id:s.bookingId,amount_paise:1,context:'to_pay',expected_payment_version:1}]},randomUUID());
 assert.equal(allocated.allocated_paise,10001);assert.equal(allocated.unallocated_paise,199999);assert.deepEqual(await db.migrate(),{applied:0});
});
