import type { PaymentEntryDto, PricingService, TaxCalculationDto } from './index.ts';

export interface ReceiptIssuer {
  organization_name: string; franchise_name: string; franchise_code: string;
  supplier_gstin: string; supplier_state: string;
}
export interface ReceiptBooking {
  customer_name: string; confirmed_at: string; service: PricingService;
  parcels: { docket: string; weight_grams: number }[];
}
export type ReceiptTax = Pick<TaxCalculationDto,
  'policy_id'|'policy_version'|'rule_id'|'classification'|'treatment'|'supplier_state'|'place_of_supply'|'jurisdiction'|
  'pre_tax_paise'|'taxable_basis_paise'|'cgst_paise'|'sgst_paise'|'igst_paise'|'tax_total_paise'|
  'unrounded_payable_paise'|'rounding_adjustment_paise'|'final_payable_paise'|'components'|'allocation'>;
interface ReceiptBase {
  id: string; number: string; schema_version: 1; version: number; booking_id: string; issued_at: string;
  issuer: ReceiptIssuer; booking: ReceiptBooking; currency: 'INR';
}
export interface BookingReceiptDto extends ReceiptBase {
  kind: 'booking_charge'; version: 1; booking_receipt_id: null; correction_of: null;
  charges: { freight_paise: number; packing_paise: number; tax: ReceiptTax };
}
export interface CollectionReceiptDto extends ReceiptBase {
  kind: 'collection_acknowledgement'; booking_receipt_id: string; correction_of: null;
  entry: PaymentEntryDto & { kind: 'collection' };
}
export interface ReversalReceiptDto extends ReceiptBase {
  kind: 'collection_reversal'; booking_receipt_id: string; correction_of: string;
  entry: PaymentEntryDto & { kind: 'reversal' };
}
export type ReceiptDto = BookingReceiptDto | CollectionReceiptDto | ReversalReceiptDto;
