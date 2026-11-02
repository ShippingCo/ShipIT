import {useEffect,useMemo,useRef,useState} from 'react';

import type {BookingServiceDto,BookingServiceInput} from '@shippingco/shared';

import {canAdminister} from '@shippingco/shared';

import type {ScopeController} from '../operator/scope';

import {scopedApi} from '../data-access/scoped-api';

import {bookingServiceDto} from '../data-access/booking-services';

import {object,uuid,integer,choice,instant} from '../data-access/dto';

import {useResource} from '../operations/hooks';

import {TextField,SelectField} from '../components/m3/Input';

import {policyAmount} from '../operations/BookingPolicySetup';

import type {CommandIntent} from '../data-access/command-intent';

import {ApiFailure,recoveryFor} from '../data-access/errors';

const versionDto=object({id:uuid,version:integer(1),state:choice('draft','published'),effective_from:instant,effective_to:instant});

export interface BookingServiceSetupProps {controller:ScopeController;destination:string;onSaved:(option:BookingServiceDto)=>void;onCancel:()=>void;onBusyChange?:(busy:boolean)=>void}

export function BookingServiceSetup({controller,destination,onSaved,onCancel,onBusyChange}:BookingServiceSetupProps){

 const api=useMemo(()=>scopedApi(controller),[controller]),base=`/api/v1/organizations/${api.organization}/franchises/${api.franchise}/pricing`;

 const current=useResource(base,signal=>api.read(base+'/versions',versionDto,signal));

 const context=controller.snapshot().context,roles=context?.franchises.find(f=>f.id===api.franchise)?.roles??[];

 const permitted=canAdminister(roles,'pricing.publish');

 const [step,setStep]=useState(0),[name,setName]=useState(''),[service,setService]=useState<BookingServiceInput['service']>('standard'),[place,setPlace]=useState(destination.replaceAll('_',' ')),[kind,setKind]=useState<'flat'|'per_kg'>('flat'),[rate,setRate]=useState(''),[extra,setExtra]=useState('0'),[packing,setPacking]=useState('0'),[acceptsLiquids,setAcceptsLiquids]=useState(false),[reviewed,setReviewed]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(false),[progress,setProgress]=useState('');

 const pending=useRef<{intent:CommandIntent;stage:'draft'|'publish'|'service'}|null>(null),draft=useRef<ReturnType<typeof versionDto>|null>(null),frozen=useRef<BookingServiceInput|null>(null),published=useRef(false),savedOption=useRef<BookingServiceDto|null>(null),alive=useRef(true);

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

 useEffect(()=>{onBusyChange?.(busy||retry);},[busy,retry,onBusyChange]);

 const destinationKey=place.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/_+$/,'');

 function input():BookingServiceInput{if(!name.trim()||name.trim().length>80)throw new Error('Enter a service name, up to 80 characters.');if(!/^[A-Z][A-Z0-9_]{0,31}$/.test(destinationKey))throw new Error('Enter a destination name using letters and numbers, up to 32 characters.');return {name:name.trim(),accepts_liquids:acceptsLiquids,service,destination_key:destinationKey,pricing:{kind,first_kg_paise:policyAmount(rate),additional_kg_paise:kind==='per_kg'?policyAmount(extra):0,packing_paise:policyAmount(packing)}};}

 function next(){try{if(step===0){if(!name.trim()||!destinationKey)throw new Error('Enter a service name and destination.');}else input();setError('');setStep(s=>s+1);}catch(e){setError((e as Error).message);}}

 async function save(){if(busy||!permitted||!reviewed)return;setBusy(true);setError('');try{

  const body=frozen.current??input();frozen.current=body;

  // Initial rate-policy creation uses the same durable draft/publication commands as Settings.

  // Future activation respects immutable policy rules; no direct database edits or fabricated IDs.

  if(!current.value&&!published.current){

   if(current.phase!=='error'||current.error?.code!=='NO_RATE')throw new Error('Published rates could not be checked. Retry before saving.');

   if(!draft.current){const from=new Date(Date.now()+15000),to=new Date(from.getTime()+365*86400000);pending.current??={stage:'draft',intent:api.intent('pricing.draft',base+'/versions',{effective_from:from.toISOString(),effective_to:to.toISOString(),quote_validity_seconds:600,override_tolerance_paise:0,approval_ref:'PUBLISHER_REVIEW',source_ref:'MANUAL_ENTRY',rules:[{destination_key:body.destination_key,service:body.service,min_weight_grams:1,max_weight_grams:body.pricing.kind==='per_kg'?1001:null,freight_paise:body.pricing.first_kg_paise,packing_paise:body.pricing.packing_paise}]})};draft.current=await api.execute(pending.current.intent,versionDto);pending.current=null;}

   if(draft.current.state==='draft'){pending.current??={stage:'publish',intent:api.intent('pricing.publish',base+'/versions/'+draft.current.id+'/publish',{expected_version:draft.current.version})};draft.current=await api.execute(pending.current.intent,versionDto);pending.current=null;}published.current=true;

  }

  if(!savedOption.current){pending.current??={stage:'service',intent:api.intent('pricing.service.create',base+'/services',body)};savedOption.current=await api.execute(pending.current.intent,bookingServiceDto);pending.current=null;}

  const result=savedOption.current;

  if(published.current){setProgress('Service saved. Waiting for the first rate card to become active…');let ready=false;for(let attempt=0;attempt<45;attempt++){if(!alive.current||!controller.runtime.isCurrent(api.scope))return;try{await api.read(base+'/versions',versionDto);ready=true;break;}catch(e){if(!(e instanceof ApiFailure)||e.code!=='NO_RATE')throw e;}await new Promise(resolve=>window.setTimeout(resolve,1000));}if(!ready)throw new Error('Service saved, but the first rate card is not active yet. Retry to check it without creating a duplicate.');}

  if(alive.current){setRetry(false);onSaved(result);}

 }catch(e){if(!alive.current)return;const uncertain=!!savedOption.current||e instanceof ApiFailure&&['uncertain','pending','conflict'].includes(recoveryFor(e,true));setRetry(uncertain);if(!uncertain){pending.current=null;frozen.current=null;if(draft.current?.state==='draft'&&e instanceof ApiFailure&&e.code==='RATE_CONFLICT')draft.current=null;}setError(e instanceof ApiFailure?(e.code==='ACTION_FORBIDDEN'?'Only an authorised administrator can publish a service.':e.code==='RATE_CONFLICT'?'A matching service or overlapping policy already exists. Check setup before trying again.':uncertain?'Saving could not be confirmed. Retry the same request; your entered details are kept.':'Service setup could not finish. Check the values and retry.'):(e as Error).message);}finally{if(alive.current)setBusy(false);}}

 const locked=busy||retry;

 if(!permitted)return <section><h2>Add a service</h2><p>An owner or branch administrator can configure services and their prices. Your booking details are kept.</p><button type="button" className="btn btn-outlined" onClick={onCancel}>Return to booking</button></section>;

 return <section className="booking-service-setup" aria-labelledby="service-setup-title"><h2 id="service-setup-title">{['Service details','Set the price','Review service'][step]}</h2><p className="ops-note">Your booking is kept while you set this up.</p>{error&&<p role="alert">{error}</p>}{progress&&<p role="status">{progress}</p>}

 <fieldset disabled={locked}><legend>Step {step+1} of 3</legend>{step===0?<><TextField label="Service name" value={name} onChange={setName} maxLength={80} placeholder="e.g. Local priority"/><TextField label="Destination" value={place} onChange={setPlace} maxLength={32} helper="A city or destination name. Its matching code is managed automatically."/><SelectField label="Service category" value={service} onChange={v=>setService(v as typeof service)} options={[{value:'standard',label:'Standard'},{value:'express',label:'Express'},{value:'same_city',label:'Same city'}]}/><label><input type="checkbox" checked={acceptsLiquids} onChange={e=>setAcceptsLiquids(e.target.checked)}/>Accept liquids and semi-liquids</label><p className="ops-note">Uses this category’s published tax rules. No new tax treatment is assumed.</p></>:step===1?<><SelectField label="How do you charge?" value={kind} onChange={v=>setKind(v as typeof kind)} options={[{value:'flat',label:'Flat charge per booking'},{value:'per_kg',label:'First kg + each additional kg'}]}/><TextField label={kind==='flat'?'Charge per booking (₹)':'First 1 kg (₹)'} inputMode="decimal" value={rate} onChange={setRate}/>{kind==='per_kg'&&<TextField label="Each additional kg (₹)" inputMode="decimal" value={extra} onChange={setExtra} helper="Additional weight rounds up to the next whole kg. Uses all parcels’ combined packed weight."/>}<TextField label="Packing charge (₹)" inputMode="decimal" value={packing} onChange={setPacking}/><p className="ops-note">Prices exclude tax. The server uses the published tax policy.</p></>:<><h3>{name}</h3><p>{place} · {service.replaceAll('_',' ')}</p><p>{kind==='flat'?`₹${rate} per booking`:`₹${rate} for the first kg, then ₹${extra} for each additional kg`} · Packing ₹{packing}</p><p>These prices apply to new bookings. Existing bookings keep their original prices.</p>{!current.value&&<p>A first rate card will also be published: valid for one year, 10-minute quotes and no ordinary price override. It starts a few seconds after publication. A separate published tax policy is required.</p>}<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these prices and the service category.</label></>}</fieldset>

 <div className="counter-actions"><button type="button" className="btn btn-outlined" disabled={locked} onClick={()=>step?setStep(s=>s-1):onCancel()}>{step?'Back':'Return to booking'}</button>{step<2?<button type="button" className="btn btn-filled" onClick={next}>Continue setup</button>:<button type="button" className="btn btn-filled" disabled={busy||!reviewed||current.phase==='loading'} onClick={()=>void save()}>{busy?'Saving service…':retry?'Retry same service request':'Save and use service'}</button>}{step>0&&<button type="button" className="btn btn-text" disabled={locked} onClick={onCancel}>Cancel setup</button>}</div>

 </section>;

}
