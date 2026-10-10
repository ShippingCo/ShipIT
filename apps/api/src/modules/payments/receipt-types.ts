import type {TenantAccess} from '../security/scope.ts';
export type MoneyReceiptAction='money_receipts.record'|'money_receipts.allocate'|'money_receipts.correct'|'money_receipts.read'|'money_receipts.select';
export interface MoneyReceiptScopes {command:TenantAccess;payment:TenantAccess;audit:TenantAccess|null;events:TenantAccess|null}
export interface MoneyReceiptRow {
 id:string;customer_id:string;account_id:string;account_revision_id:string;amount_paise:string;currency:'INR';method:import('@shippingco/shared').ReceiptMethod;
 receiver_id:string;initial_custodian_id:string;occurred_at:Date;recorded_at:Date;external_reference:string|null;
}
export interface MoneyReceiptCommand {id:string;receipt_id:string;version:number;recorded_at:Date}
