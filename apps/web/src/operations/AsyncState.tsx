import React from 'react';
import { Msym } from '../components/m3/Icon';

export function Loading({label='Loading current server data…'}:{label?:string}){return <section className="card ops-state ops-loading" role="status" aria-live="polite"><span className="workspace-state-icon"><Msym name="progress_activity"/></span><p>{label}</p><div className="workspace-skeleton" aria-hidden="true"><span/><span/><span/></div></section>;}
export function Failure({retry,label='Current server data is unavailable.',disabled=false}:{retry:()=>void;label?:string;disabled?:boolean}){return <section className="card ops-state ops-failure"><span className="workspace-state-icon"><Msym name="sync_problem"/></span><h2 className="t-title-lg">Unable to load this view</h2><p role="alert">{label} Retry to load the current records.</p><button type="button" className="btn btn-outlined" onClick={retry} disabled={disabled}><Msym name="refresh"/>Retry</button></section>;}
export function Empty({icon='inbox',title,body,action}:{icon?:string;title:string;body:string;action?:React.ReactNode}){return <section className="card ops-state ops-empty" role="status"><span className="workspace-state-icon"><Msym name={icon}/></span><div><h2 className="t-title-lg">{title}</h2><p>{body}</p></div>{action&&<div className="workspace-state-actions">{action}</div>}</section>;}
/**
 * `money` is the sentence that says what happened to the customer's money. Every
 * screen that can take or record money passes it; the design system makes it
 * mandatory there, because an operator holding a customer's cash needs that answer
 * before anything else on the screen.
 */
export function CommandNotice({phase,code,retry,money}:{phase:string;code?:string;retry?:()=>void;money?:React.ReactNode}){
 if(phase==='pending')return <p className="workspace-command-state workspace-command-pending" role="status" aria-live="polite"><Msym name="progress_activity"/>Saving…</p>;
 if(phase==='confirmed')return <p className="workspace-command-state workspace-command-confirmed" role="status" aria-live="polite"><Msym name="check_circle"/>Saved.</p>;
 /*
  * The hardest state in the product, and the one reported from a shop.
  *
  * It used to read "The outcome is uncertain. We could not confirm whether this was
  * saved. Retry the same request to check before starting a new one." — "outcome",
  * "request" and "retry" are system words. A counter clerk does not know what a
  * request is, and that sentence never answers the only question they have.
  *
  * Three things have to be said, in this order: what state the record is actually in,
  * what it means for the money, and that pressing the button is safe. The last one is
  * why operators abandoned this screen — they were afraid of creating a duplicate, and
  * the write is already keyed so it cannot.
  */
 if(phase==='uncertain')return <div className="ops-alert ops-uncertain">
  <p role="alert"><strong>We could not tell whether this saved.</strong> The connection dropped while saving, so it may or may not have gone through.</p>
  {money&&<p className="ops-uncertain-money">{money}</p>}
  {retry&&<button className="btn btn-filled" onClick={retry}>Check if it saved</button>}
  <p className="ops-uncertain-safe">Checking is safe. It will not save the same thing twice.</p>
 </div>;
 if(phase==='error'&&code==='MONEY_RECEIPTS_DISABLED')return <p role="alert" className="ops-alert">New receipt writes are disabled. Ask the administrator to complete rollout. Saved evidence and exact completed-request replay remain available.</p>;
 if(phase==='error'&&code){
  const disabled:Record<string,string>={CASHBOOK_DISABLED:'New expenses and cash movements',CUSTOMER_ACCOUNTS_DISABLED:'Customer account changes',SETTINGS_DISABLED:'Settings changes',SHIPMENT_COST_DISABLED:'Shipment cost changes',RECONCILIATION_DISABLED:'Reconciliation changes',FINANCIAL_WORKFLOW_DISABLED:'Financial changes'};
  if(Object.hasOwn(disabled,code))return <p role="alert" className="ops-alert">{disabled[code]} are not enabled for this workspace. Complete the workspace setup before enabling this feature.</p>;
 }
 if(phase==='error')return <p role="alert" className="ops-alert"><strong>Not saved.</strong> The server did not accept this change. Reload to see the current state.{code?<span className="ops-alert-code"> {code}</span>:null}</p>;
 return null;
}

/**
 * Refresh, with proof that it did something.
 *
 * Eight screens each grew their own refresh control — different labels ("Refresh cases",
 * "Refresh feed"), different variants, different places on the page — and not one of them
 * confirmed anything. Pressing refresh on a branch whose data had not changed redrew exactly
 * the same screen, so the honest reading of the press was "this button is broken". A crawl of
 * the console reported four of them as dead for precisely that reason.
 *
 * So the press now always says what happened: the icon turns while the server is being asked,
 * and a line appears afterwards saying when the data on screen was last fetched. That line
 * ages, which is the part that earns its keep — an operator looking at a number on a counter
 * wants to know whether it is from this minute or from this morning.
 */
export function DataRefresh({resource,disabled=false,label='Refresh',buttonRef}:{
  resource:{phase:string;reload:()=>void};disabled?:boolean;label?:string;
  /** Dialogs on these screens return focus here when their own trigger has gone. */
  buttonRef?:React.MutableRefObject<HTMLButtonElement|null>;
}){
  const busy=resource.phase==='loading'||resource.phase==='more';
  const [asked,setAsked]=React.useState(false);
  const [stamp,setStamp]=React.useState<number|null>(null);
  const [,tick]=React.useState(0);
  const wasBusy=React.useRef(busy);
  React.useEffect(()=>{
    // Stamp on the falling edge of busy, and only after a press: a first page load is not a
    // refresh, and saying "updated just now" about it would be telling the operator nothing.
    if(wasBusy.current&&!busy&&asked){setStamp(Date.now());setAsked(false);}
    wasBusy.current=busy;
  },[busy,asked]);
  React.useEffect(()=>{
    // Some screens refresh by re-keying their children rather than by reloading a resource the
    // button can watch, and a fast local fetch can also finish between two renders. Either way
    // the falling edge never arrives, and without this the press would go back to being silent.
    if(!asked||busy)return;
    const settle=window.setTimeout(()=>{setStamp(Date.now());setAsked(false);},400);
    return()=>window.clearTimeout(settle);
  },[asked,busy]);
  React.useEffect(()=>{
    if(stamp===null)return;
    const age=window.setInterval(()=>tick(value=>value+1),30_000);
    return()=>window.clearInterval(age);
  },[stamp]);
  return <span className="data-refresh">
    <button type="button" ref={buttonRef} className="btn btn-outlined btn-sm" disabled={disabled||busy} aria-busy={busy||undefined}
      onClick={()=>{setAsked(true);resource.reload();}}>
      <Msym name="refresh" className={busy?'is-turning':undefined}/>{label}
    </button>
    {/* Silent until the operator has actually asked: a first page load is not a refresh,
        and an extra live region on every screen competes with the one that matters. */}
    {(stamp!==null||(asked&&busy))&&<span className="data-refresh-stamp" role="status" aria-live="polite">
      {stamp!==null&&!busy?'Updated '+since(stamp):'Checking…'}
    </span>}
  </span>;
}

/** Plain words for an age, because "14:32" means nothing without today's clock in your head. */
function since(stamp:number){
  const minutes=Math.floor((Date.now()-stamp)/60_000);
  if(minutes<1)return 'just now';
  if(minutes===1)return '1 minute ago';
  if(minutes<60)return minutes+' minutes ago';
  const hours=Math.floor(minutes/60);
  return hours===1?'1 hour ago':hours+' hours ago';
}
