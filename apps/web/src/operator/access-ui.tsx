import React from 'react';
import {Msym} from '../components/m3/Icon';
import './access.css';

/**
 * The shell every pre-sign-in screen sits in.
 *
 * Before today these screens were a bare block of text floating on the page: no container, no
 * sense of how many steps were left, and controls at 36px with 13px labels — under this
 * product's own floors of 44px and 15px. They are also the first thing a new shop ever sees,
 * so they carry the weight of whether the software looks built or improvised.
 *
 * One card, one rail of steps, one column. Nothing here invents a colour: the surface is white
 * with a single hairline, the way every other surface in this app is.
 */
export function AccessCard({title,lead,steps,current,children,aside}:{
  title:string;lead?:string;steps:readonly string[];current:number;
  children:React.ReactNode;aside?:React.ReactNode;
}) {
  return <section className="access-card">
    <StepRail steps={steps} current={current}/>
    <div className="access-card-head">
      <h1 id="signin-title" tabIndex={-1}>{title}</h1>
      {lead&&<p className="access-lead">{lead}</p>}
    </div>
    {children}
    {aside}
  </section>;
}

/**
 * How many steps there are and which one this is.
 *
 * A code sent to an inbox is a wait with no visible end; naming the steps turns it into a
 * place in a short queue. Steps already done are marked, not merely dimmed, so the rail reads
 * at a glance for someone who does not read the labels fluently.
 */
export function StepRail({steps,current}:{steps:readonly string[];current:number}) {
  return <ol className="access-rail" aria-label="Steps">
    {steps.map((step,index)=>{
      const done=index<current,now=index===current;
      return <li key={step} className={'access-rail-step'+(done?' is-done':'')+(now?' is-now':'')}
        aria-current={now?'step':undefined}>
        <span className="access-rail-mark" aria-hidden="true">
          {done?<Msym name="check"/>:index+1}
        </span>
        <span className="access-rail-label">{step}</span>
      </li>;
    })}
  </ol>;
}

/** A field row: the label, the control, and the one line that explains a refusal. */
export function Field({id,label,hint,error,children}:{
  id:string;label:string;hint?:React.ReactNode;error?:string;children:React.ReactNode;
}) {
  return <div className="access-field">
    <label className="access-label" htmlFor={id}>{label}</label>
    {children}
    {hint&&<p className="access-hint">{hint}</p>}
    {error&&<p id={id+'-error'} role="alert" className="access-error">
      <Msym name="error" aria-hidden="true"/><span>{error}</span>
    </p>}
  </div>;
}
