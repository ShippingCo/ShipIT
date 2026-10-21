import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {statementSetup} from './account-statement-support.ts';
import {org,A} from './audit-support.ts';
import {draft,input as pricingInput} from './pricing-support.ts';
import {taxPolicy,taxFacts} from './tax-support.ts';
import {contact} from './customer-support.ts';
import {createReceivingAccountService} from '../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../src/modules/payments/receipt-service.ts';
import {createCashLocationService} from '../src/modules/cashbook/location-service.ts';
import {createCashHandoverService} from '../src/modules/cashbook/handover-service.ts';
import {createCashbookRequestService} from '../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../src/modules/cashbook/effect-service.ts';
import {createCashCloseService} from '../src/modules/cashbook/close-service.ts';
import {createAgentCodService} from '../src/modules/agent-settlements/cod-service.ts';
import {createAgentFeeService} from '../src/modules/agent-settlements/fee-service.ts';
import {createFinancialWorkflowService} from '../src/modules/reports/finance-workflow-service.ts';
import {createReconciliationService} from '../src/modules/reconciliation/service.ts';
import {createShipmentCostService} from '../src/modules/shipment-costs/service.ts';
import type {ShipmentCostCategory} from '@shippingco/shared';

export const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];

/** One real runtime-role business cycle. Only the booking calendar is placed by the
 * disposable owner: the existing pricing fixture uses a future injected clock.
 * No amount, balance, report, allocation, tax or audit result is seeded. */
export async function reconciliationSetup(t:Parameters<typeof statementSetup>[0]) {
 const s=await statementSetup(t);
 await s.db.prepareCashClose();await s.db.prepareReconciliation();await s.db.prepareShipmentCosts();await s.db.prepareOwnerReports();await s.db.prepareEway();
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await owner.query(`GRANT INSERT ON shipit.financial_adjustment_requests,shipit.financial_request_decisions,shipit.financial_document_links,shipit.financial_refund_evidence TO "${s.db.runtimeRole}"`);
 const accountant=await s.grant('accountant',[A]),reader=await s.grant('read_only',[A]),agent=await s.grant('delivery_agent',[A]);
 const now=Date.now(),day=new Date(now+19800000).toISOString().slice(0,10),start=Date.parse(day+'T00:00:00+05:30');
 const at=(offset:number)=>new Date(start+offset).toISOString(),filter={from_day:day,to_day:day};
 const stamp=async(id:string,instant:string)=>{
  await owner.query('BEGIN');try {
   await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');
   await owner.query('UPDATE shipit.bookings SET confirmed_at=$1 WHERE id=$2',[instant,id]);
   await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');await owner.query('COMMIT');
  }catch(error){await owner.query('ROLLBACK');throw error;}
 };
 const first=await s.book(),second=await s.book();await stamp(first.id,at(2));await stamp(second.id,at(3));
 const period={account_id:s.a.id,from_day:day.slice(0,7)+'-01',to_day:day};
 const issue=async(key=randomUUID())=>{const p=await s.service.previewStatement(s.local.token,q,period,randomUUID());const body={...period,expected_version:p.version-1,source_digest:p.source_digest};
  const result=await s.service.issueAccountStatement(s.local.token,q,key,headers,body,randomUUID());
  assert.deepEqual(await s.service.issueAccountStatement(s.local.token,q,key,headers,body,randomUUID()),result);return result;};
 const originalStatement=await issue();
 // A second genuine rate/tax version: this fictional treatment is not a legal preset.
 const from='2099-01-02T00:00:00Z',to='2099-01-03T00:00:00Z';
 await s.pricing.create(s.local.token,org,A,randomUUID(),{...draft,effective_from:from,effective_to:to,rules:[{...draft.rules[0]!,freight_paise:10000,packing_paise:0}]},randomUUID()).then(p=>s.pricing.publish(s.local.token,org,A,p.id,randomUUID(),{expected_version:1},randomUUID()));
 const policy=await s.tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,effective_from:from,effective_to:to,rules:[{...taxPolicy.rules[0]!,treatment:'exempt',taxable_lines:[],components:[]}]},randomUUID());
 await s.tax.publish(s.local.token,org,A,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(from);
 const seller=await s.customer.create(s.operator.token,org,A,randomUUID(),{...contact,name:'Fictional COD customer'},randomUUID());
 const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricingInput,randomUUID()),tax_intent={quote_id:quote.id,pricing_input:pricingInput,facts:taxFacts};
 const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID()),tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 const codBooking=await s.booking.create(s.operator.token,org,A,randomUUID(),{...s.body,customer_id:seller.id,tax_intent,tax_calculation_id:tax.id,parcels:[{...s.body.parcels[0]!,weight_grams:400},{...s.body.parcels[0]!,weight_grams:599}]},randomUUID());await stamp(codBooking.id,at(4));
 assert.equal(codBooking.charges.tax.final_payable_paise,10000);assert.equal(codBooking.charges.tax.pre_tax_paise,10000);
 const accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true,true),receipts=createMoneyReceiptService(s.pool,true,true);
 const account=async(name:string,methods:string[])=>accounts.configure(s.local.token,null,q,randomUUID(),headers,{name,methods,other_method_name:null,active:true,expected_version:0},randomUUID());
 const cash=await account('Fictional office cash',['cash']),heldAccount=await account('Fictional agent cash',['cash']),bank=await account('Fictional bank',['bank_transfer']),card=await account('Fictional card',['card','bank_transfer']),upi=await account('Fictional UPI',['upi']);
 const location=async(accountId:string,custodian_id:string|null,name:string)=>locations.configure(s.local.token,null,q,randomUUID(),headers,{account_id:accountId,expected_account_version:1,custodian_id,name,active:true,expected_version:0},randomUUID());
 const drawer=await location(cash.id,s.operator.id,'Fictional drawer'),held=await location(heldAccount.id,agent.id,'Fictional agent custody'),cardLocation=await location(card.id,null,'Fictional card clearing');await location(bank.id,null,'Fictional bank');await location(upi.id,null,'Fictional UPI');
 const receipt=async(accountId:string,method:string,amount:number,allocations:unknown[],customer=s.source.id,receiver=s.operator.id,reference:string|null=null)=>{
  const body={customer_id:customer,account_id:accountId,expected_account_version:1,amount_paise:amount,currency:'INR',method,receiver_id:receiver,custodian_id:receiver,occurred_at:at(10),external_reference:reference,allocations},key=randomUUID();
  const r=await receipts.record(s.local.token,q,key,headers,body,randomUUID());assert.deepEqual(await receipts.record(s.local.token,q,key,headers,body,randomUUID()),r);return r;
 };
 const allocation=(booking_id:string,amount_paise:number,expected_payment_version=0)=>({booking_id,amount_paise,context:'to_pay',expected_payment_version});
 const codReceipt=await receipt(heldAccount.id,'cash',210000,[allocation(codBooking.id,10000)],seller.id,agent.id);
 const bankReceipt=await receipt(bank.id,'bank_transfer',10000,[allocation(first.id,6000),allocation(second.id,2000)]);
 const cardReceipt=await receipt(card.id,'card',5000,[allocation(first.id,1000,1)],s.source.id,s.operator.id,'=FICTIONAL_REFERENCE');
 const upiReceipt=await receipt(upi.id,'upi',4000,[]),cashReceipt=await receipt(cash.id,'cash',5000,[]);
 const cod=createAgentCodService(s.pool,true),beneficiary=await cod.configureBeneficiary(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional seller',active:true},randomUUID());
 const beneficiaryId=(await owner.query('SELECT beneficiary_id FROM shipit.cod_beneficiary_revisions WHERE id=$1',[beneficiary.resource_id])).rows[0]!.beneficiary_id;
 const obligation=await cod.configureCod(s.local.token,null,q,randomUUID(),headers,{booking_id:codBooking.id,parcel_id:codBooking.parcels[0]!.id,expected_version:0,beneficiary_id:beneficiaryId,beneficiary_revision_id:beneficiary.resource_id,amount_paise:200000,currency:'INR',active:true},randomUUID());
 const obligationId=(await owner.query('SELECT obligation_id FROM shipit.cod_obligation_revisions WHERE id=$1',[obligation.resource_id])).rows[0]!.obligation_id;
 const reserved=await cod.reserve(s.local.token,q,randomUUID(),headers,{receipt_id:codReceipt.receipt_id,obligation_id:obligationId,obligation_revision_id:obligation.resource_id,amount_paise:200000,currency:'INR'},randomUUID());
 const effects=createCashbookEffectService(s.pool,true,true),requests=createCashbookRequestService(s.pool,true,true),handovers=createCashHandoverService(s.pool,true,true);
 const position=()=>effects.position(s.local.token,q,randomUUID());
 const handover=await handovers.request(s.local.token,q,randomUUID(),headers,{source_location_id:held.id,source_revision_id:held.revision_id,target_location_id:drawer.id,target_revision_id:drawer.revision_id,expected_source_version:(await position()).source_version,amount_paise:210000,currency:'INR',reason:'Fictional counted handover',occurred_at:at(20)},randomUUID());
 await handovers.respond(s.operator.token,handover.id,q,randomUUID(),headers,{kind:'accept',expected_version:1,expected_source_version:(await position()).source_version,amount_paise:210000,currency:'INR',reason:'Fictional received cash'},randomUUID());
 const expense=async(amount:number,extra:Record<string,unknown>={})=>{
  const r=await requests.submit(s.operator.token,q,randomUUID(),headers,{kind:'expense',source_location_id:drawer.id,source_revision_id:drawer.revision_id,target_location_id:null,target_revision_id:null,payment_method:'cash',expected_source_version:(await position()).source_version,amount_paise:amount,currency:'INR',category:'supplies',payee:'Fictional supplier',responsible_employee_id:s.operator.id,reason:'Fictional source evidence',occurred_at:new Date().toISOString(),...extra},randomUUID());
  const decision=await requests.decide(s.local.token,r.id,q,randomUUID(),headers,{decision:'approved',reason:'Independent fictional review',expected_version:1},randomUUID());
  const key=randomUUID(),body={decision_id:decision.id,expected_version:2},effect=await effects.apply(s.local.token,r.id,q,key,headers,body,randomUUID());assert.deepEqual(await effects.apply(s.local.token,r.id,q,key,headers,body,randomUUID()),effect);return r;
 };
 const supplies=await expense(1000),remittance=await expense(150000,{kind:'cod_remittance',category:null,payee:null,cod_allocation_id:reserved.resource_id,payment_reference:'FICTIONAL_COD_1'});
 const advance=await expense(2000,{kind:'agent_advance',category:null,payee:null,agent_payee_id:agent.id});
 const fees=createAgentFeeService(s.pool,true),term=await fees.configure(s.local.token,agent.id,q,randomUUID(),headers,{expected_version:0,basis:'agreed_period',amount_paise:2000,currency:'INR',valid_from:new Date(now-172800000).toISOString(),valid_until:new Date(now-86400000).toISOString(),active:true},randomUUID());
 const earning=await fees.earnAgreed(s.local.token,q,randomUUID(),headers,{term_revision_id:term.resource_id},randomUUID());
 const agentExpense=await expense(2000,{category:'transport',agent_payee_id:agent.id,fee_earning_id:earning.resource_id,fee_cash_paise:500,fee_advance_paise:500,fee_advance_request_id:advance.id});
 const bankFee=await expense(100,{source_location_id:cardLocation.id,source_revision_id:cardLocation.revision_id,payment_method:'bank_transfer',category:'other'});
 const workflow=createFinancialWorkflowService(s.pool,true,true);
 await workflow.configurePolicy(s.local.token,q,randomUUID(),headers,{expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false},randomUUID());
 const adjust=async(body:Record<string,unknown>,refund_evidence:unknown=null)=>{
  const r=await workflow.request(s.operator.token,q,randomUUID(),headers,body,randomUUID());await workflow.decide(s.local.token,q,r.id,randomUUID(),headers,{expected_version:0,outcome:'approved'},randomUUID());
  const key=randomUUID(),input={expected_version:1,refund_evidence},result=await workflow.apply(s.local.token,q,r.id,key,headers,input,randomUUID());assert.deepEqual(await workflow.apply(s.local.token,q,r.id,key,headers,input,randomUUID()),result);return r;
 };
 const tax2=second.charges.tax;
 const cancelled=await adjust({booking_id:second.id,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',pre_tax:tax2.pre_tax_paise,taxable:tax2.taxable_basis_paise,cgst:tax2.cgst_paise,sgst:tax2.sgst_paise,igst:tax2.igst_paise,rounding:tax2.rounding_adjustment_paise});
 const refunded=await adjust({booking_id:second.id,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',refund:2000},{account_id:bank.id,expected_account_version:1,method:'bank_transfer',occurred_at:new Date().toISOString(),returned_to_ref:'FICTIONAL_CUSTOMER',transfer_ref:'FICTIONAL_RETURN_1'});
 const statement=await issue();
 const reconciliation=createReconciliationService(s.pool,true);
 await reconciliation.configure(s.local.token,q,randomUUID(),headers,{expected_version:0,enabled:true,reason:'Fictional manual opt in'},randomUUID());
 const mapping=await reconciliation.publishMapping(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional CSV',identity_namespace:'ISSUE67',date_column:'Date',date_format:'yyyy-mm-dd',amount:{mode:'signed',unit:'paise',amount_column:'Amount',positive_direction:'credit'},reference_column:'Ref',identity_column:'ID',currency_column:null},randomUUID());
 const importBody={account_id:card.id,mapping_id:mapping.id,period_from:day,period_to:day,content_base64:Buffer.from(`Date,Amount,Ref,ID\n${day},4900,FICTIONAL_NET,NET-1\n${day},700,FICTIONAL_PENDING,PENDING-1`).toString('base64')};
 const imported=await reconciliation.preview(s.local.token,q,randomUUID(),headers,importBody,randomUUID()),importKey=randomUUID();
 const committed=await reconciliation.commitImport(s.local.token,imported.id,q,importKey,headers,{rows:[2,3]},randomUUID());assert.deepEqual(await reconciliation.commitImport(s.local.token,imported.id,q,importKey,headers,{rows:[2,3]},randomUUID()),committed);
 const duplicate=await reconciliation.preview(s.local.token,q,randomUUID(),headers,importBody,randomUUID());await reconciliation.commitImport(s.local.token,duplicate.id,q,randomUUID(),headers,{rows:[2,3]},randomUUID());
 const transactions=await reconciliation.readImport(s.local.token,imported.id,q,randomUUID());
 const line=async(source_id:string,amount_paise:number)=>({source_id,amount_paise,source_version:(await owner.query('SELECT version FROM shipit.reconciliation_recorded_sources WHERE id=$1',[source_id])).rows[0]!.version});
 const sourceLines=[await line('receipt:'+cardReceipt.receipt_id,5000)],feeLines=[await line('cashbook:'+bankFee.id+':'+cardLocation.id,100)];
 const batch=await reconciliation.saveBatch(s.local.token,null,q,randomUUID(),headers,{expected_version:0,account_id:card.id,expected_date:day,reference:'FICTIONAL_NET',reason:'Fictional evidenced net',receipts:sourceLines,fees:feeLines},randomUUID());
 await reconciliation.confirmMatch(s.local.token,q,randomUUID(),headers,{account_id:card.id,method:'manual',reason:'Fictional manual net review',batch_id:batch.id,transactions:[{transaction_id:transactions.outcomes[0]!.transaction_id,amount_paise:4900}],sources:sourceLines,fees:feeLines},randomUUID());
 const costs=createShipmentCostService(s.pool,true);
 for(const category of ['courier','packing','payment','agent'] as ShipmentCostCategory[]){const monetary=category==='courier';await costs.record(s.local.token,q,null,randomUUID(),headers,{source_id:null,expected_version:0,category,state:monetary?'actual':'not_applicable',amount_paise:monetary?6000:0,effective_at:new Date().toISOString(),reason:'Fictional attributable cost coverage',reference:'FICTIONAL_COST',supplier:monetary?'FICTIONAL_SUPPLIER':null,document:monetary?'FICTIONAL_INVOICE':null,line:monetary?'1':null,expense_id:null,rate_import_id:null,rate_booking_id:null,allocations:[{booking_id:codBooking.id,parcel_id:null,amount_paise:monetary?6000:0}]},randomUUID());}
 const closes=createCashCloseService(s.pool,true),open=await closes.command(s.operator.token,'open',null,q,randomUUID(),headers,{expected_version:0,location_id:drawer.id,location_revision_id:drawer.revision_id,day,predecessor_id:null,initial_opening:{counted_at:at(1),counted_paise:10000,denominations:[]},reason:'Fictional actual opening'},randomUUID());
 const count=await closes.command(s.operator.token,'count',open.session_id,q,randomUUID(),headers,{expected_version:1,counted_at:new Date().toISOString(),counted_paise:71000,denominations:[],reason:'Fictional physical shortage'},randomUUID());
 const submit=await closes.command(s.operator.token,'submit',open.session_id,q,randomUUID(),headers,{expected_version:2,count_id:count.command_id,reason:'Fictional exact count submitted'},randomUUID());
 await closes.command(s.local.token,'decide',open.session_id,q,randomUUID(),headers,{expected_version:3,submission_id:submit.command_id,kind:'approve',sole_admin_acknowledged:false,reason:'Independent fictional discrepancy review'},randomUUID());
 return {...s,owner,accountant,reader,agent,day,start,at,filter,stamp,first,second,codBooking,seller,originalStatement,statement,issue,accounts,receipts,cash,bank,card,upi,drawer,held,codReceipt,bankReceipt,cardReceipt,upiReceipt,cashReceipt,reserved,remittance,advance,earning,agentExpense,supplies,bankFee,position,closes,count,workflow,adjust,cancelled,refunded,reconciliation,mapping,imported,batch,costs};
}
