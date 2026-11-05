import {settings} from '../data-access/settings';
import type {ScopedApi} from '../data-access/scoped-api';
import type { ReceiptDto } from '@shippingco/shared';
import { receiptView,renderReceiptView,type ReceiptView } from './receipt-view';
export {receiptHTML,receiptMoney,receiptView,renderReceiptView,type ReceiptView} from './receipt-view';

/** Called only by an explicit user action. Print completion is never a domain fact. */
export function printReceiptView(view:ReceiptView):void {
  document.getElementById('print-root')?.remove();
  const root=document.createElement('div');root.id='print-root';root.innerHTML=renderReceiptView(view);
  document.body.appendChild(root);document.body.classList.add('printing');
  try {window.print();} finally {document.body.classList.remove('printing');root.remove();}
}
export const printReceipt=(dto:ReceiptDto):void=>printReceiptView(receiptView(dto));

export async function loadShopLogo(api:ScopedApi){try{const profile=await settings(api).read('franchise');return profile.values.identity.value?.shop?.logo??undefined;}catch{return undefined;}}
export async function printReceiptViewFor(api:ScopedApi,view:ReceiptView){const logo=await loadShopLogo(api);if(api.scope.signal.aborted)throw Error('Receipt access changed.');printReceiptView({...view,...(logo?{logo}:{})});}
export const printReceiptFor=(api:ScopedApi,dto:ReceiptDto)=>printReceiptViewFor(api,receiptView(dto));
