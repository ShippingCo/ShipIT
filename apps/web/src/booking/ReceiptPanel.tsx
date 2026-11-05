import { useEffect, useRef, useState } from 'react';
import type { ReceiptDto } from '@shippingco/shared';
import { receiptView, printReceiptFor } from '../utils/receipt';
import { receipts } from '../data-access/receipts';
import type { ScopedApi } from '../data-access/scoped-api';
import type { ScopeController } from '../operator/scope';
import { failureMessage } from './failures';
export function ReceiptPanel({ api, controller, bookingId, paymentId, focusRequest, onClose }: { api: ScopedApi; controller: ScopeController; bookingId: string; paymentId?: string; focusRequest?:number; onClose?:()=>void }) {
  const [dto, setDto] = useState<ReceiptDto>(), [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle'), [message, setMessage] = useState('');
  const pending = useRef<AbortController>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(focusRequest!==undefined){heading.current?.focus();heading.current?.scrollIntoView?.({block:'start'});}},[focusRequest]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => controller.runtime.onInvalidate(() => { pending.current?.abort(); setDto(undefined); setMessage(''); document.getElementById('print-root')?.remove(); document.body.classList.remove('printing'); }), [controller]);
  async function load() {
    if (phase === 'loading') return; const abort = new AbortController(); pending.current = abort; setPhase('loading'); setMessage('Loading issued receipt…');
    try { const client = receipts(api), result = paymentId ? await client.payment(bookingId, paymentId, abort.signal) : await client.booking(bookingId, abort.signal);
      if (abort.signal.aborted || !controller.runtime.isCurrent(api.scope)) return; setDto(result); setPhase('ready'); setMessage('Issued receipt ready. Printing is optional.');
    } catch (error) { if (abort.signal.aborted || !controller.runtime.isCurrent(api.scope)) return; setDto(undefined); setPhase('error'); setMessage('Booking saved. Receipt is temporarily unavailable. ' + failureMessage(error)); }
  }
  const view = dto && receiptView(dto);
  return <section className="card counter-section" aria-label={paymentId ? 'Collection receipt' : 'Booking receipt'}>
    <h2 ref={heading} tabIndex={focusRequest!==undefined?-1:undefined} className="t-title-lg">{paymentId ? 'Collection acknowledgement' : 'Booking receipt'}</h2>
    {onClose&&<button type="button" className="btn btn-text" onClick={onClose}>Back to receipts</button>}
    <p role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message || 'View the saved receipt. Print it only when you need a copy.'}</p>
    <button type="button" className="btn btn-outlined" disabled={phase === 'loading'} aria-busy={phase === 'loading'} onClick={() => { void load(); }}>{phase === 'error' ? 'Retry receipt' : dto ? 'Reload receipt' : 'Load receipt'}</button>
    {view && <><div className="receipt-facts"><div><p className="ops-note">Issued receipt</p><p>{view.number} · {view.customer}</p><p>{view.issuer}</p></div><p className="t-title-lg">{view.totalLabel}: {view.total}</p></div>
      <button type="button" className="btn btn-filled" onClick={() => { void printReceiptFor(api,dto!).catch(()=>setMessage('Print dialog unavailable. The saved receipt is unchanged.')); }}>Print receipt</button></>}
  </section>;
}
