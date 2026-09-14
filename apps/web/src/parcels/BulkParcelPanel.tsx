import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { MAX_BULK_PARCELS, type BulkParcelAction, type BulkParcelItem } from '@shippingco/shared';
import { Button } from '../components/m3/Button';
import { Msym } from '../components/m3/Icon';
import type { ParcelBulkController, RefreshFailed } from '../data-access/parcel-bulk-controller';

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
  return <section ref={panel} aria-label="Bulk parcel commands" className="card" style={{padding:16,minWidth:0}}>
    <p ref={summary} role="status" aria-live="polite" aria-atomic="true" className="t-title-md" tabIndex={-1}>
      <Msym name="inventory_2" /> {state.selected.length} selected · {completed} completed · {failed} need attention
      {state.phase==='pending'?' · Processing…':''}
    </p>
    {state.phase==='uncertain'&&<p>Outcome is uncertain. Retry the same request to recover confirmed results.</p>}
    {state.error&&state.phase!=='uncertain'&&<p role="alert">Request needs attention: {state.error.code}. Your selection is retained.</p>}
    <fieldset disabled={locked} style={{border:0,padding:0,minWidth:0}}>
      <legend>Select parcels (up to {MAX_BULK_PARCELS})</legend>
      {candidates.slice(0,MAX_BULK_PARCELS).map(({label,item})=>{
        const result=state.result?.items.find(result=>result.parcel_id===item.parcel_id);
        return <div key={item.parcel_id} style={{marginBlock:8,overflowWrap:'anywhere'}}>
          <label className="check"><input type="checkbox" checked={selected.has(item.parcel_id)}
            disabled={result?.outcome==='succeeded'||state.phase==='confirmed'}
            onChange={event=>controller.select(event.target.checked?[...state.selected,item]:state.selected.filter(value=>value.parcel_id!==item.parcel_id))}/>
            <span className="box"><Msym name="check"/></span><span>{label}</span></label>
          {result&&<p>{result.outcome==='succeeded'?'Completed':result.error.code==='VERSION_CONFLICT'?'Version changed. Refresh before retry.':
            ['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN'].includes(result.error.code)?'Unavailable. Refresh access before retry.':`Needs attention: ${result.error.code}`}</p>}
        </div>;
      })}
    </fieldset>
    {candidates.length>MAX_BULK_PARCELS&&<p>Showing the first {MAX_BULK_PARCELS} parcels. Narrow the selection to process others.</p>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <Button variant="outlined" icon={action==='check_in'?'warehouse':'local_shipping'}
        disabled={locked||state.phase==='confirmed'||!selected.size} onClick={()=>{void controller.submit(action);}}>
        {action==='check_in'?'Check in at hub':'Dispatch'}</Button>
      <Button variant="outlined" disabled={state.phase!=='confirmed'||!state.selected.length}
        onClick={()=>{void controller.retryFailed(refreshFailed);}}>Retry failed</Button>
      <Button variant="outlined" disabled={!['uncertain','error'].includes(state.phase)}
        onClick={()=>{void controller.retryUncertain();}}>Retry same request</Button>
    </div>
  </section>;
}
