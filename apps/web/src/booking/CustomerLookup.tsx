import { useEffect, useRef, useState } from 'react';
import type { CustomerListDto } from '@shippingco/shared';
import { TextField, SelectField } from '../components/m3/Input';
import type { BookingWorkflow } from './workflow';
import { failureMessage } from './failures';
export function CustomerLookup({ workflow, disabled }: { workflow: BookingWorkflow; disabled: boolean }) {
  const [searchBy, setSearchBy] = useState<'name' | 'phone'>('name'), [q, setQ] = useState(''), [result, setResult] = useState<CustomerListDto>(),
    [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle'), [message, setMessage] = useState('');
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);
  const reset = () => { pending.current?.abort(); setResult(undefined); setPhase('idle'); setMessage(''); };
  async function search(cursor?: string) {
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setPhase('loading'); setResult(undefined); setMessage('Searching this franchise…');
    try {
      const next = await workflow.customerApi.search(searchBy, q, abort.signal, cursor);
      if (abort.signal.aborted || pending.current !== abort || workflow.api.scope.signal.aborted) return;
      setResult(next); setPhase('ready'); setMessage(next.items.length ? 'Select the customer explicitly. Existing edits will be preserved.' : 'No matching customers in this franchise. Enter a new customer below.');
    } catch (error) { if (abort.signal.aborted || workflow.api.scope.signal.aborted) return; setPhase('error'); setMessage(failureMessage(error)); }
  }
  return <section aria-label="Repeat customer lookup">
    <div className="counter-grid"><SelectField label="Search by" value={searchBy} disabled={disabled} onChange={v => { reset(); setSearchBy(v as 'name' | 'phone'); }} options={[{ value: 'name', label: 'Name prefix' }, { value: 'phone', label: 'International phone' }]} />
      <TextField label="Find repeat customer" value={q} disabled={disabled} onChange={v => { reset(); setQ(v); }} helper={searchBy === 'name' ? 'Case-sensitive prefix, at least three letters or digits.' : 'Include + and country code; at least eight digits.'} />
    </div>
    <button type="button" className="btn btn-outlined" disabled={disabled || phase === 'loading' || !q.trim()} aria-busy={phase === 'loading'} onClick={() => { void search(); }}>{phase === 'error' ? 'Retry customer search' : 'Search customers'}</button>
    <p role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>
    <ul className="counter-results">{result?.items.map(c => <li key={c.id}><button type="button" className="btn btn-text" disabled={disabled} onClick={() => workflow.select(c)}>{c.name} · {c.phone_display} · {c.address}</button></li>)}</ul>
    {result?.page.has_more && <button type="button" className="btn btn-text" disabled={disabled || phase === 'loading'} onClick={() => { void search(result.page.next_cursor!); }}>More customers</button>}
  </section>;
}
