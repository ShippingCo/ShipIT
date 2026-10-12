import {randomUUID} from 'node:crypto';
import {auditSetup,org,A} from './audit-support.ts';
import {contact} from './customer-support.ts';
import {createCustomerService} from '../src/modules/customers/service.ts';
import {createReceivingAccountService} from '../src/modules/payments/account-service.ts';
import {createMoneyReceiptService} from '../src/modules/payments/receipt-service.ts';
import {createCashLocationService} from '../src/modules/cashbook/location-service.ts';
import {createCashbookRequestService} from '../src/modules/cashbook/request-service.ts';
import {createCashbookEffectService} from '../src/modules/cashbook/effect-service.ts';
import {createCashCloseService} from '../src/modules/cashbook/close-service.ts';
import type {CashCloseOperation} from '@shippingco/shared';
export const closeQuery={organization_id:org,franchise_id:A},closeHeaders=(key:string)=>['idempotency-key',key];
export async function setupCashClose(t:Parameters<typeof auditSetup>[0],options:{database?:Parameters<typeof auditSetup>[2];closing?:boolean}={}){
 const s=await auditSetup(t,undefined,options.database);if(options.closing!==false)await s.db.prepareCashClose();else await s.db.prepareAgentMoney();await s.db.prepareCustomers();
 const local=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),receipts=createMoneyReceiptService(s.pool,true),requests=createCashbookRequestService(s.pool,true),effects=createCashbookEffectService(s.pool,true),closes=createCashCloseService(s.pool,true);
 const customer=await createCustomerService(s.pool,s.keys.browser).create(operator.token,org,A,randomUUID(),contact,randomUUID());
 const key=randomUUID(),account=await accounts.configure(local.token,null,closeQuery,key,closeHeaders(key),{name:'Synthetic counter cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const lk=randomUUID(),drawer=await locations.configure(local.token,null,closeQuery,lk,closeHeaders(lk),{account_id:account.id,expected_account_version:1,custodian_id:operator.id,name:'Synthetic counter drawer',active:true,expected_version:0},randomUUID());
 const now=Date.now(),opening=new Date(now-3600000).toISOString(),counted=new Date(now-60000).toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(counted));
 const command=(operation:CashCloseOperation,id:string|null,body:unknown,actor=operator,key=randomUUID())=>closes.command(actor.token,operation,id,closeQuery,key,closeHeaders(key),body,randomUUID());
 const openBody={expected_version:0,location_id:drawer.id,location_revision_id:drawer.revision_id,day,predecessor_id:null,initial_opening:{counted_at:opening,counted_paise:100000,denominations:[]},reason:'Synthetic initial physical count, pending combined review'};
 const receiptBody={customer_id:customer.id,account_id:account.id,expected_account_version:1,amount_paise:500000,currency:'INR',method:'cash',receiver_id:operator.id,custodian_id:operator.id,occurred_at:new Date(now-1800000).toISOString(),external_reference:null,allocations:[]};
 const receipt=async(amount=500000,occurred_at=receiptBody.occurred_at)=>{const k=randomUUID();return receipts.record(local.token,closeQuery,k,closeHeaders(k),{...receiptBody,amount_paise:amount,occurred_at},randomUUID());};
 const expense=async(amount:number,occurred_at:string,reviewer=local)=>{
  const position=await effects.position(local.token,closeQuery,randomUUID()),k=randomUUID(),request=await requests.submit(operator.token,closeQuery,k,closeHeaders(k),{kind:'expense',source_location_id:drawer.id,source_revision_id:drawer.revision_id,target_location_id:null,target_revision_id:null,payment_method:'cash',expected_source_version:position.source_version,amount_paise:amount,currency:'INR',category:'supplies',payee:'Synthetic supplies',responsible_employee_id:operator.id,reason:'Synthetic actual cash expense',occurred_at},randomUUID());
  const dk=randomUUID(),decision=await requests.decide(reviewer.token,request.id,closeQuery,dk,closeHeaders(dk),{decision:'approved',reason:'Synthetic independent expense review',expected_version:1},randomUUID());
  const ak=randomUUID();return effects.apply(reviewer.token,request.id,closeQuery,ak,closeHeaders(ak),{decision_id:decision.id,expected_version:2},randomUUID());
 };
 return {...s,local,operator,accounts,locations,receipts,requests,effects,closes,drawer,account,customer,opening,counted,day,command,openBody,receiptBody,receipt,expense};
}
