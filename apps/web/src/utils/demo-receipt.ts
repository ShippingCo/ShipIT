// Fictional demo composition only. Never a production receipt or API fallback.
import { findByDocket, db, fmtMoney, fmtDT, grossOf } from '../data/store';
import { printReceiptView, renderReceiptView, type ReceiptView } from './receipt';
import type { Booking, Business } from '../data/types';
function demoView(b:Booking,biz:Business):ReceiptView {
  return {heading:'Fictional demo receipt',number:b.docket,issuer:biz.name,customer:b.name,
    rows:[['Booking date',fmtDT(b.createdAt)],['Service / Weight',`${b.serviceType} · ${b.weightKg} kg`],
      ['Packing charges',fmtMoney(b.amount.packing)],['Freight charges',fmtMoney(b.amount.freight)],
      ...(b.tax?[['Taxable value',fmtMoney(b.tax.taxable)],['CGST',fmtMoney(b.tax.cgst)],['SGST',fmtMoney(b.tax.sgst)],['IGST',fmtMoney(b.tax.igst)]] as [string,string][]:[])],
    totalLabel:'Booked total',total:fmtMoney(grossOf(b)),note:'Fictional demo data — not an issued production receipt.'};
}
export const demoReceiptHTML=(b:Booking,biz:Business)=>renderReceiptView(demoView(b,biz));
export function printDemoReceipt(docket:string):void {
  const b=findByDocket(docket);if(b)printReceiptView(demoView(b,db().business));
}
