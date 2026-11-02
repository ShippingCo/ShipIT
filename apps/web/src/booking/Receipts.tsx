import { useEffect, useRef, useState } from 'react';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { receiptDiscovery, type ReceiptReference } from '../data-access/bookings';
import { SearchField } from '../components/m3/Input';
import { ReceiptPanel } from './ReceiptPanel';
import { failureMessage } from './failures';
import './counter.css';
import {PageHeader,RecordTable} from '../components/workspace/Workspace';
import {Empty} from '../operations/AsyncState';
import {formatKolkata} from '../operations/format';
export default function Receipts({ controller }: { controller: ScopeController }) {
  const [api] = useState(() => scopedApi(controller));
  const [docket, setDocket] = useState(''), [rows, setRows] = useState<ReceiptReference[]>([]), [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<{id:string;reveal:number}>(), [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('loading'), [message, setMessage] = useState('');
  const pending = useRef<AbortController>();
  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  async function load(next?: string,search=docket) {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setPhase('loading'); setMessage('Loading receipt references…'); setSelected(undefined);
    if (!next) setRows([]);
    try {
      const result = await receiptDiscovery(api)(search, next, abort.signal);
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
  return <div className="counter-flow"><PageHeader title="Receipts" eyebrow="Counter" description="Find a booking, retrieve its issued receipt and print only when needed."/>
    <section className="card counter-section" aria-busy={phase==='loading'}><form className="receipt-search" aria-label="Find a receipt" onSubmit={event => { event.preventDefault(); void load(); }}>
      <SearchField id="receipt-docket-search" label="Find receipt by docket" maxLength={32} autoComplete="off" spellCheck={false} value={docket} onChange={v => { pending.current?.abort(); setDocket(v); setRows([]); setSelected(undefined); setCursor(null); setPhase('idle'); setMessage('Search to load matching bookings.'); }} helper="Use the tracking number, or leave blank for recent bookings." />
      <button className="btn btn-outlined" disabled={phase === 'loading'} aria-busy={phase === 'loading'}>{phase === 'error' ? 'Retry receipts' : 'Find receipts'}</button>
    </form><p role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
    {rows.length>0&&<RecordTable label="Receipt bookings" mobile="stack" rows={rows} rowKey={row=>row.booking_id} selectedKey={selected?.id} columns={[
      {key:'docket',label:'Docket',cell:row=><strong className="ops-mono">{row.docket}</strong>},
      {key:'confirmed',label:'Confirmed',cell:row=><time dateTime={row.confirmed_at} title={row.confirmed_at}>{formatKolkata(row.confirmed_at)}</time>},
      {key:'actions',label:'Actions',cell:row=><button type="button" className="btn btn-text" aria-label={`Open receipt for ${row.docket} · ${row.confirmed_at}`} onClick={event=>{receiptTrigger.current=event.currentTarget;setSelected(previous=>({id:row.booking_id,reveal:(previous?.reveal??0)+1}));}}>Open receipt</button>},
    ]}/>}
    {phase==='ready'&&rows.length===0&&<Empty icon="receipt_long" title="No receipts found" body={docket?'Check the docket, or clear the search to see recent bookings in this franchise.':'Issued receipts will appear here after a booking is confirmed in this franchise.'} action={docket?<button type="button" className="btn btn-outlined" onClick={()=>{setDocket('');void load(undefined,'');document.getElementById('receipt-docket-search')?.focus();}}>Clear search</button>:undefined}/>}
    {rows.length>0&&<p className="ops-note">{rows.length} bookings loaded</p>}
    {cursor && <button className="btn btn-outlined" disabled={phase === 'loading'} onClick={() => { void load(cursor); }}>More bookings</button>}
    </section>
    {selected && <ReceiptPanel key={selected.id} api={api} controller={controller} bookingId={selected.id} focusRequest={selected.reveal} onClose={()=>{setSelected(undefined);if(receiptTrigger.current?.isConnected)receiptTrigger.current.focus();}} />}
  </div>;
}
