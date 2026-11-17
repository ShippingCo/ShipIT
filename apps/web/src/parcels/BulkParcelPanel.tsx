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

/**
 * The run sheet for one check-in or send-out.
 *
 * It has exactly one obvious next step in every state, because the operator using it
 * has parcels in their hands and is not reading:
 *
 *  - ready:      one filled button that names the action and the count;
 *  - saving:     the same button, disabled, saying so;
 *  - all done:   a confirmation and, when the sheet sits in a dialog, "Done";
 *  - some done:  each failed parcel says why, and the one button retries just those;
 *  - unsure:     the connection dropped, and the one button asks the server what
 *                happened, with the reassurance that asking cannot do it twice;
 *  - not saved:  nothing changed, and the one button sends the same request again.
 *
 * The recoveries used to sit beside the main button as three equal buttons, two of
 * them always disabled, which made a dropped connection look like a broken screen.
 */
export function BulkParcelPanel({ controller, action, candidates, refreshFailed, place, onDone }: {
  controller: ParcelBulkController; action: BulkParcelAction;
  candidates: readonly { label:string; item:BulkParcelItem }[]; refreshFailed:RefreshFailed;
  /** Where the parcels are going, for the confirmation line. */
  place?: string;
  /** Closes the surrounding sheet once everything is done. */
  onDone?: () => void;
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
  const checkIn=action==='check_in';
  const verb=checkIn?'Check in':'Send out', past=checkIn?'checked in':'sent out';
  const count=state.selected.length;
  const parcels=(n:number)=>n+' '+(n===1?'parcel':'parcels');
  const allDone=state.phase==='confirmed'&&failed===0&&completed>0;
  const someFailed=state.phase==='confirmed'&&failed>0;

  return <section ref={panel} aria-label="Bulk parcel commands" className={'bulk-run'+(allDone?' is-done':'')}>
    <p ref={summary} role="status" aria-live="polite" aria-atomic="true" className={'bulk-run-status'+(allDone?' is-quiet':'')} tabIndex={-1}>
      <Msym name={allDone?'check_circle':someFailed?'error':'inventory_2'} />
      <span>{state.result||state.phase==='pending'
        ? <>{state.phase==='pending'&&!state.result
            ? <>{verb==='Check in'?'Checking in':'Sending out'} {parcels(count)} · Processing…</>
            : <>{completed} {past}{failed>0?<> · {failed} need attention</>:null}{state.phase==='pending'?' · Processing…':''}</>}</>
        : <>{parcels(count)} ready to {checkIn?'check in':'send out'}</>}</span>
    </p>

    {/* All done: say it plainly, with where, and get out of the way. */}
    {allDone&&<div className="bulk-run-done">
      <span className="bulk-run-done-ico" aria-hidden="true"><Msym name="check"/></span>
      <div>
        <p className="bulk-run-done-title">{parcels(completed)} {past}{place&&checkIn?<> at <b>{place}</b></>:null}</p>
        <p className="bulk-run-done-body">The list behind this window is already up to date.</p>
      </div>
    </div>}

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
      <div className="bulk-run-rows">
        {candidates.slice(0,MAX_BULK_PARCELS).map(({label,item})=>{
          const result=state.result?.items.find(result=>result.parcel_id===item.parcel_id);
          const done=result?.outcome==='succeeded';
          return <div key={item.parcel_id} className={'bulk-run-row'+(done?' is-done':'')+(result&&!done?' is-failed':'')}>
            {/* A finished parcel is no longer a choice, so it loses its checkbox and
                shows a tick instead of an empty box that reads as "not done". */}
            {done
              ? <span className="bulk-run-finished"><span className="bulk-run-tick" aria-hidden="true"><Msym name="check"/></span><span className="bulk-run-docket">{label.split(' · ')[0]}</span></span>
              : <label className="check"><input type="checkbox" checked={selected.has(item.parcel_id)}
                disabled={state.phase==='confirmed'}
                onChange={event=>controller.select(event.target.checked?[...state.selected,item]:state.selected.filter(value=>value.parcel_id!==item.parcel_id))}/>
                <span className="box"><Msym name="check"/></span><span className="bulk-run-docket">{label.split(' · ')[0]}</span></label>}
            {result&&<p className="bulk-run-outcome">{done?'Done':outcomeLine(result.error.code)}</p>}
          </div>;
        })}
      </div>
    </fieldset>
    {candidates.length>MAX_BULK_PARCELS&&<p className="ops-note">Only {MAX_BULK_PARCELS} parcels can go in one update. Do the rest straight after.</p>}

    {/* One filled button for whatever the next step is; nothing beside it that cannot
        be pressed right now. */}
    <div className="bulk-run-actions">
      {allDone
        ? onDone&&<Button variant="filled" icon="check" onClick={onDone}>Done</Button>
        : someFailed
          ? <Button variant="filled" icon="refresh" disabled={!state.selected.length}
              onClick={()=>{void controller.retryFailed(refreshFailed);}}>Try the ones that failed</Button>
          : state.phase==='uncertain'
            ? <Button variant="filled" icon="sync_problem" onClick={()=>{void controller.retryUncertain();}}>Check if it saved</Button>
            : state.phase==='error'
              ? <Button variant="filled" icon="refresh" onClick={()=>{void controller.retryUncertain();}}>Try again</Button>
              : <Button variant="filled" icon={checkIn?'warehouse':'local_shipping'}
                  disabled={locked||!count} onClick={()=>{void controller.submit(action);}}>
                  {state.phase==='pending'?'Saving…':`${verb} ${parcels(count)}`}</Button>}
      {someFailed&&onDone&&<Button variant="text" onClick={onDone}>Leave them for now</Button>}
    </div>
  </section>;
}
