import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {statementSetup} from '../account-statement-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {createAgeingService} from '../../src/modules/reports/ageing-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
await test('account ageing reconciles combined receipts, frozen due dates, statements and separate advances without cash custody reopening debt',{timeout:60000},async t=>{
 const s=await statementSetup(t),first=await s.book(),second=await s.book();
 const receiving=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional cash account',methods:['cash'],other_method_name:null,active:true},randomUUID());
 const agent=await s.grant('delivery_agent',[A]);const receipts=createMoneyReceiptService(s.pool,true,true),gross=first.charges.tax.final_payable_paise;
 const receipt=await receipts.record(s.operator.token,q,randomUUID(),headers,{customer_id:s.source.id,account_id:receiving.id,expected_account_version:1,method:'cash',amount_paise:gross+1500,currency:'INR',receiver_id:agent.id,custodian_id:agent.id,occurred_at:new Date().toISOString(),external_reference:'SYN_COMBINED',allocations:[{booking_id:first.id,amount_paise:gross,context:'to_pay',expected_payment_version:0},{booking_id:second.id,amount_paise:500,context:'to_pay',expected_payment_version:0}]},randomUUID());
 const statement=await s.issue(),due=statement.lines[0]!.due_date;
 let asOf=new Date(Date.parse(due+'T00:00:00+05:30')+30*86400000).toISOString();
 const pool:DatabasePool={...s.pool,async connect(){const c=await s.pool.connect();return {release:discard=>c.release(discard),query:<R extends Record<string,unknown>>(sql:string,params?:readonly unknown[])=>c.query<R>(sql.replaceAll('statement_timestamp()',`'${asOf}'::timestamptz`),params)};}};
 const service=createAgeingService(pool),capture=(filter:Record<string,unknown>={})=>service.create(s.local.token,q,randomUUID(),headers,{anchor:'due',...filter},randomUUID());
 const saved=await capture();assert.equal(saved.snapshot.count,1);assert.equal(saved.rows[0]!.id,second.id);assert.equal(saved.rows[0]!.outstanding,String(gross-500));assert.equal(saved.rows[0]!.bucket,'0_30');assert.equal(saved.rows[0]!.overdue,true);
 assert.equal(saved.rows[0]!.entries[0]!.receipt_id,receipt.receipt_id);assert.ok(saved.rows[0]!.entries[0]!.allocation_id);assert.equal(saved.rows[0]!.account_id,s.a.id);assert.equal(saved.rows[0]!.statement_id,statement.id);assert.equal(saved.snapshot.unallocated_advance,'1000');assert.equal(saved.snapshot.advances![0]!.receipt_id,receipt.receipt_id);
 assert.equal(saved.snapshot.totals.outstanding,statement.totals.outstanding);assert.equal(statement.unallocated_advance,saved.snapshot.unallocated_advance);
 for(const [days,bucket] of [[31,'31_60'],[60,'31_60'],[61,'61_plus']] as const){asOf=new Date(Date.parse(due+'T00:00:00+05:30')+days*86400000).toISOString();const p=await capture({overdue_only:true});assert.equal(p.rows[0]!.bucket,bucket);assert.equal(p.snapshot.buckets[bucket],String(gross-500));}
 asOf=due+'T18:29:59.999Z';assert.equal((await capture({overdue_only:true})).snapshot.count,0);asOf=due+'T18:30:00.000Z';assert.equal((await capture({overdue_only:true})).snapshot.count,1);
 const all=await capture({balances:'all'});assert.equal(all.snapshot.count,2);assert.equal(all.rows.find(r=>r.id===first.id)!.outstanding,'0');assert.equal(all.rows.find(r=>r.id===first.id)!.overdue,false);
 // Physical cash remains with its receiver; no handover is needed to settle the customer.
 assert.equal((await s.db.adminQuery('SELECT initial_custodian_id FROM shipit.money_receipts WHERE id=$1',[receipt.receipt_id])).rows[0]!.initial_custodian_id,agent.id);
 assert.deepEqual(await service.read(s.local.token,saved.snapshot.id,q,randomUUID()),saved);
 const csv=await service.read(s.local.token,saved.snapshot.id,q,randomUUID(),true);assert.ok('csv' in csv&&csv.csv.includes(receipt.receipt_id)&&csv.csv.includes(statement.id!));
 await receipts.allocate(s.operator.token,receipt.receipt_id,q,randomUUID(),headers,{expected_version:1,allocations:[{booking_id:second.id,amount_paise:1000,context:'to_pay',expected_payment_version:1}]},randomUUID());
 const after=await capture();assert.equal(after.snapshot.unallocated_advance,'0');assert.equal(after.snapshot.totals.outstanding,String(gross-1500));assert.deepEqual(await service.read(s.local.token,saved.snapshot.id,q,randomUUID()),saved);
 const sibling=await s.grant('franchise_admin',[B]),foreign=await s.user(),foreignAdmin=await s.user();await s.memberships.bootstrapAdministrator(foreignAdmin.id,otherOrg);const invitation=await s.memberships.createInvitation(foreignAdmin.token,{organization_id:otherOrg,invitee_user_id:foreign.id,role:'franchise_admin',franchise_ids:[C]});await s.memberships.acceptInvitation(foreign.token,{token:invitation.acceptance_token});
 for(const [actor,scope] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){const empty=await service.create(actor.token,scope,randomUUID(),headers,{},randomUUID());assert.equal(empty.snapshot.count,0);assert.deepEqual(empty.snapshot.advances,[]);await assert.rejects(service.read(actor.token,saved.snapshot.id,scope,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});}
 assert.ok(!JSON.stringify(saved).includes('SYN_COMBINED'));
});
