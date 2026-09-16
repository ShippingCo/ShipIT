import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { receiptSetup } from '../receipt-support.ts';
import { createReceiptService } from '../../src/modules/receipts/service.ts';
import { org,A } from '../audit-support.ts';
await test('receipt concurrent first retrieval, repeat reads and pool restart preserve one immutable artifact',{timeout:30000},async t=>{
 const s=await receiptSetup(t),before=await s.effects();
 const responses=await Promise.all(Array.from({length:12},()=>s.receipt()));
 for(const r of responses)assert.equal(r.statusCode,200,r.body);
 const dto=responses[0]!.json();for(const r of responses)assert.deepEqual(r.json(),dto);
 assert.equal(dto.kind,'booking_charge');assert.match(dto.number,/^RCT-\d{19}$/);
 assert.equal(dto.charges.tax.final_payable_paise,s.gross);
 const after=await s.effects();assert.deepEqual(after,{...before,receipts:1,receipt_audits:1});
 const restarted=createReceiptService(s.db.runtimePool());
 assert.deepEqual(await restarted.read(s.local.token,s.bookingId,null,{organization_id:org,franchise_id:A},randomUUID()),dto);
 assert.deepEqual((await s.direct(dto.id)).json(),dto);assert.deepEqual(await s.effects(),after);
});
await test('issued receipt freezes issuer, customer, pricing and tax across configuration changes',{timeout:30000},async t=>{
 const s=await receiptSetup(t),first=await s.receipt();assert.equal(first.statusCode,200,first.body);const dto=first.json();
 const {contact}=await import('../customer-support.ts'),{draft}=await import('../pricing-support.ts'),{taxPolicy}=await import('../tax-support.ts');
 await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),{...contact,name:'Changed Synthetic Customer',expected_version:1},randomUUID());
 await s.db.ownerPool().query("UPDATE shipit.organizations SET display_name='Synthetic Issuer B',version=version+1 WHERE id=$1",[org]);
 await s.db.ownerPool().query("UPDATE shipit.franchises SET display_name='Synthetic Branch B',version=version+1 WHERE organization_id=$1 AND id=$2",[org,A]);
 const next={...draft,effective_from:'2099-01-02T00:00:00Z',effective_to:'2099-01-03T00:00:00Z',rules:draft.rules.map(r=>({...r,freight_paise:r.freight_paise+2000}))};
 const price=await s.pricing.create(s.local.token,org,A,randomUUID(),next,randomUUID());await s.pricing.publish(s.local.token,org,A,price.id,randomUUID(),{expected_version:1},randomUUID());
 const policy=await s.tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,effective_from:next.effective_from,effective_to:next.effective_to,supplier_gstin:'27PQRST1234F1Z5'},randomUUID());
 await s.tax.publish(s.local.token,org,A,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(next.effective_from);
 assert.deepEqual((await s.receipt()).json(),dto);assert.deepEqual((await s.direct(dto.id)).json(),dto);
 assert.notEqual(dto.issuer.organization_name,'Synthetic Issuer B');assert.equal(dto.issuer.supplier_gstin,taxPolicy.supplier_gstin);
 const issued=await s.pay((await import('../payment-support.ts')).collectionInput(123));assert.equal(issued.statusCode,200,issued.body);
 assert.deepEqual((await s.receipt(issued.json().entry.id)).json().issuer,dto.issuer);
});
await test('partial/full collection, reversal and recollection retain separate immutable entry-only documents',{timeout:30000},async t=>{
 const s=await receiptSetup(t),{collectionInput}=await import('../payment-support.ts');
 const booking=(await s.receipt()).json();assert.ok(!/paid|settled|outstanding|collected/.test(JSON.stringify(booking)));
 const partial=await s.pay(collectionInput(4001));assert.equal(partial.statusCode,200,partial.body);
 const ack=(await s.receipt(partial.json().entry.id)).json();assert.equal(ack.kind,'collection_acknowledgement');assert.deepEqual(ack.entry,partial.json().entry);
 assert.equal(ack.entry.amount_paise,4001);assert.equal(ack.booking_receipt_id,booking.id);
 const full=await s.pay(collectionInput(s.gross-4001));assert.equal(full.json().payment.state,'settled');
 const fullAck=(await s.receipt(full.json().entry.id)).json();assert.ok(!/outstanding|settled|payment_result/.test(JSON.stringify(fullAck)));
 const reversed=await s.reverse(partial.json().entry.id,1000);assert.equal(reversed.statusCode,200,reversed.body);
 const amendment=(await s.receipt(reversed.json().entry.id)).json();assert.equal(amendment.kind,'collection_reversal');
 assert.equal(amendment.correction_of,ack.id);assert.equal(amendment.version,reversed.json().entry.version);assert.deepEqual(amendment.entry,reversed.json().entry);
 assert.deepEqual((await s.receipt(partial.json().entry.id)).json(),ack);assert.deepEqual((await s.receipt()).json(),booking);
 assert.equal((await s.current()).json().outstanding_paise,1000);
 const recollected=await s.pay(collectionInput(1000)),reAck=(await s.receipt(recollected.json().entry.id)).json();
 assert.notEqual(reAck.id,ack.id);assert.notEqual(reAck.number,ack.number);
 const before=await s.effects();for(let i=0;i<4;i++){await s.receipt();await s.receipt(partial.json().entry.id);await s.receipt(reversed.json().entry.id);}
 assert.deepEqual(await s.effects(),before);
 const audits=(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='receipt'")).rows;
 assert.equal(audits.length,5);assert.ok(!/customer_name|phone|address|amount_paise/.test(JSON.stringify(audits)));
 assert.ok(!/customer_name|phone|address|amount_paise|RCT-|idempotency-key|cookie|SYN_SECRET/.test(s.logs.join('\n')));
});
await test('retrieving a reversal first atomically materializes the original chain without inventing collection',{timeout:30000},async t=>{
 const s=await receiptSetup(t),paid=await s.pay(),rev=await s.reverse(paid.json().entry.id,500);
 const before=await s.effects(),r=await s.receipt(rev.json().entry.id);assert.equal(r.statusCode,200,r.body);
 const correction=r.json(),original=(await s.direct(correction.correction_of)).json();assert.equal(original.entry.id,paid.json().entry.id);
 assert.deepEqual(await s.effects(),{...before,receipts:3,receipt_audits:3});
 assert.deepEqual((await s.receipt(rev.json().entry.id)).json(),correction);
});
await test('delivered parcels with outstanding money cannot turn a booking receipt into settlement',{timeout:30000},async t=>{
 const s=await receiptSetup(t);await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
 try {await s.db.adminQuery("UPDATE shipit.parcels SET status='delivered',custody='recipient'");}
 finally {await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');}
 const first=await s.receipt();assert.equal(first.statusCode,200,first.body);assert.ok(!/paid|settled|delivered|status/.test(first.body));
 assert.equal((await s.current()).json().outstanding_paise,s.gross);
 const parcels=(await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows;
 const paid=await s.pay();await s.reverse(paid.json().entry.id,1);await s.receipt(paid.json().entry.id);
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows,parcels);assert.deepEqual((await s.receipt()).json(),first.json());
});
await test('receipt failure boundaries roll back issuance and audit, and uncertain COMMIT recovers across pool restart',{timeout:30000},async t=>{
 const s=await receiptSetup(t),{paymentFault}=await import('../payment-support.ts'),q={organization_id:org,franchise_id:A},before=await s.effects();
 for(const [point,mode] of [['FROM shipit.booking_obligations','before'],['INSERT INTO shipit.issued_receipts','before'],['INSERT INTO shipit.issued_receipts','after'],['INSERT INTO shipit.issued_receipts','omit'],['COMMIT','before']] as const){
  await assert.rejects(createReceiptService(paymentFault(s.pool,point,mode)).read(s.local.token,s.bookingId,null,q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.effects(),before,point+mode);
 }
 // A fixture-only trigger fails after source derivation/sequence reservation, before persistence.
 await s.db.adminQuery("CREATE FUNCTION shipit.receipt_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYN_FAILURE'; END $$; CREATE TRIGGER zz_receipt_test_failure BEFORE INSERT ON shipit.issued_receipts FOR EACH ROW EXECUTE FUNCTION shipit.receipt_test_failure()");
 const seqBefore=(await s.db.adminQuery('SELECT last_value FROM shipit.issued_receipt_numbers')).rows[0]!.last_value;
 try {const failed=await s.receipt();assert.equal(failed.statusCode,503,failed.body);assert.equal(failed.json().error.code,'TEMPORARILY_UNAVAILABLE');assert.ok(!/SYN_FAILURE|sql|stack|constraint/.test(failed.body));}
 finally {await s.db.adminQuery('DROP TRIGGER zz_receipt_test_failure ON shipit.issued_receipts; DROP FUNCTION shipit.receipt_test_failure()');}
 assert.notEqual((await s.db.adminQuery('SELECT last_value FROM shipit.issued_receipt_numbers')).rows[0]!.last_value,seqBefore);assert.deepEqual(await s.effects(),before);
 await assert.rejects(createReceiptService(paymentFault(s.pool,'COMMIT')).read(s.local.token,s.bookingId,null,q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const saved=await s.effects(),recovered=await createReceiptService(s.db.runtimePool()).read(s.local.token,s.bookingId,null,q,randomUUID());
 assert.equal(saved!.receipts,1);assert.deepEqual((await s.direct(recovered.id)).json(),recovered);assert.deepEqual(await s.effects(),saved);
});
await test('R13 checks all canonical roles, mixed roles, revocation and disabled historical reads',{timeout:30000},async t=>{
 const s=await receiptSetup(t);const booking=(await s.receipt()).json(),paid=await s.pay(),ack=(await s.receipt(paid.json().entry.id)).json();
 for(const role of ['franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only']){
  const actor=await s.grant(role,[A]),status=['franchise_admin','operator','accountant'].includes(role)?200:403;
  assert.equal((await s.receipt(undefined,actor)).statusCode,status,role);assert.equal((await s.receipt(paid.json().entry.id,actor)).statusCode,status,role);
  assert.equal((await s.direct(booking.id,actor)).statusCode,status,role);
  if(status===200)assert.deepEqual((await s.direct(ack.id,actor)).json(),ack);
  if(role==='accountant'){
   const audit=await s.list(actor.token);assert.ok(audit.json().items.some((x:{resource:{type:string}})=>x.resource.type==='receipt'));assert.ok(audit.json().items.every((x:{resource:{type:string}})=>['receipt','payment_obligation'].includes(x.resource.type)));
   const first=await s.list(actor.token,{resource_type:'receipt',limit:'1'});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().page.has_more,true);
   const second=await s.list(actor.token,{resource_type:'receipt',limit:'1',cursor:first.json().page.next_cursor});assert.equal(second.statusCode,200,second.body);assert.notEqual(first.json().items[0].id,second.json().items[0].id);assert.equal(second.json().page.has_more,false);
  }
 }
 assert.equal((await s.receipt(undefined,s.admin)).statusCode,200);
 const mixed=await s.grant('delivery_agent',[A]);const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:mixed.id,role:'accountant',franchise_ids:[A]});await s.memberships.acceptInvitation(mixed.token,{token:invite.acceptance_token});
 assert.equal((await s.receipt(undefined,mixed)).statusCode,200);
 const revoked=await s.grant('operator',[A]);await s.memberships.revokeMembership(s.admin.token,revoked.member.id,{expected_version:1});assert.equal((await s.receipt(undefined,revoked)).statusCode,404);
 for(const [table,id] of [['franchises',A],['organizations',org]]){
  await s.db.ownerPool().query(`UPDATE shipit.${table} SET lifecycle='disabled',version=version+1 WHERE id=$1`,[id]);
  assert.deepEqual((await s.receipt()).json(),booking);assert.deepEqual((await s.direct(ack.id)).json(),ack);
 }
});
await test('receipt validation, authentication, private cache and method boundaries are controlled',{timeout:30000},async t=>{
 const s=await receiptSetup(t),before=await s.effects();
 for(const path of ['/api/v1/bookings/bad/receipt','/api/v1/bookings/'+s.bookingId+'/payments/bad/receipt','/api/v1/receipts/bad']){
  const r=await s.app.inject({url:path+'?organization_id='+org+'&franchise_id='+A,cookies:s.cookies(s.local.token)});assert.equal(r.statusCode,422,r.body);
 }
 for(const query of ['', '?organization_id='+org,'?organization_id='+org+'&franchise_id=bad','?organization_id='+org+'&franchise_id='+A+'&download_url=https://foreign.example/receipt']){
  const r=await s.app.inject({url:'/api/v1/bookings/'+s.bookingId+'/receipt'+query,cookies:s.cookies(s.local.token)});assert.equal(r.statusCode,422,r.body);
 }
 const unauth=await s.receipt(undefined,{...s.local,token:''});assert.equal(unauth.statusCode,401,unauth.body);
 const url='/api/v1/bookings/'+s.bookingId+'/receipt?organization_id='+org+'&franchise_id='+A;
 for(const method of ['HEAD','POST','PUT','DELETE'] as const)assert.notEqual((await s.app.inject({method,url,cookies:s.cookies(s.local.token)})).statusCode,200);
 assert.deepEqual(await s.effects(),before);
 const valid=await s.receipt();assert.equal(valid.statusCode,200,valid.body);assert.equal(valid.headers['cache-control'],'no-store');
 assert.ok(!/organization_id|franchise_id|actor_id|correlation_id|fingerprint|key_digest|tax_intent|phone|address|receipt_url|download_url/.test(valid.body));
 assert.equal((await s.direct(valid.json().number)).statusCode,422);
});
await test('A/B/C tenant isolation hides real foreign booking, payment, receipt and correction identifiers',{timeout:30000},async t=>{
 const s=await receiptSetup(t),{B,otherOrg,C}=await import('../audit-support.ts'),{collectionInput}=await import('../payment-support.ts');
 const {draft,start,input}=await import('../pricing-support.ts'),{taxPolicy,taxFacts}=await import('../tax-support.ts'),{contact}=await import('../customer-support.ts');
 const ownOrgAdmin=await s.grant('org_admin',[],org);
 await s.memberships.bootstrapAdministrator(s.admin.id,otherOrg);
 const ownBase=(await s.receipt()).json(),ownPaid=await s.pay(collectionInput(100)),ownRev=await s.reverse(ownPaid.json().entry.id,1);
 const errors:unknown[]=[];
 for(const [organization,franchise] of [[org,B],[otherOrg,C]] as const){
  const admin=await s.grant('franchise_admin',[franchise],organization),operator=await s.grant('operator',[franchise],organization);
  s.setNow('2098-12-31T23:00:00Z');const price=await s.pricing.create(admin.token,organization,franchise,randomUUID(),draft,randomUUID());
  await s.pricing.publish(admin.token,organization,franchise,price.id,randomUUID(),{expected_version:1},randomUUID());
  const policy=await s.tax.create(admin.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(admin.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
  const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID());
  const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),input,randomUUID()),intentBody={quote_id:quote.id,pricing_input:input,facts:taxFacts};
  const intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),intentBody,randomUUID());
  const tax=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());
  const booked=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:tax.id,tax_intent:intentBody},randomUUID(),operator.token,franchise,organization);
  assert.equal(booked.statusCode,201,booked.body);const booking=booked.json().id as string;
  const paid=await s.request('POST',booking+'/payments',collectionInput(100),admin,randomUUID(),organization,franchise);assert.equal(paid.statusCode,200,paid.body);
  const reversal=await s.request('POST',booking+'/payments/'+paid.json().entry.id+'/reversals',{amount_paise:1,currency:'INR',reason_code:'incorrect_amount'},admin,randomUUID(),organization,franchise);
  const correction=await s.receipt(reversal.json().entry.id,admin,booking,organization,franchise);assert.equal(correction.statusCode,200,correction.body);
  const receipts=[correction.json().id,correction.json().correction_of,correction.json().booking_receipt_id];
  const before=await s.effects();
  // Valid A source plus real B/C nested IDs: database guards independently reject mixed-owner chains.
  const insert=`INSERT INTO shipit.issued_receipts(id,organization_id,franchise_id,booking_id,obligation_id,kind,payment_entry_id,booking_receipt_id,correction_of,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
  for(const [kind,payment,base,corrected] of [
   ['collection_acknowledgement',paid.json().entry.id,ownBase.id,null],
   ['collection_acknowledgement',ownPaid.json().entry.id,correction.json().booking_receipt_id,null],
   ['collection_reversal',ownRev.json().entry.id,ownBase.id,correction.json().correction_of]]){
   await assert.rejects(s.pool.query(insert,[randomUUID(),org,A,s.bookingId,s.booked.payment_obligation.id,kind,payment,base,corrected,s.local.id,randomUUID()]),e=>(e as {sqlState?:string}).sqlState==='23514');
  }
  for(const response of [await s.receipt(undefined,s.local,booking),await s.receipt(paid.json().entry.id),await s.receipt(reversal.json().entry.id),
    await s.receipt(undefined,s.local,booking,organization,franchise),...await Promise.all(receipts.map(id=>s.direct(id))),
    await s.direct(receipts[0],s.local,organization,franchise)]){
   assert.equal(response.statusCode,404,response.body);const error=response.json().error;delete error.correlation_id;errors.push(error);
   assert.ok(!/Synthetic|customer|phone|address|RCT-/.test(response.body));
  }
  assert.deepEqual(await s.effects(),before);
  // org_admin must explicitly select an owned branch; selecting A cannot reveal B/C.
  assert.equal((await s.direct(receipts[0],s.admin)).statusCode,404);
  assert.equal((await s.direct(receipts[0],s.admin,organization,franchise)).statusCode,200);
  assert.equal((await s.direct(receipts[0],ownOrgAdmin,organization,franchise)).statusCode,organization===org?200:404);
 }
 for(const r of [await s.receipt(undefined,s.local,randomUUID()),await s.receipt(randomUUID()),await s.direct(randomUUID())]){assert.equal(r.statusCode,404,r.body);const e=r.json().error;delete e.correlation_id;errors.push(e);}
 for(const e of errors)assert.deepEqual(e,errors[0]);
});
for(const variant of ['intra','inter','zero','odd'] as const)await test(`receipt exactly copies ${variant} frozen tax with no second rounding`,{timeout:30000},async t=>{
 const {pricingSetup,draft,input,start}=await import('../pricing-support.ts'),{taxPolicy,taxFacts}=await import('../tax-support.ts'),{contact}=await import('../customer-support.ts');
 const {createTaxService}=await import('../../src/modules/tax/service.ts'),{createCustomerService}=await import('../../src/modules/customers/service.ts');
 const s=await pricingSetup(t);await s.db.prepareReceipts();
 await s.published(variant==='odd'?{...draft,rules:draft.rules.map(r=>({...r,freight_paise:9852}))}:draft);
 const tax=createTaxService(s.pool,s.clock),rule=taxPolicy.rules[0]!;
 const policy=await tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,rules:[variant==='inter'?{...rule,jurisdiction:'inter',components:[{id:'I',kind:'IGST',numerator:1,denominator:20}]}:variant==='zero'?{...rule,treatment:'exempt',taxable_lines:[],components:[]}:rule]},randomUUID());
 await tax.publish(s.local.token,org,A,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
 const malicious='<script>alert(1)</script><img src=x onerror=alert(1)>',customer=await createCustomerService(s.pool,s.keys.browser).create(s.operator.token,org,A,randomUUID(),{...contact,name:malicious},randomUUID());
 const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),input,randomUUID()),intentBody={quote_id:quote.id,pricing_input:input,facts:{...taxFacts,handover_state:variant==='inter'?'24':'27'}};
 const intent=await tax.prepare(s.operator.token,org,A,randomUUID(),intentBody,randomUUID()),calculated=await tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 const booking=await s.app.inject({method:'POST',url:'/api/v1/bookings?organization_id='+org+'&franchise_id='+A,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:JSON.stringify({customer_id:customer.id,expected_customer_version:1,tax_calculation_id:calculated.id,tax_intent:intentBody,parcels:[{weight_grams:999,recipient:{name:'Synthetic Recipient',phone:'+1 202-555-0101',address:'21 Fictional Street'}}]})});
 assert.equal(booking.statusCode,201,booking.body);
 const dto=await createReceiptService(s.pool).read(s.operator.token,booking.json().id,null,{organization_id:org,franchise_id:A},randomUUID());assert.equal(dto.kind,'booking_charge');if(dto.kind!=='booking_charge')throw Error('SYN_KIND');
 const frozen=booking.json().charges.tax;
 assert.deepEqual(dto.charges.tax.components,frozen.components);for(const key of ['pre_tax_paise','taxable_basis_paise','cgst_paise','sgst_paise','igst_paise','tax_total_paise','unrounded_payable_paise','rounding_adjustment_paise','final_payable_paise'] as const)assert.equal(dto.charges.tax[key],frozen[key],key);
 assert.equal(dto.charges.tax.final_payable_paise,booking.json().payment_obligation.total_paise);assert.equal(dto.booking.customer_name,malicious);
 if(variant==='odd'){assert.equal(dto.charges.tax.pre_tax_paise,10101);assert.equal(dto.charges.tax.cgst_paise+dto.charges.tax.sgst_paise,dto.charges.tax.tax_total_paise);}
 if(variant==='zero')assert.equal(dto.charges.tax.tax_total_paise,0);
 // Render the actual persisted, authorized DTO, not a sanitized stand-in.
 const {receiptHTML}=await import('../../../web/src/utils/receipt-view.ts');const html=receiptHTML(dto);
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!/Total paid|Estimated delivery/.test(html));
});
await test('reversal chain failure leaves no originals or audit; schema unavailability returns safe 503',{timeout:30000},async t=>{
 const s=await receiptSetup(t),paid=await s.pay(),rev=await s.reverse(paid.json().entry.id,1),before=await s.effects();
 await s.db.adminQuery("CREATE FUNCTION shipit.receipt_chain_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='collection_reversal' THEN RAISE EXCEPTION 'SYN_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER zz_receipt_chain_test_failure BEFORE INSERT ON shipit.issued_receipts FOR EACH ROW EXECUTE FUNCTION shipit.receipt_chain_test_failure()");
 try {assert.equal((await s.receipt(rev.json().entry.id)).statusCode,503);assert.deepEqual(await s.effects(),before);}
 finally {await s.db.adminQuery('DROP TRIGGER zz_receipt_chain_test_failure ON shipit.issued_receipts; DROP FUNCTION shipit.receipt_chain_test_failure()');}
 await s.db.adminQuery('ALTER TABLE shipit.issued_receipts RENAME TO unavailable_receipts');
 try {const r=await s.receipt();assert.equal(r.statusCode,503);assert.equal(r.json().error.code,'TEMPORARILY_UNAVAILABLE');assert.ok(!/\brelation\b|SQL|stack|unavailable_receipts/.test(r.body));}
 finally {await s.db.adminQuery('ALTER TABLE shipit.unavailable_receipts RENAME TO issued_receipts');}
 assert.deepEqual(await s.effects(),before);assert.equal((await s.receipt(rev.json().entry.id)).statusCode,200);
});
