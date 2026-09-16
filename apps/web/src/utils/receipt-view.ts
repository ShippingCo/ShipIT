import type { ReceiptDto } from '@shippingco/shared';

/** Pure presentation only: values come from the authorized issued DTO. */
export interface ReceiptView {
  heading: string; number: string; issuer: string; customer: string;
  rows: readonly (readonly [string,string])[]; totalLabel: string; total: string; note: string;
}
const escape = (value: string) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function receiptMoney(paise:number):string {
  const value=BigInt(paise),abs=value<0n?-value:value;
  return `${value<0n?'-':''}₹${abs/100n}.${(abs%100n).toString().padStart(2,'0')}`;
}
export function receiptView(dto:ReceiptDto):ReceiptView {
  const rows:[string,string][]=[['Issued at',dto.issued_at],['Booking confirmed',dto.booking.confirmed_at],
    ['Service',dto.booking.service],['Franchise',`${dto.issuer.franchise_name} (${dto.issuer.franchise_code})`],
    ['Supplier GSTIN',dto.issuer.supplier_gstin],['Supplier state',dto.issuer.supplier_state],
    ...dto.booking.parcels.map(p=>['Docket / Weight',`${p.docket} · ${p.weight_grams} g`] as [string,string])];
  if(dto.kind==='booking_charge'){
    const t=dto.charges.tax;
    rows.push(['Freight',receiptMoney(dto.charges.freight_paise)],['Packing',receiptMoney(dto.charges.packing_paise)],
      ['Pre-tax charges',receiptMoney(t.pre_tax_paise)],['Taxable basis',receiptMoney(t.taxable_basis_paise)],
      ['Tax treatment',t.treatment],['Place of supply',t.place_of_supply],
      ...t.components.map(c=>[`${c.kind} ${c.id} (rate ${c.numerator}/${c.denominator})`,receiptMoney(c.amount_paise)] as [string,string]),
      ['CGST',receiptMoney(t.cgst_paise)],['SGST',receiptMoney(t.sgst_paise)],['IGST',receiptMoney(t.igst_paise)],
      ['Tax total',receiptMoney(t.tax_total_paise)],['Unrounded payable',receiptMoney(t.unrounded_payable_paise)],
      ['Rounding adjustment',receiptMoney(t.rounding_adjustment_paise)]);
    return {heading:'Booking receipt',number:dto.number,issuer:dto.issuer.organization_name,customer:dto.booking.customer_name,rows,
      totalLabel:'Booked total',total:receiptMoney(t.final_payable_paise),note:'Documents booked charges. Collection is recorded separately.'};
  }
  const e=dto.entry;
  rows.push(['Booking receipt reference',dto.booking_receipt_id],['Payment entry',e.id],['Entry time',e.occurred_at],
    ['Method',e.method],['Payment context',e.context]);
  if(e.collection_reference)rows.push(['Collection reference',e.collection_reference]);
  if(dto.correction_of)rows.push(['Corrects acknowledgement',dto.correction_of]);
  if(e.reversal_of)rows.push(['Reverses entry',e.reversal_of]);
  if(e.reason_code)rows.push(['Reason',e.reason_code]);
  return {heading:dto.kind==='collection_acknowledgement'?'Collection acknowledgement':'Collection reversal',number:dto.number,
    issuer:dto.issuer.organization_name,customer:dto.booking.customer_name,rows,total:receiptMoney(e.amount_paise),
    totalLabel:dto.kind==='collection_acknowledgement'?'Collected amount':'Reversed amount',
    note:'Documents this ledger entry only. Later entries do not change this acknowledgement.'};
}
/** All variable content is escaped in text context; there are no dynamic URLs or attributes. */
export function renderReceiptView(view:ReceiptView):string {
  return `<div class="receipt-sheet" style="font-family:Roboto,sans-serif;font-variant-numeric:tabular-nums;max-width:660px;margin:0 auto;color:#17212b">
    <header style="display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #17212b;padding-bottom:14px;margin-bottom:16px;overflow-wrap:anywhere">
      <div style="font-size:19px;font-weight:700">${escape(view.issuer)}</div>
      <div style="text-align:right"><div>${escape(view.heading)}</div><b>${escape(view.number)}</b></div>
    </header>
    <div style="background:#f5f8fd;border:1px solid #dde5ef;border-radius:10px;padding:12px 14px;margin-bottom:14px;overflow-wrap:anywhere">Customer: ${escape(view.customer)}</div>
    ${view.rows.map(([label,value])=>`<div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px dashed #dde5ef;font-size:13px;overflow-wrap:anywhere"><span>${escape(label)}</span><b style="text-align:right">${escape(value)}</b></div>`).join('')}
    <div style="display:flex;justify-content:space-between;gap:16px;background:#0b57d0;color:#fff;border-radius:10px;padding:12px 14px;margin-top:12px;font-weight:700"><span>${escape(view.totalLabel)}</span><span>${escape(view.total)}</span></div>
    <p style="font-size:11px;color:#5a6b7b">${escape(view.note)}</p>
  </div>`;
}
export const receiptHTML=(dto:ReceiptDto):string=>renderReceiptView(receiptView(dto));
