export interface CashLocationDto {
 id:string;revision_id:string;version:number;name:string;active:boolean;kind:'cash'|'noncash';
 account_id:string;account_revision_id:string;account_version:number;custodian_id:string|null;recorded_at:string;
}
export interface CashLocationInput {
 account_id:string;expected_account_version:number;custodian_id:string|null;name:string;active:boolean;expected_version:number;
}
