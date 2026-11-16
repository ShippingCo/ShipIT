import React,{useId,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {parcels,type ParcelRead} from '../data-access/parcels';
import {eway,type EwayCapture,type EwayCurrent,type EwaySource} from '../data-access/eway';
import {useCommand,useResource} from './hooks';
import {allLotPages} from './LotsWorkspace';
import {businessDay,dayStart} from './business-dates';
import {formatKolkata,instantToKolkataInput,kolkataInputToInstant,rupeesToPaise} from './format';
import {DataRefresh,Loading,Failure,CommandNotice} from './AsyncState';
import {Msym} from '../components/m3/Icon';
import {Button} from '../components/m3/Button';
import {TextField} from '../components/m3/Input';
import {Card,EmptyState} from '../components/m3/Surface';
import {Dialog} from '../components/m3/Dialog';
import {FilterChips,IconTile} from '../components/m3/Controls';
import DataTable,{type Column} from '../components/m3/DataTable';
import {PageHeader} from '../components/workspace/Workspace';
import './eway-workspace.css';
export const reviewThreshold=5000000;
const periods=[{value:'month',label:'This month'},{value:'lastmonth',label:'Last month'},{value:'fy',label:'Financial year'}];
export function ewayWindow(period:string,now=new Date()){
 const day=businessDay(now),year=Number(day.slice(0,4)),month=Number(day.slice(5,7)),first=(y:number,m:number)=>`${y}-${String(m).padStart(2,'0')}-01`;
 const start=period==='fy'?first(month>=4?year:year-1,4):period==='lastmonth'?first(month===1?year-1:year,month===1?12:month-1):first(year,month);
 const end=period==='fy'?first(month>=4?year+1:year,4):period==='lastmonth'?first(year,month):first(month===12?year+1:year,month===12?1:month+1);
 return {from:Date.parse(dayStart(start)),to:Date.parse(dayStart(end)),label:period==='fy'?`FY ${start.slice(0,4)}–${String(Number(start.slice(0,4))+1).slice(-2)}`:formatKolkata(dayStart(start),{month:'long',year:'numeric'})};
}
export const ewayMoney=(value:number|bigint)=>{const n=BigInt(value),fraction=n%100n;return '₹'+new Intl.NumberFormat('en-IN').format(n/100n)+(fraction?'.'+String(fraction).padStart(2,'0'):'');};
export interface EwayRow{id:string;docket:string;customer:string;destination:string;booked:string;status:string;goodsPaise:number|null;valueSource:string|null;current:EwayCurrent}
/**
 * What a recorded bill's validity means today, as a word and a colour.
 *
 * Never a bare date. An operator reading "14 Nov" has to work out what that means against
 * today, in a hurry, and the answer decides whether a vehicle can leave. Three states, because
 * "expiring tomorrow" is a different job from "expired": one is a renewal to arrange and the
 * other is a parcel that cannot move.
 *
 * ShipIT never renews, extends or hides any of this. It records what the portal said and shows
 * what that means now.
 */
export function ewayBadge(current:EwayCurrent,now=Date.now()){
 if(current.state.reference_state==='missing')return {label:'Not recorded',pill:'pill-warn'};
 if(current.state.official_validity_state==='expired')return {label:'Expired',pill:'pill-err'};
 const until=current.record?.external?.official_valid_until;
 if(until){
  const left=Date.parse(until)-now;
  if(Number.isFinite(left)&&left<=24*60*60*1000)return {label:'Expires tomorrow',pill:'pill-warn'};
 }
 return {label:'Valid',pill:'st-delivered'};
}
export async function loadEwayRows(shipments:ParcelRead[],source:EwaySource,signal:AbortSignal):Promise<EwayRow[]>{
 const bookings=new Map<string,ParcelRead[]>();for(const p of shipments.filter(p=>p.status!=='cancelled')){const list=bookings.get(p.booking_id)??[];list.push(p);bookings.set(p.booking_id,list);}
 const groups=[...bookings.entries()],rows:EwayRow[]=[];
 for(let i=0;i<groups.length;i+=8)rows.push(...await Promise.all(groups.slice(i,i+8).map(async([id,items])=>{
  const current=await source.read(id,signal),declared=items.every(p=>p.details?.declared_value_paise!==undefined)?items.reduce((n,p)=>n+BigInt(p.details!.declared_value_paise!),0n):null;
  const amount=current.record?.declaration?.value_paise??(declared!==null&&declared<=BigInt(Number.MAX_SAFE_INTEGER)?Number(declared):null),first=items[0]!;
  const destinations=[...new Set(items.map(p=>p.details?.city||p.destination_key).filter(Boolean))];
  return {id,docket:items.map(p=>p.docket).join(', '),customer:first.sender.name,destination:destinations.join(', ')||'Not recorded',booked:first.confirmed_at,status:[...new Set(items.map(p=>p.status.replaceAll('_',' ')))].join(', '),goodsPaise:amount,valueSource:current.record?.declaration?.source_ref??(amount===null?null:'booking:'+id),current};
 })));
 return rows;
}
export default function EwayWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>eway(api),[api]),[period,setPeriod]=useState('month'),[editing,setEditing]=useState<EwayRow|null>(null),[notice,setNotice]=useState('');
 const [find,setFind]=useState('');
 const records=useResource(api.franchise+'eway-checklist',async(signal:AbortSignal)=>loadEwayRows(await allLotPages(cursor=>parcels(api).list({limit:100,cursor},signal)),source,signal));
 const win=ewayWindow(period),canWrite=canAdminister(roles,'eway.write')||roles.includes('operator');
 const all=(records.value??[]).filter(r=>Date.parse(r.booked)>=win.from&&Date.parse(r.booked)<win.to),rows=all.filter(r=>r.goodsPaise!==null&&r.goodsPaise>=reviewThreshold),other=all.filter(r=>r.goodsPaise===null||r.goodsPaise<reviewThreshold),pending=rows.filter(r=>ewayBadge(r.current).label!=='Recorded').length,value=rows.reduce((n,r)=>n+BigInt(r.goodsPaise!),0n);
 // Searching what is already loaded keeps this instant and needs no second request. It
 // deliberately ignores the period and the threshold: those filter attention, not rights.
 const query=find.trim().toLowerCase();
 const matches=query?(records.value??[]).filter(r=>r.docket.toLowerCase().includes(query)||r.customer.toLowerCase().includes(query)).slice(0,8):[];
 const outsideWindow=(records.value??[]).length-all.length;
 const action=(r:EwayRow)=>r.current.record?.external?.reference?<button type="button" className="eway-no" aria-label={`${canWrite?'Edit':'View'} e-way bill for ${r.docket}`} onClick={()=>setEditing(r)}><span className="mono">{r.current.record.external.reference}</span><Msym name={canWrite?'edit':'visibility'}/></button>:<Button size="sm" variant="outlined" onClick={()=>setEditing(r)}>{canWrite?'Record':'View'}</Button>;
 const columns:Column<EwayRow>[]=[{key:'docket',label:'Docket',type:'text',render:r=><span className="mono">{r.docket}</span>},{key:'customer',label:'Customer',type:'text'},{key:'destination',label:'Destination',type:'enum'},{key:'value',label:'Goods value',type:'money',accessor:r=>r.goodsPaise===null?null:r.goodsPaise/100,render:r=>r.goodsPaise===null?'Not recorded':ewayMoney(r.goodsPaise),total:true,aggregate:visible=>ewayMoney(visible.reduce((n,r)=>n+BigInt(r.goodsPaise??0),0n))},{key:'booked',label:'Booked',type:'date',accessor:r=>r.booked,render:r=>formatKolkata(r.booked,{day:'numeric',month:'numeric',year:'numeric'})},{key:'status',label:'Status',type:'enum',accessor:r=>ewayBadge(r.current).label,render:r=>{const badge=ewayBadge(r.current);return <span className="eway-state"><span className={`pill ${badge.pill}`}>{badge.label}</span>{badge.label==='Expired'&&r.current.record?.external?.official_valid_until&&<span className="t-label-sm muted">until {formatKolkata(r.current.record.external.official_valid_until,{day:'numeric',month:'short'})}</span>}</span>;}},{key:'number',label:'Bill number',type:'text',accessor:r=>r.current.record?.external?.reference??'',render:action}];
 return <div className="page live-eway">
  <PageHeader title="E-way bills"/>
  <div className="eway-period"><FilterChips options={periods} value={period} onChange={setPeriod}/><DataRefresh resource={records}/></div>{notice&&<p role="status">{notice}</p>}
 {records.phase==='loading'&&!records.value?<Loading label="Loading e-way bills…"/>:records.phase==='error'?<Failure label="E-way bills could not be loaded." retry={records.reload}/>:<>
 <div className="stat3"><Card pad className="stat"><span className="stat-label">Review for an e-way bill</span><span className="stat-value">{rows.length}</span><p className="stat-empty">{ewayMoney(reviewThreshold)} or more · {win.label}</p></Card><Card pad className="stat"><span className="stat-label">To record or renew</span><span className={`stat-value${pending?' is-alert':''}`}>{pending}</span><p className="stat-empty">{pending?'missing or expired':'no missing or expired references'}</p></Card><Card pad className="stat"><span className="stat-label">Goods value covered</span><span className="stat-value">{ewayMoney(value)}</span><p className="stat-empty">across {rows.length} consignment{rows.length===1?'':'s'}</p></Card></div>
 {/* R-1: the boundary first, before any figure or row. Everything below it is a record of
     what somebody else's system said, and an operator who reads it after the table has
     already assumed otherwise. */}
 <p className="eway-boundary"><Msym name="info"/><span>ShipIT does not create, renew or extend e-way bills. Do that on the government portal (<b>ewaybillgst.gov.in</b>) and record the details here. &ldquo;Recorded&rdquo; means the reference is saved — it is not a check that a bill applies or is still valid.</span></p>
 <div className="section-label"><IconTile name="local_shipping" size="sm" tone={pending?'warn':'ok'}/>Consignments worth {ewayMoney(reviewThreshold)} or more</div><Card>{rows.length?<DataTable caption="E-way bills" columns={columns} rows={rows}/>:<EmptyState icon="task_alt" title="Nothing over the threshold" sub={`No dispatchable booking in ${win.label} has a recorded goods value of ${ewayMoney(reviewThreshold)} or more.`}/>}<p className="rep-note"><Msym name="info"/><span>Distance-based travel estimates are shown separately and never set or extend an official expiry.</span></p></Card>
 {other.length>0&&<details className="eway-other" open={!rows.length}><summary>Other dispatchable bookings ({other.length})</summary><p className="t-body-sm muted">These bookings have a lower or unknown declared goods value. You can still record their bill details.</p><Card><DataTable caption="Other dispatchable bookings" columns={columns.map(c=>({...c,total:false}))} rows={other}/></Card></details>}
 {/* The way in that the page used to lack: any booking, whatever its value or date. */}
 <div className="section-label"><IconTile name="search" size="sm"/>Record a bill for any booking</div>
 <Card pad className="eway-find">
  <TextField label="Find by docket or customer" value={find} onChange={setFind} maxLength={64}
    autoComplete="off" spellCheck={false}
    helper={`Searches all ${(records.value??[]).length} booking${(records.value??[]).length===1?'':'s'} in this branch, whatever their value or date.`}/>
  {query&&(matches.length?<ul className="eway-find-results">
    {matches.map(r=><li key={r.id}>
      <button type="button" onClick={()=>setEditing(r)}>
        <span className="mono">{r.docket}</span>
        <span>{r.customer} · {r.destination}</span>
        <span className="eway-find-state">{ewayBadge(r.current).label}</span>
      </button>
    </li>)}
  </ul>:<p role="status" className="t-body-sm muted">No booking matches “{find.trim()}”. Check the docket, or the branch selected above.</p>)}
  {!query&&outsideWindow>0&&<p className="t-body-sm muted">{outsideWindow} booking{outsideWindow===1?' falls':'s fall'} outside {win.label}. Search above to record a bill for one of them.</p>}
 </Card>
 <p className="eway-detail-link"><Link to="/business/eway?view=records">Detailed records, revision history and travel estimates</Link></p></>}
 {editing&&<EwayEditor key={editing.id} row={editing} source={source} writable={canWrite} close={()=>setEditing(null)} saved={()=>{setNotice(`E-way bill details saved for ${editing.docket}.`);setEditing(null);records.reload();}}/>}
 </div>;
}
const validRef=(s:string,max=128)=>s.length>0&&s.length<=max&&/^[A-Za-z0-9][A-Za-z0-9.:_/-]*$/.test(s)&&!s.includes('://');
function EwayEditor({row,source,writable,close,saved}:{row:EwayRow;source:EwaySource;writable:boolean;close:()=>void;saved:()=>void}){
 const record=row.current.record,external=record?.external,id=useId(),[number,setNumber]=useState(external?.reference??''),[vehicle,setVehicle]=useState(record?.vehicle_number??''),[distance,setDistance]=useState(record?.distance_km===null||record?.distance_km===undefined?'':String(record.distance_km));
 const [issuer,setIssuer]=useState(external?.issuer??'ewaybillgst'),[sourceRef,setSourceRef]=useState(external?.source_ref??''),[issued,setIssued]=useState(external?.issued_at?instantToKolkataInput(external.issued_at)??'':''),[until,setUntil]=useState(external?.official_valid_until?instantToKolkataInput(external.official_valid_until)??'':''),[evidence,setEvidence]=useState(external?.validity_evidence_ref??'');
 const [amount,setAmount]=useState(row.goodsPaise===null?'':`${BigInt(row.goodsPaise)/100n}.${String(BigInt(row.goodsPaise)%100n).padStart(2,'0')}`),[declarationSource,setDeclarationSource]=useState(row.valueSource??''),[reason,setReason]=useState(''),[error,setError]=useState('');
 const command=useCommand(intent=>source.execute(intent)),busy=command.phase==='pending'||command.phase==='uncertain',locked=busy,preview=record?.estimate;
 async function submit(event:React.FormEvent){event.preventDefault();if(!writable||busy)return;setError('');
  const no=number.trim(),v=vehicle.trim().toUpperCase(),km=distance.trim()?Number(distance):null,issuedAt=issued?kolkataInputToInstant(issued):null,untilAt=until?kolkataInputToInstant(until):null,paise=amount.trim()?rupeesToPaise(amount):null;
  if(no&&(!validRef(no)||!validRef(issuer,64))){setError('Enter a valid bill number and issuer using letters, digits, dots, colons, slashes, underscores or hyphens.');return;}
  if(v&&!/^[A-Z0-9](?:[A-Z0-9 -]{0,30}[A-Z0-9])?$/.test(v)){setError('Check the vehicle number. Use up to 32 letters, digits, spaces or hyphens.');return;}
  if(km!==null&&(!Number.isSafeInteger(km)||km<1||km>100000)){setError('Enter a whole-number distance from 1 to 100,000 km, or leave it blank.');return;}
  if(issued&&!issuedAt||until&&!untilAt||untilAt&&(!sourceRef.trim()||!evidence.trim())||!untilAt&&evidence.trim()||untilAt&&issuedAt&&Date.parse(untilAt)<=Date.parse(issuedAt)){setError('Check the source dates. An official expiry needs its source and validity evidence references and must follow the issue time.');return;}
  if([sourceRef,evidence].some(s=>s.trim()&&!validRef(s.trim()))||record&&!validRef(reason.trim())){setError('Enter valid source references and a correction reference when editing.');return;}
  if((amount.trim()||declarationSource.trim())&&(paise===null||!validRef(declarationSource.trim()))){setError('Enter a valid declared value and the reference for its source document.');return;}
  const body:EwayCapture={external:no?{issuer:issuer.trim(),reference:no,source_ref:sourceRef.trim()||null,issued_at:issuedAt,official_valid_until:untilAt,validity_evidence_ref:evidence.trim()||null}:null,vehicle_number:v||null,distance_km:km,declaration:paise===null?null:{value_paise:paise,source_ref:declarationSource.trim()}};
  if(!record&&Object.values(body).every(value=>value===null)){setError('Enter at least one bill, declaration or transport detail to save.');return;}
  if(!no&&(sourceRef.trim()||issued||until||evidence.trim())){setError('Enter a bill number before adding its source details, or clear those details.');return;}
  try{await command.run(source.intent(record?{kind:'correct',bookingId:row.id,body:{...body,expected_version:record.version,reason_code:'metadata_correction',reason_ref:reason.trim()}}:{kind:'create',bookingId:row.id,body}));saved();}catch{/* exact uncertain requests are retained */}
 }
 return <Dialog open title={`E-way bill for ${row.docket}`} hideClose={busy} onClose={()=>{if(!busy)close();}} actions={<><Button variant="text" onClick={close} disabled={busy}>{writable?'Cancel':'Close'}</Button>{writable&&<Button type="submit" form={id} disabled={busy}>Save</Button>}</>}>
 <div className="ew-doc-facts"><span>{row.status}</span><span>{row.customer} → {row.destination}</span><span>{row.goodsPaise===null?'Goods value not recorded':`Goods worth ${ewayMoney(row.goodsPaise)}`}</span></div>
 <form id={id} onSubmit={event=>{void submit(event);}}><fieldset className="eway-edit-fields" disabled={!writable||locked}>
 <TextField label="E-way bill number" value={number} onChange={v=>{setNumber(v);setError('');}} maxLength={128} autoFocus autoComplete="off" spellCheck={false} helper="Enter the reference exactly as it appears on the source document."/>
 <TextField label="Vehicle number (Part-B)" value={vehicle} onChange={v=>setVehicle(v.toUpperCase())} maxLength={32} helper="For example, GJ-01-AB-1234. Check the source document for transport requirements."/>
 <TextField label="Approximate road distance (km)" value={distance} onChange={setDistance} type="number" min="1" max="100000" step="1" inputMode="numeric" helper="Saving distance does not set or extend the official expiry."/>
 {external&&writable&&<Button type="button" variant="text" size="sm" onClick={()=>{setNumber('');setSourceRef('');setIssued('');setUntil('');setEvidence('');}}>Clear bill details</Button>}
 {record&&<TextField label="Correction reference" value={reason} onChange={setReason} maxLength={128} required helper="Reference for the source document or correction request."/>}
 <details className="eway-source-details"><summary>Source document and declared value</summary><div className="grid2"><TextField label="Issuer" value={issuer} onChange={setIssuer} maxLength={64}/><TextField label="Source reference" value={sourceRef} onChange={setSourceRef} maxLength={128}/><TextField label="Issued at (IST)" type="datetime-local" value={issued} onChange={setIssued}/><TextField label="Official valid until (IST)" type="datetime-local" value={until} onChange={setUntil}/><TextField label="Validity evidence reference" value={evidence} onChange={setEvidence} maxLength={128}/><TextField label="Declared goods value (₹)" value={amount} onChange={setAmount} inputMode="decimal"/><TextField label="Declaration source reference" value={declarationSource} onChange={setDeclarationSource} maxLength={128}/></div></details>
 </fieldset></form>
 {preview&&<p className="ops-note">{preview.label}: {formatKolkata(preview.estimated_valid_until)}. This estimate does not replace official validity.</p>}
 {external&&<p className="ops-note">Official expiry: {external.official_valid_until?formatKolkata(external.official_valid_until):'Not recorded; check the source document.'}</p>}
 {/* R-1: repeated once, here, where a number is about to be typed in. */}
 <p className="eway-boundary"><Msym name="info"/><span>This saves what the portal told you. It does not create the bill, renew it, or check that it is valid.</span></p>
 {/* R-8: optional, and the reason it is worth doing anyway. */}
 <p className="ops-note">A photo or PDF of the bill is optional. It is useful if the vehicle is stopped and the driver needs to show it.</p>
 {record&&<p className="ops-note">Clearing details creates a new revision. Earlier records remain in history.</p>}
 {error&&<p className="eway-error" role="alert">{error}</p>}
 <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(saved).catch(()=>{});}:undefined}/>
 </Dialog>;
}
