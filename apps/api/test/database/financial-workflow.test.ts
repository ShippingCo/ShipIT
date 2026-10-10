import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {withTransaction,type DatabasePool} from '@shippingco/db';
import {draft,input as pricingInput} from '../pricing-support.ts';
import {taxFacts} from '../tax-support.ts';
import {createPaymentService} from '../../src/modules/payments/service.ts';
import {collectionInput,paymentFault} from '../payment-support.ts';
import {createReceiptService} from '../../src/modules/receipts/service.ts';
import {createSalesService} from '../../src/modules/reports/sales-service.ts';
import {createAgeingService} from '../../src/modules/reports/ageing-service.ts';
import {createAuditService} from '../../src/modules/audit/service.ts';
import {bookingSetup} from '../booking-support.ts';
import {org,A,B,otherOrg,C} from '../audit-support.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import type {FinancialAuditPage,FinancialAuditExport} from '@shippingco/shared';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../../src/modules/cashbook/effect-service.ts';
import {createFinancialWorkflowService} from '../../src/modules/reports/finance-workflow-service.ts';
import {createFinanceService} from '../../src/modules/reports/finance-service.ts';
import {withFinancialScope} from '../../src/modules/memberships/service.ts';
import * as finance from '../../src/modules/reports/finance-repository.ts';
const digest=()=>randomBytes(32).toString('hex');
await test('financial request/approval services enforce roles, scopes, exact retry and separation without moving money',{timeout:60000},async t=>{
 const s=await bookingSetup(t);await s.db.preparePayments();const owner=s.db.ownerPool();
 await owner.query(`GRANT SELECT,INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_document_links TO "${s.db.runtimeRole}"`);
 await owner.query(`GRANT SELECT ON shipit.financial_policy_revisions TO "${s.db.runtimeRole}"`);
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id,q={organization_id:org,franchise_id:A};
 const policy=randomUUID();await owner.query(`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,1,20000,false,true,$4,$5,$6,$7)`,[policy,org,A,s.local.id,randomUUID(),digest(),digest()]);
 const service=createFinancialWorkflowService(s.pool,true),disabled=createFinancialWorkflowService(s.pool),input={booking_id:booking,expected_version:0,payment_version:0,kind:'discount',reason:'customer_agreement',pre_tax:1,taxable:1};
 const request=(token=s.operator.token,body:unknown=input,key=randomUUID(),query=q,impl=service)=>impl.request(token,query,key,['idempotency-key',key],body,randomUUID());
 const key=randomUUID(),saved=await request(s.operator.token,input,key);
 assert.deepEqual(await request(s.operator.token,input,key),saved);
 assert.deepEqual(await request(s.operator.token,input,key,q,disabled),saved);
 await assert.rejects(request(s.operator.token,{...input,pre_tax:2,taxable:2},key),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(request(s.operator.token,input,randomUUID(),q,disabled),{code:'FINANCIAL_WORKFLOW_DISABLED'});
 await assert.rejects(request(s.operator.token,{...input,actor_id:s.local.id}),{code:'VALIDATION_FAILED'});
 await assert.rejects(request(s.operator.token,{...input,expected_version:1}),{code:'VERSION_CONFLICT'});
 const accountant=await s.grant('accountant',[A]),reader=await s.grant('read_only',[A]);
 for(const actor of [accountant,reader,s.admin])await assert.rejects(request(actor.token),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(request(s.operator.token,input,randomUUID(),{organization_id:org,franchise_id:B}),{code:'RESOURCE_NOT_FOUND'});
 for(const booking_id of [randomUUID()])await assert.rejects(request(s.operator.token,{...input,booking_id}),{code:'RESOURCE_NOT_FOUND'});
 const legacy=createFinanceService(s.pool),legacyKey=randomUUID();
 await assert.rejects(legacy.change(s.local.token,q,legacyKey,['idempotency-key',legacyKey],{...input,approval_ref:'synthetic_legacy'},randomUUID()),{code:'FINANCIAL_APPROVAL_REQUIRED'});
 const own=await request(s.local.token),decision={expected_version:0,outcome:'approved'},decisionKey=randomUUID();
 const decide=(id:string,token=s.local.token,body:unknown=decision,key=randomUUID(),impl=service)=>impl.decide(token,q,id,key,['idempotency-key',key],body,randomUUID());
 await assert.rejects(decide(own.id),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(decide(saved.id,s.operator.token),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(decide(randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const approved=await decide(saved.id,s.local.token,decision,decisionKey);
 assert.deepEqual(await decide(saved.id,s.local.token,decision,decisionKey,disabled),approved);
 await assert.rejects(decide(saved.id,s.local.token,{expected_version:0,outcome:'rejected'},decisionKey),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(decide(saved.id),{code:'VERSION_CONFLICT'});
 const pending=await request(),races=await Promise.allSettled([decide(pending.id),decide(pending.id)]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.filter(r=>r.status==='rejected').length,1);
 const audit=createAuditService(s.pool,s.keys.browser),filter={organization_id:org,franchise_id:A,resource_type:'financial_request',resource_id:saved.id};
 const ownerAudit=await audit.list(s.local.token,filter,randomUUID()),accountantAudit=await audit.list(accountant.token,filter,randomUUID());
 assert.deepEqual(ownerAudit.items.map(r=>r.action).sort(),['financial.approved','financial.request']);
 assert.deepEqual(accountantAudit.items.map(r=>r.id),ownerAudit.items.map(r=>r.id));
 await assert.rejects(audit.list(accountant.token,{...filter,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(audit.list(s.operator.token,filter,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const safeAudit=JSON.stringify(ownerAudit);assert.ok(!safeAudit.includes('fingerprint'));assert.ok(!safeAudit.includes('key_digest'));
 await owner.query(`GRANT SELECT,INSERT ON shipit.financial_deletion_denials TO "${s.db.runtimeRole}"`);
 const beforeRequests=(await owner.query('SELECT * FROM shipit.financial_adjustment_requests ORDER BY id')).rows;
 await assert.rejects(disabled.denyDeletion(s.local.token,q,saved.id,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(disabled.denyDeletion(accountant.token,q,saved.id,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(disabled.denyDeletion(s.local.token,q,randomUUID(),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(disabled.denyDeletion(s.local.token,{organization_id:org,franchise_id:B},saved.id,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_adjustment_requests ORDER BY id')).rows,beforeRequests);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_deletion_denials')).rows[0]!.n,2);
 const denials=await audit.list(s.local.token,filter,randomUUID());assert.equal(denials.items.filter(r=>r.action==='financial.delete.denied'&&r.result==='denied').length,2);
 await assert.rejects(owner.query('UPDATE shipit.financial_deletion_denials SET id=id'));await assert.rejects(owner.query('DELETE FROM shipit.financial_deletion_denials'));
 const editTarget=await request(),originalRow=(await owner.query('SELECT * FROM shipit.financial_adjustment_requests WHERE id=$1',[editTarget.id])).rows[0];
 const editBody={expected_request_version:0,proposal:{...input,pre_tax:2,taxable:2}},editKey=randomUUID();
 const amend=(id:string,token=s.operator.token,body:unknown=editBody,key=randomUUID(),impl=service)=>impl.amend(token,q,id,key,['idempotency-key',key],body,randomUUID());
 await assert.rejects(amend(editTarget.id,s.local.token),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(amend(editTarget.id,s.operator.token,{...editBody,proposal:{...input,booking_id:randomUUID()}}),{code:'RESOURCE_NOT_FOUND'});
 const edited=await amend(editTarget.id,s.operator.token,editBody,editKey);
 assert.deepEqual(await amend(editTarget.id,s.operator.token,editBody,editKey,disabled),edited);
 await assert.rejects(amend(editTarget.id,s.operator.token,{...editBody,proposal:{...input,pre_tax:3,taxable:3}},editKey),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(amend(editTarget.id),{code:'VERSION_CONFLICT'});
 await assert.rejects(decide(editTarget.id),{code:'VERSION_CONFLICT'});
 assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_adjustment_requests WHERE id=$1',[editTarget.id])).rows[0],originalRow);
 const oldDetail=await service.requestDetail(s.local.token,q,editTarget.id,randomUUID()),newDetail=await service.requestDetail(s.local.token,q,edited.id,randomUUID());
 assert.equal(oldDetail.request.outcome,'superseded');assert.equal(oldDetail.decisions[0]!.outcome,'superseded');
 assert.equal(newDetail.request.outcome,'pending');assert.equal(newDetail.request.supersedes_id,editTarget.id);assert.equal(newDetail.request.pre_tax,'2');
 const ownProposal=await disabled.ownRequest(s.operator.token,q,edited.id,randomUUID());assert.equal(ownProposal.request.actor_id,s.operator.id);assert.equal(ownProposal.request.pre_tax,'2');assert.equal(ownProposal.request.outcome,'pending');
 assert.deepEqual(Object.keys(ownProposal).sort(),['document_links','request']);
 await assert.rejects(service.ownRequest(s.local.token,q,edited.id,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.ownRequest(s.operator.token,q,own.id,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.ownRequest(s.operator.token,q,randomUUID(),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.ownRequest(s.operator.token,{organization_id:org,franchise_id:B},edited.id,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 for(const actor of [accountant,reader,s.admin])await assert.rejects(service.ownRequest(actor.token,q,edited.id,randomUUID()),{code:'ACTION_FORBIDDEN'});
 assert.equal((await owner.query("SELECT count(*)::int n FROM shipit.financial_access_events WHERE actor_id=$1 AND resource_id=$2 AND action='financial.read'",[s.operator.id,booking])).rows[0]!.n,1);
 const proposalContext=await disabled.proposalContext(s.operator.token,q,booking,randomUUID()),financialCurrent=await createFinanceService(s.pool).read(s.local.token,q,booking,randomUUID());
 assert.equal(proposalContext.booking_id,booking);assert.equal(proposalContext.expected_version,0);assert.equal(proposalContext.payment_version,0);assert.equal(proposalContext.position.gross,financialCurrent.gross);assert.equal(proposalContext.position.outstanding,financialCurrent.gross);assert.deepEqual(proposalContext.refund_targets,[]);
 assert.deepEqual(Object.keys(proposalContext).sort(),['booking_id','components','expected_version','payment_version','position','refund_targets']);
 for(const actor of [accountant,reader,s.admin])await assert.rejects(service.proposalContext(actor.token,q,booking,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.proposalContext(s.operator.token,q,randomUUID(),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.proposalContext(s.operator.token,{organization_id:org,franchise_id:B},booking,randomUUID()),{code:'RESOURCE_NOT_FOUND'});

 const applyKey=randomUUID();await assert.rejects(service.apply(s.local.token,q,edited.id,applyKey,['idempotency-key',applyKey],{expected_version:1},randomUUID()),{code:'VERSION_CONFLICT'});
 const raceTarget=await request(),editRaces=await Promise.allSettled([amend(raceTarget.id),amend(raceTarget.id)]);
 assert.equal(editRaces.filter(r=>r.status==='fulfilled').length,1);assert.equal(editRaces.filter(r=>r.status==='rejected').length,1);
 // A request or approval capability cannot append a charge effect directly.
 await assert.rejects(withFinancialScope(s.pool,s.operator.token,org,A,'finance.request',randomUUID(),scope=>finance.append(scope,randomUUID(),digest(),digest(),{...input,approval_ref:'synthetic',returned_to_ref:null,cgst:0,sgst:0,igst:0,rounding:0,refund:0})),{code:'ACTION_FORBIDDEN'});
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,0);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_adjustment_requests')).rows[0]!.n,7);
 // Once policy governance exists, disabling it must not reopen unreviewed legacy effects.
 await owner.query(`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,2,20000,false,false,$4,$5,$6,$7)`,[randomUUID(),org,A,s.local.id,randomUUID(),digest(),digest()]);
 const disabledLegacyKey=randomUUID();await assert.rejects(legacy.change(s.local.token,q,disabledLegacyKey,['idempotency-key',disabledLegacyKey],{...input,approval_ref:'SYN_DISABLED_BYPASS'},randomUUID()),{code:'FINANCIAL_APPROVAL_REQUIRED'});
 await assert.rejects(withTransaction(owner,tx=>tx.query(`INSERT INTO shipit.financial_changes
 (id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,1,0,'discount','customer_agreement','SYN_DISABLED_ORPHAN',1,1,$8)`,[randomUUID(),org,A,booking,s.local.id,digest(),digest(),randomUUID()])));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);

});

for(const paid of [false,true])await test(`approved 500 ${paid?'paid':'unpaid'} cancellation and actual partial refunds preserve source evidence`,{timeout:60000},async t=>{
 const s=await bookingSetup(t,undefined,{pricingDraft:{...draft,rules:draft.rules.map((r,index)=>index===0?{...r,freight_paise:47370}:r)}});await s.db.preparePayments();
 const owner=s.db.ownerPool();await owner.query(`GRANT SELECT,INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_refund_evidence,shipit.financial_document_links TO "${s.db.runtimeRole}"`);
 await owner.query(`GRANT SELECT ON shipit.receiving_account_revisions TO "${s.db.runtimeRole}"`);
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id,q={organization_id:org,franchise_id:A};
 await s.db.prepareReceipts();const receipt=await createReceiptService(s.pool).read(s.local.token,booking,null,q,randomUUID());
 const secondPrepared=await s.prepared(),secondTax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:secondPrepared.intent.id},randomUUID());
 const secondBooked=await s.book({...s.body,tax_intent:secondPrepared.body,tax_calculation_id:secondTax.id});assert.equal(secondBooked.statusCode,201);
 const otherReceipt=await createReceiptService(s.pool).read(s.local.token,secondBooked.json().id,null,q,randomUUID());
 const issuedBefore=(await owner.query('SELECT * FROM shipit.issued_receipts ORDER BY id')).rows;
 const componentBound=(await owner.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='shipit.financial_changes'::regclass AND conname='financial_changes_check'")).rows[0]!.definition;assert.match(componentBound,/taxable >= 0/);assert.match(componentBound,/taxable <= pre_tax/);
 const documents=(await owner.query('SELECT tax_snapshot,final_payable_paise FROM shipit.bookings WHERE id=$1',[booking])).rows[0]!;assert.equal(documents.final_payable_paise,'50000');
 const payment=createPaymentService(s.pool);if(paid){const key=randomUUID();await payment.execute(s.local.token,booking,null,q,key,['idempotency-key',key],collectionInput(50000),'payments.collect',randomUUID());}
 const p=randomUUID();await owner.query(`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,1,NULL,false,true,$4,$5,$6,$7)`,[p,org,A,s.local.id,randomUUID(),digest(),digest()]);
 // The deferred completeness guard must roll back even a valid component effect without its applied decision.
 await assert.rejects(withTransaction(owner,tx=>tx.query(`INSERT INTO shipit.financial_changes
 (id,organization_id,franchise_id,booking_id,actor_id,key_digest,fingerprint,version,payment_version,kind,reason,approval_ref,pre_tax,taxable,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,'discount','customer_agreement','SYN_ORPHAN',1,1,$9)`,[randomUUID(),org,A,booking,s.local.id,digest(),digest(),paid?1:0,randomUUID()])));
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);
 const service=createFinancialWorkflowService(s.pool,true),disabled=createFinancialWorkflowService(s.pool),reader=createFinanceService(s.pool);
 const current=()=>reader.read(s.local.token,q,booking,randomUUID());
 const request=async(input:unknown)=>{const key=randomUUID(),r=await service.request(s.operator.token,q,key,['idempotency-key',key],input,randomUUID()),dk=randomUUID();
  await service.decide(s.local.token,q,r.id,dk,['idempotency-key',dk],{expected_version:0,outcome:'approved'},randomUUID());return r.id;};
 const apply=(id:string,body:unknown,key=randomUUID(),token=s.local.token,impl=service)=>impl.apply(token,q,id,key,['idempotency-key',key],body,randomUUID());
 for(const receipt_id of [otherReceipt.id,randomUUID()])await assert.rejects(request({booking_id:booking,expected_version:0,payment_version:paid?1:0,kind:'correction',reason:'incorrect_charge',pre_tax:1,taxable:1,document_links:[{kind:'issued_receipt',receipt_id}]}),{code:'RESOURCE_NOT_FOUND'});
 const initial=await current(),cancel=await request({booking_id:booking,expected_version:0,payment_version:paid?1:0,kind:'cancellation',reason:'booking_cancelled',
  pre_tax:Number(initial.pre_tax),taxable:Number(initial.taxable),cgst:Number(initial.cgst),sgst:Number(initial.sgst),igst:Number(initial.igst),rounding:Number(initial.rounding),document_links:[{kind:'issued_receipt',receipt_id:receipt.id},{kind:'external_invoice',external_ref:'SYN_EXTERNAL_INVOICE'}]});
 await assert.rejects(apply(cancel,{expected_version:1},randomUUID(),s.operator.token),{code:'ACTION_FORBIDDEN'});
 const key=randomUUID(),applied=await apply(cancel,{expected_version:1},key);assert.deepEqual(await apply(cancel,{expected_version:1},key,s.local.token,disabled),applied);
 const detail=await service.requestDetail(s.local.token,q,cancel,randomUUID());
 assert.equal(detail.before.gross,'50000');assert.equal(detail.before.held,paid?'50000':'0');assert.equal(detail.proposed.gross,'0');assert.equal(detail.proposed.refundable_credit,paid?'50000':'0');
 assert.deepEqual(detail.decisions.map(r=>r.outcome),['approved','applied']);assert.ok(detail.decisions.every(r=>r.actor_id===s.local.id&&r.recorded_at.endsWith('Z')));assert.equal(detail.request.actor_id,s.operator.id);
 assert.equal(detail.document_links.length,2);assert.ok(detail.document_links.some(l=>l.receipt_id===receipt.id&&l.qualification==='issued_source'));assert.ok(detail.document_links.some(l=>l.external_ref==='SYN_EXTERNAL_INVOICE'&&l.qualification==='unverified_external_reference'));
 assert.equal(detail.request.outcome,'applied');assert.equal(detail.source.financial_version,0);
 const ownCancellation=await disabled.ownRequest(s.operator.token,q,cancel,randomUUID());assert.deepEqual(ownCancellation.document_links,detail.document_links);assert.equal(ownCancellation.request.outcome,'applied');
 await assert.rejects(service.requestDetail(s.local.token,q,randomUUID(),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.requestDetail(s.local.token,{organization_id:org,franchise_id:B},cancel,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const cancelled=await current();assert.equal(cancelled.gross,'0');assert.equal(cancelled.collections,paid?'50000':'0');assert.equal(cancelled.refunds,'0');
 if(paid){
  const account=randomUUID();await withTransaction(owner,async tx=>{
   await tx.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[account,org,A]);
   await tx.query(`INSERT INTO shipit.receiving_account_revisions(id,organization_id,franchise_id,account_id,version,name,methods,other_method_name,active,actor_id,correlation_id,key_digest,fingerprint)
   VALUES($1,$2,$3,$4,1,'Synthetic refund drawer',ARRAY['cash'],NULL,true,$5,$6,$7,$8)`,[randomUUID(),org,A,account,s.local.id,randomUUID(),digest(),digest()]);
  });
  await s.db.prepareCashbook();
  const locations=createCashLocationService(s.pool,true),locationKey=randomUUID(),cashLocation=await locations.configure(s.local.token,null,q,locationKey,['idempotency-key',locationKey],{account_id:account,expected_account_version:1,custodian_id:s.operator.id,name:'Synthetic operator custody',active:true,expected_version:0},randomUUID());
  const cashbook=createCashbookEffectService(s.pool,true),cashRequests=createCashbookRequestService(s.pool,true),custodyService=createFinancialWorkflowService(s.pool,true,true),floatKey=randomUUID(),sourceVersion=(await cashbook.position(s.local.token,q,randomUUID())).source_version;
  const float=await cashRequests.submit(s.operator.token,q,floatKey,['idempotency-key',floatKey],{kind:'opening_float',source_location_id:cashLocation.id,source_revision_id:cashLocation.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:sourceVersion,amount_paise:100000,currency:'INR',category:null,payee:null,responsible_employee_id:s.operator.id,reason:'Synthetic new cash introduced',occurred_at:'2026-01-01T00:00:00Z'},randomUUID());
  const floatReviewKey=randomUUID(),floatDecision=await cashRequests.decide(s.local.token,float.id,q,floatReviewKey,['idempotency-key',floatReviewKey],{expected_version:1,decision:'approved',reason:'Synthetic float review'},randomUUID()),floatApplyKey=randomUUID();
  await cashbook.apply(s.local.token,float.id,q,floatApplyKey,['idempotency-key',floatApplyKey],{expected_version:2,decision_id:floatDecision.id},randomUUID());
  for(const [index,amount] of [20000,30000].entries()){
   const id=await request({booking_id:booking,expected_version:index+1,payment_version:1,kind:'refund',reason:'customer_refund',refund:amount});
   const evidence={account_id:account,expected_account_version:1,method:'cash',occurred_at:(await owner.query<{instant:Date}>('SELECT clock_timestamp() instant')).rows[0]!.instant.toISOString(),returned_to_ref:'SYN_BENEFICIARY',transfer_ref:'SYN_RETURN_'+index,...(index===0?{cash_location_id:cashLocation.id,cash_location_revision_id:cashLocation.revision_id}:{})};
   await assert.rejects(apply(id,{expected_version:1}),{code:'VALIDATION_FAILED'});
   await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,account_id:randomUUID()}}),{code:'RESOURCE_NOT_FOUND'});
   await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,occurred_at:'2099-01-01T00:00:00Z'}}),{code:'VALIDATION_FAILED'});
   if(index===1)await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,transfer_ref:'SYN_RETURN_0'}}),{code:'FINANCIAL_REFUND_REFERENCE_CONFLICT'});
   if(index===0){
    await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,cash_location_id:null,cash_location_revision_id:null}},randomUUID(),s.local.token,custodyService),{code:'VALIDATION_FAILED'});
    await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,cash_location_id:randomUUID()}},randomUUID(),s.local.token,custodyService),{code:'RESOURCE_NOT_FOUND'});
    await assert.rejects(apply(id,{expected_version:1,refund_evidence:{...evidence,cash_location_revision_id:randomUUID()}},randomUUID(),s.local.token,custodyService),{code:'VERSION_CONFLICT'});
    // Corrupt the writer's bound revision after service validation: PostgreSQL must deny it
    // and roll back the already-appended financial change and its source-generation bump.
    const beforeBoundary=await current(),beforePosition=await cashbook.position(s.local.token,q,randomUUID()),beforeEvidence=(await owner.query('SELECT * FROM shipit.financial_refund_evidence ORDER BY id')).rows;
    const forged:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
     if(sql.includes('INSERT INTO shipit.financial_refund_evidence')){const tampered=[...params!];tampered[11]=randomUUID();return client.query<Row>(sql,tampered);}return client.query<Row>(sql,params);
    }};}};
    await assert.rejects(apply(id,{expected_version:1,refund_evidence:evidence},randomUUID(),s.local.token,createFinancialWorkflowService(forged,true,true)));
    assert.deepEqual(await current(),beforeBoundary);const boundaryPosition=await cashbook.position(s.local.token,q,randomUUID());assert.equal(boundaryPosition.source_version,beforePosition.source_version);assert.deepEqual(boundaryPosition.locations,beforePosition.locations);
    assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_refund_evidence ORDER BY id')).rows,beforeEvidence);

   }
   const keys=[randomUUID(),randomUUID()],results=await Promise.allSettled(keys.map(key=>apply(id,{expected_version:1,refund_evidence:evidence},key,s.local.token,index===0?custodyService:service)));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results.map(r=>r.status==='rejected'?{status:r.status,code:(r.reason as {code?:string}).code}:{status:r.status})));assert.equal(results.filter(r=>r.status==='rejected').length,1);
   const winner=results.findIndex(r=>r.status==='fulfilled'),result=results[winner]!;assert.equal(result.status,'fulfilled');
   if(result.status!=='fulfilled')throw new Error('Synthetic refund race had no winner');
   assert.deepEqual(await apply(id,{expected_version:1,refund_evidence:evidence},keys[winner]!,s.local.token,disabled),result.value);
   assert.equal((await current()).refunds,String(index===0?20000:50000));
   const position=(await cashbook.position(s.local.token,q,randomUUID())).locations.find(p=>p.location_id===cashLocation.id)!;
   assert.equal(position.known_recorded_paise,'80000');assert.equal(position.available_paise,index===0?'80000':'0');
   const recorded=(await owner.query('SELECT * FROM shipit.financial_refund_evidence WHERE transfer_ref=$1',[evidence.transfer_ref])).rows[0]!;
   assert.equal(recorded.cash_location_id,index===0?cashLocation.id:null);assert.equal(recorded.actor_id,s.local.id);assert.notEqual(recorded.actor_id,s.operator.id);
   const fact=(await owner.query("SELECT location_id,unknown_reason FROM shipit.cashbook_source_facts WHERE source_kind='refund' AND source_id=$1",[recorded.id])).rows[0]!;assert.equal(fact.location_id,index===0?cashLocation.id:null);assert.equal(fact.unknown_reason,index===0?null:'cash_refund_custody_unknown');
  }
  const extra=randomUUID();await assert.rejects(service.request(s.operator.token,q,extra,['idempotency-key',extra],{booking_id:booking,expected_version:3,payment_version:1,kind:'refund',reason:'customer_refund',refund:1},randomUUID()),{code:'FINANCIAL_CONFLICT'});
  // Subsequent refunds do not rewrite the cancellation request's original paid observation.
  assert.deepEqual(await service.requestDetail(s.local.token,q,cancel,randomUUID()),detail);
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_refund_evidence')).rows[0]!.n,2);
  const auditRows=(await owner.query("SELECT * FROM shipit.audit_history WHERE action='financial.refund.record'")).rows;
  assert.equal(auditRows.length,2);const safe=JSON.stringify(auditRows);
  for(const value of ['SYN_BENEFICIARY','SYN_RETURN_0','SYN_RETURN_1','Synthetic refund drawer'])assert.ok(!safe.includes(value));
  for(const sql of ['UPDATE shipit.financial_refund_evidence SET id=id','DELETE FROM shipit.financial_refund_evidence'])await assert.rejects(owner.query(sql));
  await s.db.prepareReports();
  const sales=createSalesService(s.pool),ageing=createAgeingService(s.pool);
  const confirmed=(await owner.query("SELECT to_char(confirmed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS confirmed_day FROM shipit.bookings WHERE id=$1",[booking])).rows[0]!.confirmed_day;
  const captureSales=()=>{const k=randomUUID();return sales.create(s.local.token,q,k,['idempotency-key',k],{from_day:confirmed,to_day:confirmed},randomUUID());};
  const captureAgeing=()=>{const k=randomUUID();return ageing.create(s.local.token,q,k,['idempotency-key',k],{balances:'all'},randomUUID());};
  const frozenSales=await captureSales(),frozenAgeing=await captureAgeing();
  assert.equal(frozenSales.rows.find(r=>r.id===booking)!.amounts.refunds,'50000');assert.equal(frozenAgeing.rows.find(r=>r.id===booking)!.refunds,'50000');
  // Correct a fictional erroneous refund record without recording another transfer.
  const originalRefund=(await owner.query("SELECT * FROM shipit.financial_changes WHERE booking_id=$1 AND version=2",[booking])).rows[0]!;
  const correctionBody={booking_id:booking,expected_version:3,payment_version:1,kind:'refund_correction',reason:'incorrect_refund_recording',refund:10000,refund_correction_of:originalRefund.id};
  const propose=(body:unknown)=>{const k=randomUUID();return service.request(s.operator.token,q,k,['idempotency-key',k],body,randomUUID());};
  for(const refund_correction_of of [randomUUID(),(await owner.query('SELECT id FROM shipit.financial_changes WHERE booking_id=$1 AND version=1',[booking])).rows[0]!.id])await assert.rejects(propose({...correctionBody,refund_correction_of}),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(propose({...correctionBody,refund:20001}),{code:'FINANCIAL_CONFLICT'});
  await assert.rejects(propose({...correctionBody,pre_tax:1,taxable:1}),{code:'FINANCIAL_CONFLICT'});
  const corrected=await request(correctionBody),correctionDetail=await service.requestDetail(s.local.token,q,corrected,randomUUID());
  assert.equal(correctionDetail.before.held,'0');assert.equal(correctionDetail.proposed.held,'10000');assert.equal(correctionDetail.proposed.refundable_credit,'10000');
  const correctionKey=randomUUID(),correctionApplied=await apply(corrected,{expected_version:1},correctionKey);
  assert.deepEqual(await apply(corrected,{expected_version:1},correctionKey,s.local.token,disabled),correctionApplied);
  const position=await current();assert.equal(position.refunds,'40000');assert.equal(position.collections,'50000');assert.equal(BigInt(position.collections)-BigInt(position.refunds)-BigInt(position.gross),10000n);
  const operatorContext=await disabled.proposalContext(s.operator.token,q,booking,randomUUID());assert.equal(operatorContext.position.refundable_credit,'10000');assert.equal(operatorContext.expected_version,4);assert.equal(operatorContext.payment_version,1);
  assert.deepEqual(operatorContext.refund_targets.find(r=>r.id===originalRefund.id),{id:originalRefund.id,original_paise:'20000',remaining_paise:'10000'});
  for(const secret of ['SYN_BENEFICIARY','SYN_RETURN_0','Synthetic refund drawer','source_account_id','transfer_ref'])assert.ok(!JSON.stringify(operatorContext).includes(secret));
  const paymentAfter=await payment.read(s.local.token,booking,q,randomUUID());assert.equal(paymentAfter.collected_paise,10000);assert.equal(paymentAfter.refundable_credit_paise,10000);assert.equal(paymentAfter.gross_paise,0);assert.equal(paymentAfter.version,1);
  const correctedSales=await captureSales(),correctedAgeing=await captureAgeing(),sale=correctedSales.rows.find(r=>r.id===booking)!,aged=correctedAgeing.rows.find(r=>r.id===booking)!;
  assert.equal(sale.amounts.refunds,'40000');assert.equal(sale.amounts.refundable_credit,'10000');assert.equal(aged.refunds,'40000');assert.equal(aged.net_collections,'10000');assert.equal(aged.refundable_credit,'10000');
  assert.equal(sale.corrections.at(-1)!.kind,'refund_correction');assert.equal(aged.changes.at(-1)!.kind,'refund_correction');
  assert.deepEqual(await sales.read(s.local.token,frozenSales.snapshot.id,q,randomUUID()),frozenSales);assert.deepEqual(await ageing.read(s.local.token,frozenAgeing.snapshot.id,q,randomUUID()),frozenAgeing);
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_refund_evidence')).rows[0]!.n,2);
  assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_changes WHERE id=$1',[originalRefund.id])).rows[0],originalRefund);
  assert.deepEqual(await service.requestDetail(s.local.token,q,cancel,randomUUID()),detail);
  const afterCorrectionDetail=await service.requestDetail(s.local.token,q,corrected,randomUUID());
  assert.deepEqual(afterCorrectionDetail.before,correctionDetail.before);assert.deepEqual(afterCorrectionDetail.proposed,correctionDetail.proposed);
  await assert.rejects(propose({...correctionBody,expected_version:4,refund:10001}),{code:'FINANCIAL_CONFLICT'});
  // The restored credit can fund a separately approved actual refund, with separate evidence.
  const returnId=await request({booking_id:booking,expected_version:4,payment_version:1,kind:'refund',reason:'customer_refund',refund:10000});
  await apply(returnId,{expected_version:1,refund_evidence:{account_id:account,expected_account_version:1,method:'cash',occurred_at:(await owner.query<{instant:Date}>('SELECT clock_timestamp() instant')).rows[0]!.instant.toISOString(),returned_to_ref:'SYN_BENEFICIARY',transfer_ref:'SYN_RECORDED_RETURN'}});
  assert.equal((await current()).refunds,'50000');assert.equal(BigInt((await current()).collections)-BigInt((await current()).refunds)-BigInt((await current()).gross),0n);
  assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_changes WHERE id=$1',[originalRefund.id])).rows[0],originalRefund);
  assert.deepEqual((await service.requestDetail(s.local.token,q,corrected,randomUUID())).proposed,correctionDetail.proposed);
  // Exhausted correction targets must disappear, so the production adapter can still load the booking.
  const finalCorrection=await request({...correctionBody,expected_version:5,refund:10000});
  await apply(finalCorrection,{expected_version:1});
  const exhaustedContext=await disabled.proposalContext(s.operator.token,q,booking,randomUUID());
  assert.equal(exhaustedContext.expected_version,6);assert.equal(exhaustedContext.position.refundable_credit,'10000');
  assert.ok(exhaustedContext.refund_targets.every(row=>BigInt(row.remaining_paise)>0n));
  assert.ok(!exhaustedContext.refund_targets.some(row=>row.id===originalRefund.id));
  await assert.rejects(propose({...correctionBody,expected_version:6,refund:1}),{code:'FINANCIAL_CONFLICT'});
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_refund_evidence')).rows[0]!.n,3);
  assert.deepEqual((await owner.query('SELECT * FROM shipit.financial_changes WHERE id=$1',[originalRefund.id])).rows[0],originalRefund);
  const oldEvidence=(await owner.query("SELECT * FROM shipit.financial_refund_evidence WHERE cash_location_id IS NULL ORDER BY recorded_at,id")).rows;
  assert.equal(oldEvidence.length,2);
  for(const [index,e] of oldEvidence.entries()){
   const original=(await owner.query('SELECT refund FROM shipit.financial_changes WHERE id=$1',[e.id])).rows[0]!,id=await request({booking_id:booking,expected_version:6+index,payment_version:1,kind:'refund_correction',reason:'incorrect_refund_recording',refund:Number(original.refund),refund_correction_of:e.id});
   await apply(id,{expected_version:1});
  }
  const released=(await cashbook.position(s.local.token,q,randomUUID())).locations.find(p=>p.location_id===cashLocation.id)!;assert.equal(released.known_recorded_paise,'100000');assert.equal(released.available_paise,'100000');assert.equal(released.state,'incomplete');
  assert.deepEqual((await owner.query("SELECT * FROM shipit.financial_refund_evidence WHERE cash_location_id IS NULL ORDER BY recorded_at,id")).rows,oldEvidence);
  await assert.rejects(owner.query('UPDATE shipit.financial_refund_evidence SET cash_location_id=$1,cash_location_revision_id=$2 WHERE id=$3',[cashLocation.id,cashLocation.revision_id,oldEvidence[0]!.id]));
  const accounts=createReceivingAccountService(s.pool),bankKey=randomUUID(),bank=await accounts.configure(s.local.token,null,q,bankKey,['idempotency-key',bankKey],{name:'Synthetic noncash refund account',methods:['upi'],other_method_name:null,active:true,expected_version:0},randomUUID()),bankLocationKey=randomUUID(),bankLocation=await locations.configure(s.local.token,null,q,bankLocationKey,['idempotency-key',bankLocationKey],{account_id:bank.id,expected_account_version:1,custodian_id:null,name:'Synthetic recorded UPI funds',active:true,expected_version:0},randomUUID());
  const noncash=await request({booking_id:booking,expected_version:8,payment_version:1,kind:'refund',reason:'customer_refund',refund:10000}),noncashEvidence={account_id:bank.id,expected_account_version:1,method:'upi',occurred_at:'2026-01-01T00:00:00Z',returned_to_ref:'SYN_BENEFICIARY',transfer_ref:'SYN_UPI_REFUND'};
  await assert.rejects(apply(noncash,{expected_version:1,refund_evidence:{...noncashEvidence,cash_location_id:cashLocation.id,cash_location_revision_id:cashLocation.revision_id}},randomUUID(),s.local.token,custodyService),{code:'VALIDATION_FAILED'});
  await apply(noncash,{expected_version:1,refund_evidence:noncashEvidence},randomUUID(),s.local.token,custodyService);
  const finalCash=await cashbook.position(s.local.token,q,randomUUID());assert.equal(finalCash.locations.find(p=>p.location_id===cashLocation.id)!.known_recorded_paise,'100000');assert.equal(finalCash.locations.find(p=>p.location_id===bankLocation.id)!.known_recorded_paise,'-10000');



 }
 assert.deepEqual((await owner.query('SELECT * FROM shipit.issued_receipts ORDER BY id')).rows,issuedBefore);
 await assert.rejects(owner.query('UPDATE shipit.financial_document_links SET ordinal=ordinal'));await assert.rejects(owner.query('DELETE FROM shipit.financial_document_links'));
 await assert.rejects(owner.query(`INSERT INTO shipit.financial_document_links(organization_id,franchise_id,booking_id,request_id,ordinal,kind,external_ref)
 VALUES($1,$2,$3,$4,3,'external_credit_note','SYN_LATE_LINK')`,[org,A,booking,cancel]));
 assert.deepEqual((await owner.query('SELECT tax_snapshot,final_payable_paise FROM shipit.bookings WHERE id=$1',[booking])).rows[0],documents);
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,paid?1:0);
});

await test('financial audit captures complete scoped source lineage, filters, frozen detail/export, paging and revocation',{timeout:60000},async t=>{
 const s=await bookingSetup(t);await s.db.prepareReports();await s.db.prepareMoneyReceipts();
 const owner=s.db.ownerPool(),q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
 await owner.query(`GRANT INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_document_links,shipit.financial_deletion_denials TO "${s.db.runtimeRole}"`);
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id;
 const issued=await createReceiptService(s.pool).read(s.local.token,booking,null,q,randomUUID());
 const service=createFinanceService(s.pool,true),k=randomUUID();
 const legacy=await service.change(s.local.token,q,k,headers(k),{booking_id:booking,expected_version:0,payment_version:0,kind:'discount',reason:'customer_agreement',approval_ref:'SYN_LEGACY',pre_tax:1,taxable:1},randomUUID());
 const small=await s.quote({...pricingInput,override:{freight_paise:13051,reason_code:'customer_agreement'}});assert.equal(small.statusCode,200,small.body);
 const large=await s.quote({...pricingInput,override:{freight_paise:13052,reason_code:'commercial_exception'}},s.local.token);assert.equal(large.statusCode,200,large.body);
 const overrideIntent={quote_id:small.json().id,pricing_input:{...pricingInput,override:{freight_paise:13051,reason_code:'customer_agreement'}},facts:taxFacts};
 const preparedOverride=await s.tax.prepare(s.operator.token,org,A,randomUUID(),overrideIntent,randomUUID()),taxedOverride=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:preparedOverride.id},randomUUID());
 const overrideBooking=await s.book({...s.body,tax_intent:overrideIntent,tax_calculation_id:taxedOverride.id});assert.equal(overrideBooking.statusCode,201,overrideBooking.body);
 const payment=createPaymentService(s.pool),pk=randomUUID(),paid=await payment.execute(s.local.token,booking,null,q,pk,headers(pk),collectionInput(1000),'payments.collect',randomUUID());
 const rk=randomUUID();await payment.execute(s.local.token,booking,paid.entry.id,q,rk,headers(rk),{amount_paise:100,currency:'INR',reason_code:'collection_not_received'},'payments.reverse',randomUUID());
 const accounts=createReceivingAccountService(s.pool),ak=randomUUID(),account=await accounts.configure(s.local.token,null,q,ak,headers(ak),{name:'Synthetic PRIVATE drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const receipts=createMoneyReceiptService(s.pool),mk=randomUUID(),receipt=await receipts.record(s.operator.token,q,mk,headers(mk),{customer_id:s.source.id,account_id:account.id,expected_account_version:1,amount_paise:200,currency:'INR',method:'cash',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:(await owner.query<{instant:Date}>('SELECT clock_timestamp() instant')).rows[0]!.instant.toISOString(),external_reference:'SYN_PRIVATE_BANK_REF',allocations:[{booking_id:booking,amount_paise:200,context:'to_pay',expected_payment_version:2}]},randomUUID());
 const allocation=(await owner.query("SELECT id FROM shipit.money_receipt_allocations WHERE receipt_id=$1 AND kind='allocation'",[receipt.receipt_id])).rows[0]!.id;
 const ck=randomUUID();await receipts.correct(s.local.token,receipt.receipt_id,q,ck,headers(ck),{expected_version:1,allocation_id:allocation,amount_paise:50,currency:'INR',reason_code:'incorrect_amount'},randomUUID());
 const fixturePolicy=randomUUID();await owner.query(`INSERT INTO shipit.financial_policy_revisions
 (id,organization_id,franchise_id,version,discount_review_threshold_paise,allow_self_approval,enabled,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,1,2,false,true,$4,$5,$6,$7)`,[fixturePolicy,org,A,s.local.id,randomUUID(),digest(),digest()]);
 const proposal={booking_id:booking,expected_version:1,payment_version:4,kind:'discount',reason:'service_recovery',pre_tax:2,taxable:2,document_links:[{kind:'issued_receipt',receipt_id:issued.id},{kind:'external_invoice',external_ref:'SYN_AUDIT_INVOICE'}]};
 const firstKey=randomUUID(),first=await service.request(s.operator.token,q,firstKey,headers(firstKey),proposal,randomUUID());
 const amendKey=randomUUID(),replacement=await service.amend(s.operator.token,q,first.id,amendKey,headers(amendKey),{expected_request_version:0,proposal:{...proposal,pre_tax:3,taxable:3}},randomUUID());
 for(let n=0;n<101;n++)await assert.rejects(service.denyDeletion(s.local.token,q,first.id,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const day=(await owner.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS recorded_day")).rows[0]!.recorded_day;
 const filter={from_day:day,to_day:day,sort:'confirmed_asc'},key=randomUUID();
 const capture=(body:unknown=filter,token=s.local.token,k=randomUUID(),query=q)=>service.captureAudit(token,query,k,headers(k),body,randomUUID());
 const captured=await capture(filter,s.local.token,key);assert.equal(captured.snapshot.count,108);assert.equal(captured.rows.length,100);assert.equal(captured.next_offset,100);
 assert.deepEqual(await capture(filter,s.local.token,key),captured);await assert.rejects(capture({...filter,kind:'refund'},s.local.token,key),{code:'IDEMPOTENCY_CONFLICT'});
 const rest=await service.readAudit(s.local.token,{...q,offset:'100'},captured.snapshot.id,randomUUID()) as FinancialAuditPage;
 const rows=[...captured.rows,...rest.rows];assert.equal(rows.length,captured.snapshot.count);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 assert.deepEqual(captured.snapshot.counts,{discount:2,price_override:2,collection_correction:1,receipt_correction:1,request_amendment:1,deletion_denied:101});
 const manual=rows.find(r=>r.source_id===legacy.id)!;assert.equal(manual.source_type,'financial_change');assert.equal(manual.approval_basis,'legacy_manual_reference');assert.equal(manual.approved_actor_id,null);assert.equal(BigInt(manual.before_paise!)-BigInt(manual.proposed_paise!),1n);
 const quoteRows=rows.filter(r=>r.kind==='price_override');assert.equal(quoteRows[0]!.approval_threshold_paise,'500');assert.equal(quoteRows[0]!.additional_review_required,false);assert.equal(quoteRows[0]!.approved_actor_id,null);assert.equal(quoteRows[1]!.additional_review_required,true);assert.equal(quoteRows[1]!.approved_actor_id,s.local.id);assert.equal(quoteRows[1]!.before_paise,'12551');assert.equal(quoteRows[1]!.proposed_paise,'13052');
 const direct=rows.find(r=>r.kind==='collection_correction')!;assert.equal(direct.before_paise,'1000');assert.equal(direct.proposed_paise,'900');assert.equal(direct.correction_of,paid.entry.id);
 const released=rows.find(r=>r.kind==='receipt_correction')!;assert.equal(released.amount_basis,'allocated_collection');assert.equal(released.before_paise,'200');assert.equal(released.proposed_paise,'150');assert.equal(released.correction_of,allocation);assert.equal(released.receipt_id,receipt.receipt_id);
 const amended=rows.find(r=>r.source_id===replacement.id)!;assert.equal(amended.kind,'request_amendment');assert.equal(amended.correction_of,first.id);
 const original=rows.find(r=>r.source_id===first.id)!;assert.equal(original.status,'superseded');assert.equal(original.decisions[0]!.outcome,'superseded');
 assert.equal(original.document_links.length,2);assert.ok(original.document_links.some(l=>l.receipt_id===issued.id&&l.qualification==='issued_source'));assert.ok(original.document_links.some(l=>l.external_ref==='SYN_AUDIT_INVOICE'&&l.qualification==='unverified_external_reference'));
 assert.equal(original.approval_threshold_paise,'2');assert.equal(original.additional_review_required,false);assert.equal(amended.additional_review_required,true);assert.equal(amended.status,'pending');
 const detail=await service.auditDetail(s.local.token,q,captured.snapshot.id,original.id,randomUUID());assert.deepEqual(detail.row,original);assert.deepEqual(detail.snapshot,captured.snapshot);
 const exported=await service.readAudit(s.local.token,q,captured.snapshot.id,randomUUID(),true) as FinancialAuditExport;assert.equal(exported.csv.split('\r\n').length,rows.length+2);assert.deepEqual(exported.snapshot,captured.snapshot);
 for(const sensitive of ['SYN_PRIVATE_BANK_REF','Synthetic PRIVATE drawer','fingerprint','key_digest','+1 202','Fictional Street'])assert.ok(!JSON.stringify({rows,exported}).includes(sensitive));
 const filtered=await capture({...filter,kind:'receipt_correction',actor_id:s.local.id,booking_id:booking,status:'recorded'});assert.equal(filtered.snapshot.count,1);assert.deepEqual(filtered.rows[0],released);
 const bookedPrice=await capture({...filter,kind:'price_override',booking_id:overrideBooking.json().id});assert.equal(bookedPrice.snapshot.count,1);assert.equal(bookedPrice.rows[0]!.source_id,small.json().id);assert.equal(bookedPrice.rows[0]!.booking_id,overrideBooking.json().id);
 const empty=await capture({...filter,kind:'refund'});assert.equal(empty.snapshot.count,0);assert.deepEqual(empty.rows,[]);
 for(const booking_id of [randomUUID()])await assert.rejects(capture({...filter,booking_id}),{code:'RESOURCE_NOT_FOUND'});
 for(const kind of ['unsupported',42])await assert.rejects(capture({...filter,kind}),{code:'VALIDATION_FAILED'});
 await assert.rejects(capture({...filter,from_day:'2026-01-01',to_day:'2026-03-01'}),{code:'VALIDATION_FAILED'});
 const accountant=await s.grant('accountant',[A]),readonly=await s.grant('read_only',[A]),foreign=await s.beta('accountant');
 for(const actor of [s.operator,readonly])await assert.rejects(capture(filter,actor.token),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(capture(filter,foreign.token),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(capture(filter,s.local.token,randomUUID(),{organization_id:org,franchise_id:B}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(capture(filter,s.local.token,randomUUID(),{organization_id:otherOrg,franchise_id:C}),{code:'RESOURCE_NOT_FOUND'});
 const accountantPage=await capture({...filter,kind:'receipt_correction'},accountant.token);assert.equal(accountantPage.snapshot.count,1);
 const accountantExport=await service.readAudit(accountant.token,q,accountantPage.snapshot.id,randomUUID(),true) as FinancialAuditExport;assert.equal(accountantExport.csv.split('\r\n').length,3);
 const organizationPage=await capture({...filter,kind:'discount'},s.admin.token);assert.equal(organizationPage.snapshot.count,2);
 await assert.rejects(service.readAudit(foreign.token,q,captured.snapshot.id,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.readAudit(accountant.token,q,captured.snapshot.id,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.readAudit(s.admin.token,q,captured.snapshot.id,randomUUID(),true),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.readAudit(s.local.token,{...q,franchise_id:B},captured.snapshot.id,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.auditDetail(s.local.token,q,captured.snapshot.id,'request:'+randomUUID(),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.readAudit(s.local.token,{...q,offset:'1'},captured.snapshot.id,randomUUID()),{code:'VALIDATION_FAILED'});
 // A later request does not alter the captured queue, its row detail or export.
 const late=randomUUID();await service.request(s.operator.token,q,late,headers(late),proposal,randomUUID());
 const approvedKey=randomUUID();await service.decide(s.local.token,q,replacement.id,approvedKey,headers(approvedKey),{expected_version:0,outcome:'approved'},randomUUID());
 assert.equal((await service.requestDetail(s.local.token,q,replacement.id,randomUUID())).request.outcome,'approved');
 assert.equal((await service.auditDetail(s.local.token,q,captured.snapshot.id,amended.id,randomUUID())).row.status,'pending');
 assert.deepEqual(await service.auditDetail(s.local.token,q,captured.snapshot.id,original.id,randomUUID()),detail);
 assert.deepEqual(await service.readAudit(s.local.token,q,captured.snapshot.id,randomUUID(),true),exported);
 const access=(await owner.query("SELECT action,count(*)::int n FROM shipit.report_access_events WHERE snapshot_id=$1 GROUP BY action",[captured.snapshot.id])).rows;assert.ok(access.some(r=>r.action==='report.export'&&r.n===2));assert.ok(access.some(r=>r.action==='report.read'));
 await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});
 // Revoking the only organization grant hides the organization before any snapshot lookup.
 await assert.rejects(capture(filter,s.local.token,key),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(service.readAudit(s.local.token,q,captured.snapshot.id,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 const accountantKey=randomUUID(),expiring=await capture({...filter,kind:'receipt_correction'},accountant.token,accountantKey);
 await owner.query('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');
 try {
 await owner.query("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[expiring.snapshot.id]);
 } finally {await owner.query('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');}
 await assert.rejects(capture({...filter,kind:'receipt_correction'},accountant.token,accountantKey),{code:'REPORT_EXPIRED'});
 await assert.rejects(service.readAudit(accountant.token,q,expiring.snapshot.id,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
});

await test('explicit financial policy configuration enforces approved baseline, scoped revisions and exact disabled-rollout replay',{timeout:60000},async t=>{
 const s=await bookingSetup(t);await s.db.preparePayments();const owner=s.db.ownerPool(),q={organization_id:org,franchise_id:A},service=createFinancialWorkflowService(s.pool),enabled=createFinancialWorkflowService(s.pool,true);
 await owner.query(`GRANT SELECT,INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_document_links TO "${s.db.runtimeRole}"`);
 assert.deepEqual(await service.readPolicy(s.local.token,q,randomUUID()),{policy:null,writes_enabled:false});
 const body={expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false},key=randomUUID();
 const configure=(token=s.local.token,input:unknown=body,idempotency=key,query=q)=>service.configurePolicy(token,query,idempotency,['idempotency-key',idempotency],input,randomUUID());
 const accountant=await s.grant('accountant',[A]),reader=await s.grant('read_only',[A]);
 for(const actor of [s.operator,s.admin,accountant,reader]){await assert.rejects(configure(actor.token),{code:'ACTION_FORBIDDEN'});await assert.rejects(service.readPolicy(actor.token,q,randomUUID()),{code:'ACTION_FORBIDDEN'});}
 await assert.rejects(configure(s.local.token,body,key,{organization_id:org,franchise_id:B}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(configure(s.local.token,{...body,allow_self_approval:true}),{code:'VALIDATION_FAILED'});
 await assert.rejects(configure(s.local.token,{...body,discount_review_threshold_paise:50000}),{code:'VALIDATION_FAILED'});
 const saved=await configure();assert.deepEqual(saved,{id:saved.id,version:1,discount_review_threshold_paise:null,allow_self_approval:false,enabled:true});
 assert.deepEqual(await configure(),saved);assert.deepEqual((await service.readPolicy(s.local.token,q,randomUUID())).policy,saved);
 await assert.rejects(configure(s.local.token,{...body,enabled:false}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(configure(s.local.token,body,randomUUID()),{code:'VERSION_CONFLICT'});
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id;
 const proposal={booking_id:booking,expected_version:0,payment_version:0,kind:'discount',reason:'customer_agreement',pre_tax:1,taxable:1},requestKey=randomUUID();
 await assert.rejects(service.request(s.operator.token,q,requestKey,['idempotency-key',requestKey],proposal,randomUUID()),{code:'FINANCIAL_WORKFLOW_DISABLED'});
 const submitted=await enabled.request(s.local.token,q,requestKey,['idempotency-key',requestKey],proposal,randomUUID()),decisionKey=randomUUID();
 await assert.rejects(enabled.decide(s.local.token,q,submitted.id,decisionKey,['idempotency-key',decisionKey],{expected_version:0,outcome:'approved'},randomUUID()),{code:'ACTION_FORBIDDEN'});
 const reviewer=await s.grant('franchise_admin',[A]);await enabled.decide(reviewer.token,q,submitted.id,decisionKey,['idempotency-key',decisionKey],{expected_version:0,outcome:'approved'},randomUUID());
 const revisionKey=randomUUID(),disable={...body,expected_version:1,enabled:false};const stopped=await configure(s.local.token,disable,revisionKey);assert.equal(stopped.version,2);
 assert.deepEqual(await configure(),saved);assert.deepEqual((await service.readPolicy(s.local.token,q,randomUUID())).policy,stopped);
 const applyKey=randomUUID();await assert.rejects(enabled.apply(s.local.token,q,submitted.id,applyKey,['idempotency-key',applyKey],{expected_version:1},randomUUID()),{code:'FINANCIAL_APPROVAL_REQUIRED'});
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_policy_revisions')).rows[0]!.n,2);assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);
 await assert.rejects(owner.query('UPDATE shipit.financial_policy_revisions SET enabled=true WHERE id=$1',[stopped.id]),{code:'DB_QUERY_FAILED',sqlState:'23514'});
});

await test('distinct refund requests serialize capacity and recover exact intent across interrupted commits',{timeout:60000},async t=>{
 const s=await bookingSetup(t,undefined,{pricingDraft:{...draft,rules:draft.rules.map((r,index)=>index===0?{...r,freight_paise:47370}:r)}});await s.db.preparePayments();
 const owner=s.db.ownerPool(),q={organization_id:org,franchise_id:A};
 await owner.query(`GRANT SELECT,INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_refund_evidence,shipit.financial_document_links TO "${s.db.runtimeRole}"`);
 await owner.query(`GRANT SELECT ON shipit.receiving_account_revisions TO "${s.db.runtimeRole}"`);
 const booked=await s.book();assert.equal(booked.statusCode,201);const booking=booked.json().id;
 const paymentKey=randomUUID();await createPaymentService(s.pool).execute(s.local.token,booking,null,q,paymentKey,['idempotency-key',paymentKey],collectionInput(50000),'payments.collect',randomUUID());
 const service=createFinancialWorkflowService(s.pool,true),financeReader=createFinanceService(s.pool);
 const policyKey=randomUUID();await service.configurePolicy(s.local.token,q,policyKey,['idempotency-key',policyKey],{expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false},randomUUID());
 const request=async(body:unknown)=>{const key=randomUUID(),r=await service.request(s.operator.token,q,key,['idempotency-key',key],body,randomUUID()),dk=randomUUID();await service.decide(s.local.token,q,r.id,dk,['idempotency-key',dk],{expected_version:0,outcome:'approved'},randomUUID());return r.id;};
 const initial=await financeReader.read(s.local.token,q,booking,randomUUID());
 const cancelled=await request({booking_id:booking,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',pre_tax:Number(initial.pre_tax),taxable:Number(initial.taxable),cgst:Number(initial.cgst),sgst:Number(initial.sgst),igst:Number(initial.igst),rounding:Number(initial.rounding)});
 const cancelKey=randomUUID();await service.apply(s.local.token,q,cancelled,cancelKey,['idempotency-key',cancelKey],{expected_version:1},randomUUID());
 const account=randomUUID();await withTransaction(owner,async tx=>{
  await tx.query('INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id) VALUES($1,$2,$3)',[account,org,A]);
  await tx.query(`INSERT INTO shipit.receiving_account_revisions(id,organization_id,franchise_id,account_id,version,name,methods,other_method_name,active,actor_id,correlation_id,key_digest,fingerprint) VALUES($1,$2,$3,$4,1,'Synthetic refund drawer',ARRAY['cash'],NULL,true,$5,$6,$7,$8)`,[randomUUID(),org,A,account,s.local.id,randomUUID(),digest(),digest()]);
 });
 const evidence=async(reference:string)=>({account_id:account,expected_account_version:1,method:'cash',occurred_at:(await owner.query<{instant:Date}>('SELECT clock_timestamp() instant')).rows[0]!.instant.toISOString(),returned_to_ref:'SYN_BENEFICIARY',transfer_ref:reference});
 const sourceBefore=(await owner.query('SELECT * FROM shipit.payment_entries ORDER BY id')).rows;
 const requests=await Promise.all([request({booking_id:booking,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',refund:30000}),request({booking_id:booking,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',refund:30000})]);
 const bodies=await Promise.all(requests.map((_,i)=>evidence('SYN_COMPETING_'+i).then(refund_evidence=>({expected_version:1,refund_evidence})))),keys=requests.map(()=>randomUUID());
 const results=await Promise.allSettled(requests.map((id,i)=>service.apply(s.local.token,q,id,keys[i]!,['idempotency-key',keys[i]!],bodies[i],randomUUID())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const loser=results.find(r=>r.status==='rejected');assert.ok(loser&&loser.status==='rejected');assert.equal(loser.reason.code,'VERSION_CONFLICT');
 const position=await financeReader.read(s.local.token,q,booking,randomUUID());assert.equal(position.refunds,'30000');
 assert.equal((await owner.query('SELECT count(*)::int n FROM shipit.financial_refund_evidence')).rows[0]!.n,1);
 const remaining=await request({booking_id:booking,expected_version:2,payment_version:1,kind:'refund',reason:'customer_refund',refund:20000}),body={expected_version:1,refund_evidence:await evidence('SYN_RECOVERED')},key=randomUUID();
 const facts=async()=>({changes:(await owner.query('SELECT * FROM shipit.financial_changes ORDER BY id')).rows,decisions:(await owner.query('SELECT * FROM shipit.financial_request_decisions ORDER BY id')).rows,evidence:(await owner.query('SELECT * FROM shipit.financial_refund_evidence ORDER BY id')).rows});
 const before=await facts();
 for(const point of ['INSERT INTO shipit.financial_refund_evidence','INSERT INTO shipit.financial_request_decisions','COMMIT']){
  await assert.rejects(createFinancialWorkflowService(paymentFault(s.pool,point,'before'),true).apply(s.local.token,q,remaining,key,['idempotency-key',key],body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await facts(),before);
 }
 await assert.rejects(createFinancialWorkflowService(paymentFault(s.pool,'COMMIT','after'),true).apply(s.local.token,q,remaining,key,['idempotency-key',key],body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const committed=await facts();assert.equal(committed.changes.length,before.changes.length+1);assert.equal(committed.decisions.length,before.decisions.length+1);assert.equal(committed.evidence.length,before.evidence.length+1);
 const recovered=createFinancialWorkflowService(s.db.runtimePool(),true);
 await recovered.apply(s.local.token,q,remaining,key,['idempotency-key',key],body,randomUUID());assert.deepEqual(await facts(),committed);
 assert.equal((await financeReader.read(s.local.token,q,booking,randomUUID())).refunds,'50000');
 assert.deepEqual((await owner.query('SELECT * FROM shipit.payment_entries ORDER BY id')).rows,sourceBefore);
});
