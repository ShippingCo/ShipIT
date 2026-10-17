import type {CustomerSnapshot, PricingRuleInput} from './index.ts';

/** A shop's debtor, never a ShipIT organization or SaaS subscriber. */
export interface CustomerAccountInput {
  expected_version:number;
  debtor_customer_id:string;
  name:string;
  shipping_customer_ids:string[];
  billing_contact:{name:string;phone:string;authorization_ref:string};
  closing_day:number;
  due_days:number;
  credit_limit_paise:number;
  state:'active'|'held';
  reason:string;
}
export interface CustomerAccountDto extends Omit<CustomerAccountInput,'expected_version'|'reason'> {
  id:string;revision_id:string;version:number;recorded_at:string;
}
export interface AccountRateInput {
  expected_version:number;effective_from:string;effective_to:string;
  approval_ref:string;rules:PricingRuleInput[];
}
export interface AccountRateDto extends Omit<AccountRateInput,'expected_version'> {
  id:string;account_id:string;version:number;recorded_at:string;
}
export interface AccountCredit {
  outstanding_paise:string;available_paise:string;overdue_paise:string;
  credit_limit_paise:number;state:'active'|'held';as_of:string;
}
export interface AccountBookingSnapshot {
  account_id:string;account_revision_id:string;account_version:number;
  debtor:CustomerSnapshot;closing_day:number;due_days:number;due_date:string;
  credit_limit_paise:number;exposure_before_paise:string;
  rate_source:'account'|'normal';rate_revision_id:string|null;
  approval_id:string|null;
}
