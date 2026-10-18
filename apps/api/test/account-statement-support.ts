import {randomUUID} from 'node:crypto';
import {bookingSetup} from './booking-support.ts';
import {org,A} from './audit-support.ts';
import {input as priceInput} from './pricing-support.ts';
import {taxFacts} from './tax-support.ts';
import {createPricingService} from './../src/modules/pricing/service.ts';
import {createBookingService} from './../src/modules/bookings/service.ts';
import {createCustomerAccountService} from './../src/modules/customer-accounts/service.ts';
import {createAccountStatementService} from './../src/modules/reports/account-statement-service.ts';
const q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
export async function statementSetup(t:Parameters<typeof bookingSetup>[0]){
 const s=await bookingSetup(t);await s.db.prepareCustomerAccounts();await s.db.prepareReports();
 const accounts=createCustomerAccountService(s.pool,true,s.clock),a=await accounts.configure(s.local.token,null,q,randomUUID(),headers,{expected_version:0,debtor_customer_id:s.source.id,shipping_customer_ids:[s.source.id],name:'Fictional Monthly Debtor',billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'SYN_ATTESTATION'},closing_day:31,due_days:10,credit_limit_paise:10000000,state:'active',reason:'Approved synthetic terms'},randomUUID());
 const pricing=createPricingService(s.pool,s.clock,true),bookings=createBookingService(s.pool,s.keys.browser,s.clock,true),service=createAccountStatementService(s.pool,true);
 const book=async()=>{const pricing_input={...priceInput,customer_account_id:a.id},quote=await pricing.quote(s.operator.token,org,A,randomUUID(),pricing_input,randomUUID()),tax_intent={quote_id:quote.id,pricing_input,facts:taxFacts},intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID()),tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());return bookings.create(s.operator.token,org,A,randomUUID(),{...s.body,tax_intent,tax_calculation_id:tax.id},randomUUID());};
 const period={account_id:a.id,from_day:'2099-01-01',to_day:'2099-01-31'},preview=()=>service.previewStatement(s.local.token,q,period,randomUUID());
 const issue=async()=>{const p=await preview();return service.issueAccountStatement(s.local.token,q,randomUUID(),headers,{...period,expected_version:p.version-1,source_digest:p.source_digest},randomUUID());};
 return {...s,a,accounts,book,service,period,preview,issue};
}
