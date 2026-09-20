import React from 'react';
import { Msym } from '../components/m3/Icon';

export function Loading({label='Loading current server data…'}:{label?:string}){return <section className="card ops-state" role="status" aria-live="polite"><Msym name="progress_activity"/><p>{label}</p></section>;}
export function Failure({retry,label='Current server data is unavailable.'}:{retry:()=>void;label?:string}){return <section className="card ops-state"><Msym name="sync_problem"/><p role="alert">{label} No local changes were made.</p><button className="btn btn-outlined" onClick={retry}><Msym name="refresh"/>Retry</button></section>;}
export function Empty({icon='inbox',title,body}:{icon?:string;title:string;body:string}){return <section className="card ops-state" role="status"><Msym name={icon}/><h2 className="t-title-lg">{title}</h2><p>{body}</p></section>;}
export function CommandNotice({phase,code,retry}:{phase:string;code?:string;retry?:()=>void}){
 if(phase==='pending')return <p role="status" aria-live="polite">Saving with the server…</p>;
 if(phase==='confirmed')return <p role="status" aria-live="polite">Server update confirmed.</p>;
 if(phase==='uncertain')return <div className="ops-alert"><p role="alert">The outcome is uncertain. Keep this exact request and reconcile it before making a replacement.</p>{retry&&<button className="btn btn-outlined" onClick={retry}>Retry same request</button>}</div>;
 if(phase==='error')return <p role="alert" className="ops-alert">The server rejected the change{code?` (${code})`:''}. Refresh current state before changing a stale command.</p>;
 return null;
}
