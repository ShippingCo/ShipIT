import {type ReactNode,useEffect,useState,useSyncExternalStore} from 'react';
import {SelectField,TextField} from '../components/m3/Input';
import {array,choice,instant,integer,nullable,object,text,uuid} from '../data-access/dto';
import {useResource,usePagedResource} from '../operations/hooks';
import {bookingServicesDto} from '../data-access/booking-services';
import type {BookingWorkflow} from './workflow';
import {totalWeight} from './form';
import {PriceOptions,optionAmount,ruleAmount,serviceName,type PriceOption} from './PriceOptions';
import {Link} from 'react-router-dom';

// The existing scoped endpoint only returns the currently effective published card. Its rules
// carry their own prices, so the counter can show what each service costs at this weight
// without asking the server once per option: the figures are already on the wire.
export const publishedChoices=object({id:uuid,state:choice('published'),effective_to:instant,
  rules:array(object({destination_key:text,service:choice('standard','express','same_city'),
    min_weight_grams:integer(),max_weight_grams:nullable(integer()),
    freight_paise:integer(),packing_paise:integer()}))});
const services=[{value:'standard',label:'Standard'},{value:'express',label:'Express'},{value:'same_city',label:'Same-city'}];
export function RateChoices({workflow,disabled,destinationError,serviceError,onChange,refreshKey=0,onAddService,onServiceLabel,beforeDestination,afterDestination,beforeService,afterFields,compact=false}:{compact?:boolean;beforeDestination?:ReactNode;afterDestination?:ReactNode;beforeService?:ReactNode;afterFields?:ReactNode;workflow:BookingWorkflow;disabled:boolean;destinationError?:string;serviceError?:string;onChange:(key:'destination'|'service',value:string)=>void;refreshKey?:number;onAddService?:()=>void;onServiceLabel?:(label:string)=>void}) {
  const state=useSyncExternalStore(workflow.subscribe,workflow.snapshot),d=state.draft;
  const [accountEntry,setAccountEntry]=useState(false);
  const source=useResource(workflow.api.franchise+refreshKey,signal=>workflow.api.read(`/api/v1/organizations/${workflow.api.organization}/franchises/${workflow.api.franchise}/pricing/versions`,publishedChoices,signal));
  const catalog=usePagedResource(workflow.api.franchise+'services'+refreshKey,(cursor,signal)=>workflow.api.read(`/api/v1/organizations/${workflow.api.organization}/franchises/${workflow.api.franchise}/pricing/services`+(cursor?'?cursor='+encodeURIComponent(cursor):''),bookingServicesDto,signal));
  const manual=!!state.accountId&&accountEntry;
  const destinations=[...new Set([...(source.value?.rules.map(rule=>rule.destination_key)??[]),...catalog.items.map(s=>s.destination_key)])];
  const allowed=compact||manual?services:services.filter(service=>source.value?.rules.some(rule=>rule.destination_key===d.destination&&rule.service===service.value));
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
  // The chargeable weight for the whole booking — the same figure the quote is asked for, so a
  // card can never show one price and the quote return another.
  const chargeable=totalWeight(state.draft,state.additionalParcels);
  const grams=chargeable?Number(chargeable):0;
  const rules=source.value?.rules??[];
  const forDestination=[...new Set(rules.filter(rule=>rule.destination_key===d.destination).map(rule=>rule.service))];
  const priceOptions:PriceOption[]=[
    ...named.map(option=>({key:'option:'+option.id,name:option.name,paise:grams?optionAmount(option,grams):null,negotiated:true})),
    ...forDestination.map(service=>({key:service,name:serviceName(service),paise:grams?ruleAmount(rules,d.destination,service,grams):null})),
  ];
  // The shop's usual choice, marked but never made. Standard where it is published here.
  const recommended=forDestination.includes('standard')?'standard':forDestination[0]??'';
  // Cards wherever this branch actually publishes a price for the typed destination. An
  // account entering its own agreed destination key (manual) keeps the plain select: there is
  // no published card behind it to read an amount from.
  const asCards=!manual&&!!d.destination&&!missingDestination&&priceOptions.length>0;
  function chooseOption(key:string) {
    const option=named.find(s=>'option:'+s.id===key);
    workflow.change('serviceOptionId',option?.id??'');
    if(option){workflow.change('override','');workflow.change('packing','');}
    onChange('service',option?.service??key);
  }
  useEffect(()=>{onServiceLabel?.(selectedLabel??'');},[selectedLabel,onServiceLabel]);
  return <div className="counter-rate-choices">
    <div className={compact?"form-grid":"counter-grid"}>
      {beforeDestination}
      {compact?<><TextField id="counter-destination" label="Destination city" value={d.destination.replaceAll('_',' ')} list="booking-cities" disabled={disabled} error={destinationError} onChange={value=>{workflow.change('serviceOptionId','');onChange('destination',value.toUpperCase().replaceAll(' ','_'));}}/><datalist id="booking-cities">{destinations.map(value=><option key={value} value={value.replaceAll('_',' ')}/>)}</datalist></>:manual?<TextField id="counter-destination" label="Destination" value={d.destination} disabled={disabled} error={destinationError} helper="Use the destination key agreed for this monthly account." onChange={value=>onChange('destination',value)}/>:<SelectField id="counter-destination" label="Destination" value={d.destination} disabled={blocked} error={destinationError} options={[{value:'',label:waiting?'Loading destinations…':unavailable?'Rates need attention':'Choose destination'},...(missingDestination?[{value:d.destination,label:d.destination+' · not in current rates'}]:[]),...destinations.map(value=>({value,label:value.replaceAll('_',' ')}))]} onChange={value=>{workflow.change('serviceOptionId','');onChange('destination',value);if(!source.value?.rules.some(rule=>rule.destination_key===value&&rule.service===d.service))onChange('service','');}}/>}
      {afterDestination}
      {beforeService}
      {!asCards&&<SelectField id="counter-service" label="Service" value={compact&&!d.destination?d.service:serviceValue} disabled={disabled||!compact&&!manual&&(blocked||!d.destination||missingDestination)} error={serviceError} helper={state.additionalParcels.length ? "Applies to every parcel in this booking." : undefined} options={[{value:'',label:waiting?'Loading services…':!d.destination?'Choose destination first':'Choose service'},...(compact&&!d.destination?services:allowed),...named.map(s=>({value:'option:'+s.id,label:s.name}))]} onChange={chooseOption}/>}
      {afterFields}
    </div>
    {asCards&&<PriceOptions options={priceOptions} value={serviceValue} recommended={recommended} weighed={!!chargeable}
      disabled={disabled} onChange={chooseOption} setupHref="/business/settings?setup=booking"/>}
    {asCards&&serviceError&&<p className="counter-help" role="alert">{serviceError}</p>}
    {waiting&&!compact&&<p role="status">Loading this branch’s destinations and services…</p>}
    {onAddService&&<button type="button" className="btn btn-text" disabled={disabled} onClick={onAddService}>Add a service and its rates</button>}
    {catalog.page.has_more&&<button type="button" className="btn btn-text" disabled={disabled||catalog.phase==='more'} onClick={catalog.loadMore}>Load more services</button>}
    {catalog.phase==='error'&&<p role="status">Saved service options could not be loaded. <button type="button" className="btn btn-text" onClick={catalog.reload}>Retry service options</button></p>}
    {unavailable&&!compact&&<div className="counter-rate-message"><h3>{source.error?.code==='NO_RATE'||noChoices?'Set up booking rates for this branch':source.error?.code==='RATE_CONFLICT'?'Published rates overlap':'Destinations could not be loaded'}</h3><p role="alert">{source.error?.code==='NO_RATE'?'There are no published rates covering today. A branch administrator needs to publish the approved destinations, services and prices before you can book.':noChoices?'The published rate card has no destinations. Ask a branch administrator to check its rules.':source.error?.code==='RATE_CONFLICT'?'More than one rate card covers today. Ask a branch administrator to resolve the overlapping dates.':'Check your connection and retry. If this continues, ask your branch administrator to check access and published rates.'}</p><div className="counter-actions"><Link className="btn btn-outlined" to="/business/settings?setup=booking" target="_blank" rel="noopener noreferrer">Open booking setup · new tab</Link><button type="button" className="btn btn-outlined" disabled={disabled} onClick={source.reload}>Retry destinations</button></div><p className="counter-help">Keep this tab open to retain your booking. After rates are published, return here and retry. Only an authorised administrator can change rates.</p></div>}
    {source.phase==='ready'&&missingDestination&&!manual&&!compact&&<p className="counter-help">This destination is not in the current rate card. Choose a listed destination or check the monthly account’s agreed rates.</p>}
    {!!state.accountId&&<button type="button" className="btn btn-text" disabled={disabled} aria-pressed={manual} onClick={()=>setAccountEntry(value=>!value)}>{manual?'Choose from published destinations':'Use an account-specific destination'}</button>}
  </div>;
}
