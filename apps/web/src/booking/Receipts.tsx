import { useEffect, useRef, useState } from 'react';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { receiptDiscovery, type ReceiptReference } from '../data-access/bookings';
import { TextField } from '../components/m3/Input';
import { ReceiptPanel } from './ReceiptPanel';
import { failureMessage } from './failures';
import './counter.css';
export default function Receipts({ controller }: { controller: ScopeController }) {
  const [api] = useState(() => scopedApi(controller));
  const [docket, setDocket] = useState(''), [rows, setRows] = useState<ReceiptReference[]>([]), [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string>(), [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'), [message, setMessage] = useState('');
  const pending = useRef<AbortController>();
  async function load(next?: string) {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setPhase('loading'); setMessage('Loading receipt references…'); setSelected(undefined);
    if (!next) setRows([]);
    try {
      const result = await receiptDiscovery(api)(docket, next, abort.signal);
      if (abort.signal.aborted || !controller.runtime.isCurrent(api.scope)) return;
      setRows(prior => [...new Map([...(next ? prior : []), ...result.items].map(row => [row.booking_id, row])).values()]);
      setCursor(result.page.next_cursor); setPhase('ready'); setMessage(result.items.length ? 'Choose a booking to retrieve its issued receipt.' : 'No bookings found in this workspace.');
    } catch (error) { if (abort.signal.aborted || !controller.runtime.isCurrent(api.scope)) return; setPhase('error'); setMessage(failureMessage(error)); }
  }
  useEffect(() => {
    const abort = new AbortController(); pending.current = abort;
    void receiptDiscovery(api)('', undefined, abort.signal).then(result => {
      if (abort.signal.aborted || !controller.runtime.isCurrent(api.scope)) return;
      setRows([...new Map(result.items.map(row => [row.booking_id, row])).values()]); setCursor(result.page.next_cursor); setPhase('ready');
      setMessage(result.items.length ? 'Choose a booking to retrieve its issued receipt.' : 'No bookings found in this workspace.');
    }).catch(error => { if (!abort.signal.aborted && controller.runtime.isCurrent(api.scope)) { setPhase('error'); setMessage(failureMessage(error)); } });
    const unsubscribe = controller.runtime.onInvalidate(() => { pending.current?.abort(); setRows([]); setSelected(undefined); setDocket(''); setCursor(null); setMessage(''); });
    return () => { pending.current?.abort(); unsubscribe(); };
  }, [api, controller]);
  return <div className="counter-flow"><h1 className="t-headline-sm">Receipts</h1>
    <section className="card counter-section"><form onSubmit={event => { event.preventDefault(); void load(); }}>
      <TextField label="Find receipt by docket" value={docket} onChange={v => { pending.current?.abort(); setDocket(v); setRows([]); setSelected(undefined); setCursor(null); setPhase('ready'); setMessage('Search to load matching bookings.'); }} helper="Leave blank for recent authorized bookings." />
      <button className="btn btn-outlined" disabled={phase === 'loading'} aria-busy={phase === 'loading'}>{phase === 'error' ? 'Retry receipts' : 'Find receipts'}</button>
    </form><p role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
    <ul className="counter-results">{rows.map(row => <li key={row.booking_id}><button className="btn btn-text" onClick={() => setSelected(row.booking_id)}>{row.docket} · {row.confirmed_at}</button></li>)}</ul>
    {cursor && <button className="btn btn-outlined" disabled={phase === 'loading'} onClick={() => { void load(cursor); }}>More bookings</button>}
    </section>
    {selected && <ReceiptPanel key={selected} api={api} controller={controller} bookingId={selected} />}
  </div>;
}
