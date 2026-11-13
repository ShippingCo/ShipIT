import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {Msym} from '../components/m3/Icon';

/**
 * What the counter sees the moment a booking is saved.
 *
 * This screen used to be seven stacked sentences and nine controls in one wrapping
 * row: the docket number, the total, the outstanding amount, the billing account,
 * an instruction about payment and a status line all competed as body prose, and
 * the thing the operator does next — take the money — was the fourth button along.
 *
 * The rebuild answers three questions in the order a counter actually asks them:
 *
 *  1. Did it save?  One mark, one line, nothing else above the fold.
 *  2. What do I write on the parcel?  The docket, set large, with a copy button —
 *     this is the single value that gets transcribed by hand onto tape.
 *  3. What do I owe / what do I collect?  Two figures on one rule, the one that
 *     needs collecting carried in colour.
 *
 * Everything that is not one of those three is an action, and actions are ranked:
 * one filled button, then outlined, then links. No sentence explains a button that
 * states its own verb.
 */

export interface BookingSavedFigures {
  /** Every docket in the booking. One is the common case; a multi-parcel booking lists all. */
  dockets:readonly string[];
  /** Formatted money, already localised by the receipt helper. */
  total:string;
  outstanding:string;
  /** True when nothing is left to collect, so the figure is reported rather than chased. */
  settled:boolean;
  /** 'to_pay' means the destination collects; nothing is taken at this counter. */
  toPay:boolean;
  /** Set when the booking bills a credit account instead of the person at the counter. */
  billedTo?:{name:string;due:string};
}

/** Copy to clipboard, and say so — a silent copy button is indistinguishable from a dead one. */
function DocketValue({docket}:{docket:string}) {
  const [copied,setCopied]=useState(false);
  React.useEffect(()=>{
    if(!copied)return;
    const clear=window.setTimeout(()=>setCopied(false),2200);
    return()=>window.clearTimeout(clear);
  },[copied]);
  const copy=()=>{
    // Clipboard access is refused outright in some embedded browsers and over plain
    // http. The docket is on screen either way, so a refusal must not look like a crash.
    navigator.clipboard?.writeText(docket).then(()=>setCopied(true),()=>setCopied(false));
  };
  return <div className="saved-docket-row">
    <span className="saved-docket-value">{docket}</span>
    <button type="button" className="btn btn-outlined btn-sm saved-docket-copy" onClick={copy}>
      <Msym name={copied?'check':'content_copy'}/>{copied?'Copied':'Copy'}
    </button>
  </div>;
}

export function BookingSaved({cancelled,figures,message,printState,printMessage,onPrint,onRecordMoney,onStartAnother,onCancelBooking,paymentsHref,busy,canCancel,headingRef}:{
  cancelled:boolean;
  figures:BookingSavedFigures;
  /** The workflow's own status line. Shown once, under the figures, never as a headline. */
  message:string;
  printState:'idle'|'loading'|'error';
  printMessage:string;
  onPrint:()=>void;
  onRecordMoney:()=>void;
  onStartAnother:()=>void;
  onCancelBooking?:()=>void;
  paymentsHref:string;
  busy:boolean;
  canCancel:boolean;
  /** The page's own heading lives here, so focus after a save lands on the verdict. */
  headingRef?:React.Ref<HTMLHeadingElement>;
}) {
  const {dockets,total,outstanding,settled,toPay,billedTo}=figures;
  // Collecting is the next physical act unless the destination collects or the booking
  // is on account. When it is not, printing is: the docket has to go on the parcel.
  const collect=!cancelled&&!toPay&&!settled;
  const printLabel=printState==='error'?'Retry printing':printState==='loading'?'Loading receipt…':'Print booking receipt';
  return <section className={'booking-saved'+(cancelled?' booking-saved-void':'')} aria-label={cancelled?'Booking cancelled':'Booking saved'}>
    <div className="saved-mark" aria-hidden="true"><Msym name={cancelled?'cancel':'check'}/></div>
    <h1 ref={headingRef} tabIndex={-1} className="saved-title">{cancelled?'Booking cancelled':'Booking saved'}</h1>
    <p className="saved-lede">{cancelled
      ?'No parcel in this booking can be dispatched.'
      :dockets.length===1?'Write the docket number on the parcel.':`${dockets.length} parcels. Write each docket on its parcel.`}</p>

    <div className="saved-card">
      <div className="saved-dockets">
        <p className="saved-field-label">{dockets.length===1?'Docket number':'Docket numbers'}</p>
        {dockets.map(docket=><DocketValue key={docket} docket={docket}/>)}
      </div>
      <dl className="saved-figures">
        <div><dt>Booked total</dt><dd>{total}</dd></div>
        <div className={collect?'saved-figure-due':undefined}>
          <dt>{settled?'Collected':toPay?'Collect at delivery':'To collect now'}</dt>
          <dd>{settled?total:outstanding}</dd>
        </div>
      </dl>
      {billedTo&&<p className="saved-billed"><Msym name="receipt_long"/><span>Billed to <strong>{billedTo.name}</strong> · due {billedTo.due}</span></p>}
      {toPay&&!cancelled&&<p className="saved-billed"><Msym name="info"/><span>To Pay: no collection was recorded.</span></p>}
    </div>

    <div className="saved-actions">
      {collect
        ?<button type="button" className="btn btn-filled btn-lg" onClick={onRecordMoney}><Msym name="payments"/>Record {outstanding} received</button>
        :<button type="button" className="btn btn-filled btn-lg" disabled={printState==='loading'} onClick={onPrint}>
           <Msym name="print"/>{printLabel}</button>}
      {collect&&<button type="button" className="btn btn-outlined" disabled={printState==='loading'} onClick={onPrint}>
        <Msym name="print"/>{printLabel}</button>}
      <button type="button" className="btn btn-outlined" disabled={busy} onClick={onStartAnother}><Msym name="add"/>Start another booking</button>
    </div>

    <div className="saved-links">
      {!cancelled&&<Link to={paymentsHref}>Open payments / apply advance</Link>}
      <Link to="/business/receipts">Open Receipts</Link>
      {canCancel&&!cancelled&&onCancelBooking&&
        <button type="button" className="saved-link-danger" disabled={busy} onClick={onCancelBooking}>Cancel saved booking</button>}
    </div>

    {/* The workflow's own words, and the printer's, kept together and kept last: they
        report on something that already happened and must not sit above the docket. */}
    {(message||printMessage)&&<div className="saved-notes">
      {message&&<p role="status">{message}</p>}
      {printMessage&&<p role={printState==='error'?'alert':'status'}>{printMessage}</p>}
    </div>}
  </section>;
}
