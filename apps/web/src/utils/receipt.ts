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
