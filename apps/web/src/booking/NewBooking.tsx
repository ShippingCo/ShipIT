import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {canAdminister} from '@shippingco/shared';
import {CancelBooking} from '../operations/CancelBooking';
import {Dialog} from '../components/m3/Dialog';
import {TextField} from '../components/m3/Input';
import {createApiClient} from '../data-access/api-client';
import {ApiFailure} from '../data-access/errors';
import {createAttachmentClient} from '../data-access/attachments';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {receipts} from '../data-access/receipts';
import type {ScopeController} from '../operator/scope';
import {createBookingWorkflow} from './workflow';
import {totalWeight,emptyDraft,parcelErrors,additionalParcelErrors,draftCode,type Field} from './form';
import {BookingPayment} from './BookingPayment';
import {ReceiptPanel} from './ReceiptPanel';
import {receiptMoney,printReceiptFor} from '../utils/receipt';
import {useResource} from '../operations/hooks';
import {UnitField,displayUnits} from './UnitField';
import {RateChoices} from './RateChoices';
import {PhoneField} from './PhoneField';
import {Msym} from '../components/m3/Icon';
import {Card} from '../components/m3/Surface';
import {Button,SegmentedControl} from '../components/m3/Button';
import {StepTrack} from '../components/m3/StepTrack';
import type {CustomerDto} from '@shippingco/shared';
import {useBookingAttachments,BookingAttachments} from './BookingAttachments';
import './counter.css';
import './booking-modal.css';
import {ParcelEntry} from './ParcelEntry';
import {useBookingLotAssignment} from './BookingLotAssignment';
import {businessGstDto,businessGstPath} from '../data-access/business-gst';
export default function NewBooking({controller}:{controller:ScopeController}) {
  const [serial,setSerial]=useState(0);
  return <BookingForm key={serial} controller={controller} startAnother={()=>setSerial(value=>value+1)}/>;
}

function BookingForm({controller,startAnother}:{controller:ScopeController;startAnother:()=>void}) {
  const [workflow]=useState(()=>{const w=createBookingWorkflow(controller);w.change('weight','1000');w.change('paymentMode','paid_counter');w.change('method','cash');return w;});
  const [repeat,setRepeat]=useState<CustomerDto[]>([]);
  // A phone that already belongs to a saved customer used to end the booking silently as a
  // draft. Only the operator can say whether it is the same person, so ask them.
  const [customerChoice,setCustomerChoice]=useState<CustomerDto[]|null>(null);
  const keepTypedCustomer=useRef(false);
  const [lookupError,setLookupError]=useState('');
  const lookup=useRef<AbortController>();
  const [preparing,setPreparing]=useState(false);
  const state=useSyncExternalStore(workflow.subscribe,workflow.snapshot);
  const d=state.draft;
  const gst=useResource(workflow.api.franchise+'gst',signal=>workflow.api.read(businessGstPath(workflow.api),businessGstDto,signal));
  useEffect(()=>{if(gst.value?.supplier_state&&!workflow.snapshot().draft.handoverState)workflow.change('handoverState',gst.value.supplier_state);},[gst.value,workflow]);
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const requestedCustomer=params.get('customer_id');
  const requestedDraft=params.get('draft');
  const [exitPrompt,setExitPrompt]=useState(false);
  const exitDestination=useRef('/business/bookings');
  const [closeBlocked,setCloseBlocked]=useState(false);
  const [selectedServiceLabel,setSelectedServiceLabel]=useState('');
  const [cancelling,setCancelling]=useState(false);
  const [cancelled,setCancelled]=useState(false);
  const context=controller.snapshot().context;
  const roles=context?.franchises.find(f=>f.id===context.active_franchise_id)?.roles??[];
  const canCancel=roles.includes('operator')||canAdminister(roles,'bookings.cancel');
  const [paymentOpen,setPaymentOpen]=useState(false);
  const [paymentPending,setPaymentPending]=useState(false);
  const [printState,setPrintState]=useState<'idle'|'loading'|'error'>('idle');
  const [printMessage,setPrintMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  const linkedCustomer=useResource(requestedCustomer??'',signal=>{
    if(!requestedCustomer)return Promise.resolve(null);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestedCustomer))return Promise.reject(new ApiFailure('VALIDATION_FAILED'));
    return workflow.customerApi.read(requestedCustomer,signal);
  });
  useEffect(()=>{if(linkedCustomer.phase==='ready'&&linkedCustomer.value)workflow.select(linkedCustomer.value);},[linkedCustomer.phase,linkedCustomer.value,workflow]);
  // Opening a draft from the Drafts list restores exactly what was typed, once.
  const restoredDraft=useRef('');
  const savedDraft=useResource(requestedDraft??'',signal=>{
    if(!requestedDraft)return Promise.resolve(null);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestedDraft))return Promise.reject(new ApiFailure('VALIDATION_FAILED'));
    return workflow.entryApi.list(signal).then(page=>page.items.find(item=>item.id===requestedDraft)??Promise.reject(new ApiFailure('RESOURCE_NOT_FOUND')));
  });
  useEffect(()=>{
    if(savedDraft.phase!=='ready'||!savedDraft.value||restoredDraft.current===savedDraft.value.id)return;
    restoredDraft.current=savedDraft.value.id;
    workflow.restoreDraft(savedDraft.value.data.fields,savedDraft.value.data.additional_parcels);
  },[savedDraft.phase,savedDraft.value,workflow]);
  useEffect(()=>{workflow.activate();return()=>workflow.dispose();},[workflow]);
  const disabled=preparing||workflow.locked()||!!requestedCustomer&&linkedCustomer.phase==='loading'||!!requestedDraft&&savedDraft.phase==='loading';
  const lot=useBookingLotAssignment(workflow.api,state.booking,d.destination,disabled);
  const attachmentClient=useMemo(()=>state.booking?createAttachmentClient(controller.runtime,state.booking.id,{
    async request<T>(path:string,options?:Parameters<ReturnType<typeof createApiClient>['request']>[1]):Promise<T>{
      try{return await createApiClient().request<T>(path,options);}
      catch(error){if(controller.runtime.isCurrent(workflow.api.scope)&&error instanceof ApiFailure&&error.code==='UNAUTHENTICATED')controller.clear('signed_out');throw error;}
    },
  }):null,[state.booking,controller,workflow]);
  const attachments=useBookingAttachments({runtime:controller.runtime,client:attachmentClient});
  const uncertain=[state.bookingPhase,state.customerPhase,state.pricingPhase,state.taxPhase,state.creditPhase].includes('uncertain');
  const retained=state.creditPhase==='loading'||state.creditPhase==='uncertain'||paymentPending||lot.busy;
  useEffect(()=>retained?retainAccountNavigation(workflow.api.scope,()=>setCloseBlocked(true)):undefined,[retained,workflow]);
  const original={...emptyDraft(),weight:'1000',paymentMode:'paid_counter',method:'cash',handoverState:gst.value?.supplier_state??''};
  const dirty=(Object.keys(original) as Field[]).some(field=>original[field]!==d[field])||state.additionalParcels.length>0||attachments.count>0;
  const busy=preparing||state.busy||attachments.uploading||paymentPending||lot.busy||printState==='loading';
  useEffect(()=>{
    if(!dirty||state.booking||state.entry||uncertain||retained)return;
    const guardLink=(event:MouseEvent)=>{
      if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
      if(!link||link.target&&link.target!=='_self'||link.origin!==window.location.origin||!link.hash.startsWith('#/')||link.hash===window.location.hash)return;
      event.preventDefault();event.stopPropagation();
      if(busy){setCloseBlocked(true);return;}
      exitDestination.current=link.hash.slice(1);
      setExitPrompt(true);
    };
    document.addEventListener('click',guardLink,true);
    return()=>document.removeEventListener('click',guardLink,true);
  },[dirty,state.booking,state.entry,uncertain,retained,busy]);
  useEffect(()=>{
    const prevent=(event:BeforeUnloadEvent)=>{if(busy||uncertain||dirty&&!state.booking&&!state.entry){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',prevent);
    return()=>window.removeEventListener('beforeunload',prevent);
  },[busy,uncertain,dirty,state.booking,state.entry]);
  useEffect(()=>{heading.current?.focus();},[state.booking,state.entry]);
  useEffect(()=>{
    const snapshot=workflow.snapshot();
    const first=(Object.keys(snapshot.errors) as Field[]).find(key=>!!snapshot.errors[key]);
    const index=snapshot.parcelErrors.findIndex(errors=>Object.values(errors).some(Boolean));
    const extra=index>=0?Object.keys(snapshot.parcelErrors[index]).find(key=>snapshot.parcelErrors[index][key as Field]):undefined;
    if(!first&&!extra)return;
    const key=first==='recipientRef'||first==='evidenceRef'?'handoverState':first;
    const frame=requestAnimationFrame(()=>{
      const element=document.getElementById(key?'counter-'+key:'counter-package-'+index+'-'+extra);
      element?.focus();
    });
    return()=>cancelAnimationFrame(frame);
  },[state.validationAttempt,workflow]);

  function close(){
    exitDestination.current='/business/bookings';
    if(busy||uncertain){setCloseBlocked(true);return;}
    if(dirty&&!state.booking||state.booking&&attachments.pending){setExitPrompt(true);return;}
    navigate('/business/bookings');
  }
  const printSaved=useCallback(async()=>{
    const booking=workflow.snapshot().booking;
    if(!booking||printState==='loading')return;
    setPrintState('loading');setPrintMessage('Loading the issued receipt…');
    try{
      const dto=await receipts(workflow.api).booking(booking.id);
      if(!controller.runtime.isCurrent(workflow.api.scope))return;
      await printReceiptFor(workflow.api,dto);setPrintState('idle');setPrintMessage('The booking is saved. You can print another copy if needed.');
    }catch{
      if(!controller.runtime.isCurrent(workflow.api.scope))return;
      setPrintState('error');setPrintMessage('Booking saved. The receipt could not be printed. Retry printing without creating another booking.');
    }
  },[workflow,printState,controller]);
  async function lookupCustomer(){
    lookup.current?.abort();const abort=new AbortController();lookup.current=abort;
    const phone=workflow.snapshot().draft.phone;
    if(!/^\+[1-9][0-9]{7,14}$/.test(phone.replace(/[ -]/g,'')))return;
    try{const result=await workflow.customerApi.search('phone',phone,abort.signal);
      if(!abort.signal.aborted&&workflow.snapshot().draft.phone===phone){setRepeat(result.items);setLookupError('');}
    }catch{if(!abort.signal.aborted)setLookupError('Customer lookup could not finish. Retry before saving.');}
  }
  useEffect(()=>()=>lookup.current?.abort(),[]);
  const priceKey=JSON.stringify([d.destination,d.service,d.serviceOptionId,d.weight,d.override,d.packing,state.additionalParcels.map(p=>p.weight),state.accountId]);
  useEffect(()=>{
    if(state.booking||preparing)return;
    const timer=window.setTimeout(()=>{void workflow.price();},500);
    return()=>window.clearTimeout(timer);
  },[priceKey,workflow,state.booking,preparing]);
  async function save(){
    if(busy)return;
    if(workflow.entryPending()||workflow.requiresEntry()){await workflow.saveEntry();return;}
    if(state.bookingPhase==='uncertain'){await workflow.save();if(workflow.snapshot().booking&&d.paymentMode==='paid_counter')setPaymentOpen(true);return;}
    if(!workflow.validateEntry())return;
    setPreparing(true);
    try{
      if(workflow.snapshot().pricingPhase==='uncertain'){await workflow.price();if(workflow.snapshot().pricingPhase!=='ready')return;}
      if(!workflow.snapshot().customer&&!keepTypedCustomer.current){
        const current=workflow.snapshot().draft;
        const result=await workflow.customerApi.search('phone',current.phone,workflow.api.scope.signal);
        if(result.items.length){
          const match=result.items.length===1&&result.items[0].name.trim()===current.name.trim()?result.items[0]:undefined;
          // Never decide this quietly: a saved name that differs by one letter is not evidence
          // that the booking should stop being a booking.
          if(!match){setCustomerChoice(result.items);return;}
          workflow.select(match);
        }
      }
      if(workflow.snapshot().customerPhase!=='ready')await workflow.confirmCustomer();
      if(workflow.snapshot().customerPhase!=='ready'){
        if(workflow.snapshot().failureCode==='VALIDATION_FAILED')await workflow.saveEntry();
        return;
      }
      workflow.recordTaxEntry();
      if(!workflow.snapshot().tax)await workflow.preview();
      if(workflow.snapshot().tax){
        await workflow.save();
        if(workflow.snapshot().booking&&d.paymentMode==='paid_counter')setPaymentOpen(true);
        else if(['VALIDATION_FAILED','DOCKET_CONFLICT'].includes(workflow.snapshot().failureCode??''))await workflow.saveEntry();
      }
      else if(Object.values(workflow.snapshot().errors).some(Boolean)||['NO_RATE','TAX_POLICY_UNAVAILABLE','TAX_CONFLICT','VALIDATION_FAILED'].includes(workflow.snapshot().failureCode??''))await workflow.saveEntry();
    }catch{setLookupError('Customer lookup could not finish. Retry before saving.');}
    finally{setPreparing(false);}
  }
  const parcelCount=1+state.additionalParcels.length;
  const packedWeight=displayUnits(totalWeight(d,state.additionalParcels),3);
  const serviceName=state.quote?.service_option?.name??selectedServiceLabel;
  const previewRate=gst.value?.mode==='none'?0:gst.value?.mode==='gta5'?5:gst.value?.mode?18:null;
  const previewTax=state.quote&&previewRate!==null?Math.round(state.quote.subtotal_paise*previewRate/100):null;
  const previewInter=!!gst.value?.supplier_state&&(d.registration==='registered'?d.recipientState:d.handoverState)!==gst.value.supplier_state;
  const displayTax=state.tax??(state.quote&&previewTax!==null?{taxable_basis_paise:state.quote.subtotal_paise,final_payable_paise:state.quote.subtotal_paise+previewTax,components:previewRate===0?[]:previewInter?[{id:'IGST',kind:'IGST',numerator:previewRate!,denominator:100,amount_paise:previewTax}]:[{id:'CGST',kind:'CGST',numerator:previewRate!,denominator:200,amount_paise:Math.ceil(previewTax/2)},{id:'SGST',kind:'SGST',numerator:previewRate!,denominator:200,amount_paise:Math.floor(previewTax/2)}]}:null);
  const parcelReady=!!serviceName&&!!packedWeight&&[parcelErrors(d),...additionalParcelErrors(d,state.additionalParcels)].every(errors=>Object.keys(errors).length===0);
  const sectionReady=[!!d.name&&!!d.phone&&!!d.destination,parcelReady,!!state.quote];
  const formHasError=Object.values(state.errors).some(Boolean)||state.parcelErrors.some(errors=>Object.values(errors).some(Boolean));
  // The counter has two different saves. Which one the button will do must be visible before
  // it is pressed, never discovered afterwards from the wording of a confirmation.
  const needs=state.booking||state.entry?[]:workflow.needs();
  const savedNeeds=state.entry?workflow.needs():[];
  const retrying=uncertain||state.bookingPhase==='uncertain';
  const draftOnly=needs.length>0;
  const statusError=formHasError||['error','uncertain','stale'].some(phase=>[state.customerPhase,state.pricingPhase,state.taxPhase,state.bookingPhase].some(value=>value===phase));
  if(state.recoveryBlocked)return <section className="counter-section"><h1>Booking recovery required</h1><p role="alert">An earlier request may have saved. Check Bookings and Receipts before creating a replacement.</p><Link to="/business/bookings">Open Bookings</Link><Link to="/business/receipts">Open Receipts</Link></section>;
  if(state.entry)return <section className="counter-section counter-confirmation counter-draft-saved">
    <span className="counter-draft-mark" aria-hidden="true"><Msym name="draft"/></span>
    <h1 ref={heading} tabIndex={-1}>Draft saved</h1>
    <p role="status" className="t-title-md">This is <strong>not a booking yet</strong>. No docket was created and the parcel cannot be dispatched.</p>
    <p>Draft number <span className="ops-mono counter-draft-code">{draftCode(state.entry.id)}</span></p>
    {savedNeeds.length>0&&<p>Still needed: <strong>{savedNeeds.join(', ')}</strong>.</p>}
    {d.docket&&<p>You typed docket {d.docket}. It is only written on the draft; no parcel carries it yet.</p>}
    {attachments.count>0&&<p role="alert">Your selected files are still on this device and have not been attached.</p>}
    <div className="counter-actions">
      <button type="button" className="btn btn-filled" onClick={()=>workflow.reopenDraft()}>Finish this booking</button>
      <Link className="btn btn-outlined" to="/business/bookings?filter=drafts">View drafts</Link>
      <button type="button" className="btn btn-text" onClick={()=>{attachments.clear();startAnother();}}>Start another booking</button>
    </div>
  </section>;
  return <div className="booking-counter-page booking-original">
    {!state.booking&&<h1 className="workspace-visually-hidden">New booking</h1>}
    <header className="booking-page-heading" hidden={!state.booking}>
      <div><h1 ref={heading} tabIndex={-1}>{state.booking?(cancelled?'Booking cancelled':'Booking saved'):'New booking'}</h1>
      {state.booking&&<p>{cancelled?'All packages in this booking are cancelled.':'Your dockets are ready.'}</p>}</div>
      <button type="button" className="btn btn-text" onClick={close}>{state.booking?'Back to bookings':'Discard draft'}</button>
    </header>
    {!state.booking&&<p className="counter-help" id="booking-optional-fields">A booking needs a docket number, a weight, a destination and a price. Without them you can still save a draft and finish it later.</p>}
    {closeBlocked&&<p role="alert" className="booking-inline-note">Finish or retry the current request before closing this booking.</p>}
    {state.booking?<div className="booking-saved-content">
      <section className="counter-confirmation">
        <span className="counter-confirmation-mark" aria-hidden="true"><Msym name="check"/></span>
        <h2>{cancelled?'Booking cancelled':'Ready for the next parcel'}</h2><p>{state.booking.parcels.map(parcel=>parcel.docket).join(', ')}</p>
        <p className="t-headline-sm">Booked total {receiptMoney(state.booking.charges.tax.final_payable_paise)}</p>
        <p>Outstanding {receiptMoney(state.booking.payment_obligation.outstanding_paise)} at booking confirmation</p>
        <p role="status">{cancelled?'This booking is no longer available for intake or dispatch.':state.message}</p>
        {state.booking.account&&<p>Bill to {state.booking.account.debtor.name} · Due {state.booking.account.due_date}</p>}
        {!cancelled&&<><p>{d.paymentMode==='to_pay'?'To Pay: no collection was recorded.':'Record the money received next. Choosing a payment method does not record a payment.'}</p>
        <button type="button" className="btn btn-filled" disabled={cancelled} onClick={()=>setPaymentOpen(true)}>Record received money</button>
        <Link className="btn btn-text" to={'/business/money-receipts?'+new URLSearchParams({customer_id:state.booking.account?.debtor.source_customer_id??state.booking.customer.source_customer_id,booking_id:state.booking.id,context:d.paymentMode})}>Open payments / apply advance</Link></>}
        <div className="counter-actions">
          <button type="button" className="btn btn-outlined" disabled={printState==='loading'} onClick={()=>void printSaved()}>{printState==='error'?'Retry printing':printState==='loading'?'Loading receipt…':'Print booking receipt'}</button>
          <button type="button" className="btn btn-text" disabled={busy||attachments.pending} onClick={()=>{lot.reset();startAnother();}}>Start another booking</button>
          <Link to="/business/receipts">Open Receipts</Link>
          {canCancel&&!cancelled&&<button type="button" className="btn btn-text" disabled={busy||uncertain} onClick={()=>setCancelling(true)}>Cancel saved booking</button>}
        </div>
        {printMessage&&<p role={printState==='error'?'alert':'status'}>{printMessage}</p>}
      </section>
      {lot.result}
      <BookingAttachments queue={attachments}/>
      {paymentOpen&&!cancelled&&<BookingPayment controller={controller} booking={state.booking} onPendingChange={setPaymentPending}/>}
      <ReceiptPanel controller={controller} api={workflow.api} bookingId={state.booking.id}/>
    </div>:<div className="page"><form aria-label="New booking" aria-describedby="booking-optional-fields" noValidate onSubmit={event=>event.preventDefault()}>
      <div className="booking-layout">
        <div><Card pad>
          <div className="jrn-wrap"><StepTrack steps={['Customer','Parcel','Charges'].map((label,index)=>({key:label,label,icon:['person','inventory_2','currency_rupee'][index],done:sectionReady[index]}))}/></div>
          <h2 className="form-sec-title">Customer</h2>
          <div className="form-grid">
            <PhoneField compact helper="" id="counter-phone" label="WhatsApp number" value={d.phone} disabled={disabled} error={state.errors.phone} onBlur={()=>void lookupCustomer()} onChange={value=>{if(state.customer)workflow.newCustomer();workflow.change('phone',value);setRepeat([]);setLookupError('');keepTypedCustomer.current=false;}}/>
            <TextField id="counter-name" label="Customer name" value={d.name} disabled={disabled} error={state.errors.name} autoComplete="name" onChange={value=>workflow.change('name',value)}/>
            <TextField id="counter-recipientAddress" label="Delivery address" value={d.recipientAddress} disabled={disabled} error={state.errors.recipientAddress} autoComplete="street-address" className="span2" onChange={value=>workflow.change('recipientAddress',value)}/>
          </div>
          {repeat.map(customer=><button key={customer.id} type="button" className="recall" disabled={disabled} onClick={()=>{workflow.select(customer);workflow.useLatestCustomer();setRepeat([]);setLookupError('');}}><Msym name="history"/><span className="u-grow"><b>{customer.name}</b> · {customer.phone_display} — fill it in</span><Msym name="arrow_forward"/></button>)}
          {lookupError&&<p role="alert">{lookupError} <button type="button" className="btn btn-text" disabled={disabled} onClick={()=>void lookupCustomer()}>Retry customer lookup</button></p>}
          {requestedCustomer&&linkedCustomer.phase==='error'&&<p role="alert">The selected customer could not be loaded. <button type="button" onClick={linkedCustomer.reload}>Retry selected customer</button></p>}
          <hr className="divider form-rule"/>
          <h2 className="form-sec-title">Parcel</h2>
          <RateChoices compact workflow={workflow} onServiceLabel={setSelectedServiceLabel} disabled={disabled} destinationError={state.errors.destination} serviceError={state.errors.service} onChange={workflow.change}
            beforeDestination={<TextField id="counter-docket" label="Docket number" value={d.docket} disabled={disabled} error={state.errors.docket} className="mono" maxLength={32} autoCapitalize="characters" autoCorrect="off" spellCheck={false} helper="Copy it from your paper receipt book" onChange={value=>workflow.change('docket',value.toUpperCase())}/>}
            afterDestination={<div className="span2 booking-add-package"><Button type="button" variant="outlined" icon="add" disabled={disabled||parcelCount>=50} onClick={()=>workflow.addParcel()}>Add package</Button><span className="counter-help" role="status">{parcelCount} {parcelCount===1?'package':'packages'} in this booking{parcelCount>=50?' · Maximum reached':''}</span></div>}
            beforeService={<UnitField id="counter-weight" label="Weight (kg)" places={3} value={d.weight} disabled={disabled} error={state.errors.weight} onChange={value=>workflow.change('weight',value)}/>}
            afterFields={<><UnitField id="counter-declaredValue" label="Declared goods value ₹" places={2} value={d.declaredValue} disabled={disabled} error={state.errors.declaredValue} helper={Number(d.declaredValue)>=5000000?'E-way bill likely needed':'Optional — used for e-way bill checks'} onChange={value=>workflow.change('declaredValue',value)}/>{lot.picker}</>}/>
          {state.additionalParcels.map((parcel,index)=><ParcelEntry key={parcel.localKey} number={index+2} parcel={parcel} earlier={[d,...state.additionalParcels.slice(0,index)]} copyReceiver={sourceNumber=>workflow.copyReceiver(index,sourceNumber)} errors={state.parcelErrors[index]??{}} disabled={disabled} onRemove={()=>workflow.removeParcel(index)} onChange={(key,value)=>workflow.changeParcel(index,key,value)}/>)}
          <div className="attach-slot"><span className="field-legend">Proof of parcel</span><BookingAttachments compact queue={attachments} disabled={disabled}/></div>
          <hr className="divider form-rule"/>
          <h2 className="form-sec-title">Charges</h2>
          <div className="form-grid">
            <UnitField id="counter-packing" label="Packing ₹" places={2} value={d.packing||(state.quote?String(state.quote.packing_paise):'')} disabled={disabled} error={state.errors.packing} onChange={value=>{const freight=d.override||(state.quote?String(state.quote.freight_paise):'');workflow.change('override',freight);workflow.change('packing',value);}}/>
            <UnitField id="counter-override" label="Freight ₹" places={2} value={d.override||(state.quote?String(state.quote.freight_paise):'')} disabled={disabled} error={state.errors.override} onChange={value=>workflow.change('override',value)}/>
          </div>
          {state.quote?.rate_version_id&&d.override!==''&&Math.abs(Number(d.override)-state.quote.freight_suggestion_paise)>=1000&&<button type="button" className="recall" disabled={disabled} onClick={()=>{workflow.change('override','');workflow.change('packing','');}}><Msym name="auto_fix_high"/><span className="u-grow">Usual rate for {d.destination.replaceAll('_',' ')} at {packedWeight} kg is <b>{receiptMoney(state.quote.freight_suggestion_paise)}</b> — use it</span><Msym name="arrow_forward"/></button>}
          <div className="pay-choice"><span className="field-legend">Payment</span><SegmentedControl options={[{value:'paid_counter',label:'Paid now'},{value:'to_pay',label:'To Pay'}]} value={d.paymentMode} onChange={value=>{if(!disabled)workflow.change('paymentMode',value);}}/></div>

        </Card></div>
        <aside className="booking-side" aria-label="Booking summary"><Card pad>
          <h2 className="sum-head">Booking summary</h2>
          <dl className="sum-list">
            <div><dt>Docket</dt><dd className="mono">{d.docket||'—'}</dd></div>
            <div><dt>To</dt><dd>{d.destination.replaceAll('_',' ')||'—'}</dd></div>
            <div><dt>Service</dt><dd>{serviceName||'Standard'}</dd></div>
            {parcelCount>1&&<div><dt>Packages</dt><dd>{parcelCount}</dd></div>}
            <div><dt>Packing</dt><dd>{state.quote?receiptMoney(state.quote.packing_paise):'—'}</dd></div>
            <div><dt>Freight</dt><dd>{state.quote?receiptMoney(state.quote.freight_paise):'—'}</dd></div>
            <div><dt>Taxable</dt><dd>{displayTax?receiptMoney(displayTax.taxable_basis_paise):'—'}</dd></div>
            {displayTax?.components.map(component=><div key={component.id}><dt>{component.kind} {100*component.numerator/component.denominator}%</dt><dd>{receiptMoney(component.amount_paise)}</dd></div>)}
          </dl>
          <div className="sum-total"><span>Total</span><strong>{displayTax?receiptMoney(displayTax.final_payable_paise):'—'}</strong></div>
          <span className={'pill '+(d.paymentMode==='to_pay'?'pill-warn':'st-delivered')+' sum-pay'}>{d.paymentMode==='to_pay'?'Collect on delivery':'Paid now'}</span>
          <Button type="button" icon={retrying?'check':draftOnly?'draft':'check'} size="lg" block loading={busy} disabled={busy} className="sum-cta" onClick={()=>void save()}>{state.bookingPhase==='uncertain'?'Retry same booking':uncertain?'Retry booking request':draftOnly?'Save as draft':'Save booking'}</Button>
          {draftOnly&&!retrying&&<p className="booking-needs" id="booking-needs">
            <Msym name="info"/><span>This cannot be booked yet. <strong>Needs: {needs.join(', ')}.</strong> Saving keeps a draft you can finish later — no docket is created.</span>
          </p>}
          <Button type="button" variant="text" icon="close" block disabled={busy||uncertain} onClick={close}>Cancel booking</Button>

          {state.message&&<p role={statusError?'alert':'status'} className="booking-status">{state.message}</p>}
        </Card></aside>
      </div>
    </form></div>}
    {cancelling&&state.booking&&<CancelBooking api={workflow.api} bookingId={state.booking.id} docket={state.booking.parcels[0].docket} close={()=>setCancelling(false)} refresh={()=>{}} onConfirmed={()=>setCancelled(true)} canReviewCharges={roles.includes('operator')||roles.includes('accountant')||canAdminister(roles,'bookings.cancel')}/>}
    <Dialog open={!!customerChoice} title="Is this the same customer?" onClose={()=>setCustomerChoice(null)}>
      <p>This phone number is already saved{customerChoice&&customerChoice.length>1?' for more than one customer':' under a different name'}. Choose the right one so the booking is linked to it.</p>
      <div className="counter-customer-choice">
        {customerChoice?.map(customer=><button key={customer.id} type="button" className="recall" onClick={()=>{
          workflow.select(customer);setCustomerChoice(null);void save();
        }}><Msym name="history"/><span className="u-grow"><b>{customer.name}</b> · {customer.phone_display}{customer.address?' — '+customer.address:''}</span><Msym name="arrow_forward"/></button>)}
        <button type="button" className="recall" onClick={()=>{
          keepTypedCustomer.current=true;workflow.newCustomer();setCustomerChoice(null);void save();
        }}><Msym name="person_add"/><span className="u-grow">A different person — save <b>{d.name}</b> as a new customer</span><Msym name="arrow_forward"/></button>
      </div>
      <div className="counter-actions">
        <button type="button" className="btn btn-text" onClick={()=>{setCustomerChoice(null);void workflow.saveEntry();}}>Save as a draft instead</button>
        <button type="button" className="btn btn-text" onClick={()=>setCustomerChoice(null)}>Keep editing</button>
      </div>
    </Dialog>
    <Dialog open={exitPrompt} title={state.booking?'Leave the saved booking?':'Discard this booking draft?'} onClose={()=>setExitPrompt(false)}>
      <p>{state.booking?'Some selected files are not attached. Leaving clears the remaining local files.':'The unsaved booking and selected files will be cleared. Any customer already created remains saved.'}</p>
      <div className="counter-actions"><button type="button" className="btn btn-filled" onClick={()=>setExitPrompt(false)}>Keep editing</button><button type="button" className="btn btn-outlined" onClick={()=>{attachments.clear();navigate(exitDestination.current);}}>{state.booking?'Leave saved booking':'Discard booking draft'}</button></div>
    </Dialog>
  </div>;
}
