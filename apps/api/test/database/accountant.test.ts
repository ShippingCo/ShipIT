import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentSetup,collectionInput,paymentFault} from '../payment-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {createAccountantService} from '../../src/modules/reports/accountant-service.ts';
import type {AccountantPage,AccountantExport} from '@shippingco/shared';
const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
async function setup(t:Parameters<typeof paymentSetup>[0]) {
 const s=await paymentSetup(t,100000);await s.db.prepareReports();await s.db.prepareMoneyReceipts();await s.db.prepareAgentMoney();await s.db.prepareReconciliation();
 const day=((await s.db.adminQuery<{day:string}>("SELECT (confirmed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day FROM shipit.bookings WHERE id=$1",[s.bookingId])).rows[0]!.day),filter={from_day:day,to_day:day},service=createAccountantService(s.pool);
 const call=(method:'GET'|'POST',path='',body:unknown=filter,actor:{id:string;token:string}=s.local,key=randomUUID(),query=q)=>s.app.inject({method,url:'/api/v1/reports/accountant'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(method==='POST'?{payload:JSON.stringify(body)}:{})});
 return {...s,service,filter,call};
}
await test('accountant snapshot independently reconciles one sale, partial receipts, corrections and retained exports',{timeout:60000},async t=>{
 const s=await setup(t);
 const a=await s.pay(collectionInput(60000));assert.equal(a.statusCode,200,a.body);
 const b=await s.pay(collectionInput(40000));assert.equal(b.statusCode,200,b.body);
 const capture=await s.call('POST');assert.equal(capture.statusCode,200,capture.body);const p=capture.json<AccountantPage>();
 assert.equal(p.rows.filter(r=>r.family==='sales').length,1);
 assert.equal(p.rows.filter(r=>r.family==='legacy_receipts').length,2);
 assert.equal(p.rows.find(r=>r.family==='booking_positions'&&r.fields.position==='closing')?.fields.outstanding_paise,'0');
 assert.ok(p.snapshot.controls.every(c=>c.difference_paise==='0'));
 const exported=await s.call('GET','/'+p.snapshot.id+'/export');assert.equal(exported.statusCode,200,exported.body);const e=exported.json<AccountantExport>();assert.ok(e.files.some(f=>f.name==='manifest.csv'));
 const repeated=await s.call('POST');assert.equal(repeated.statusCode,200,repeated.body);assert.deepEqual(repeated.json<AccountantPage>().rows,p.rows);
 const reversed=await s.reverse(a.json().entry.id,10000);assert.equal(reversed.statusCode,200,reversed.body);
 const corrected=await s.call('POST');assert.equal(corrected.statusCode,200,corrected.body);
 assert.equal(corrected.json<AccountantPage>().rows.find(r=>r.family==='booking_positions'&&r.fields.position==='closing')?.fields.outstanding_paise,'10000');
 assert.equal(corrected.json<AccountantPage>().rows.filter(r=>r.family==='sales').length,1);
 assert.deepEqual((await s.call('GET','/'+p.snapshot.id+'/export')).json(),e);
 assert.equal((await s.call('GET','/'+p.snapshot.id+'/export',undefined,s.admin)).statusCode,403);
 for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}])assert.equal((await s.call('GET','/'+p.snapshot.id+'/export',undefined,s.local,randomUUID(),query)).statusCode,404);
 const count=await s.paymentCounts();assert.equal(count!.entries,3);
});
await test('accountant exact replay, conflict, rollback, unknown properties and wrong artifact types',{timeout:60000},async t=>{
 const s=await setup(t),key=randomUUID();
 const one=await s.call('POST','',s.filter,s.local,key);assert.equal(one.statusCode,200,one.body);
 assert.deepEqual((await s.call('POST','',s.filter,s.local,key)).json(),one.json());
 assert.equal((await s.call('POST','',{...s.filter,include_references:true},s.local,key)).statusCode,409);
 assert.equal((await s.call('POST','',{...s.filter,actor_id:s.local.id})).statusCode,422);
 assert.equal((await s.call('POST','',{...s.filter,format:'unqualified_target'})).statusCode,422);
 const other=await s.app.inject({method:'POST',url:'/api/v1/reports/sales?'+new URLSearchParams(q),headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:JSON.stringify(s.filter)});assert.equal(other.statusCode,200,other.body);
 assert.equal((await s.call('GET','/'+other.json().snapshot.id)).statusCode,404);
 const failure=createAccountantService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before'));
 await assert.rejects(()=>failure.create(s.local.token,q,randomUUID(),headers,s.filter,randomUUID()));
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,2);
});

await test('accountant COD, advance, cash handover, UPI/card and expense families conserve source money',{timeout:60000},async t=>{
 const {setupAgentMoney}=await import('../agent-money-support.ts');const {createCashbookRequestService}=await import('../../src/modules/cashbook/request-service.ts');
 const s=await setupAgentMoney(t);await s.db.prepareReports();await s.db.prepareReconciliation();
 const service=createAccountantService(s.pool),day=new Date(s.clock().getTime()+19800000).toISOString().slice(0,10),filter={from_day:day,to_day:day};
 const account=await s.accounts.configure(s.local.token,null,q,randomUUID(),headers,{name:'Fictional card clearing',methods:['card'],other_method_name:null,active:true,expected_version:0},randomUUID());
 await s.receipts.record(s.local.token,q,randomUUID(),headers,{...s.receiptBody,account_id:account.id,amount_paise:500000,method:'card',receiver_id:s.operator.id,custodian_id:s.operator.id,allocations:[],external_reference:'=SYNTHETIC_FORMULA'},randomUUID());
 await s.receipts.record(s.local.token,q,randomUUID(),headers,{...s.receiptBody,account_id:s.upiAccount.id,amount_paise:30000,method:'upi',receiver_id:s.operator.id,custodian_id:s.operator.id,allocations:[]},randomUUID());
 const capture=await service.create(s.local.token,q,randomUUID(),headers,filter,randomUUID());
 const all=async(id:string)=>{const rows=[];let offset:number|null=0;while(offset!==null){const p=await service.read(s.local.token,id,{...q,offset:String(offset)},randomUUID()) as AccountantPage;rows.push(...p.rows);offset=p.next_offset;}return rows;};
 const before=await all(capture.snapshot.id),sum=(family:string,column:string,rows=before)=>rows.filter(r=>r.family===family).reduce((n,r)=>n+BigInt(r.fields[column]??0),0n);
 assert.equal(sum('receipts','received_paise'),740000n);assert.equal(sum('allocations','allocated_paise'),10000n);assert.equal(sum('cod_reservations','reserved_paise'),200000n);assert.equal(sum('sales','gross_paise'),50000n);
 assert.equal(before.filter(r=>r.family==='advance_positions'&&r.fields.position==='closing').reduce((n,r)=>n+BigInt(r.fields.unallocated_paise!),0n),530000n);
 assert.equal(before.find(r=>r.family==='cod_positions'&&r.fields.position==='closing')?.fields.remaining_paise,'200000');
 assert.ok(!JSON.stringify(before).includes('SYNTHETIC_FORMULA'));assert.equal(capture.snapshot.reconciliation_state,'disabled');
 const h=await s.handovers.request(s.local.token,q,randomUUID(),headers,await s.requestBody(),randomUUID());
 await s.handovers.respond(s.operator.token,h.id,q,randomUUID(),headers,{kind:'accept',expected_version:1,expected_source_version:(await s.position()).source_version,amount_paise:210000,currency:'INR',reason:'Fictional cash counted'},randomUUID());
 const requests=createCashbookRequestService(s.pool,true),position=await s.position();
 const request=await requests.submit(s.operator.token,q,randomUUID(),headers,{kind:'expense',payment_method:'cash',source_location_id:s.office.id,source_revision_id:s.office.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:position.source_version,amount_paise:10000,currency:'INR',category:'supplies',payee:'Fictional vendor',responsible_employee_id:s.operator.id,reason:'Fictional supplies',occurred_at:new Date(Date.now()-1).toISOString()},randomUUID());
 const decision=await requests.decide(s.local.token,request.id,q,randomUUID(),headers,{decision:'approved',reason:'Independent fictional review',expected_version:1},randomUUID());
 await s.effects.apply(s.local.token,request.id,q,randomUUID(),headers,{decision_id:decision.id,expected_version:2},randomUUID());
 const next=await service.create(s.local.token,q,randomUUID(),headers,{...filter,include_references:true},randomUUID()),after=await all(next.snapshot.id);
 assert.equal(sum('receipts','received_paise',after),740000n);assert.equal(sum('cashbook','expense_paise',after),10000n);assert.equal(sum('handover_acknowledgements','acknowledged_paise',after),210000n);
 assert.equal(after.filter(r=>r.family==='custody'&&r.fields.source_kind==='handover').reduce((n,r)=>n+BigInt(r.fields.custody_paise!),0n),0n);
 const bundle=await service.read(s.local.token,next.snapshot.id,q,randomUUID(),true) as AccountantExport;assert.ok(bundle.files.find(f=>f.name==='receipts.csv')!.csv.includes("'=SYNTHETIC_FORMULA"));assert.equal(bundle.snapshot.controls.every(c=>c.difference_paise==='0'),true);
 assert.deepEqual(await all(capture.snapshot.id),before);
});

await test('accountant access, exact concurrent recovery and expiry protect every saved scope',{timeout:60000},async t=>{
 const s=await setup(t),key=randomUUID();
 const pair=await Promise.all([s.call('POST','',s.filter,s.local,key),s.call('POST','',s.filter,s.local,key)]);pair.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(pair[0]!.json(),pair[1]!.json());const p=pair[0]!.json<AccountantPage>();
 const lostKey=randomUUID(),uncertain=createAccountantService(paymentFault(s.pool,'COMMIT','after'));await assert.rejects(uncertain.create(s.local.token,q,lostKey,['idempotency-key',lostKey],s.filter,randomUUID()));
 const recovered=await s.call('POST','',s.filter,s.local,lostKey);assert.equal(recovered.statusCode,200,recovered.body);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,2);
 for(const actor of [await s.grant('operator',[A]),await s.grant('read_only',[A]),await s.grant('accountant',[B])]){assert.notEqual((await s.call('POST','',s.filter,actor,key)).statusCode,200);assert.notEqual((await s.call('GET','/'+p.snapshot.id+'/export',undefined,actor)).statusCode,200);}
 const accountant=await s.grant('accountant',[A]);assert.equal((await s.call('GET','/'+p.snapshot.id,undefined,accountant)).statusCode,404);
 const own=await s.call('POST','',s.filter,accountant);assert.equal(own.statusCode,200,own.body);assert.equal((await s.call('GET','/'+own.json().snapshot.id+'/export',undefined,accountant)).statusCode,200);
 assert.equal((await s.call('POST','',{...s.filter,franchise_ids:[A,B]})).statusCode,404);
 const multi=await s.call('POST','',{...s.filter,franchise_ids:[A,B]},s.admin);assert.equal(multi.statusCode,200,multi.body);assert.equal((await s.call('GET','/'+multi.json().snapshot.id+'/export',undefined,s.admin)).statusCode,403);
 for(const body of [{...s.filter,to_day:'bad'},{...s.filter,franchise_ids:[A,A]},{...s.filter,from_day:'2026-02-30'}])assert.equal((await s.call('POST','',body)).statusCode,422);
 await s.db.adminQuery('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');
 await s.db.adminQuery("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[p.snapshot.id]);await s.db.adminQuery('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');
 assert.equal((await s.call('GET','/'+p.snapshot.id+'/export')).statusCode,404);assert.equal((await s.call('POST','',s.filter,s.local,key)).statusCode,410);
 const member=(await s.db.adminQuery("SELECT id,version FROM shipit.memberships WHERE user_id=$1 AND role='accountant'",[accountant.id])).rows[0]!;await s.memberships.revokeMembership(s.admin.token,member.id,{expected_version:member.version});
 assert.equal((await s.call('GET','/'+own.json().snapshot.id+'/export',undefined,accountant)).statusCode,404);
 assert.ok(!s.logs.join('').includes(s.local.token));assert.equal((await s.paymentCounts())!.entries,0);
});

await test('monthly statements, allocations, charge adjustments and refund corrections retain original sales',{timeout:60000},async t=>{
 const {statementSetup}=await import('../account-statement-support.ts');const {createMoneyReceiptService}=await import('../../src/modules/payments/receipt-service.ts');const {createReceivingAccountService}=await import('../../src/modules/payments/account-service.ts');const {createFinanceService}=await import('../../src/modules/reports/finance-service.ts');
 const s=await statementSetup(t);await s.db.prepareAgentMoney();await s.db.prepareReconciliation();const first=await s.book(),statement=await s.issue(),second=await s.book(),revision=await s.issue(),service=createAccountantService(s.pool);
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional month bank',methods:['bank_transfer'],other_method_name:null,active:true},randomUUID());
 await createMoneyReceiptService(s.pool).record(s.operator.token,q,randomUUID(),headers,{customer_id:s.source.id,account_id:account.id,expected_account_version:1,method:'bank_transfer',amount_paise:1200,currency:'INR',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date().toISOString(),external_reference:'PRIVATE_FICTIONAL_REFERENCE',allocations:[{booking_id:first.id,amount_paise:500,context:'to_pay',expected_payment_version:0},{booking_id:second.id,amount_paise:400,context:'to_pay',expected_payment_version:0}]},randomUUID());
 const filter={from_day:s.period.from_day,to_day:s.period.to_day},before=await service.create(s.local.token,q,randomUUID(),headers,filter,randomUUID());assert.equal(before.rows.filter(r=>r.family==='sales').length,2);assert.equal(before.rows.filter(r=>r.family==='receipts').length,1);assert.equal(before.rows.filter(r=>r.family==='allocations').length,2);
 assert.equal(before.rows.filter(r=>r.family==='statement_shipments').length,3);assert.ok(before.rows.some(r=>r.family==='statements'&&r.fields.source_id===revision.id&&r.fields.correction_of===statement.id));assert.ok(before.rows.filter(r=>r.family==='statements').every(r=>r.fields.document_type==='account_statement_v2'));
 const finance=createFinanceService(s.pool),tax=first.charges.tax;
 await finance.change(s.local.token,q,randomUUID(),headers,{booking_id:first.id,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYNTHETIC_REVIEW',pre_tax:tax.pre_tax_paise,taxable:tax.taxable_basis_paise,cgst:tax.cgst_paise,sgst:tax.sgst_paise,igst:tax.igst_paise,rounding:tax.rounding_adjustment_paise},randomUUID());
 const refund=await finance.change(s.local.token,q,randomUUID(),headers,{booking_id:first.id,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',approval_ref:'SYNTHETIC_REVIEW',returned_to_ref:'SYNTHETIC_RETURN',refund:400},randomUUID());
 const after=await service.create(s.local.token,q,randomUUID(),headers,filter,randomUUID());assert.equal(after.rows.filter(r=>r.family==='sales').length,2);assert.deepEqual(after.rows.filter(r=>r.family==='sales'),before.rows.filter(r=>r.family==='sales'));assert.equal(after.rows.find(r=>r.family==='refunds'&&r.fields.source_id===refund.id)?.fields.refunded_paise,'400');
 assert.equal(after.rows.find(r=>r.family==='booking_positions'&&r.fields.source_id===first.id&&r.fields.position==='closing')?.fields.refundable_paise,'100');assert.ok(after.snapshot.controls.every(c=>c.difference_paise==='0'));
 assert.deepEqual(await service.read(s.local.token,before.snapshot.id,q,randomUUID()),before);assert.ok(!JSON.stringify(after).includes('PRIVATE_FICTIONAL_REFERENCE'));
});

await test('net card reconciliation preserves gross, fee, net and lineage when new reconciliation is disabled',{timeout:60000},async t=>{
 const {setupCashClose}=await import('../cash-close-support.ts');const {createReconciliationService}=await import('../../src/modules/reconciliation/service.ts');
 const s=await setupCashClose(t);await s.db.prepareReports();await s.db.prepareReconciliation();const reconcile=createReconciliationService(s.pool,true),register=createAccountantService(s.pool);
 const account=await s.accounts.configure(s.local.token,null,q,randomUUID(),headers,{name:'Fictional card clearing',methods:['card','bank_transfer'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const location=await s.locations.configure(s.local.token,null,q,randomUUID(),headers,{account_id:account.id,expected_account_version:1,custodian_id:null,name:'Fictional noncash location',active:true,expected_version:0},randomUUID());
 const receipt=await s.receipts.record(s.operator.token,q,randomUUID(),headers,{...s.receiptBody,account_id:account.id,amount_paise:500000,method:'card',external_reference:'PRIVATE_CARD_GROSS'},randomUUID());
 const request=await s.requests.submit(s.operator.token,q,randomUUID(),headers,{kind:'expense',source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,payment_method:'bank_transfer',expected_source_version:(await s.effects.position(s.local.token,q,randomUUID())).source_version,amount_paise:10000,currency:'INR',category:'other',payee:'Fictional processor',responsible_employee_id:s.operator.id,reason:'Actual evidenced fee',occurred_at:s.receiptBody.occurred_at},randomUUID());
 const decision=await s.requests.decide(s.local.token,request.id,q,randomUUID(),headers,{decision:'approved',reason:'Independent fee review',expected_version:1},randomUUID());await s.effects.apply(s.local.token,request.id,q,randomUUID(),headers,{decision_id:decision.id,expected_version:2},randomUUID());
 await reconcile.configure(s.local.token,q,randomUUID(),headers,{expected_version:0,enabled:true,reason:'Fictional import review'},randomUUID());
 const mapping=await reconcile.publishMapping(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional bank CSV',identity_namespace:'FICTIONAL',date_column:'Date',date_format:'yyyy-mm-dd',amount:{mode:'signed',unit:'rupees',amount_column:'Amount',positive_direction:'credit'},reference_column:'Ref',identity_column:'ID',currency_column:null},randomUUID());
 const preview=await reconcile.preview(s.local.token,q,randomUUID(),headers,{account_id:account.id,mapping_id:mapping.id,period_from:s.day,period_to:s.day,content_base64:Buffer.from('Date,Amount,Ref,ID\n'+s.day+',4900,PRIVATE_NET,FICTIONAL_BANK_ID').toString('base64')},randomUUID());await reconcile.commitImport(s.local.token,preview.id,q,randomUUID(),headers,{rows:[2]},randomUUID());
 const transaction=(await reconcile.readImport(s.local.token,preview.id,q,randomUUID())).outcomes[0]!.transaction_id;
 const line=async(id:string,amount_paise:number)=>{const source=(await s.db.adminQuery<{version:string}>('SELECT version FROM shipit.reconciliation_recorded_sources WHERE id=$1',[id])).rows[0]!;return {source_id:id,source_version:source.version,amount_paise};};
 const receipts=[await line('receipt:'+receipt.receipt_id,500000)],fees=[await line('cashbook:'+request.id+':'+location.id,10000)];
 const batch=await reconcile.saveBatch(s.local.token,null,q,randomUUID(),headers,{expected_version:0,account_id:account.id,expected_date:s.day,reference:'PRIVATE_NET',reason:'Fictional 5000 less 100 fee',receipts,fees},randomUUID());
 await reconcile.confirmMatch(s.local.token,q,randomUUID(),headers,{account_id:account.id,method:'manual',reason:'Reviewed gross less actual fee equals net',batch_id:batch.id,transactions:[{transaction_id:transaction,amount_paise:490000}],sources:receipts,fees},randomUUID());
 const captured=await register.create(s.local.token,q,randomUUID(),headers,{from_day:s.day,to_day:s.day},randomUUID());
 const actual=captured.rows.find(r=>r.family==='reconciliation'&&r.fields.kind==='transaction')!;assert.equal(actual.fields.recorded_paise,'490000');assert.equal(actual.fields.matched_paise,'490000');assert.equal(actual.fields.state,'verified');assert.ok(actual.fields.evidence!.includes(receipt.receipt_id));assert.ok(!JSON.stringify(captured).includes('PRIVATE_'));
 const batchRow=captured.rows.find(r=>r.family==='reconciliation'&&r.fields.kind==='batch')!;const evidence=JSON.parse(batchRow.fields.evidence!);assert.equal(evidence.receipts[0].amount_paise,'500000');assert.equal(evidence.fees[0].amount_paise,'10000');
 await reconcile.configure(s.local.token,q,randomUUID(),headers,{expected_version:1,enabled:false,reason:'Disable new imports, retain evidence'},randomUUID());
 const disabled=await register.create(s.local.token,q,randomUUID(),headers,{from_day:s.day,to_day:s.day},randomUUID());assert.equal(disabled.snapshot.reconciliation_state,'disabled');assert.deepEqual(disabled.rows.filter(r=>r.family==='reconciliation'),captured.rows.filter(r=>r.family==='reconciliation'));assert.equal(disabled.rows.filter(r=>r.family==='receipts').length,1);assert.equal(disabled.rows.filter(r=>r.family==='cashbook').length,1);assert.ok(disabled.snapshot.controls.every(c=>c.difference_paise==='0'));
});

await test('concurrent different captures cannot exceed active quota; empty bundles and control drill-through stay exact',{timeout:60000},async t=>{
 const s=await setup(t),empty={from_day:'2000-01-01',to_day:'2000-01-01'};
 const first=await s.call('POST','',empty);assert.equal(first.statusCode,200,first.body);assert.equal(first.json().snapshot.count,0);
 const bundle=(await s.call('GET','/'+first.json().snapshot.id+'/export')).json<AccountantExport>();assert.ok(bundle.files.find(f=>f.name==='sales.csv')!.csv.startsWith('"schema_version"'));
 const populated=await s.call('POST');assert.equal(populated.statusCode,200,populated.body);const p=populated.json<AccountantPage>(),index=p.snapshot.controls.findIndex(c=>c.family==='sales'&&c.column==='gross_paise');assert.ok(index>=0);
 const drill=await s.app.inject({method:'GET',url:'/api/v1/reports/accountant/'+p.snapshot.id+'?'+new URLSearchParams({...q,control:String(index)}),cookies:s.cookies(s.local.token)});assert.equal(drill.statusCode,200,drill.body);const evidence=drill.json<AccountantPage>();assert.equal(evidence.rows.reduce((n,r)=>n+BigInt(r.fields.gross_paise!),0n).toString(),p.snapshot.controls[index]!.source_paise);
 for(let i=2;i<19;i++){const r=await s.call('POST','',empty);assert.equal(r.statusCode,200,r.body);}
 const race=await Promise.all([s.call('POST','',empty),s.call('POST','',empty)]);assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,429]);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,20);
});

await test('combined register row bound and saved pagination reject overflow without partial artifacts',{timeout:60000},async t=>{
 const s=await setup(t),owner=s.db.ownerPool();
 // Disposable owner-only query fixture; keep FKs/checks but bypass source command triggers.
 await owner.query('BEGIN');
 try{
  for(const table of ['booking_commands','bookings','booking_obligations'])await owner.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER USER`);
  await owner.query('CREATE TEMP TABLE accountant_seed AS SELECT gen_random_uuid() id,gen_random_uuid() command,gen_random_uuid() obligation,n FROM generate_series(1,2498) n');
  for(let first=1;first<=2498;first+=250){
   await owner.query(`INSERT INTO shipit.booking_commands SELECT (jsonb_populate_record(NULL::shipit.booking_commands,to_jsonb(c)||jsonb_build_object('id',s.command,'booking_id',s.id,'key_digest',md5(s.id::text)||md5(s.id::text),'state','reserved','http_status',NULL,'result',NULL,'committed_at',NULL,'retain_until',NULL))).* FROM shipit.booking_commands c CROSS JOIN accountant_seed s WHERE c.booking_id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
   await owner.query(`INSERT INTO shipit.bookings SELECT (jsonb_populate_record(NULL::shipit.bookings,to_jsonb(b)||jsonb_build_object('id',s.id,'command_id',s.command,'parcel_set_ref',s.id))).* FROM shipit.bookings b CROSS JOIN accountant_seed s WHERE b.id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
   await owner.query(`INSERT INTO shipit.booking_obligations SELECT (jsonb_populate_record(NULL::shipit.booking_obligations,to_jsonb(o)||jsonb_build_object('id',s.obligation,'booking_id',s.id))).* FROM shipit.booking_obligations o CROSS JOIN accountant_seed s WHERE o.booking_id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
  }
  await owner.query('SET CONSTRAINTS ALL IMMEDIATE');for(const table of ['booking_commands','bookings','booking_obligations'])await owner.query(`ALTER TABLE shipit.${table} ENABLE TRIGGER USER`);await owner.query('COMMIT');
 }catch(error){await owner.query('ROLLBACK');throw error;}
 const captured=await s.call('POST');assert.equal(captured.statusCode,200,captured.body);const p=captured.json<AccountantPage>();assert.equal(p.snapshot.count,5000);assert.equal(p.rows.length,100);assert.equal(p.next_offset,100);
 const second=await s.service.read(s.local.token,p.snapshot.id,{...q,offset:'100'},randomUUID()) as AccountantPage;assert.equal(second.rows.length,100);assert.ok(second.rows.every(r=>!p.rows.some(first=>first.id===r.id)));
 assert.equal(p.snapshot.controls.find(c=>c.family==='sales'&&c.column==='gross_paise')?.source_paise,'249900000');
 // The next day adds one opening position for every booking: overflow must not save anything.
 const date=new Date(s.filter.to_day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);const day=date.toISOString().slice(0,10);
 const oversized=await s.call('POST','',{from_day:day,to_day:day});assert.equal(oversized.statusCode,413,oversized.body);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
 const bundle=await s.service.read(s.local.token,p.snapshot.id,q,randomUUID(),true) as AccountantExport;assert.equal(bundle.files.find(f=>f.name==='sales.csv')!.csv.split('\r\n').length,2501);
});
