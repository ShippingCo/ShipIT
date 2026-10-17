import type {CustomerAccountInput,AccountRateInput} from '@shippingco/shared';
export type CustomerAccountAction='customer_accounts.request'|'customer_accounts.select'|'customer_accounts.read'|'customer_accounts.configure'|'customer_accounts.rates'|'customer_accounts.approve';
export interface AccountRow extends Omit<CustomerAccountInput,'expected_version'|'credit_limit_paise'> {
 id:string;account_id:string;version:number;credit_limit_paise:string;recorded_at:Date;fingerprint:string;
}
export interface RateRow extends Omit<AccountRateInput,'expected_version'|'effective_from'|'effective_to'> {
 id:string;account_id:string;version:number;effective_from:Date;effective_to:Date;recorded_at:Date;fingerprint:string;
}
