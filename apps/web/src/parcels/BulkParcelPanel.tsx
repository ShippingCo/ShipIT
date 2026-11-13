import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { MAX_BULK_PARCELS, type BulkParcelAction, type BulkParcelItem } from '@shippingco/shared';
import { Button } from '../components/m3/Button';
import { Msym } from '../components/m3/Icon';
import type { ParcelBulkController, RefreshFailed } from '../data-access/parcel-bulk-controller';

/**
 * What the server said about one parcel, in the operator's terms.
 *
 * The codes were being printed raw — "Needs attention: VERSION_CONFLICT" — which
 * tells a counter clerk nothing and, worse, does not say whether the parcel moved.
 * Each row here answers that first.
 */
function outcomeLine(code: string): string {
  if (code === 'VERSION_CONFLICT') return 'Someone else changed this parcel. Reload and try it again.';
  if (code === 'RESOURCE_NOT_FOUND') return 'This parcel is no longer here.';
  if (code === 'ACTION_FORBIDDEN') return 'You cannot do this to this parcel.';
  if (code === 'VALIDATION_FAILED') return 'This parcel is not in the right state for this.';
  return 'Not done. Nothing about this parcel changed.';
}

/** Reusable production control; mounted by the operational screen owner (#34). */
export function BulkParcelPanel({ controller, action, candidates, refreshFailed }: {
  controller: ParcelBulkController; action: BulkParcelAction;
  candidates: readonly { label:string; item:BulkParcelItem }[]; refreshFailed:RefreshFailed;
}) {
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot), selected=new Set(state.selected.map(item=>item.parcel_id));
  const panel=useRef<HTMLElement>(null),summary=useRef<HTMLParagraphElement>(null),previous=useRef(state.phase);
  useEffect(()=>{
    if(previous.current==='pending'&&['confirmed','uncertain','error'].includes(state.phase)&&
      (document.activeElement===document.body||panel.current?.contains(document.activeElement)))summary.current?.focus();
    previous.current=state.phase;
  },[state.phase]);
  const locked=state.phase==='pending'||state.phase==='uncertain'||state.phase==='error';
  const completed=state.result?.summary.succeeded??0, failed=state.result?.summary.failed??0;
  const verb=action==='check_in'?'Check in':'Send out';
  const count=state.selected.length;
  return <section ref={panel} aria-label="Bulk parcel commands" className="card bulk-run">
    <p ref={summary} role="status" aria-live="polite" aria-atomic="true" className="t-title-md" tabIndex={-1}>
      <Msym name="inventory_2" />{' '}
      {state.result||state.phase==='pending'
        ? <>{count} selected · {completed} completed · {failed} need attention{state.phase==='pending'?' · Processing…':''}</>
        : <>{count} {count===1?'parcel':'parcels'} ready to {action==='check_in'?'check in':'send out'}</>}
    </p>
    {/* The catalogue's uncertain state: say the records may or may not have gone
        through, and remove the fear of doing it twice, which is why an operator
        walks away from this screen. */}
    {state.phase==='uncertain'&&<div className="ops-alert ops-uncertain">
      <p role="alert"><strong>We could not tell whether this saved.</strong> The connection dropped, so these parcels may or may not have been updated.</p>
      <p className="ops-uncertain-safe">Checking is safe. It will not update the same parcel twice.</p>
    </div>}
    {state.error&&state.phase!=='uncertain'&&<p role="alert" className="ops-alert">
      <strong>Not saved.</strong> Nothing about these parcels changed, and your selection is still here.
      <span className="ops-alert-code"> {state.error.code}</span></p>}

    <fieldset disabled={locked} className="bulk-run-list">
      <legend>Parcels in this update{candidates.length>MAX_BULK_PARCELS?` (first ${MAX_BULK_PARCELS})`:''}</legend>
      {candidates.slice(0,MAX_BULK_PARCELS).map(({label,item})=>{
        const result=state.result?.items.find(result=>result.parcel_id===item.parcel_id);
        const done=result?.outcome==='succeeded';
        return <div key={item.parcel_id} className={'bulk-run-row'+(done?' is-done':'')+(result&&!done?' is-failed':'')}>
          <label className="check"><input type="checkbox" checked={selected.has(item.parcel_id)}
            disabled={done||state.phase==='confirmed'}
            onChange={event=>controller.select(event.target.checked?[...state.selected,item]:state.selected.filter(value=>value.parcel_id!==item.parcel_id))}/>
            <span className="box"><Msym name="check"/></span><span>{label.split(' · ')[0]}</span></label>
          {result&&<p className="bulk-run-outcome">{done?'Done':outcomeLine(result.error.code)}</p>}
        </div>;
      })}
    </fieldset>
    {candidates.length>MAX_BULK_PARCELS&&<p className="ops-note">Only {MAX_BULK_PARCELS} parcels can go in one update. Do the rest straight after.</p>}

    {/* One filled button, naming the action and the number it applies to, so the
        label is the confirmation. The recoveries beside it are alternatives, not
        peers, and only one of them is ever live at a time. */}
    <div className="bulk-run-actions">
      <Button variant="filled" icon={action==='check_in'?'warehouse':'local_shipping'}
        disabled={locked||state.phase==='confirmed'||!count} onClick={()=>{void controller.submit(action);}}>
        {state.phase==='pending'?'Saving…':`${verb} ${count} ${count===1?'parcel':'parcels'}`}</Button>
      <Button variant="outlined" disabled={state.phase!=='confirmed'||!state.selected.length}
        onClick={()=>{void controller.retryFailed(refreshFailed);}}>Try the ones that failed</Button>
      <Button variant="outlined" disabled={!['uncertain','error'].includes(state.phase)}
        onClick={()=>{void controller.retryUncertain();}}>Check if it saved</Button>
    </div>
  </section>;
}
