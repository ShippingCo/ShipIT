import {RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import React,{useState} from 'react';
import type {OperatorRole,ParcelCustodyTransferDto} from '@shippingco/shared';
import type {CustodyCommand,CustodySource} from '../data-access/custody';
import {usePagedResource} from './hooks';
import {Empty,Failure,Loading} from './AsyncState';
export default function CustodyTransfers({source,user,roles,revision,locked,submit}:{source:CustodySource;user:string;roles:readonly OperatorRole[];revision:number;locked:boolean;submit:(command:CustodyCommand)=>void}){
 const [selected,setSelected]=useState<string|null>(null);
 const grants=usePagedResource('transfers-'+revision,async(cursor,signal)=>{const r=await source.transfers(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const transfer=grants.items.find(g=>g.id===selected);
 return <section className="card ops-card logistics-records"><SectionHeader title="Approved outgoing transfers" description="Each approval applies to its named giver, current parcel receipt and destination. Preparation and release do not establish receiving custody."/>{grants.phase==='loading'?<Loading/>:grants.phase==='error'?<Failure retry={grants.reload} label="Current transfer approvals unavailable."/>:grants.items.length===0?<Empty title="No current transfer approvals" body="Ask an owner or franchise admin for a specific approval. Revoked approvals and receipts already transferred are excluded."/>:<RecordTable label="Approved outgoing transfers" rows={grants.items} rowKey={g=>g.id} selectedKey={selected} columns={[
  {key:'parcel',label:'Parcel',cell:g=><span className="ops-mono logistics-reference">{g.parcel_id}</span>},
  {key:'giver',label:'Giver',cell:g=><span className="ops-mono logistics-reference">{g.agent_id}</span>},
  {key:'destination',label:'Destination',cell:g=>g.destination_kind==='office'?'Office':'Receiving agent '+g.destination_agent_id},
  {key:'evidence',label:'Approval / source receipt',cell:g=><div className="record-identity"><span className="ops-mono logistics-reference">Approval {g.id}</span><span className="ops-note ops-mono logistics-reference">Source receipt {g.source_receipt_id}</span></div>},
  {key:'actions',label:'Actions',className:'record-actions',cell:g=><div className="ops-actions"><button className="btn btn-outlined" disabled={locked} onClick={()=>setSelected(g.id)}>View approved transfer {g.id.slice(0,8)}</button>{canAdminister(roles,'custody.prepare')&&<button className="btn btn-text" disabled={locked} onClick={()=>submit({kind:'revoke_grant',id:g.id,body:{expected_version:1}})}>Revoke this transfer approval</button>}</div>},
 ]}/>}{grants.page.has_more&&<button className="btn btn-outlined" disabled={locked||grants.phase==='more'} onClick={grants.loadMore}>Load more transfer approvals</button>}
 {transfer&&<Outgoing key={transfer.id+'-'+revision} source={source} transfer={transfer} giver={roles.includes('delivery_agent')&&transfer.agent_id===user} locked={locked} submit={submit}/>}
 </section>;
}
function Outgoing({source,transfer,giver,locked,submit}:{source:CustodySource;transfer:ParcelCustodyTransferDto;giver:boolean;locked:boolean;submit:(command:CustodyCommand)=>void}){
 const manifests=usePagedResource(transfer.id,async(cursor,signal)=>{const r=await source.outgoingManifests(transfer.id,cursor??undefined,signal);if(r.items.some(m=>m.agent_id!==transfer.destination_agent_id))throw new Error('Transfer destination mismatch');return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const release=(manifest:string|null)=>submit({kind:'release',body:{parcel_id:transfer.parcel_id,source_receipt_id:transfer.source_receipt_id,grant_id:transfer.id,manifest_id:manifest}});
 return <div className="logistics-transfer-detail"><h3 className="t-title-md">Selected approval {transfer.id}</h3>{giver&&transfer.can_prepare&&<button className="btn btn-filled" disabled={locked} onClick={()=>submit({kind:'prepare',body:{agent_id:transfer.destination_agent_id!,items:[{parcel_id:transfer.parcel_id,expected_parcel_version:transfer.parcel_version,previous_receipt_id:transfer.source_receipt_id,instruction_id:transfer.instruction_id,grant_id:transfer.id}]}})}>Prepare handover under this approval</button>}{giver&&transfer.destination_kind==='agent'&&!transfer.can_prepare&&<p>A current dispatcher instruction and active delivery assignment are required before preparation.</p>}
 {transfer.destination_kind==='office'?<>{transfer.office_release_id?<p>Giver release recorded: {transfer.office_release_id}. Office receipt is still separate.</p>:giver&&<button className="btn btn-outlined" disabled={locked} onClick={()=>release(null)}>Confirm I released this parcel to the office</button>}</>:manifests.phase==='loading'?<Loading/>:manifests.phase==='error'?<Failure retry={manifests.reload} label="Outgoing manifests unavailable."/>:<><RecordTable label="Prepared outgoing manifests" rows={manifests.items} rowKey={m=>m.id} columns={[
  {key:'manifest',label:'Prepared manifest',cell:m=><span className="ops-mono logistics-reference">{m.id}</span>},
  {key:'agent',label:'Receiving agent',cell:m=><span className="ops-mono logistics-reference">{m.agent_id}</span>},
  {key:'release',label:'Release',cell:m=>m.released?<><StatusBadge tone="info">Giver release recorded</StatusBadge><p className="ops-note">Awaiting receiving-agent acknowledgement.</p></>:giver?<button className="btn btn-outlined" disabled={locked} onClick={()=>release(m.id)}>Confirm parcel release for {m.id.slice(0,8)}</button>:<StatusBadge>Not released</StatusBadge>},
 ]}/>{manifests.items.length===0&&<p>No pending outgoing manifest under this approval.</p>}{manifests.page.has_more&&<button className="btn btn-text" disabled={locked||manifests.phase==='more'} onClick={manifests.loadMore}>Load more outgoing manifests</button>}</>}
 <p>Confirm release only after physically giving the actual parcel to the named destination. Receiving acknowledgement remains a separate action.</p></div>;
}
