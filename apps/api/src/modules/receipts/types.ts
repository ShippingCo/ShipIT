import type { ReceiptDto, ReceiptBooking, ReceiptIssuer, ReceiptTax, PaymentEntryDto, ReceiptAllocationSource } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
import { instant } from '../pricing/types.ts';
import { HttpError } from '../../plugins/errors.ts';
export type ReceiptAction = 'receipts.read' | 'receipts.materialize';
export interface ReceiptScopes { read: TenantAccess; materialize: TenantAccess; payment: TenantAccess }
export interface ReceiptRow {
  id: string; number: string; schema_version: 1|2; version: number; booking_id: string; issued_at: Date;
  kind: ReceiptDto['kind']; booking_receipt_id: string|null; correction_of: string|null;
  snapshot: {currency:'INR';issuer:ReceiptIssuer;booking:ReceiptBooking;charges?:{freight_paise:number;packing_paise:number;tax:ReceiptTax};entry?:PaymentEntryDto;allocation_source?:ReceiptAllocationSource};
}
function pick<T,K extends keyof T>(value:T,keys:readonly K[]):Pick<T,K> {
  return Object.fromEntries(keys.map(key=>[key,value[key]])) as Pick<T,K>;
}
/** Every nested field is allowlisted; future stored JSON fields cannot expand R13. */
export function receiptDto(row:ReceiptRow):ReceiptDto {
  const s=row.snapshot;
  const base={...pick(row,['id','number','schema_version','booking_id','version']),issued_at:instant(row.issued_at),currency:'INR' as const,
    issuer:pick(s.issuer,['organization_name','franchise_name','franchise_code','supplier_gstin','supplier_state']),
    booking:{...pick(s.booking,['customer_name','confirmed_at','service']),parcels:s.booking.parcels.map(p=>pick(p,['docket','weight_grams']))}};
  if(row.kind==='booking_charge'&&s.charges){
    if(row.schema_version!==1)throw new HttpError('TEMPORARILY_UNAVAILABLE');
    const tax=s.charges.tax;
    return {...base,schema_version:1,kind:row.kind,version:1,booking_receipt_id:null,correction_of:null,charges:{...pick(s.charges,['freight_paise','packing_paise']),
      tax:{...pick(tax,['policy_id','policy_version','rule_id','classification','treatment','supplier_state','place_of_supply','jurisdiction',
        'pre_tax_paise','taxable_basis_paise','cgst_paise','sgst_paise','igst_paise','tax_total_paise','unrounded_payable_paise','rounding_adjustment_paise','final_payable_paise','allocation']),
        components:tax.components.map(c=>pick(c,['id','kind','numerator','denominator','exact_numerator','exact_denominator','amount_paise']))}}};
  }
  if(s.entry&&row.booking_receipt_id){
    const entry=pick(s.entry,['id','kind','amount_paise','currency','context','method','collection_reference','reversal_of','reason_code','version','occurred_at']);
    const source=row.schema_version===2?s.allocation_source:undefined;
    if(row.schema_version===2&&(!source||source.kind!==(entry.kind==='collection'?'allocation':'release')))throw new HttpError('TEMPORARILY_UNAVAILABLE');
    const provenance=source?{allocation_source:pick(source,['receipt_id','allocation_id','kind','receipt_occurred_at','receipt_recorded_at'])}:{};
    if(row.kind==='collection_acknowledgement'&&entry.kind==='collection')return {...base,...provenance,kind:row.kind,booking_receipt_id:row.booking_receipt_id,correction_of:null,entry:{...entry,kind:'collection'}};
    if(row.kind==='collection_reversal'&&entry.kind==='reversal'&&row.correction_of)return {...base,...provenance,kind:row.kind,booking_receipt_id:row.booking_receipt_id,correction_of:row.correction_of,entry:{...entry,kind:'reversal'}};
  }
  throw new HttpError('TEMPORARILY_UNAVAILABLE');
}
