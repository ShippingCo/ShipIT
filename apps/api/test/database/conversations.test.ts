import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../../src/modules/whatsapp/consent-worker.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { createConversationWorker } from '../../src/modules/conversations/worker.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { history } from '../../src/modules/conversations/repository.ts';
import { createReceiptService } from '../../src/modules/receipts/service.ts';
import { createPaymentService } from '../../src/modules/payments/service.ts';
import { collectionInput } from '../payment-support.ts';
import { callback,inbound,signed,webhookConfig } from '../webhook-fixture.ts';
import { deliveryProofConfiguration,startTestDelivery,testDeliveryCode } from '../delivery-support.ts';
import { createCustomerService } from '../../src/modules/customers/service.ts';
import { contact } from '../customer-support.ts';
import { draft,input } from '../pricing-support.ts';
import { taxPolicy,taxFacts } from '../tax-support.ts';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';

import { conversationSetup as setup } from '../conversation-support.ts';

await test('signed conversation answers current tracking, replays once and survives worker/pool restart',{timeout:40000},async t=>{
 const s=await setup(t),messageId='wamid.'+randomUUID(),id=await s.message('Where is my parcel?',s.phone,messageId);
 assert.equal(await s.worker.tick(),'answered');assert.equal((await s.turn(id)).intent,'tracking');assert.match(await s.reply(id),/booked.*version 1/);
 assert.match(await s.reply(id),/estimate is unavailable/);
 await s.message('Where is my parcel?',s.phone,messageId);assert.equal(await s.worker.tick(),null);
 const pool=s.db.runtimePool();t.after(()=>pool.close());
 const restarted=createConversationWorker(pool,s.whatsapp,s.keys.browser,deliveryProofConfiguration);assert.equal(await restarted.tick(),null);
 assert.equal(await createOutboundWorker(pool,s.whatsapp).tick(),'accepted');assert.equal(s.sends.length,1);assert.equal(s.sends[0]!.phone,s.phone);
 const second=await s.message('ETA');assert.equal(await restarted.tick(),'answered');assert.equal((await s.turn(second)).intent,'eta');
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer AS n FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[id])).rows[0]!.n,1);
});

await test('multiple shipments require explicit selection; pending tool resumes and a foreign docket cannot reuse old selection',{timeout:40000},async t=>{
 const s=await setup(t,2),id=await s.message('charges');assert.equal(await s.worker.tick(),'selection_required');
 assert.match(await s.reply(id),new RegExp(s.parcels[1]!.docket));
 const select=await s.message(s.parcels[1]!.docket.toLowerCase());assert.equal(await s.worker.tick(),'answered');assert.equal((await s.turn(select)).intent,'charges');
 assert.match(await s.reply(select),/Booked total/);assert.match(await s.reply(select),new RegExp(s.parcels[1]!.docket));
 const denied=await s.message('tracking docket FOREIGN47');assert.equal(await s.worker.tick(),'not_found');assert.doesNotMatch(await s.reply(denied),new RegExp(s.parcels[1]!.docket));
 const ambiguous=await s.message('ETA');assert.equal(await s.worker.tick(),'selection_required');assert.equal((await s.turn(ambiguous)).outcome,'selection_required');
});

await test('STOP is applied before tools; human request wins and pauses tools without inventing a staff case',{timeout:40000},async t=>{
 const s=await setup(t),human=await s.message('human please track my parcel');assert.equal(await s.worker.tick(),'human_requested');
 assert.equal((await s.turn(human)).provenance.length,0);assert.match(await s.reply(human),/case has not been created/);
 const paused=await s.message('charges');assert.equal(await s.worker.tick(),'paused');assert.match(await s.reply(paused),/contact the franchise/i);
 await s.message('RESUME');assert.equal(await s.worker.tick(),'answered');
 const stop=await s.message('STOP tracking');assert.equal(await s.worker.tick(),'consent');
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.whatsapp_consent_state')).rows[0]!.state,'revoked');
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.whatsapp_outbound WHERE conversation_inbox_id=$1',[stop])).rows[0]!.n,0);
 const afterStop=await s.message('resend OTP');assert.equal(await s.worker.tick(),'consent');
 assert.equal((await s.turn(afterStop)).provenance.length,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.delivery_commands WHERE customer_inbox_id=$1',[afterStop])).rows[0]!.n,0);
 while(await s.outbound.tick()!==null){/* every queued reply is suppressed after STOP */}
 assert.equal(s.sends.length,0);
});

await test('pending consent defers a reply without purging it or consuming an external attempt',{timeout:40000},async t=>{
 const s=await setup(t),id=await s.message('tracking');assert.equal(await s.worker.tick(),'answered');
 const body=JSON.stringify(callback([{...inbound('wamid.'+randomUUID(),'hello'),from:'12025550166',timestamp:String(Math.floor(Date.now()/1000))}],{kind:'messages'}));
 assert.equal((await s.app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(body),payload:body})).statusCode,200);
 assert.equal(await s.outbound.tick(),'retry_wait');assert.equal(s.sends.length,0);
 const waiting=(await s.db.adminQuery('SELECT state,sealed_payload,attempts FROM shipit.whatsapp_outbound WHERE conversation_inbox_id=$1',[id])).rows[0]!;
 assert.equal(waiting.state,'retry_wait');assert.ok(waiting.sealed_payload);assert.equal(waiting.attempts,0);
 while(await createInboxWorker(s.pool).tick()!==null){/* process signed source */}
 while(await createConsentWorker(s.pool,webhookConfig).tick()!==null){/* settle unrelated consent */}
 s.whatsapp.clock=()=>new Date(Date.now()+3000);
 assert.equal(await s.outbound.tick(),'accepted');assert.equal(s.sends.length,1);
});

await test('finance uses frozen booking/ledger and receipt snapshots; recipients get only tracking',{timeout:40000},async t=>{
 const s=await setup(t),receiptService=createReceiptService(s.pool),booking=(await s.db.adminQuery<{booking_id:string}>('SELECT booking_id FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0]!.booking_id;
 const issued=await receiptService.read(s.operator.token,booking,null,s.q,randomUUID());
 const old=(await s.db.adminQuery<{total_paise:string}>('SELECT total_paise::text FROM shipit.booking_obligations WHERE booking_id=$1',[booking])).rows[0]!.total_paise;
 // Publish a new tax rule. Existing booking answers must retain their saved amount.
 const policy=await s.tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,effective_from:'2099-01-02T00:00:00Z',effective_to:'2099-01-03T00:00:00Z',rules:taxPolicy.rules.map(r=>({...r,components:r.components.map(v=>({...v,denominator:20}))}))},randomUUID());
 await s.tax.publish(s.local.token,org,A,policy.id,randomUUID(),{expected_version:1},randomUUID());
 const charges=await s.message('charges');assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(charges),new RegExp(`INR ${BigInt(old)/100n}\\.`));
 const paymentKey=randomUUID();await createPaymentService(s.pool).execute(s.local.token,booking,null,s.q,paymentKey,['idempotency-key',paymentKey],collectionInput(100),'payments.collect',randomUUID());
 const collected=await s.message('balance');assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(collected),/Collected INR 1\.00/);
 const remaining=BigInt(old)-100n;assert.match(await s.reply(collected),new RegExp(`Remaining INR ${remaining/100n}\\.${String(remaining%100n).padStart(2,'0')}`));
 const receipt=await s.message('receipt');assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(receipt),new RegExp(issued.number));
 // Corrected money must also reach the deterministic customer answer, without
 // replacing the original receipt or granting finance data to a recipient.
 const finance=(await import('../../src/modules/reports/finance-service.ts')).createFinanceService(s.pool);
 const current=await finance.read(s.local.token,s.q,booking,randomUUID()),cancelKey=randomUUID();
 await finance.change(s.local.token,s.q,cancelKey,['idempotency-key',cancelKey],{booking_id:booking,expected_version:current.version,payment_version:current.payment_version,
  kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYN_CUSTOMER_CORRECTION',...Object.fromEntries(['pre_tax','taxable','cgst','sgst','igst','rounding'].map(k=>[k,Number(current[k as keyof typeof current])]))},randomUUID());
 const refundKey=randomUUID();await finance.change(s.local.token,s.q,refundKey,['idempotency-key',refundKey],{booking_id:booking,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',approval_ref:'SYN_REVIEW',returned_to_ref:'SYN_RETURN',refund:100},randomUUID());
 const corrected=await s.message('charges');assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(corrected),/Adjusted charge INR 0\.00/);assert.match(await s.reply(corrected),/Actually refunded INR 1\.00/);assert.match(await s.reply(corrected),/Remaining INR 0\.00/);
 assert.deepEqual(await receiptService.read(s.operator.token,booking,null,s.q,randomUUID()),issued);
 const recipient='+12025550101',proof=await s.message('hello',recipient);await s.bind(proof,s.parcel,'recipient');await s.worker.tick();
 const forbidden=await s.message('charges',recipient);assert.equal(await s.worker.tick(),'forbidden');assert.doesNotMatch(await s.reply(forbidden),/Booked total/);
 const tracked=await s.message('tracking',recipient);assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(tracked),/booked/);
});

await test('revocation and contact changes reauthorize queued replies and later turns',{timeout:40000},async t=>{
 const s=await setup(t),id=await s.message('tracking');assert.equal(await s.worker.tick(),'answered');
 await s.access.revoke(s.admin.token,s.parcel.id,s.q,randomUUID(),{relation:'sender',expected_version:1,evidence_ref:randomUUID()},randomUUID());
 assert.equal(await s.outbound.tick(),'suppressed');assert.equal(s.sends.length,0);
 const denied=await s.message('ETA');assert.equal(await s.worker.tick(),'not_found');assert.equal((await s.turn(denied)).provenance.length,0);
 const fresh=await s.message('hello');await s.bind(fresh,s.parcel,'sender',2);await s.worker.tick();
 const queued=await s.message('tracking');assert.equal(await s.worker.tick(),'answered');
 await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),{...contact,phone:'+12025550199',expected_version:1},randomUUID());
 // Drain non-sensitive clarification then the reply carrying the old binding generation.
 while(await s.outbound.tick()!==null){/* no private old-generation reply may be sent */}
 assert.ok(s.sends.every(v=>!v.text.includes(s.parcel.docket)));
 assert.equal((await s.turn(id)).outcome,'answered');assert.equal((await s.turn(queued)).outcome,'answered');
});

await test('concurrent workers preserve one turn and ordered selection; history and stored audit omit transcript/tokens',{timeout:40000},async t=>{
 const s=await setup(t),id=await s.message('tracking');
 const pool=s.db.runtimePool();t.after(()=>pool.close());const other=createConversationWorker(pool,s.whatsapp,s.keys.browser,deliveryProofConfiguration);
 const results=await Promise.all([s.worker.tick(),other.tick()]);assert.equal(results.filter(v=>v==='answered').length,1);
 for(let i=0;i<22;i++){await s.message('tracking');assert.equal(await s.worker.tick(),'answered');}
 const c=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.customer_conversations')).rows[0]!;
 const rows=await withTransaction(s.pool,tx=>history(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},organizationId:org,
  permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),c.id));assert.equal(rows.length,20);
 const retained=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.customer_conversation_turns')).rows);
 for(const privateValue of [s.phone,'Where is my parcel?','Synthetic Recipient','21 Fictional Street','sealed_payload','grant','otp'])assert.equal(retained.includes(privateValue),false);
 assert.equal((await s.turn(id)).outcome,'answered');assert.ok(!JSON.stringify(s.logs).includes(s.phone));
 const owner=s.db.ownerPool();try {
  await assert.rejects(owner.query('UPDATE shipit.customer_conversation_turns SET outcome=outcome WHERE inbox_id=$1',[id]));
  await assert.rejects(s.pool.query('DELETE FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[id]));
  assert.equal((await owner.query("SELECT has_function_privilege('public','shipit.customer_conversation_next()','EXECUTE') AS allowed")).rows[0]!.allowed,false);
 }finally{await owner.close();}
});

await test('expired source, malformed encrypted input and database failure are controlled; uncertain provider acceptance is never blindly resent',{timeout:40000},async t=>{
 const s=await setup(t),stale=await s.message('tracking',s.phone,undefined,901);assert.equal(await s.worker.tick(),'stale');
 assert.equal((await s.turn(stale)).provenance.length,0);
 s.setOutcome({kind:'uncertain',reason:'acceptance_unknown'});await s.message('tracking');assert.equal(await s.worker.tick(),'answered');
 assert.equal(await s.outbound.tick(),'uncertain');assert.equal(await s.outbound.tick(),null);assert.equal(s.sends.length,1);
 const owner=s.db.ownerPool();try {await owner.query('REVOKE SELECT ON shipit.booking_obligations FROM '+s.db.runtimeRole);}finally{await owner.close();}
 const fail=await s.message('charges');assert.equal(await s.worker.tick(),'unavailable');assert.match(await s.reply(fail),/retry once/);assert.equal((await s.turn(fail)).provenance.length,0);
 assert.deepEqual((await s.db.adminQuery('SELECT intent,metric_category,metric_reason FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[fail])).rows[0],{intent:'charges',metric_category:'failure',metric_reason:'dependency'});
 assert.deepEqual((await s.db.adminQuery('SELECT metric_category,metric_reason FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[stale])).rows[0],{metric_category:'failure',metric_reason:'stale'});
 const disabled=createConversationWorker(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,conversation_enabled:false}},s.keys.browser);assert.equal(await disabled.tick(),null);
});

await test('forward upgrade preserves existing operational rows and creates no automatic turn/access',{timeout:40000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:30}),{applied:30});const migrate=db.migrate;db.migrate=async()=>({applied:0});
 const s=await bookingSetup(t,db);assert.equal((await s.book()).statusCode,201);db.migrate=migrate;
 const snapshot=async()=>JSON.stringify((await db.adminQuery('SELECT id,status,version,booking_id FROM shipit.parcels')).rows),before=await snapshot();
 assert.deepEqual(await db.migrate(),{applied:13});assert.deepEqual(await db.migrate(),{applied:0});assert.equal(await snapshot(),before);
 assert.equal((await db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_conversation_turns')).rows[0]!.n,0);
});

await test('valid sibling-franchise and unrelated-organization dockets remain indistinguishable from unknown dockets',{timeout:60000},async t=>{
 const s=await setup(t),foreignDockets:string[]=[];
 const configurations=[...s.whatsapp.configuration.bindings];
 for(const [i,organization,franchise] of [[0,org,B],[1,otherOrg,C]] as const) {
  let owner:{id:string;token:string};
  let root=s.root;
  if(i===0)owner=await s.grant('franchise_admin',[B]);
  else {root=await s.user();await s.memberships.bootstrapAdministrator(root.id,otherOrg);owner=await s.user();
   const invitation=await s.memberships.createInvitation(root.token,{organization_id:otherOrg,invitee_user_id:owner.id,role:'franchise_admin',franchise_ids:[C]});
   await s.memberships.acceptInvitation(owner.token,{token:invitation.acceptance_token});}
  const operatorInvitation=await s.memberships.createInvitation(root.token,{organization_id:organization,invitee_user_id:owner.id,role:'operator',franchise_ids:[franchise]});
  await s.memberships.acceptInvitation(owner.token,{token:operatorInvitation.acceptance_token});
  const customer=await createCustomerService(s.pool,s.keys.browser).create(owner.token,organization,franchise,randomUUID(),contact,randomUUID());
  const price=await s.pricing.create(owner.token,organization,franchise,randomUUID(),draft,randomUUID());await s.pricing.publish(owner.token,organization,franchise,price.id,randomUUID(),{expected_version:1},randomUUID());
  const policy=await s.tax.create(owner.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(owner.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());
  const quote=await s.pricing.quote(owner.token,organization,franchise,randomUUID(),input,randomUUID()),tax_intent={quote_id:quote.id,pricing_input:input,facts:taxFacts};
  const prepared=await s.tax.prepare(owner.token,organization,franchise,randomUUID(),tax_intent,randomUUID()),calculated=await s.tax.calculate(owner.token,organization,franchise,randomUUID(),{intent_id:prepared.id},randomUUID());
  const booked=await s.booking.create(owner.token,organization,franchise,randomUUID(),{customer_id:customer.id,expected_customer_version:1,tax_calculation_id:calculated.id,tax_intent,parcels:s.body.parcels},randomUUID());
  const p=booked.parcels[0]!;foreignDockets.push(p.docket);
  const channel={key:`conversation_foreign_${i}`,organization_id:organization,franchise_id:franchise,waba_id:i===0?'200001':'300001',phone_number_id:i===0?'200002':'300002',credential_ref:`whatsapp:foreign${i}/v1`};
  configurations.push(channel);
  await createWhatsappService(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,bindings:[channel]}}).execute(owner.token,null,'connect',{organization_id:organization,franchise_id:franchise},randomUUID(),{binding_key:channel.key,expected_version:0},randomUUID());
  const inbox=await s.message('tracking',s.phone,undefined,0,{waba:channel.waba_id,phone:channel.phone_number_id});
  await s.access.bind(owner.token,p.id,{organization_id:organization,franchise_id:franchise},randomUUID(),{inbox_id:inbox,relation:'sender',expected_version:0,evidence_ref:randomUUID()},randomUUID());
  assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(inbox),new RegExp(p.docket));
 }
 const replies:string[]=[];
 for(const docket of [...foreignDockets,'UNKNOWN47']) {const id=await s.message('tracking docket '+docket);assert.equal(await s.worker.tick(),'not_found');replies.push(await s.reply(id));assert.equal((await s.turn(id)).provenance.length,0);}
 assert.equal(new Set(replies).size,1);
 const reader=await s.grant('read_only',[A]),proof=await s.message('hello');
 await assert.rejects(s.access.bind(reader.token,s.parcel.id,s.q,randomUUID(),{inbox_id:proof,relation:'sender',expected_version:1,evidence_ref:randomUUID()},randomUUID()),{code:'ACTION_FORBIDDEN'});
 assert.equal((await s.app.inject({method:'POST',url:'/api/v1/conversations/tools',payload:{organization_id:otherOrg,franchise_id:C,docket:foreignDockets[1],phone:s.phone,tool:'SQL'}})).statusCode,404);
});

await test('delivery assistance calls shared resend policy, targets actual recipient and never reveals code',{timeout:60000},async t=>{
 const s=await setup(t,2),agent=await s.grant('delivery_agent',[A]);
 const installation=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_installations')).rows[0]!.id;
 s.whatsapp.clock=()=>new Date(Date.now()-62000);
 await createWhatsappService(s.pool,s.whatsapp).execute(s.admin.token,installation,'sync',s.q,randomUUID(),{expected_version:1,name:'shipit_delivery_code',language:'en'},randomUUID());
 s.whatsapp.clock=()=>new Date();
 const started=await startTestDelivery({...s,clock:()=>new Date(Date.now()-61000)},s.parcel.id,agent,undefined,s.whatsapp);
 assert.equal(await s.outbound.tick(),'accepted');assert.equal(s.codes.length,1);
 const code=await testDeliveryCode(s,s.parcel.id),recipient='+12025550101';
 const proof=await s.message('hello',recipient);for(const p of s.parcels)await s.bind(proof,p,'recipient');await s.worker.tick();await s.outbound.tick();
 const sender=await s.message('resend OTP docket '+s.parcel.docket);assert.equal(await s.worker.tick(),'forbidden');assert.doesNotMatch(await s.reply(sender),new RegExp(code));
 const ambiguous=await s.message('resend OTP',recipient);assert.equal(await s.worker.tick(),'selection_required');
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.delivery_commands WHERE customer_inbox_id=$1',[ambiguous])).rows[0]!.n,0);
 assert.match(await s.reply(ambiguous),new RegExp(s.parcels[1]!.docket));
 const request=await s.message(s.parcel.docket,recipient);assert.equal(await s.worker.tick(),'answered');assert.match(await s.reply(request),/resend queued/);assert.doesNotMatch(await s.reply(request),new RegExp(code));
 const command=(await s.db.adminQuery('SELECT principal_id,operation_id,result FROM shipit.delivery_commands WHERE customer_inbox_id=$1',[request])).rows[0]!;
 assert.equal(command.principal_id,null);assert.equal(command.operation_id,'api.v1.deliveries.resend');assert.equal(command.result.state,'queued');
 const limited=await s.message('OTP',recipient);assert.equal(await s.worker.tick(),'unavailable');assert.match(await s.reply(limited),/limited/);
 while(await s.outbound.tick()!==null){/* consume safe response and protected challenge */}
 assert.equal(s.codes.length,2);assert.ok(s.codes.every(v=>v[0]===code));
 const publicState=JSON.stringify((await s.db.adminQuery('SELECT result,input FROM shipit.delivery_commands WHERE customer_inbox_id IS NOT NULL')).rows);
 assert.equal(publicState.includes(code),false);assert.equal(JSON.stringify(s.logs).includes(code),false);
 const completeKey=randomUUID();await started.service.complete(agent.token,s.parcel.id,s.q,completeKey,['idempotency-key',completeKey],{expected_version:5,challenge_ref:started.state.challenge_ref,challenge_version:1,proof:code},false,randomUUID());
 const delivered=await s.message('resend OTP',recipient);assert.equal(await s.worker.tick(),'unavailable');assert.doesNotMatch(await s.reply(delivered),new RegExp(code));
 const changed=await s.message('hello','+12025550188');await s.bind(changed,s.parcel,'recipient',1,true);await s.worker.tick();
 const foreignRecipient=await s.message('OTP','+12025550188');assert.equal(await s.worker.tick(),'forbidden');assert.equal((await s.turn(foreignRecipient)).outcome,'forbidden');
});

await test('tool lock timeout rolls back grants and returns a bounded retry; ciphertext/key failure reveals no input',{timeout:40000},async t=>{
 const s=await setup(t),id=await s.message('tracking'),owner=s.db.ownerPool();
 try {
  await withTransaction(owner,async tx=>{await tx.query('SELECT id FROM shipit.parcels WHERE id=$1 FOR UPDATE',[s.parcel.id]);
   assert.equal(await s.worker.tick(),'unavailable');});
 }finally{await owner.close();}
 assert.match(await s.reply(id),/retry once/);assert.equal((await s.turn(id)).provenance.length,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_tracking_grants WHERE inbox_id=$1',[id])).rows[0]!.n,0);
 const next=await s.message('tracking');const wrongKey=createConversationWorker(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,webhook:{...webhookConfig,key_version:'missing47'}}},s.keys.browser);
 assert.equal(await wrongKey.tick(),'invalid');assert.equal((await s.turn(next)).provenance.length,0);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.whatsapp_outbound WHERE conversation_inbox_id=$1',[next])).rows[0]!.n,0);
});
