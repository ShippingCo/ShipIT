import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMetaProvider} from '../../src/modules/whatsapp/provider.ts';
import {createWhatsappService} from '../../src/modules/whatsapp/service.ts';
import type {WhatsappConfiguration} from '../../src/modules/whatsapp/types.ts';
import {AuthRepository} from '../../src/modules/auth/repository.ts';
import {createCustomerAccountService} from '../../src/modules/customer-accounts/service.ts';
import {createPricingService} from '../../src/modules/pricing/service.ts';
import {createBookingService} from '../../src/modules/bookings/service.ts';
import {input as priceInput} from '../pricing-support.ts';
import {setupCashClose} from '../cash-close-support.ts';
import {captureOwnerSummary} from '../../src/modules/reports/owner-summary-sources.ts';
import {createReconciliationService} from '../../src/modules/reconciliation/service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {taxFacts} from '../tax-support.ts';
import {paymentSetup,paymentFault,collectionInput} from '../payment-support.ts';
import {org,A,B,otherOrg,C} from '../audit-support.ts';
import {withReportScope} from '../../src/modules/memberships/service.ts';
import {ownerSummaryPeriod} from '../../src/modules/reports/owner-summary-repository.ts';
import type {DatabasePool} from '@shippingco/db';
import type {OwnerSummaryTiming} from '@shippingco/shared';
import type {OwnerSummarySchedule,OwnerSummaryScheduleInput} from '@shippingco/shared';
import {createOwnerSummaryService} from '../../src/modules/reports/owner-summary-service.ts';
import {createOwnerSummaryWorker} from '../../src/modules/reports/owner-summary-worker.ts';
const query={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
const input=(recipient:string):OwnerSummaryScheduleInput=>({expected_version:0,name:'Daily owner report',timing:{frequency:'daily',timezone:'Asia/Kolkata',minute:0,weekday:1},franchise_ids:[A],recipient_ids:[recipient],enabled:true,whatsapp:false,corrections:false,alerts:{enabled:false,notify:false,minimum_paise:'100',minimum_overdue_days:1,repeat_hours:null}});
async function setup(t:Parameters<typeof paymentSetup>[0]){
 const s=await paymentSetup(t,100000);await s.db.prepareOwnerReports();
 const service=createOwnerSummaryService(s.pool,true),failures:string[]=[],worker=createOwnerSummaryWorker(s.pool,undefined,{enabled:true,onFailure:c=>failures.push(c)});
 const save=(body:OwnerSummaryScheduleInput=input(s.local.id),key=randomUUID(),actor=s.local,id:string|null=null)=>service.save(actor.token,id,query,key,headers,body,randomUUID()) as Promise<OwnerSummarySchedule>;
 return {...s,service,worker,failures,save};
}

await test('owner summary calendar uses IST due times, complete weeks/months, leap years and actual DST boundaries',{timeout:60000},async t=>{
 const s=await paymentSetup(t);await s.db.prepareReports();
 const period=(at:string,patch:Partial<OwnerSummaryTiming>={})=>withReportScope(s.pool,s.local.token,org,A,false,randomUUID(),scope=>
  ownerSummaryPeriod(scope,{frequency:'daily',timezone:'Asia/Kolkata',minute:540,weekday:1,...patch},new Date(at)));
 for(const [at,from,to] of [
  ['2026-10-18T03:29:59.999Z','2026-10-15T18:30:00.000Z','2026-10-16T18:30:00.000Z'],
  ['2026-10-18T03:30:00.000Z','2026-10-16T18:30:00.000Z','2026-10-17T18:30:00.000Z'],
 ] as const){const p=await period(at);assert.equal(p.from,from);assert.equal(p.to,to);}
 const week=await period('2026-10-21T03:30:00Z',{frequency:'weekly',weekday:3});
 assert.equal(week.from,'2026-10-11T18:30:00.000Z');assert.equal(week.to,'2026-10-18T18:30:00.000Z');
 assert.equal((await period('2026-10-21T03:29:59Z',{frequency:'weekly',weekday:3})).to,'2026-10-11T18:30:00.000Z');
 const month=await period('2028-03-01T03:30:00Z',{frequency:'monthly'});
 assert.equal(month.from,'2028-01-31T18:30:00.000Z');assert.equal(month.to,'2028-02-29T18:30:00.000Z');
 const year=await period('2027-01-01T03:30:00Z',{frequency:'monthly'});
 assert.equal(year.from,'2026-11-30T18:30:00.000Z');assert.equal(year.to,'2026-12-31T18:30:00.000Z');
 const dst=await period('2026-03-09T13:00:00Z',{timezone:'America/New_York'});
 assert.equal(dst.from,'2026-03-08T05:00:00.000Z');assert.equal(dst.to,'2026-03-09T04:00:00.000Z');
});
await test('owner schedules retain source-backed snapshots, one crash/retry intent, scope-safe configuration and private exports',{timeout:60000},async t=>{
 const s=await setup(t),owner=s.db.ownerPool(),day=new Date(Date.now()+19800000).toISOString().slice(0,10),yesterday=new Date(Date.parse(day+'T00:00:00+05:30')-3600000);
 await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');await owner.query('UPDATE shipit.bookings SET confirmed_at=$1 WHERE id=$2',[yesterday,s.bookingId]);await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');
 const key=randomUUID(),schedule=await s.save(undefined,key);assert.deepEqual(await s.save(undefined,key),schedule);
 await assert.rejects(s.save({...input(s.local.id),name:'conflicting'},key));
 await assert.rejects(s.save({...input(s.local.id),franchise_ids:[A,B]}));
 const reader=await s.grant('read_only',[A]);await assert.rejects(s.save(input(s.local.id),randomUUID(),reader));
 await s.worker.tick();assert.deepEqual(s.failures,[]);
 const workspace=await s.service.workspace(s.local.token,query,randomUUID());assert.equal(workspace.runs.length,1);assert.equal(workspace.runs[0]!.deliveries.length,1);assert.equal(workspace.runs[0]!.deliveries[0]!.state,'sent');assert.match(workspace.runs[0]!.deliveries[0]!.updated_at,/Z$/);
 const wire=await s.app.inject({method:'GET',url:'/api/v1/owner-reports?'+new URLSearchParams(query),cookies:s.cookies(s.local.token)});assert.equal(wire.statusCode,200,wire.body);assert.match(wire.json().runs[0].deliveries[0].updated_at,/Z$/);
 const id=workspace.runs[0]!.id,report=await s.service.report(s.local.token,id,query,randomUUID());assert.ok('snapshot' in report);assert.ok(report.snapshot);
 assert.equal(report.snapshot.metrics.billed_gross,'100000');assert.equal(report.snapshot.metrics.outstanding,'100000');assert.equal(report.snapshot.metrics.bookings,1);assert.equal(report.snapshot.expenses_paise,'0');assert.equal(report.snapshot.reconciliation_state,'disabled');
 assert.equal(report.snapshot.sales_rows.reduce((n,row)=>n+BigInt(row.billed_gross),0n).toString(),report.snapshot.metrics.billed_gross);
 const csv=await s.service.report(s.local.token,id,query,randomUUID(),true);assert.ok(csv.csv?.includes('100000'));
 await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await Promise.all([s.worker.tick(),s.worker.tick()]);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.owner_report_runs')).rows[0]!.n,1);
 const sibling=await s.grant('franchise_admin',[B]);await assert.rejects(s.service.report(sibling.token,id,{organization_id:org,franchise_id:B},randomUUID()));
 await assert.rejects(s.service.report(s.local.token,id,{organization_id:otherOrg,franchise_id:C},randomUUID()));
 const before=await s.service.workspace(s.local.token,query,randomUUID());
 const lost=createOwnerSummaryService(paymentFault(s.pool,'COMMIT'),true),lostKey=randomUUID(),body={...input(s.local.id),name:'Lost acknowledgement'};
 await assert.rejects(lost.save(s.local.token,null,query,lostKey,headers,body,randomUUID()));await s.save(body,lostKey);
 assert.equal((await s.service.workspace(s.local.token,query,randomUUID())).schedules.length,before.schedules.length+1);
 await assert.rejects(s.pool.query('UPDATE shipit.owner_report_runs SET payload=$1 WHERE id=$2',[{},id]));
 await assert.rejects(s.pool.query('UPDATE shipit.owner_report_commands SET result=$1',[{}]));
 await s.pay(collectionInput(10000));assert.deepEqual(await s.service.report(s.local.token,id,query,randomUUID()),report);
});
await test('owner WhatsApp uses verified self-consent, approved template and private link; uncertainty never resends',{timeout:60000},async t=>{
 const s=await setup(t),configuration:WhatsappConfiguration={graph_version:'v24.0',outbound_enabled:true,bindings:[{key:'owner',organization_id:org,franchise_id:A,waba_id:'900001',phone_number_id:'900002',credential_ref:'whatsapp:owner/v1'}],owner_reports:{template_name:'owner_report_ready',template_language:'en_US',app_origin:'https://owner.example.test'}};
 const posts:Record<string,unknown>[]=[],failures:string[]=[];let mode:'accepted'|'uncertain'='uncertain';
 const provider=createMetaProvider({configuration,secrets:{kind:'developer-local',resolve:async()=> 'synthetic_owner_token_not_a_secret'},transport:async(url,options)=>{
  if(options?.method==='POST'){posts.push(JSON.parse(String(options.body)));return mode==='uncertain'?new Response('{}',{status:503}):new Response(JSON.stringify({messages:[{id:'wamid.synthetic_owner_'+posts.length}]}));}
  return new Response(JSON.stringify(String(url).includes('phone_numbers')?{data:[{id:'900002',code_verification_status:'VERIFIED',platform_type:'CLOUD_API'}]}:{data:[{id:'900003',name:'owner_report_ready',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Your owner report is ready: {{1}}'}]}]}));
 }}),dependencies={configuration,provider},whatsapp=createWhatsappService(s.pool,dependencies);
 const installation=await whatsapp.execute(s.local.token,null,'connect',query,randomUUID(),{binding_key:'owner',expected_version:0},randomUUID());
 await whatsapp.execute(s.local.token,installation.id,'sync',query,randomUUID(),{expected_version:1,name:'owner_report_ready',language:'en_US'},randomUUID());
 await assert.rejects(s.service.consent(s.local.token,query,randomUUID(),headers,{enabled:true,expected_version:0},randomUUID()));
 await new AuthRepository(s.pool).addIdentifier(s.local.id,'whatsapp','+12025550149');
 await s.service.consent(s.local.token,query,randomUUID(),headers,{enabled:true,expected_version:0},randomUUID());
 const schedule=await s.save({...input(s.local.id),whatsapp:true}),worker=createOwnerSummaryWorker(s.pool,dependencies,{enabled:true,onFailure:c=>failures.push(c)});
 await worker.tick();assert.deepEqual(failures,[]);assert.equal(posts.length,1);
 const payload=JSON.stringify(posts[0]);assert.ok(payload.includes('https://owner.example.test/#/business/reports?owner_report='));assert.ok(!payload.includes('100000'));assert.ok(!payload.includes(s.source.id));assert.ok(!payload.includes(s.bookingId));
 assert.equal(posts[0]!.to,'12025550149');
 let history=await s.service.workspace(s.local.token,query,randomUUID());const uncertain=history.runs[0]!.deliveries.find(d=>d.channel==='whatsapp')!;
 assert.equal(uncertain.state,'uncertain');assert.equal(uncertain.attempts,1);
 await worker.tick();assert.equal(posts.length,1);
 await assert.rejects(s.service.action(s.local.token,uncertain.id,query,randomUUID(),headers,{expected_version:1},randomUUID(),'retry'));
 mode='accepted';await s.save({...input(s.local.id),name:'Second owner report',whatsapp:true});await worker.tick();assert.equal(posts.length,2);history=await s.service.workspace(s.local.token,query,randomUUID());assert.ok(history.runs.some(r=>r.deliveries.some(d=>d.channel==='whatsapp'&&d.state==='sent')));
 // A recorded but interrupted dispatch cannot be assumed unaccepted after lease expiry.
 const owner=s.db.ownerPool(),deliveryId=history.runs.find(r=>r.schedule_id===schedule.id)!.deliveries.find(d=>d.channel==='whatsapp')!.id;
 await owner.query('ALTER TABLE shipit.owner_report_deliveries DISABLE TRIGGER USER');await owner.query("UPDATE shipit.owner_report_deliveries SET state='sending',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[deliveryId]);await owner.query('ALTER TABLE shipit.owner_report_deliveries ENABLE TRIGGER USER');
 await worker.tick();assert.equal(posts.length,2);assert.equal((await owner.query('SELECT state FROM shipit.owner_report_deliveries WHERE id=$1',[deliveryId])).rows[0]!.state,'uncertain');
 const revoked=await s.save({...input(s.local.id),name:'Revocation before delivery',whatsapp:true});
 const stopBeforeSend=createOwnerSummaryWorker(paymentFault(s.pool,'FROM shipit.owner_report_deliveries d','before'),dependencies,{enabled:true});await stopBeforeSend.tick();
 const before=posts.length;
 let releaseCommit!:()=>void,commitEntered!:()=>void,discovered!:()=>void;
 const held=new Promise<void>(resolve=>{releaseCommit=resolve;}),entered=new Promise<void>(resolve=>{commitEntered=resolve;}),seen=new Promise<void>(resolve=>{discovered=resolve;});
 const blocked:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){if(sql==='COMMIT'){commitEntered();await held;}return client.query<Row>(sql,params);}};}};
 const observed:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){const result=await client.query<Row>(sql,params);if(sql.includes('owner_report_next($1)')&&params?.[0]===true&&result.rows.length)discovered();return result;}};}};
 const optOut=createOwnerSummaryService(blocked,true).consent(s.local.token,query,randomUUID(),headers,{enabled:false,expected_version:1},randomUUID());await entered;
 const racing=createOwnerSummaryWorker(observed,dependencies,{enabled:true}).tick();await seen;releaseCommit();await optOut;await racing;assert.equal(posts.length,before);
 assert.ok((await s.service.workspace(s.local.token,query,randomUUID())).runs.find(r=>r.schedule_id===revoked.id)!.deliveries.some(d=>d.channel==='whatsapp'&&d.state==='suppressed'));
});
await test('overdue alerts deduplicate, acknowledge, repeat only by policy, resolve after payment and suppress revoked access',{timeout:60000},async t=>{
 const s=await setup(t);await s.db.prepareCustomerAccounts();
 const accounts=createCustomerAccountService(s.pool,true,s.clock),pricing=createPricingService(s.pool,s.clock,true),bookings=createBookingService(s.pool,s.keys.browser,s.clock,true);
 const account=await accounts.configure(s.local.token,null,query,randomUUID(),headers,{expected_version:0,debtor_customer_id:s.source.id,shipping_customer_ids:[s.source.id],name:'Synthetic overdue account',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'ATTESTED'},closing_day:1,due_days:0,credit_limit_paise:1000000,state:'active',reason:'Synthetic owner approval'},randomUUID());
 const pricingInput={...priceInput,customer_account_id:account.id},quote=await pricing.quote(s.operator.token,org,A,randomUUID(),pricingInput,randomUUID());
 const tax_intent={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts},intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID()),tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 const booked=await bookings.create(s.operator.token,org,A,randomUUID(),{...s.body,tax_intent,tax_calculation_id:tax.id},randomUUID());
 const owner=s.db.ownerPool();await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');await owner.query("UPDATE shipit.bookings SET confirmed_at=statement_timestamp()-interval '1 second' WHERE id=$1",[booked.id]);await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');await owner.query('ALTER TABLE shipit.customer_account_bookings DISABLE TRIGGER USER');await owner.query("UPDATE shipit.customer_account_bookings SET due_date=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date-2 WHERE booking_id=$1",[booked.id]);await owner.query('ALTER TABLE shipit.customer_account_bookings ENABLE TRIGGER USER');
 const schedule=await s.save({...input(s.local.id),alerts:{enabled:true,notify:true,minimum_paise:'100',minimum_overdue_days:1,repeat_hours:24}});
 await s.worker.tick();assert.deepEqual(s.failures,[]);let workspace=await s.service.workspace(s.local.token,query,randomUUID());assert.equal(workspace.alerts.length,1);const alert=workspace.alerts[0]!;assert.equal(alert.source_id,booked.id);assert.equal(alert.amount_paise,String(tax.final_payable_paise));
 const initialRuns=workspace.runs.length;await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await s.worker.tick();assert.equal((await s.service.workspace(s.local.token,query,randomUUID())).runs.length,initialRuns);
 await owner.query("UPDATE shipit.owner_report_alerts SET last_notified_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[alert.id]);await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await s.worker.tick();assert.equal((await s.service.workspace(s.local.token,query,randomUUID())).runs.length,initialRuns+1);
 await s.service.action(s.local.token,alert.id,query,randomUUID(),headers,{expected_version:alert.version},randomUUID(),'acknowledge');await owner.query("UPDATE shipit.owner_report_alerts SET last_notified_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[alert.id]);await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await s.worker.tick();assert.equal((await s.service.workspace(s.local.token,query,randomUUID())).runs.length,initialRuns+1);
 const paid=await s.request('POST',booked.id+'/payments',collectionInput(tax.final_payable_paise));assert.equal(paid.statusCode,200,paid.body);await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await s.worker.tick();workspace=await s.service.workspace(s.local.token,query,randomUUID());assert.equal(workspace.alerts.length,0);assert.equal((await owner.query('SELECT state FROM shipit.owner_report_alerts WHERE id=$1',[alert.id])).rows[0]!.state,'resolved');
 const saved=workspace.runs[0]!.id;await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[s.local.id]);await assert.rejects(s.service.report(s.local.token,saved,query,randomUUID()));
});
await test('multi-franchise owner reports recheck every grant for reads, exports, configuration replay and retries',{timeout:60000},async t=>{
 const s=await setup(t),manager=await s.grant('franchise_admin',[A,B]),accountant=await s.grant('accountant',[A,B]);
 const body={...input(manager.id),franchise_ids:[A,B],recipient_ids:[manager.id,accountant.id,s.admin.id].sort()},key=randomUUID();
 const schedule=await s.save(body,key,manager);await s.worker.tick();assert.deepEqual(s.failures,[]);
 const workspace=await s.service.workspace(manager.token,query,randomUUID());assert.equal(workspace.schedules.length,1);assert.equal(workspace.runs.length,1);const run=workspace.runs[0]!;
 await s.service.report(accountant.token,run.id,query,randomUUID(),true);await s.service.report(s.admin.token,run.id,query,randomUUID());
 await s.service.report(s.admin.token,run.id,query,randomUUID(),true);
 await assert.rejects(s.save({...body,expected_version:1},randomUUID(),accountant,schedule.id),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(s.pool.query('INSERT INTO shipit.owner_report_franchises(organization_id,franchise_id,schedule_id,selected_id) VALUES($1,$2,$3,$4)',[org,A,schedule.id,C]));
 await s.db.adminQuery('DELETE FROM shipit.membership_franchise_scopes WHERE membership_id=$1 AND franchise_id=$2',[manager.member.id,B]);
 for(const exporting of [false,true])await assert.rejects(s.service.report(manager.token,run.id,query,randomUUID(),exporting),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(s.save(body,key,manager),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(s.service.action(manager.token,run.deliveries[0]!.id,query,randomUUID(),headers,{expected_version:0},randomUUID(),'retry'),{code:'RESOURCE_NOT_FOUND'});
 const denied=await s.service.workspace(manager.token,query,randomUUID());assert.equal(denied.runs.length,0);assert.equal(denied.schedules.length,0);
 await s.service.report(accountant.token,run.id,query,randomUUID());
});
await test('owner source totals reconcile real expenses, recorded cash differences, agent cash and unmatched manual evidence without sensitive text',{timeout:60000},async t=>{
 const s=await setupCashClose(t);await s.db.prepareOwnerReports();await s.receipt();await s.expense(5000,new Date(Date.parse(s.counted)-1000).toISOString());
 const opened=await s.command('open',null,s.openBody),count=await s.command('count',opened.session_id,{expected_version:1,counted_at:s.counted,counted_paise:594500,denominations:[],reason:'Synthetic counted shortage'});assert.equal(count.count!.variance_paise,'-500');
 const agent=await s.grant('delivery_agent',[A]),drawer=await createCashLocationService(s.pool,true,true).configure(s.local.token,null,query,randomUUID(),headers,{account_id:s.account.id,expected_account_version:1,custodian_id:agent.id,name:'Synthetic agent cash',active:true,expected_version:0},randomUUID());
 const receipt=await createMoneyReceiptService(s.pool,true,true).record(s.local.token,query,randomUUID(),headers,{...s.receiptBody,receiver_id:agent.id,custodian_id:agent.id,amount_paise:30000,occurred_at:new Date(Date.now()-1000).toISOString()},randomUUID());assert.ok(receipt.receipt_id);assert.ok(drawer.id);
 const bank=await s.accounts.configure(s.local.token,null,query,randomUUID(),headers,{name:'Synthetic manual bank',methods:['bank_transfer'],other_method_name:null,active:true,expected_version:0},randomUUID()),reconcile=createReconciliationService(s.pool,true);
 await reconcile.configure(s.local.token,query,randomUUID(),headers,{expected_version:0,enabled:true,reason:'Synthetic opt-in'},randomUUID());
 const mapping=await reconcile.publishMapping(s.local.token,null,query,randomUUID(),headers,{expected_version:0,name:'Synthetic map',identity_namespace:'OWNER_TEST',date_column:'Date',date_format:'yyyy-mm-dd',amount:{mode:'signed',unit:'rupees',amount_column:'Amount',positive_direction:'credit'},reference_column:'Ref',identity_column:'ID',currency_column:null},randomUUID());
 const today=new Date(Date.now()+19800000).toISOString().slice(0,10),preview=await reconcile.preview(s.local.token,query,randomUUID(),headers,{account_id:bank.id,mapping_id:mapping.id,period_from:today,period_to:today,content_base64:Buffer.from(`Date,Amount,Ref,ID\n${today},1500,PRIVATE_OWNER_REFERENCE,OWNER-1`).toString('base64')},randomUUID());
 await reconcile.commitImport(s.local.token,preview.id,query,randomUUID(),headers,{rows:[2]},randomUUID());
 const period={frequency:'daily' as const,timezone:'Asia/Kolkata',from:new Date(today+'T00:00:00+05:30').toISOString(),to:new Date().toISOString(),label:today};
 const snapshot=await withReportScope(s.pool,s.local.token,org,A,false,randomUUID(),(scope,cutoff)=>captureOwnerSummary(scope,period,cutoff!),[A],true);
 assert.equal(snapshot.expenses_paise,'5000');assert.equal(snapshot.cash_differences_paise,'500');assert.equal(snapshot.agent_held_known_paise,'30000');assert.equal(snapshot.metrics.collections,'530000');assert.equal(snapshot.reconciliation_exceptions,1);assert.equal(snapshot.reconciliation_state,'available');
 assert.equal(snapshot.evidence.filter(e=>e.kind==='expense').reduce((n,e)=>n+BigInt(e.amount_paise!),0n).toString(),'5000');assert.equal(snapshot.evidence.filter(e=>e.kind.startsWith('reconciliation_')).length,1);
 assert.ok(snapshot.evidence.every(e=>e.occurred_at===null||e.occurred_at.endsWith('Z')));assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_OWNER_REFERENCE'));assert.ok(!JSON.stringify(snapshot).includes('Synthetic supplies'));
});
await test('previews never notify; late evidence appends corrected versions, expiry purges payloads and source failures recover visibly',{timeout:60000},async t=>{
 const s=await setup(t),owner=s.db.ownerPool(),day=new Date(Date.now()+19800000).toISOString().slice(0,10),before=Date.parse(day+'T00:00:00+05:30')-3600000;
 await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');await owner.query('UPDATE shipit.bookings SET confirmed_at=$1 WHERE id=$2',[new Date(before),s.bookingId]);await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');
 const config={...input(s.local.id),enabled:false,corrections:true},schedule=await s.save(config),preview=await s.service.action(s.local.token,schedule.id,query,randomUUID(),headers,{expected_version:1},randomUUID(),'preview');
 assert.equal((await owner.query('SELECT kind FROM shipit.owner_report_runs WHERE id=$1',[preview.id])).rows[0]!.kind,'preview');assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.owner_report_deliveries')).rows[0]!.n,0);
 await s.save({...config,enabled:true,expected_version:1},randomUUID(),s.local,schedule.id);await s.worker.tick();assert.deepEqual(s.failures,[]);
 let workspace=await s.service.workspace(s.local.token,query,randomUUID());const original=workspace.runs.find(r=>r.kind==='summary')!;const frozen=await s.service.report(s.local.token,original.id,query,randomUUID());assert.equal(frozen.snapshot!.metrics.outstanding,'100000');
 const paid=await s.pay(collectionInput(10000));assert.equal(paid.statusCode,200,paid.body);await owner.query('ALTER TABLE shipit.payment_entries DISABLE TRIGGER USER');await owner.query('UPDATE shipit.payment_entries SET occurred_at=$1 WHERE id=$2',[new Date(before+1800000),paid.json().entry.id]);await owner.query('ALTER TABLE shipit.payment_entries ENABLE TRIGGER USER');
 await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await s.worker.tick();workspace=await s.service.workspace(s.local.token,query,randomUUID());const corrected=workspace.runs.find(r=>r.kind==='summary'&&r.version===2)!;assert.equal(corrected.corrected_from,original.id);
 const changed=await s.service.report(s.local.token,corrected.id,query,randomUUID());assert.equal(changed.snapshot!.metrics.outstanding,'90000');assert.equal(changed.snapshot!.metrics.collections,'10000');assert.deepEqual(await s.service.report(s.local.token,original.id,query,randomUUID()),frozen);
 const key=randomUUID(),manual=await s.service.action(s.local.token,corrected.id,query,key,headers,{expected_version:2},randomUUID(),'correct');assert.deepEqual(await s.service.action(s.local.token,corrected.id,query,key,headers,{expected_version:2},randomUUID(),'correct'),manual);
 await owner.query('ALTER TABLE shipit.owner_report_runs DISABLE TRIGGER USER');await owner.query("UPDATE shipit.owner_report_runs SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[original.id]);await owner.query('ALTER TABLE shipit.owner_report_runs ENABLE TRIGGER USER');
 await s.save({...config,expected_version:2},randomUUID(),s.local,schedule.id);await s.worker.tick();assert.equal((await owner.query('SELECT payload FROM shipit.owner_report_runs WHERE id=$1',[original.id])).rows[0]!.payload,null);await assert.rejects(s.service.report(s.local.token,original.id,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const failedSchedule=await s.save({...input(s.local.id),name:'Recover source failure'}),failures:string[]=[];
 await createOwnerSummaryWorker(paymentFault(s.pool,'WITH clock AS','before'),undefined,{enabled:true,onFailure:c=>failures.push(c)}).tick();assert.ok(failures.some(c=>c.startsWith('owner_report_generation_failed')));
 workspace=await s.service.workspace(s.local.token,query,randomUUID());assert.equal(workspace.schedules.find(s=>s.id===failedSchedule.id)!.last_state,'failed');assert.ok(workspace.runs.some(r=>r.schedule_id===failedSchedule.id&&r.state==='failed'&&r.deliveries.length===0));
 await owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[failedSchedule.id]);await s.worker.tick();workspace=await s.service.workspace(s.local.token,query,randomUUID());assert.equal(workspace.schedules.find(s=>s.id===failedSchedule.id)!.last_state,'completed');assert.ok(workspace.runs.some(r=>r.schedule_id===failedSchedule.id&&r.state==='ready'));
 const paymentCounts=await s.paymentCounts();assert.ok(paymentCounts);assert.equal(paymentCounts.entries,1);
});
