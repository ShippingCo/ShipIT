import React from 'react';
import { Msym } from '../components/m3/Icon';

export function Loading({label='Loading current server data…'}:{label?:string}){return <section className="card ops-state ops-loading" role="status" aria-live="polite"><span className="workspace-state-icon"><Msym name="progress_activity"/></span><p>{label}</p><div className="workspace-skeleton" aria-hidden="true"><span/><span/><span/></div></section>;}
export function Failure({retry,label='Current server data is unavailable.'}:{retry:()=>void;label?:string}){return <section className="card ops-state ops-failure"><span className="workspace-state-icon"><Msym name="sync_problem"/></span><h2 className="t-title-lg">Unable to load this view</h2><p role="alert">{label} Retry to load the current records.</p><button type="button" className="btn btn-outlined" onClick={retry}><Msym name="refresh"/>Retry</button></section>;}
export function Empty({icon='inbox',title,body,action}:{icon?:string;title:string;body:string;action?:React.ReactNode}){return <section className="card ops-state ops-empty" role="status"><span className="workspace-state-icon"><Msym name={icon}/></span><div><h2 className="t-title-lg">{title}</h2><p>{body}</p></div>{action&&<div className="workspace-state-actions">{action}</div>}</section>;}
export function CommandNotice({phase,code,retry}:{phase:string;code?:string;retry?:()=>void}){
 if(phase==='pending')return <p className="workspace-command-state workspace-command-pending" role="status" aria-live="polite"><Msym name="progress_activity"/>Saving with the server…</p>;
 if(phase==='confirmed')return <p className="workspace-command-state workspace-command-confirmed" role="status" aria-live="polite"><Msym name="check_circle"/>Server update confirmed.</p>;
 if(phase==='uncertain')return <div className="ops-alert ops-uncertain"><p role="alert">The outcome is uncertain. Keep this exact request and reconcile it before making a replacement.</p>{retry&&<button className="btn btn-outlined" onClick={retry}>Retry same request</button>}</div>;
 if(phase==='error'&&code==='MONEY_RECEIPTS_DISABLED')return <p role="alert" className="ops-alert">New receipt writes are disabled. Ask the administrator to complete rollout. Saved evidence and exact completed-request replay remain available.</p>;
 if(phase==='error')return <p role="alert" className="ops-alert">The server rejected the change{code?` (${code})`:''}. Refresh current state before changing a stale command.</p>;
 return null;
}
