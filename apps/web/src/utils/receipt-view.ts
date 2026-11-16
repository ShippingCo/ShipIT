import type { ReceiptDto } from '@shippingco/shared';

/** One tax component as it prints: the name, the rate it was charged at, and the amount. */
export interface ReceiptTaxLine { label: string; rate: string; amount: string }

/** Pure presentation only: values come from the authorized issued DTO. */
export interface ReceiptView {
  logo?: string; heading: string; number: string; issuer: string; customer: string;
  rows: readonly (readonly [string,string])[];
  /**
   * CGST/SGST/IGST with their rates. Absent - not zero - where the shop has no GSTIN: a
   * zero-value tax row on a receipt reads as "GST was charged, at nothing", which is a
   * different and wrong statement from "this shop does not charge GST".
   */
  taxLines?: readonly ReceiptTaxLine[];
  totalLabel: string; total: string; note: string;
  /**
   * Set on every print after the first, carrying the time of this reprint. It is on the
   * document itself and there is no setting to suppress it: two identical receipts in
   * circulation is how a payment dispute starts.
   */
  duplicate?: string;
  /** A cancelled booking's receipt still prints. A tax document is not deleted. */
  cancelled?: boolean;
  /** The shop's conditions of carriage. Absent where the shop has not set them. */
  terms?: string;
}

/** A component's rate as it is spoken: 9/100 is "9.00%". Two decimals appear here and nowhere else. */
export function taxRate(numerator:number,denominator:number):string {
  if(!denominator)return '';
  const hundredths=(BigInt(numerator)*10000n)/BigInt(denominator);
  return (hundredths/100n)+'.'+String(hundredths%100n).padStart(2,'0')+'%';
}
const escape = (value: string) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function receiptMoney(paise:number):string {
  const value=BigInt(paise),abs=value<0n?-value:value;
  return `${value<0n?'-':''}₹${abs/100n}.${(abs%100n).toString().padStart(2,'0')}`;
}
export function receiptView(dto:ReceiptDto,marks:{duplicate?:string;cancelled?:boolean;terms?:string}={}):ReceiptView {
  const rows:[string,string][]=[['Issued at',dto.issued_at],['Booking confirmed',dto.booking.confirmed_at],
    ['Service',dto.booking.service],['Franchise',`${dto.issuer.franchise_name} (${dto.issuer.franchise_code})`],
    ['Supplier GSTIN',dto.issuer.supplier_gstin],['Supplier state',dto.issuer.supplier_state],
    ...dto.booking.parcels.map(p=>['Docket / Weight',`${p.docket} · ${p.weight_grams} g`] as [string,string])];
  if(dto.kind==='booking_charge'){
    const t=dto.charges.tax;
    rows.splice(0,rows.length,
      ['Booking date',new Date(dto.booking.confirmed_at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})],
      ['Service / Weight',`${dto.booking.service.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase())} · ${dto.booking.parcels.reduce((n,p)=>n+p.weight_grams,0)/1000} kg`],
      ['Packing charges',receiptMoney(dto.charges.packing_paise)],['Freight charges',receiptMoney(dto.charges.freight_paise)],
      ['Taxable value',receiptMoney(t.taxable_basis_paise)],
      ...(t.rounding_adjustment_paise?[['Rounding adjustment',receiptMoney(t.rounding_adjustment_paise)] as [string,string]]:[]));
    // Tax rows exist only where this shop is registered. Where it is not, they are absent.
    const registered=!!dto.issuer.supplier_gstin.trim();
    const amounts:Record<string,number>={CGST:t.cgst_paise,SGST:t.sgst_paise,IGST:t.igst_paise};
    const taxLines=registered?t.components.flatMap(component=>{
      const amount=component.amount_paise??amounts[component.kind];
      return amount===undefined?[]:[{label:component.kind,rate:taxRate(component.numerator,component.denominator),amount:receiptMoney(amount)}];
    }):[];
    return {heading:'Booking receipt',number:dto.number,issuer:dto.issuer.organization_name,customer:dto.booking.customer_name,rows,
      ...(taxLines.length?{taxLines}:{}),...marks,
      totalLabel:'Booked total',total:receiptMoney(t.final_payable_paise),note:'Documents booked charges. Collection is recorded separately.'};
  }
  const e=dto.entry;
  rows.push(['Booking receipt reference',dto.booking_receipt_id],['Payment entry',e.id],['Entry time',e.occurred_at],
    ['Method',e.method],['Payment context',e.context]);
  if(e.collection_reference)rows.push(['Collection reference',e.collection_reference]);
  if(dto.correction_of)rows.push(['Corrects acknowledgement',dto.correction_of]);
  if(e.reversal_of)rows.push(['Reverses entry',e.reversal_of]);
  if(e.reason_code)rows.push(['Reason',e.reason_code]);
  if(dto.allocation_source){
    const source=dto.allocation_source;rows.push(['Source receipt',source.receipt_id],['Allocation',source.allocation_id],['Money received at',source.receipt_occurred_at],['Receipt recorded at',source.receipt_recorded_at]);
    return {...marks,heading:source.kind==='allocation'?'Receipt allocation acknowledgement':'Allocation correction',number:dto.number,issuer:dto.issuer.organization_name,customer:dto.booking.customer_name,rows,total:receiptMoney(e.amount_paise),totalLabel:source.kind==='allocation'?'Applied amount':'Released allocation',note:'Applies or releases funds from an existing recorded receipt. This entry does not record new money received or a refund.'};
  }
  return {...marks,heading:dto.kind==='collection_acknowledgement'?'Collection acknowledgement':'Collection reversal',number:dto.number,
    issuer:dto.issuer.organization_name,customer:dto.booking.customer_name,rows,total:receiptMoney(e.amount_paise),
    totalLabel:dto.kind==='collection_acknowledgement'?'Collected amount':'Reversed amount',
    note:'Documents this ledger entry only. Later entries do not change this acknowledgement.'};
}
/** All variable content is escaped in text context; there are no dynamic URLs or attributes. */
export function renderReceiptView(view:ReceiptView):string {
  return `<div class="receipt-sheet" style="font-family:Roboto,sans-serif;font-variant-numeric:tabular-nums;max-width:660px;margin:0 auto;color:#17212b">
    <header style="display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #17212b;padding-bottom:14px;margin-bottom:16px;overflow-wrap:anywhere">
      <div style="font-size:19px;font-weight:700">${view.logo?.startsWith('data:image/png;base64,iVBORw0KGgo')&&view.logo.length<=30000?`<img src="${escape(view.logo)}" alt="Shop logo" style="width:56px;height:56px;object-fit:contain;margin-right:12px;vertical-align:middle">`: ''}${escape(view.issuer)}</div>
      <div style="text-align:right"><div>${escape(view.heading)}</div><b>${escape(view.number)}</b></div>
    </header>
    ${view.duplicate||view.cancelled?`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${view.cancelled?`<span style="border:2px solid #b3261e;color:#b3261e;border-radius:6px;padding:4px 10px;font-weight:700;letter-spacing:0.08em">CANCELLED</span>`:''}${view.duplicate?`<span style="border:2px solid #17212b;border-radius:6px;padding:4px 10px;font-weight:700;letter-spacing:0.08em">DUPLICATE</span><span style="align-self:center;font-size:13px;color:#5a6b7b">Reprinted ${escape(view.duplicate)}</span>`:''}</div>`:''}
    <div style="background:#f5f8fd;border:1px solid #dde5ef;border-radius:10px;padding:12px 14px;margin-bottom:14px;overflow-wrap:anywhere">Customer: ${escape(view.customer)}</div>
    ${view.rows.map(([label,value])=>`<div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px dashed #dde5ef;font-size:13px;overflow-wrap:anywhere"><span>${escape(label)}</span><b style="text-align:right">${escape(value)}</b></div>`).join('')}
    ${(view.taxLines??[]).map(line=>`<div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px dashed #dde5ef;font-size:13px;overflow-wrap:anywhere"><span>${escape(line.label)} <span style="color:#5a6b7b">@ ${escape(line.rate)}</span></span><b style="text-align:right">${escape(line.amount)}</b></div>`).join('')}
    <div style="display:flex;justify-content:space-between;gap:16px;background:#0b57d0;color:#fff;border-radius:10px;padding:12px 14px;margin-top:12px;font-weight:700"><span>${escape(view.totalLabel)}</span><span>${escape(view.total)}</span></div>
    <p style="font-size:13px;color:#5a6b7b">${escape(view.note)}</p>
    ${view.terms?`<p style="font-size:13px;color:#5a6b7b;border-top:1px solid #dde5ef;padding-top:8px;margin-top:8px">${escape(view.terms)}</p>`:''}
  </div>`;
}
export const receiptHTML=(dto:ReceiptDto):string=>renderReceiptView(receiptView(dto));
