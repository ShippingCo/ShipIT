import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentSetup,collectionInput,paymentFault } from '../payment-support.ts';
import { taxPolicy } from '../tax-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createSalesService } from '../../src/modules/reports/sales-service.ts';
import { createFinanceService } from '../../src/modules/reports/finance-service.ts';
import type { DatabasePool } from '@shippingco/db';
import { createPaymentService } from '../../src/modules/payments/service.ts';
import type { SalesPage } from '@shippingco/shared';
async function setup(t:Parameters<typeof paymentSetup>[0]){
 const s=await paymentSetup(t);await s.db.prepareReports();const q={organization_id:org,franchise_id:A},day=new Date(Date.parse(s.booked.charges.confirmed_at)+19800000).toISOString().slice(0,10),filter={from_day:day,to_day:day};
 const call=(path:string,body?:unknown,actor:{id:string;token:string}=s.local,key=randomUUID(),query=q)=>s.app.inject({method:body===undefined?'GET':'POST',url:'/api/v1/'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
 const correction={booking_id:s.bookingId,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYN_ACCOUNTANT_REVIEW',pre_tax:12800,taxable:12000,cgst:320,sgst:320,igst:0,rounding:-40};
 return {...s,q,filter,call,correction};
}
await test('sales source-to-total reconciliation, approved cancellation, refund and immutable statement do not double count',{timeout:60000},async t=>{
 const s=await setup(t),paid=await s.pay(collectionInput(s.gross));assert.equal(paid.statusCode,200);
 const issued=await s.request('GET',s.bookingId+'/receipt');assert.equal(issued.statusCode,200,issued.body);
 const initial=await s.call('reports/sales',s.filter);assert.equal(initial.headers['cache-control'],'no-store');assert.equal(initial.statusCode,200,initial.body);const p=initial.json<SalesPage>();
 const r=p.rows[0]!;assert.equal(r.receipt_id,issued.json().id);
 const next=structuredClone(taxPolicy);next.effective_from='2099-01-02T00:00:00Z';next.effective_to='2099-01-03T00:00:00Z';next.rules[0]!.components.forEach(c=>{c.denominator=20;});
 const draft=await s.tax.create(s.local.token,org,A,randomUUID(),next,randomUUID());await s.tax.publish(s.local.token,org,A,draft.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(next.effective_from);
 assert.deepEqual((await s.call('reports/sales',s.filter)).json<SalesPage>().rows,p.rows);assert.equal(r.amounts.gross,String(s.gross));assert.equal(BigInt(r.amounts.pre_tax)+BigInt(r.amounts.gst)+BigInt(r.amounts.rounding),BigInt(r.amounts.gross));assert.equal(BigInt(r.amounts.cgst)+BigInt(r.amounts.sgst)+BigInt(r.amounts.igst),BigInt(r.amounts.gst));
 const statement=await s.call('finance/statements',{...s.filter,customer_id:s.source.id});assert.equal(statement.statusCode,200,statement.body);
 assert.equal(statement.json().kind,'account_statement');assert.equal(statement.json().totals.gross,r.amounts.gross);
 assert.equal((await s.call('finance/statements',{...s.filter,customer_id:s.source.id})).statusCode,409);
 const afterStatement=(await s.call('reports/sales',s.filter)).json<SalesPage>();assert.equal(afterStatement.snapshot.totals.gross,p.snapshot.totals.gross);assert.deepEqual(afterStatement.rows[0]!.statement_ids,[statement.json().id]);
 // Use the stored source fields: taxable basis may exclude a charge; rounding is a separate amount.
 const input={...s.correction,pre_tax:Number(r.original.pre_tax),taxable:Number(r.original.taxable),cgst:Number(r.original.cgst),sgst:Number(r.original.sgst),igst:Number(r.original.igst),rounding:Number(r.original.rounding)};
 const key=randomUUID(),changed=await s.call('finance/changes',input,s.local,key);assert.equal(changed.statusCode,200,changed.body);
 assert.deepEqual((await s.call('finance/changes',input,s.local,key)).json(),changed.json());assert.equal((await s.call('finance/changes',{...input,approval_ref:'DIFFERENT'},s.local,key)).statusCode,409);
 const corrected=(await s.call('reports/sales',s.filter)).json<SalesPage>();assert.equal(corrected.snapshot.totals.gross,'0');assert.equal(corrected.snapshot.totals.refundable_credit,String(s.gross));assert.equal(corrected.rows[0]!.original.gross,String(s.gross));assert.equal(corrected.rows[0]!.corrections[0]!.id,changed.json().id);
 assert.equal((await s.current()).json().gross_paise,0);assert.equal((await s.pay(collectionInput(1))).statusCode,409);
 const refund={booking_id:s.bookingId,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',approval_ref:'SYN_APPROVED',returned_to_ref:'SYN_CASH_RETURN',refund:s.gross};
 const refunds=await Promise.all([s.call('finance/changes',refund),s.call('finance/changes',refund)]);assert.deepEqual(refunds.map(x=>x.statusCode).sort(),[200,409]);
 const final=(await s.call('reports/sales',s.filter)).json<SalesPage>();assert.equal(final.snapshot.totals.refundable_credit,'0');assert.equal(final.snapshot.totals.refunds,String(s.gross));assert.equal(final.snapshot.totals.collections,String(s.gross));assert.equal(final.rows[0]!.corrections.at(-1)!.kind,'refund');assert.equal((await s.reverse(paid.json().entry.id,1)).statusCode,409);
 assert.deepEqual((await s.call('reports/sales/'+p.snapshot.id)).json(),p);assert.deepEqual((await s.call('finance/statements/'+statement.json().id)).json(),statement.json());
 const csv=(await s.call('reports/sales/'+final.snapshot.id+'/export')).json();assert.deepEqual(csv.snapshot,final.snapshot);assert.ok(csv.csv.includes(changed.json().id));
 await assert.rejects(s.pool.query('UPDATE shipit.financial_changes SET refund=refund'));await assert.rejects(s.pool.query('DELETE FROM shipit.account_statements'));
 const safe=JSON.stringify({report:final,logs:s.logs});for(const privateValue of [s.local.token,s.booked.customer.phone,s.booked.customer.address,'SYN_CASH_RETURN'])assert.ok(!safe.includes(privateValue));
});
await test('sales authorization, filters, persistence, failures and replay use the real database',{timeout:60000},async t=>{
 const s=await setup(t),key=randomUUID(),p=(await s.call('reports/sales',s.filter,s.local,key)).json<SalesPage>();
 assert.deepEqual(await createSalesService(s.pool).read(s.local.token,p.snapshot.id,s.q,randomUUID()),p);
 for(const actor of [s.operator,await s.grant('read_only',[A]),await s.grant('accountant',[B])])assert.notEqual((await s.call('reports/sales',s.filter,actor)).statusCode,200);
 for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}])assert.equal((await s.call('reports/sales/'+p.snapshot.id+'/export',undefined,s.local,randomUUID(),query)).statusCode,404);
 assert.equal((await s.call('reports/sales',{...s.filter,franchise_ids:[A,B]})).statusCode,404);
 const aggregate=await s.call('reports/sales',{...s.filter,franchise_ids:[A,B]},s.admin);assert.equal(aggregate.statusCode,200,aggregate.body);assert.equal(aggregate.json().snapshot.count,1);assert.equal((await s.call('reports/sales/'+aggregate.json().snapshot.id+'/export',undefined,s.admin)).statusCode,403);
 assert.equal((await s.call('reports/sales',{...s.filter,franchise_ids:[A,C]},s.admin)).statusCode,404);
 const empty=await s.call('reports/sales',{...s.filter,rate:'0/1'});assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().snapshot.totals.gst,'0');
 for(const body of [{...s.filter,rate:'1/0'},{...s.filter,to_day:'bad'},{...s.filter,franchise_ids:[A,A]}])assert.equal((await s.call('reports/sales',body)).statusCode,422);
 const uncertain=createSalesService(paymentFault(s.pool,'COMMIT')),retry=randomUUID();await assert.rejects(uncertain.create(s.local.token,s.q,retry,['Idempotency-Key',retry],s.filter,randomUUID()));assert.equal((await s.call('reports/sales',s.filter,s.local,retry)).statusCode,200);
 const accountant=await s.grant('accountant',[A]);assert.equal((await s.call('finance/changes',s.correction,accountant)).statusCode,403);
 const failure=createFinanceService(paymentFault(s.pool,'INSERT INTO shipit.account_statement_lines','before')),statementKey=randomUUID();await assert.rejects(failure.statement(s.local.token,s.q,statementKey,['Idempotency-Key',statementKey],{...s.filter,customer_id:s.source.id},randomUUID()));assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.account_statements')).rows[0]!.n,0);
 await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[s.local.id]);assert.equal((await s.call('reports/sales/'+p.snapshot.id+'/export')).statusCode,404);
});


await test('partial corrections constrain later collections and preserve old command outcomes',{timeout:60000},async t=>{
 const s=await setup(t),firstKey=randomUUID(),firstBody=collectionInput(1000);
 // A real SQL clock seam gives the first entry a future occurrence time. Ledger
 // sequence, not wall-clock order, must keep later corrections out of its replay.
 const skewed:DatabasePool={...s.pool,async connect(){const c=await s.pool.connect();return {release:discard=>c.release(discard),query:<R extends Record<string,unknown>>(sql:string,params?:readonly unknown[])=>c.query<R>(sql.startsWith("SELECT lifecycle,date_trunc")?sql.replace('clock_timestamp()',"(clock_timestamp()+interval '1 day')"):sql,params)};}};
 const first=await createPaymentService(skewed).execute(s.local.token,s.bookingId,null,s.q,firstKey,['idempotency-key',firstKey],firstBody,'payments.collect',randomUUID());assert.equal(first.payment.collected_paise,1000);

 const reduction={booking_id:s.bookingId,expected_version:0,payment_version:1,kind:'discount',reason:'customer_agreement',approval_ref:'SYN_APPROVED_DISCOUNT',pre_tax:100,taxable:100,cgst:0,sgst:0,igst:0,rounding:0};
 assert.equal((await s.call('finance/changes',reduction)).statusCode,200);
 assert.deepEqual((await s.pay(firstBody,firstKey)).json(),first);
 assert.deepEqual((await s.pay(firstBody)).json(),first);
 const due=s.gross-1100;assert.equal((await s.pay(collectionInput(due+1))).statusCode,409);
 const settled=await s.pay(collectionInput(due));assert.equal(settled.statusCode,200,settled.body);
 assert.equal(settled.json().payment.gross_paise,s.gross-100);assert.equal((await s.current()).json().outstanding_paise,0);
 const r=(await s.call('reports/sales',s.filter)).json<SalesPage>().rows[0]!;
 assert.equal(r.amounts.gross,String(s.gross-100));assert.equal(r.amounts.collections,r.amounts.gross);
});

