import {settings} from '../data-access/settings';
import type {ScopedApi} from '../data-access/scoped-api';
import type { ReceiptDto } from '@shippingco/shared';
import { receiptView,renderReceiptView,type ReceiptView } from './receipt-view';
export {receiptHTML,receiptMoney,receiptView,renderReceiptView,taxRate,type ReceiptView,type ReceiptTaxLine} from './receipt-view';

/** Called only by an explicit user action. Print completion is never a domain fact. */
export function printReceiptView(view:ReceiptView):void {
  document.getElementById('print-root')?.remove();
  const root=document.createElement('div');root.id='print-root';root.innerHTML=renderReceiptView(view);
  document.body.appendChild(root);document.body.classList.add('printing');
  try {window.print();} finally {document.body.classList.remove('printing');root.remove();}
}
export const printReceipt=(dto:ReceiptDto):void=>printReceiptView(receiptView(dto));

export async function loadShopLogo(api:ScopedApi){return (await loadShopMarks(api)).logo;}

/**
 * What the shop itself puts on its paper: its logo, and its conditions of carriage.
 *
 * Both are absent until the shop sets them, and a failure to read them is absent too. A
 * receipt that prints without a logo is still a valid receipt; one that prints with terms
 * this software made up is not.
 */
export async function loadShopMarks(api:ScopedApi):Promise<{logo?:string;terms?:string}>{
  try{
    const shop=(await settings(api).read('franchise')).values.identity.value?.shop;
    return {...(shop?.logo?{logo:shop.logo}:{}),...(shop?.terms?.trim()?{terms:shop.terms.trim()}:{})};
  }catch{return {};}
}
export async function printReceiptViewFor(api:ScopedApi,view:ReceiptView){const marks=await loadShopMarks(api);if(api.scope.signal.aborted)throw Error('Receipt access changed.');printReceiptView({...marks,...view});}
export const printReceiptFor=(api:ScopedApi,dto:ReceiptDto,marks:{duplicate?:string;cancelled?:boolean}={})=>printReceiptViewFor(api,receiptView(dto,marks));

/** The sheet the operator is looking at, saved to a file. One renderer, so one document. */
export async function downloadReceiptFor(api:ScopedApi,dto:ReceiptDto,marks:{duplicate?:string;cancelled?:boolean}={}){
  const shop=await loadShopMarks(api);
  if(api.scope.signal.aborted)throw Error('Receipt access changed.');
  const view=receiptView(dto,marks);
  const page='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'
    +view.number.replace(/[^A-Za-z0-9-]/g,'')+'</title></head><body style="margin:24px">'
    +renderReceiptView({...shop,...view})+'</body></html>';
  const url=URL.createObjectURL(new Blob([page],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=view.number.replace(/[^A-Za-z0-9-]/g,'')+'.html';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
