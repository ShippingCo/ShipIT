export interface CashLocationDto {
 id:string;revision_id:string;version:number;name:string;active:boolean;kind:'cash'|'noncash';
 account_id:string;account_revision_id:string;account_version:number;custodian_id:string|null;recorded_at:string;
}
export interface CashLocationInput {
 account_id:string;expected_account_version:number;custodian_id:string|null;name:string;active:boolean;expected_version:number;
}

export type CashMovementKind='expense'|'opening_float'|'owner_funds'|'deposit'|'withdrawal';
export type ExpenseCategory='rent'|'utilities'|'supplies'|'transport'|'maintenance'|'other';
export interface CashbookRequestInput {
 kind:CashMovementKind;source_location_id:string;source_revision_id:string;target_location_id:string|null;target_revision_id:string|null;
 expected_source_version:number;amount_paise:number;currency:'INR';category:ExpenseCategory|null;payee:string|null;
 responsible_employee_id:string;reason:string;occurred_at:string;
}
export interface CashbookRequestDto extends CashbookRequestInput {
 id:string;actor_id:string;recorded_at:string;
}
export interface CashbookDecisionInput {decision:'approved'|'rejected';reason:string;expected_version:1}
export interface CashbookDecisionDto {id:string;request_id:string;decision:'approved'|'rejected';reason:string;actor_id:string;recorded_at:string;version:2}
export interface CashbookRequestDetail {request:CashbookRequestDto;decision:CashbookDecisionDto|null;version:1|2}
