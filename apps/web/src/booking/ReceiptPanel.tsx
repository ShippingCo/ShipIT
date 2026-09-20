import { useEffect, useRef, useState } from 'react';
import type { ReceiptDto } from '@shippingco/shared';
import { receiptView, printReceipt } from '../utils/receipt';
import { receipts } from '../data-access/receipts';
import type { ScopedApi } from '../data-access/scoped-api';
import type { ScopeController } from '../operator/scope';
import { failureMessage } from './failures';
export function ReceiptPanel({ api, controller, bookingId, paymentId }: { api: ScopedApi; controller: ScopeController; bookingId: string; paymentId?: string }) {
  const [dto, setDto] = useState<ReceiptDto>(), [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle'), [message, setMessage] = useState('');
  const pending = useRef<AbortController>();
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
    <h2 className="t-title-lg">{paymentId ? 'Collection acknowledgement' : 'Booking receipt'}</h2>
    <p role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message || 'Retrieve the immutable issued snapshot when you need it.'}</p>
    <button type="button" className="btn btn-outlined" disabled={phase === 'loading'} aria-busy={phase === 'loading'} onClick={() => { void load(); }}>{phase === 'error' ? 'Retry receipt' : dto ? 'Reload receipt' : 'Load receipt'}</button>
    {view && <><p>{view.number} · {view.customer}</p><p className="t-title-lg">{view.totalLabel}: {view.total}</p><p>{view.issuer}</p>
      <button type="button" className="btn btn-filled" onClick={() => { try { printReceipt(dto!); } catch { setMessage('Print dialog unavailable. The saved receipt is unchanged.'); } }}>Print receipt</button></>}
  </section>;
}
