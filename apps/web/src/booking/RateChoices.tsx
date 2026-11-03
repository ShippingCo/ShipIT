import {type ReactNode,useEffect,useState,useSyncExternalStore} from 'react';
import {SelectField,TextField} from '../components/m3/Input';
import {array,choice,instant,object,text,uuid} from '../data-access/dto';
import {useResource,usePagedResource} from '../operations/hooks';
import {bookingServicesDto} from '../data-access/booking-services';
import type {BookingWorkflow} from './workflow';
import {Link} from 'react-router-dom';

// The existing scoped endpoint only returns the currently effective published card.
export const publishedChoices=object({id:uuid,state:choice('published'),effective_to:instant,
  rules:array(object({destination_key:text,service:choice('standard','express','same_city')}))});
const services=[{value:'standard',label:'Standard'},{value:'express',label:'Express'},{value:'same_city',label:'Same-city'}];
export function RateChoices({workflow,disabled,destinationError,serviceError,onChange,refreshKey=0,onAddService,onServiceLabel,beforeDestination,beforeService,afterFields}:{beforeDestination?:ReactNode;beforeService?:ReactNode;afterFields?:ReactNode;workflow:BookingWorkflow;disabled:boolean;destinationError?:string;serviceError?:string;onChange:(key:'destination'|'service',value:string)=>void;refreshKey?:number;onAddService?:()=>void;onServiceLabel?:(label:string)=>void}) {
  const state=useSyncExternalStore(workflow.subscribe,workflow.snapshot),d=state.draft;
  const [accountEntry,setAccountEntry]=useState(false);
  const source=useResource(workflow.api.franchise+refreshKey,signal=>workflow.api.read(`/api/v1/organizations/${workflow.api.organization}/franchises/${workflow.api.franchise}/pricing/versions`,publishedChoices,signal));
  const catalog=usePagedResource(workflow.api.franchise+'services'+refreshKey,(cursor,signal)=>workflow.api.read(`/api/v1/organizations/${workflow.api.organization}/franchises/${workflow.api.franchise}/pricing/services`+(cursor?'?cursor='+encodeURIComponent(cursor):''),bookingServicesDto,signal));
  const manual=!!state.accountId&&accountEntry;
  const destinations=[...new Set([...(source.value?.rules.map(rule=>rule.destination_key)??[]),...catalog.items.map(s=>s.destination_key)])];
  const allowed=manual?services:services.filter(service=>source.value?.rules.some(rule=>rule.destination_key===d.destination&&rule.service===service.value));
  const missingDestination=!!d.destination&&!destinations.includes(d.destination);
  const missingService=!!d.service&&!allowed.some(service=>service.value===d.service);
  const noChoices=source.phase==='ready'&&!destinations.length;
  const unavailable=source.phase==='error'||noChoices;
  const waiting=source.phase==='loading';
  const blocked=disabled||!destinations.length;
  const named=state.accountId?[]:catalog.items.filter(s=>s.destination_key===d.destination);
  const namedSelected=!!d.serviceOptionId;
  const serviceValue=namedSelected?'option:'+d.serviceOptionId:missingService?'':d.service;
  const selectedLabel=namedSelected?named.find(option=>option.id===d.serviceOptionId)?.name:allowed.find(option=>option.value===serviceValue)?.label;
  useEffect(()=>{onServiceLabel?.(selectedLabel??'');},[selectedLabel,onServiceLabel]);
  return <div className="counter-rate-choices">
    <div className="counter-grid">
      {beforeDestination}
      {manual?<TextField id="counter-destination" label="Destination" value={d.destination} disabled={disabled} error={destinationError} helper="Use the destination key agreed for this monthly account." onChange={value=>onChange('destination',value)}/>:<SelectField id="counter-destination" label="Destination" value={d.destination} disabled={blocked} error={destinationError} options={[{value:'',label:waiting?'Loading destinations…':unavailable?'Rates need attention':'Choose destination'},...(missingDestination?[{value:d.destination,label:d.destination+' · not in current rates'}]:[]),...destinations.map(value=>({value,label:value.replaceAll('_',' ')}))]} onChange={value=>{workflow.change('serviceOptionId','');onChange('destination',value);if(!source.value?.rules.some(rule=>rule.destination_key===value&&rule.service===d.service))onChange('service','');}}/>}
      {beforeService}
      <SelectField id="counter-service" label="Service" value={serviceValue} disabled={disabled||!manual&&(blocked||!d.destination||missingDestination)} error={serviceError} helper={state.additionalParcels.length ? "Applies to every parcel in this booking." : undefined} options={[{value:'',label:waiting?'Loading services…':!d.destination?'Choose destination first':'Choose service'},...allowed,...named.map(s=>({value:'option:'+s.id,label:s.name}))]} onChange={value=>{const option=named.find(s=>'option:'+s.id===value);workflow.change('serviceOptionId',option?.id??'');onChange('service',option?.service??value);}}/>
      {afterFields}
    </div>
    {waiting&&<p role="status">Loading this branch’s destinations and services…</p>}
    {onAddService&&<button type="button" className="btn btn-text" disabled={disabled} onClick={onAddService}>Add a service and its rates</button>}
    {catalog.page.has_more&&<button type="button" className="btn btn-text" disabled={disabled||catalog.phase==='more'} onClick={catalog.loadMore}>Load more services</button>}
    {catalog.phase==='error'&&<p role="status">Saved service options could not be loaded. <button type="button" className="btn btn-text" onClick={catalog.reload}>Retry service options</button></p>}
    {unavailable&&<div className="counter-rate-message"><h3>{source.error?.code==='NO_RATE'||noChoices?'Set up booking rates for this branch':source.error?.code==='RATE_CONFLICT'?'Published rates overlap':'Destinations could not be loaded'}</h3><p role="alert">{source.error?.code==='NO_RATE'?'There are no published rates covering today. A branch administrator needs to publish the approved destinations, services and prices before you can book.':noChoices?'The published rate card has no destinations. Ask a branch administrator to check its rules.':source.error?.code==='RATE_CONFLICT'?'More than one rate card covers today. Ask a branch administrator to resolve the overlapping dates.':'Check your connection and retry. If this continues, ask your branch administrator to check access and published rates.'}</p><div className="counter-actions"><Link className="btn btn-outlined" to="/business/settings?setup=booking" target="_blank" rel="noopener noreferrer">Open booking setup · new tab</Link><button type="button" className="btn btn-outlined" disabled={disabled} onClick={source.reload}>Retry destinations</button></div><p className="counter-help">Keep this tab open to retain your booking. After rates are published, return here and retry. Only an authorised administrator can change rates.</p></div>}
    {source.phase==='ready'&&missingDestination&&!manual&&<p className="counter-help">This destination is not in the current rate card. Choose a listed destination or check the monthly account’s agreed rates.</p>}
    {!!state.accountId&&<button type="button" className="btn btn-text" disabled={disabled} aria-pressed={manual} onClick={()=>setAccountEntry(value=>!value)}>{manual?'Choose from published destinations':'Use an account-specific destination'}</button>}
  </div>;
}
