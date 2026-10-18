import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {DailyPage} from '@shippingco/shared';
import type {DatabasePool} from '@shippingco/db';
import {paymentSetup,collectionInput,paymentFault} from '../payment-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {createDailyService} from '../../src/modules/reports/daily-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createFinanceService} from '../../src/modules/reports/finance-service.ts';
const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
async function setup(t:Parameters<typeof paymentSetup>[0]) {
 const s=await paymentSetup(t,100000);await s.db.prepareReports();await s.db.prepareMoneyReceipts();
 const day=new Date(Date.now()+19800000).toISOString().slice(0,10),start=Date.parse(day+'T00:00:00+05:30');
 // Only disposable fictional records are moved to historical instants. Runtime cannot edit them.
 const owner=s.db.ownerPool();
 const stamp=async(table:'bookings'|'payment_entries',id:string,at:number)=>{
  await owner.query('BEGIN');try{await owner.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER USER`);await owner.query(`UPDATE shipit.${table} SET ${table==='bookings'?'confirmed_at':'occurred_at'}=$1 WHERE id=$2`,[new Date(at),id]);await owner.query(`ALTER TABLE shipit.${table} ENABLE TRIGGER USER`);await owner.query('COMMIT');}catch(e){await owner.query('ROLLBACK');throw e;}
 };
 const call=(method:'GET'|'POST',path='',body:unknown={mode:'complete_day'},actor:{id:string;token:string}=s.local,key=randomUUID(),query:Record<string,string>=q)=>s.app.inject({method,url:'/api/v1/reports/daily'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(method==='POST'?{payload:JSON.stringify(body)}:{})});
 return {...s,day,start,stamp,call};
}
await test('daily source evidence separates old-booking collections, stable customers and receipt allocations',{timeout:60000},async t=>{
 const s=await setup(t);await s.stamp('bookings',s.bookingId,s.start-86400000+1);
 const first=await s.pay(collectionInput(60000));assert.equal(first.statusCode,200,first.body);await s.stamp('payment_entries',first.json().entry.id,s.start-86400000+2);
 const second=await s.pay(collectionInput(40000));assert.equal(second.statusCode,200,second.body);await s.stamp('payment_entries',second.json().entry.id,s.start+1);
 const captured=await s.call('POST');assert.equal(captured.statusCode,200,captured.body);assert.equal(captured.headers['cache-control'],'no-store');const p=captured.json<DailyPage>();
 assert.equal(p.snapshot.yesterday.bookings,1);assert.equal(p.snapshot.yesterday.billed_gross,'100000');assert.equal(p.snapshot.yesterday.collections,'60000');assert.equal(p.snapshot.yesterday.outstanding,'40000');
 assert.equal(p.snapshot.today.bookings,0);assert.equal(p.snapshot.today.billed_gross,'0');assert.equal(p.snapshot.today.collections,'40000');assert.equal(p.snapshot.today.outstanding,'0');assert.equal(p.snapshot.today.average_bill,null);
 for(let i=0;i<3;i++){const booked=await s.book(s.paymentBookingInput);assert.equal(booked.statusCode,201,booked.body);await s.stamp('bookings',booked.json().id,s.start+2+i);}
 const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,randomUUID(),headers,{name:'Synthetic daily bank',methods:['bank_transfer'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const booking=(await s.db.adminQuery('SELECT id FROM shipit.bookings WHERE id<>$1 ORDER BY id LIMIT 1',[s.bookingId])).rows[0]!.id as string;
 const receipt=await createMoneyReceiptService(s.pool).record(s.operator.token,q,randomUUID(),headers,{customer_id:s.source.id,account_id:account.id,expected_account_version:1,method:'bank_transfer',amount_paise:5000,currency:'INR',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date(Date.now()-1).toISOString(),external_reference:'SYN_PRIVATE_BANK_REFERENCE',allocations:[{booking_id:booking,amount_paise:1000,context:'to_pay',expected_payment_version:0}]},randomUUID());
 const current=await s.call('POST');assert.equal(current.statusCode,200,current.body);const next=current.json<DailyPage>();
 assert.equal(next.snapshot.today.bookings,3);assert.equal(next.snapshot.today.customers,1);assert.equal(next.snapshot.today.new_customers,0);assert.equal(next.snapshot.today.returning_customers,1);assert.equal(next.snapshot.today.billed_gross,'300000');assert.equal(next.snapshot.today.collections,'45000');assert.equal(next.snapshot.today.outstanding,'299000');
 assert.deepEqual(next.snapshot.today.methods,[{method:'bank_transfer',paise:'5000'},{method:'cash',paise:'40000'}]);
 const sources=await s.call('GET','/'+next.snapshot.id,undefined,s.local,randomUUID(),{...q,period:'today',metric:'collections'});assert.equal(sources.statusCode,200,sources.body);assert.equal(sources.json().rows.length,2);assert.ok(sources.json().rows.some((r:{id:string})=>r.id===receipt.receipt_id));
 const bank=await s.call('GET','/'+next.snapshot.id,undefined,s.local,randomUUID(),{...q,period:'today',metric:'collections',method:'bank_transfer'});assert.equal(bank.statusCode,200,bank.body);assert.equal(bank.json().rows.length,1);assert.equal(bank.json().rows[0].collections,'5000');
 const csv=await s.call('GET','/'+next.snapshot.id+'/export',undefined,s.local,randomUUID(),{...q,period:'today'});assert.equal(csv.statusCode,200,csv.body);
 const e=csv.json(),records=e.csv.trimEnd().split('\r\n').slice(1).map((line:string)=>line.split(',').map(c=>c.slice(1,-1)));
 for(const [column,expected] of [['billed_gross_paise','300000'],['tax_exclusive_revenue_paise',next.snapshot.today.tax_exclusive_revenue],['collections_paise','45000'],['refunds_paise','0'],['outstanding_paise','299000']] as const)assert.equal(records.reduce((sum:bigint,r:string[])=>sum+BigInt(r[e.columns.indexOf(column)]!),0n).toString(),expected);
 assert.equal(new Set(records.filter((r:string[])=>r[e.columns.indexOf('source_kind')]==='booking').map((r:string[])=>r[e.columns.indexOf('customer_id')])).size,1);
 const reloaded=await s.call('GET','/'+p.snapshot.id,undefined,s.local,randomUUID(),{...q,period:'today'});assert.deepEqual(reloaded.json(),p);assert.ok(!JSON.stringify(next).includes('SYN_PRIVATE_BANK_REFERENCE'));
 const finance=createFinanceService(s.pool),tax=s.booked.charges.tax;
 await finance.change(s.local.token,q,randomUUID(),headers,{booking_id:s.bookingId,expected_version:0,payment_version:2,kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYN_REVIEW',pre_tax:tax.pre_tax_paise,taxable:tax.taxable_basis_paise,cgst:tax.cgst_paise,sgst:tax.sgst_paise,igst:tax.igst_paise,rounding:tax.rounding_adjustment_paise},randomUUID());
 await finance.change(s.local.token,q,randomUUID(),headers,{booking_id:s.bookingId,expected_version:1,payment_version:2,kind:'refund',reason:'customer_refund',approval_ref:'SYN_REVIEW',returned_to_ref:'SYN_PRIVATE_RETURN',refund:100000},randomUUID());
 const corrected=(await s.call('POST')).json<DailyPage>();assert.equal(corrected.snapshot.today.refunds,'100000');assert.equal(corrected.snapshot.today.collections,'45000');assert.equal(corrected.snapshot.today.bookings,3);assert.equal(corrected.snapshot.today.new_customers,1);assert.equal(corrected.snapshot.today.returning_customers,0);assert.equal(corrected.snapshot.yesterday.bookings,1);assert.equal(corrected.snapshot.yesterday.billed_gross,'100000');
 const refunds=await s.call('GET','/'+corrected.snapshot.id+'/export',undefined,s.local,randomUUID(),{...q,period:'today',metric:'refunds'});assert.equal(refunds.statusCode,200);assert.ok(refunds.json().csv.includes('"100000"'));assert.ok(!refunds.body.includes('SYN_PRIVATE_RETURN'));
 // Kolkata boundaries must not inherit a database session's US daylight-saving day.
 const others=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.bookings WHERE id<>$1 ORDER BY id',[s.bookingId])).rows;
 await s.stamp('bookings',s.bookingId,Date.parse('2026-03-08T18:29:59.999Z'));
 await s.stamp('bookings',others[0]!.id,Date.parse('2026-03-07T18:30:00.000Z'));
 await s.stamp('bookings',others[1]!.id,Date.parse('2026-03-08T18:30:00.000Z'));
 await s.stamp('bookings',others[2]!.id,Date.parse('2026-03-07T18:29:59.999Z'));
 const zoned:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();try{await client.query("SET TIME ZONE 'America/New_York'");return client;}catch(error){client.release();throw error;}}};
 for(const mode of ['complete_day','same_elapsed']){
  const dst=await createDailyService(zoned).create(s.local.token,q,randomUUID(),headers,{day:'2026-03-08',mode},randomUUID());
  assert.equal(dst.snapshot.today.bookings,2);assert.equal(dst.snapshot.today.billed_gross,'200000');assert.equal(dst.snapshot.yesterday.bookings,1);
  assert.equal(dst.snapshot.windows[0]!.from,'2026-03-07T18:30:00.000Z');assert.equal(dst.snapshot.windows[0]!.to,'2026-03-08T18:30:00.000Z');
  assert.ok(!dst.rows.some(r=>r.id===others[1]!.id));
 }
});
await test('daily capture authorizes all saved scopes, exact retries, expiry and private exports',{timeout:60000},async t=>{
 const s=await setup(t);await s.stamp('bookings',s.bookingId,s.start+1);const key=randomUUID(),filter={mode:'same_elapsed'};
 const both=await Promise.all([s.call('POST','',filter,s.local,key),s.call('POST','',filter,s.local,key)]);for(const r of both)assert.equal(r.statusCode,200,r.body);assert.deepEqual(both[0]!.json(),both[1]!.json());const p=both[0]!.json<DailyPage>();
 assert.equal((await s.call('POST','',{mode:'complete_day'},s.local,key)).statusCode,409);
 assert.equal((await s.call('POST','',{...filter,franchise_ids:[A,B]})).statusCode,404);
 assert.equal((await s.call('POST','',{day:'2026-02-30'})).statusCode,422);assert.equal((await s.call('POST','',{day:'9998-01-01'})).statusCode,422);assert.equal((await s.call('POST','',{organization_id:otherOrg})).statusCode,422);
 for(const role of ['read_only','operator','delivery_agent']){const actor=await s.grant(role,[A]);assert.equal((await s.call('POST','',filter,actor)).statusCode,403);assert.equal((await s.call('GET','/'+p.snapshot.id+'/export',undefined,actor)).statusCode,403);}
 const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
 for(const [actor,query] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
  for(const suffix of ['', '/export']){const actual=await s.call('GET','/'+p.snapshot.id+suffix,undefined,actor,randomUUID(),query),missing=await s.call('GET','/'+randomUUID()+suffix,undefined,actor,randomUUID(),query);assert.equal(actual.statusCode,404);assert.equal(actual.json().error.code,missing.json().error.code);}
  const emptyTenant=await s.call('POST','',filter,actor,key,query);assert.equal(emptyTenant.statusCode,200);assert.equal(emptyTenant.json().snapshot.today.billed_gross,'0');assert.equal(emptyTenant.json().snapshot.today.outstanding,'0');assert.equal(emptyTenant.json().snapshot.today.customers,0);assert.deepEqual(emptyTenant.json().rows,[]);
 }
 const grant=await s.grant('franchise_admin',[A,B]),multi=(await s.call('POST','',{franchise_ids:[A,B]},grant)).json<DailyPage>();assert.equal(multi.snapshot.today.billed_gross,'100000');assert.equal((await s.call('GET','/'+multi.snapshot.id+'/export',undefined,grant)).statusCode,200);
 await s.db.adminQuery('DELETE FROM shipit.membership_franchise_scopes WHERE membership_id=$1 AND franchise_id=$2',[grant.member.id,B]);
 assert.equal((await s.call('GET','/'+multi.snapshot.id,undefined,grant)).statusCode,404);assert.equal((await s.call('GET','/'+multi.snapshot.id+'/export',undefined,grant)).statusCode,404);
 const uncertain=createDailyService(paymentFault(s.pool,'COMMIT')),retry=randomUUID();await assert.rejects(uncertain.create(s.local.token,q,retry,headers,filter,randomUUID()));assert.equal((await s.call('POST','',filter,s.local,retry)).statusCode,200);
 const owner=s.db.ownerPool();await owner.query('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');await owner.query("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[p.snapshot.id]);await owner.query('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');
 assert.equal((await s.call('GET','/'+p.snapshot.id+'/export')).statusCode,404);assert.equal((await s.call('POST','',filter,s.local,key)).statusCode,410);
 await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[s.local.id]);assert.equal((await s.call('POST','',filter,s.local,key)).statusCode,404);
});
