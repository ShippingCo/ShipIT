import {RecordTable,StatusBadge,SectionHeader} from '../components/workspace/Workspace';
import React,{useMemo,useState} from 'react';
import type {CashLocationDto} from '@shippingco/shared';
import type {CashbookSource} from '../data-access/cashbook';
import type {ScopedApi} from '../data-access/scoped-api';
import type {CommandIntent} from '../data-access/command-intent';
import {receivingAccounts} from '../data-access/money-receipts';
import {TextField,SelectField} from '../components/m3/Input';
import {resourceLoaded,usePagedResource,useResource,type ResourceLoadState} from './hooks';
import {Empty,Failure,Loading} from './AsyncState';

interface Props {
 source:CashbookSource;api:ScopedApi;locations:CashLocationDto[];employees:{id:string;label:string}[];
 locationsState:ResourceLoadState;employeesState:ResourceLoadState;
 locked:boolean;revision:number;selected:string|null;select:(id:string|null)=>void;run:(intent:CommandIntent)=>void;
}
export default function CashLocations({source,api,locations,employees,locationsState,employeesState,locked,revision,selected,select,run}:Props){
 const accounts=useMemo(()=>receivingAccounts(api),[api]);
 const list=usePagedResource('accounts-'+revision,async(cursor,signal)=>{
  const result=await accounts.list(cursor??undefined,signal);
  return {items:result.items,page:{has_more:result.next_cursor!==null,next_cursor:result.next_cursor}};
 });
 const current=useResource('location-'+selected+'-'+revision,signal=>selected?source.location(selected,signal):Promise.resolve(null));
 const [reference,setReference]=useState('');
 const detail=current.value?.id===selected?current.value:null;
 return <section className="card ops-card">
  <SectionHeader title="Configure cash locations" description="A cash location belongs to an actual receiving account and named current custodian. Noncash locations belong to an account. Account and custodian identity stay fixed; rename, deactivate or refresh the account revision through a new location revision."/>
  <p>Configure receiving accounts in Money receipts before saving a location.</p>
  <div className="finance-section-actions"><button type="button" className="btn btn-outlined" disabled={locked} onClick={()=>select(null)}>New cash location</button></div>
  {locationsState.phase==='loading'&&<Loading label="Loading current cash locations…"/>}
  {locationsState.phase==='error'&&<Failure retry={locationsState.reload} disabled={locked} label="Cash locations could not be loaded."/>}
  {resourceLoaded(locationsState)&&(locations.length===0?<Empty title="No cash locations" body="Create a location for an actual receiving account and custodian."/>:
   <RecordTable label="Cash locations" rows={locations} rowKey={location=>location.id} selectedKey={selected} columns={[
    {key:'name',label:'Location',cell:location=><button type="button" className="btn btn-text" disabled={locked} aria-label={location.name+' · '+location.kind+' · version '+location.version} onClick={()=>select(location.id)}>{location.name}</button>},
    {key:'kind',label:'Type',cell:location=>location.kind},
    {key:'availability',label:'Availability',cell:location=><StatusBadge tone={location.active?'success':'neutral'}>{location.active?'Active':'Inactive'}</StatusBadge>},
    {key:'version',label:'Revision',align:'right',cell:location=>location.version},
   ]}/>)}
  <details className="finance-secondary-action"><summary>Find an older location by reference</summary>
   <form className="ops-form finance-grouped-form" aria-label="Open historical cash location" onSubmit={event=>{event.preventDefault();if(!locked)select(reference.trim());}}>
    <TextField label="Cash location reference" value={reference} onChange={setReference} disabled={locked}/>
    <button className="btn btn-outlined" disabled={locked||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reference.trim())}>Open location, including inactive</button>
   </form>
  </details>
  {list.phase==='loading'&&<Loading label="Loading actual receiving accounts…"/>}
  {list.phase==='error'&&<Failure retry={list.reload} disabled={locked} label="Receiving accounts unavailable."/>}
  {list.page.has_more&&<button type="button" className="btn btn-text" disabled={locked||list.phase==='more'} onClick={list.loadMore}>Load more receiving accounts</button>}
  {employeesState.phase==='loading'&&<Loading label="Loading current cash custodians…"/>}
  {employeesState.phase==='error'&&<Failure retry={employeesState.reload} disabled={locked} label="Current cash custodians unavailable."/>}
  {selected&&current.phase==='loading'&&<Loading label="Loading current location revision…"/>}
  {selected&&current.phase==='error'&&<Failure retry={current.reload} disabled={locked} label="Cash location unavailable."/>}
  {(!selected||detail)&&<Editor key={(detail?.id??'new')+'-'+(detail?.version??0)} original={detail} accounts={list.items} employees={employees}
   accountsReady={resourceLoaded(list)} employeesReady={resourceLoaded(employeesState)} locked={locked}
   save={input=>run(source.configure(selected,input))}/>}
 </section>;
}

interface EditorProps {
 original:CashLocationDto|null;accounts:Awaited<ReturnType<ReturnType<typeof receivingAccounts>['list']>>['items'];
 employees:{id:string;label:string}[];accountsReady:boolean;employeesReady:boolean;locked:boolean;
 save:(input:Parameters<CashbookSource['configure']>[1])=>void;
}
function Editor({original,accounts,employees,accountsReady,employeesReady,locked,save}:EditorProps){
 const [accountId,setAccountId]=useState(original?.account_id??''),[custodian,setCustodian]=useState(original?.custodian_id??'');
 const [name,setName]=useState(original?.name??''),[active,setActive]=useState(original?.active??true),[error,setError]=useState('');
 const account=accounts.find(value=>value.id===accountId),cash=account?.methods.includes('cash')??original?.kind==='cash';
 const ready=accountsReady&&(!cash||employeesReady);
 return <>
  {accountsReady&&accounts.length===0&&<Empty title="No receiving accounts" body="Configure an actual account in Money receipts before saving this location. You can enter the location name now."/>}
  <form className="ops-form finance-grouped-form" aria-label="Save cash location revision" onSubmit={event=>{
   event.preventDefault();
   if(locked||!ready)return;
   if(!account||!name.trim()||cash&&!custodian){setError('Choose the actual account, cash custodian and location name.');return;}
   setError('');save({account_id:account.id,expected_account_version:account.version,custodian_id:cash?custodian:null,name:name.trim(),active,expected_version:original?.version??0});
  }}>
   <SelectField label="Location receiving account" aria-label="Location receiving account" value={accountId} disabled={locked||!accountsReady||!!original}
    onChange={value=>{setAccountId(value);setCustodian('');}} options={[{value:'',label:accountsReady?'Select actual account':'Load accounts to select'},...accounts.map(value=>({value:value.id,label:value.name+(value.active?'':' · inactive')}))]}/>
   {cash&&<SelectField label="Named cash custodian" aria-label="Named cash custodian" value={custodian} onChange={setCustodian} disabled={locked||!employeesReady||!!original}
    options={[{value:'',label:'Select current employee'},...employees.map(value=>({value:value.id,label:value.label})),
     ...(original?.custodian_id&&!employees.some(value=>value.id===original.custodian_id)?[{value:original.custodian_id,label:'Recorded custodian '+original.custodian_id}]:[])]}/>}
   <TextField label="Cash location name" value={name} onChange={setName} required disabled={locked}/>
   <SelectField label="Location availability" aria-label="Location availability" value={active?'active':'inactive'} disabled={locked} onChange={value=>setActive(value==='active')}
    options={[{value:'active',label:'Active for new movements'},{value:'inactive',label:'Inactive; retain historical evidence'}]}/>
   {account&&<p>Current account revision {account.version}; location revision {original?.version??0}. No account balance is implied.</p>}
   {!ready&&<p role="status">You can enter a draft. Current account and custodian details must load before saving.</p>}
   {error&&<p role="alert">{error}</p>}
   <button className="btn btn-filled" disabled={locked||!ready||!account||!name.trim()||cash&&!custodian}>Save location revision</button>
  </form>
 </>;
}
