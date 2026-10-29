import {RecordTable,SectionHeader} from '../components/workspace/Workspace';
import {useEffect,useMemo,useState} from 'react';
import {ReceiptPanel} from '../booking/ReceiptPanel';
import type {ScopeController} from '../operator/scope';
import {Link} from 'react-router-dom';
import type {AccountStatement,CustomerAccountDto} from '@shippingco/shared';
import type {ScopedApi} from '../data-access/scoped-api';
import {accountStatements} from '../data-access/account-statements';
import {useCommand,usePagedResource} from './hooks';
import {TextField} from '../components/m3/Input';
import {CommandNotice,Empty,Failure,Loading} from './AsyncState';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {formatKolkata} from './format';
const money=(v:string)=>{const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'−':'')+'₹'+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0');};
export function AccountStatements({api,account,admin,canExport,controller,busyChanged}:{api:ScopedApi;controller?:ScopeController;canExport?:boolean;account:CustomerAccountDto;admin:boolean;busyChanged:(busy:boolean)=>void}){
 const source=useMemo(()=>accountStatements(api),[api]),[from,setFrom]=useState(''),[to,setTo]=useState(''),[document,setDocument]=useState<AccountStatement|null>(null),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState<string|null>(null);
 const preview=useCommand(source.executePreview),issue=useCommand(source.executeIssue),capture=useCommand(source.executeCapture);
 const locked=[preview,issue,capture].some(c=>c.phase==='pending'||c.phase==='uncertain');
 useEffect(()=>{busyChanged(locked);return()=>busyChanged(false);},[busyChanged,locked]);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>setNotice('Resolve the retained command before leaving.')):undefined,[locked,api.scope]);
 const history=usePagedResource(account.id,(cursor,s)=>source.history(account.id,cursor??undefined,s).then(p=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}})));
 const show=(s:AccountStatement|null)=>{if(s){setDocument(s);setNotice(s.id?'Statement issued. Original charges and debt are unchanged.':'Preview ready. Check every source before issue.');history.reload();}};
 const download=async(id:string)=>{try{const value=await source.download(id);if(api.scope.signal.aborted)return;const url=URL.createObjectURL(new Blob([value.csv],{type:'text/csv;charset=utf-8'})),a=window.document.createElement('a');a.href=url;a.download='account-statement-'+value.statement.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Private CSV ready. Capture expires after 24 hours.');}catch{setNotice('Download failed. Retry the same capture while it remains valid.');}};
 return <section className="card ops-card"><SectionHeader title={"Monthly statements"} description={"Statements group existing shipment debt. They are not tax invoices. Later payments and corrections appear in a linked revision; issued evidence stays unchanged."}/>
 <form onSubmit={e=>{e.preventDefault();issue.reset();void preview.run(source.preview({account_id:account.id,from_day:from,to_day:to})).then(show).catch(()=>{});}}><fieldset disabled={locked}><legend>Statement period · Asia/Kolkata</legend><div className="ops-grid"><TextField label="Period start" type="date" value={from} onChange={v=>{setFrom(v);setDocument(null);}} required/><TextField label="Period end" type="date" value={to} onChange={v=>{setTo(v);setDocument(null);}} required/></div><button className="btn btn-outlined">Preview statement</button></fieldset></form>
 <CommandNotice phase={preview.phase} code={preview.error?.code} retry={preview.canRetry?()=>{void preview.retry().then(show).catch(()=>{});}:undefined}/>
 <p role="status" aria-live="polite">{notice}</p>
 {document&&<><h3>{document.id?'Issued statement':'Preview'} · revision {document.version}</h3><p>Period {document.from_day}–{document.to_day} · activity captured through {formatKolkata(document.as_of)}</p><p>Statement ID: {document.id??'Not issued'} · Previous: {document.previous_statement_id??'None'}</p><p>Opening {money(document.totals.opening)} + charges {money(document.totals.charges)} − credits {money(document.totals.credits)} − payments {money(document.totals.payments)} + refunds {money(document.totals.refunds)} = closing <strong>{money(document.totals.closing)}</strong></p><p>Debt {money(document.totals.outstanding)} · Refundable credit {money(document.totals.refundable_credit)} · Unallocated customer advance {money(document.unallocated_advance)} (separate from debt)</p>
 <details><summary>Advance and return evidence</summary><RecordTable label="Statement advance and return evidence" rows={document.advance_sources} rowKey={a=>a.receipt_id} columns={[
 {key:'receipt',label:'Receipt',cell:a=><span className="finance-record-ref">Receipt {a.receipt_id}<small>Revision {a.version}</small></span>},
 {key:'received',label:'Received',align:'right',cell:a=>money(a.received)},
 {key:'allocated',label:'Allocated',align:'right',cell:a=>money(a.allocated)},
 {key:'cod',label:'Seller COD',align:'right',cell:a=>money(a.cod_reserved)},
 {key:'returned',label:'Returned',align:'right',cell:a=>money(a.returned??'0')},
 {key:'advance',label:'Advance',align:'right',cell:a=>money(a.unallocated)},
 ]}/>{!document.advance_sources.length&&<p>No residual advances or returned receipt sources.</p>}</details>
 <RecordTable label="Statement shipment ledger" rows={document.lines} rowKey={l=>l.booking_id} columns={[
 {key:'shipment',label:'Shipment',cell:l=><><button className="btn btn-text" disabled={locked} aria-label={'Open shipment '+l.booking_id} onClick={()=>setReceipt(l.booking_id)}>Open shipment</button><span className="finance-record-ref">{l.booking_id}</span><small>{l.source_statement_id?'Previously documented; updated evidence':'First document for this shipment'}</small></>},
 {key:'due',label:'Due',cell:l=>l.due_date},
 {key:'original',label:'Original',align:'right',cell:l=>money(l.original_gross)},
 {key:'credits',label:'Credits',align:'right',cell:l=>money(l.amounts.credits)},
 {key:'payments',label:'Payments',align:'right',cell:l=>money(l.amounts.payments)},
 {key:'balance',label:'Balance',align:'right',cell:l=><strong>{money(l.amounts.closing)}</strong>},
 {key:'source',label:'Source evidence',cell:l=><details><summary>Source charge, tax and allocation evidence</summary><p>Pre-tax {money(l.pre_tax)} · CGST {money(l.cgst)} · SGST {money(l.sgst)} · IGST {money(l.igst)} · rounding {money(l.rounding)}</p><p>Original receipt: {l.receipt_id??'Unknown / not issued'}</p><ul>{l.payment_evidence.map(p=><li key={p.id}>{p.kind==='collection'?'Allocated payment':'Allocation reversal'} {money(p.amount)} · {formatKolkata(p.recorded_at)} · {p.id}</li>)}{l.adjustment_evidence.map(a=><li key={a.id}>{a.kind.replaceAll('_',' ')} · {a.reason.replaceAll('_',' ')} · credit {money(a.credit)} · actual refund {money(a.refund)} · {formatKolkata(a.recorded_at)} · {a.id}</li>)}</ul></details>},
 ]}/>
 {!document.id&&admin&&<button className="btn btn-filled" disabled={locked||!document.lines.length||issue.phase==='error'} onClick={()=>{void issue.run(source.issue(document)).then(show).catch(()=>{});}}>Issue statement</button>}
 {document.id&&(canExport??admin)&&<button className="btn btn-outlined" disabled={locked} onClick={()=>{void capture.run(source.capture(document.id!)).then(v=>download(v.id)).catch(()=>{});}}>Capture private CSV</button>}
 <Link className="btn btn-text" to={'/business/money-receipts?customer_id='+document.customer_id}>Record or allocate customer payment</Link>
 </>}
 <CommandNotice phase={issue.phase} code={issue.error?.code} retry={issue.canRetry?()=>{void issue.retry().then(show).catch(()=>{});}:undefined}/><CommandNotice phase={capture.phase} code={capture.error?.code} retry={capture.canRetry?()=>{void capture.retry().then(v=>{if(v)void download(v.id);}).catch(()=>{});}:undefined}/>
 {capture.result&&<button className="btn btn-text" disabled={locked} onClick={()=>{void download(capture.result!.id);}}>Download retained CSV</button>}
 {receipt&&controller&&<ReceiptPanel key={receipt} api={api} controller={controller} bookingId={receipt}/>}
 <h3>Issued history</h3>{history.phase==='loading'?<Loading/>:history.phase==='error'?<Failure retry={history.reload}/>:!history.items.length?<Empty title="No issued statements" body="Preview a period to inspect existing charges."/>:<RecordTable label="Issued statement history" rows={history.items} rowKey={s=>s.id} columns={[
 {key:'revision',label:'Statement',cell:s=><button className="btn btn-text" disabled={locked} aria-label={'Revision '+s.version+' · '+s.from_day+'–'+s.to_day} onClick={()=>{void source.read(s.id).then(show).catch(()=>setNotice('Statement could not be loaded. Retry from history.'));}}>Revision {s.version}</button>},
 {key:'from',label:'From',cell:s=>s.from_day},{key:'to',label:'Through',cell:s=>s.to_day},
 ]}/>}{history.page.has_more&&<button className="btn btn-text" disabled={locked} onClick={history.loadMore}>More statements</button>}
 </section>;
}
