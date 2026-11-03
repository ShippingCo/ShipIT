import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {canAdminister} from '@shippingco/shared';
import {CancelBooking} from '../operations/CancelBooking';
import {Dialog} from '../components/m3/Dialog';
import {TextField,SelectField} from '../components/m3/Input';
import {createApiClient} from '../data-access/api-client';
import {ApiFailure} from '../data-access/errors';
import {createAttachmentClient} from '../data-access/attachments';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {receipts} from '../data-access/receipts';
import type {ScopeController} from '../operator/scope';
import {createBookingWorkflow} from './workflow';
import {totalWeight,emptyDraft,parcelErrors,additionalParcelErrors,type Field} from './form';
import {CustomerLookup} from './CustomerLookup';
import {AccountSelection} from './AccountSelection';
import {BookingPayment} from './BookingPayment';
import {ReceiptPanel} from './ReceiptPanel';
import {receiptMoney,printReceipt} from '../utils/receipt';
import {useResource} from '../operations/hooks';
import {UnitField,displayUnits} from './UnitField';
import {RateChoices} from './RateChoices';
import {BookingServiceSetup} from './BookingServiceSetup';
import {PhoneField} from './PhoneField';
import {Msym} from '../components/m3/Icon';
import {formatKolkata} from '../operations/format';
import {useBookingAttachments,BookingAttachments} from './BookingAttachments';
import './counter.css';
import './booking-modal.css';
import {ParcelEntry} from './ParcelEntry';
import {useBookingLotAssignment} from './BookingLotAssignment';
const stateOptions = [{ value: '', label: 'Not supplied' }, ...[
  ['02','Himachal Pradesh'],['03','Punjab'],['05','Uttarakhand'],['06','Haryana'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['32','Kerala'],['33','Tamil Nadu'],['36','Telangana'],['37','Andhra Pradesh'],
].map(([value, label]) => ({ value, label }))];
export default function NewBooking({controller}:{controller:ScopeController}) {
  const [serial,setSerial]=useState(0);
  return <BookingForm key={serial} controller={controller} startAnother={()=>setSerial(value=>value+1)}/>;
}

function BookingForm({controller,startAnother}:{controller:ScopeController;startAnother:()=>void}) {
  const [workflow]=useState(()=>createBookingWorkflow(controller));
  const state=useSyncExternalStore(workflow.subscribe,workflow.snapshot);
  const d=state.draft;
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const requestedCustomer=params.get('customer_id');
  const [exitPrompt,setExitPrompt]=useState(false);
  const exitDestination=useRef('/business/bookings');
  const [closeBlocked,setCloseBlocked]=useState(false);
  const [serviceSetup,setServiceSetup]=useState(false);
  const [serviceBusy,setServiceBusy]=useState(false);
  const [rateRefresh,setRateRefresh]=useState(0);
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
  const printRequested=useRef(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const linkedCustomer=useResource(requestedCustomer??'',signal=>{
    if(!requestedCustomer)return Promise.resolve(null);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestedCustomer))return Promise.reject(new ApiFailure('VALIDATION_FAILED'));
    return workflow.customerApi.read(requestedCustomer,signal);
  });
  useEffect(()=>{if(linkedCustomer.phase==='ready'&&linkedCustomer.value)workflow.select(linkedCustomer.value);},[linkedCustomer.phase,linkedCustomer.value,workflow]);
  useEffect(()=>{workflow.activate();return()=>workflow.dispose();},[workflow]);
  const disabled=workflow.locked()||!!requestedCustomer&&linkedCustomer.phase==='loading';
  const lot=useBookingLotAssignment(workflow.api,state.booking,d.destination,disabled);
  const attachmentClient=useMemo(()=>state.booking?createAttachmentClient(controller.runtime,state.booking.id,{
    async request<T>(path:string,options?:Parameters<ReturnType<typeof createApiClient>['request']>[1]):Promise<T>{
      try{return await createApiClient().request<T>(path,options);}
      catch(error){if(controller.runtime.isCurrent(workflow.api.scope)&&error instanceof ApiFailure&&error.code==='UNAUTHENTICATED')controller.clear('signed_out');throw error;}
    },
  }):null,[state.booking,controller,workflow]);
  const attachments=useBookingAttachments({runtime:controller.runtime,client:attachmentClient});
  const uncertain=[state.bookingPhase,state.customerPhase,state.pricingPhase,state.taxPhase,state.creditPhase].includes('uncertain');
  const retained=state.creditPhase==='loading'||state.creditPhase==='uncertain'||paymentPending||serviceBusy||lot.busy;
  useEffect(()=>retained?retainAccountNavigation(workflow.api.scope,()=>setCloseBlocked(true)):undefined,[retained,workflow]);
  const original=emptyDraft();
  const dirty=(Object.keys(original) as Field[]).some(field=>original[field]!==d[field])||state.additionalParcels.length>0||attachments.count>0;
  const busy=state.busy||attachments.uploading||paymentPending||serviceBusy||lot.busy||printState==='loading';
  useEffect(()=>{
    if(!dirty||state.booking||uncertain||retained)return;
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
  },[dirty,state.booking,uncertain,retained,busy]);
  useEffect(()=>{
    const prevent=(event:BeforeUnloadEvent)=>{if(busy||uncertain||dirty&&!state.booking){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',prevent);
    return()=>window.removeEventListener('beforeunload',prevent);
  },[busy,uncertain,dirty,state.booking]);
  useEffect(()=>{heading.current?.focus();},[state.booking]);
  useEffect(()=>{
    const snapshot=workflow.snapshot();
    const first=(Object.keys(snapshot.errors) as Field[]).find(key=>!!snapshot.errors[key]);
    const index=snapshot.parcelErrors.findIndex(errors=>Object.values(errors).some(Boolean));
    const extra=index>=0?Object.keys(snapshot.parcelErrors[index]).find(key=>snapshot.parcelErrors[index][key as Field]):undefined;
    if(!first&&!extra)return;
    const key=first==='recipientRef'?'evidenceRef':first;
    const frame=requestAnimationFrame(()=>{
      const element=document.getElementById(key?'counter-'+key:'counter-package-'+index+'-'+extra);
      element?.closest('details')?.setAttribute('open','');
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
      printReceipt(dto);setPrintState('idle');setPrintMessage('The booking is saved. You can print another copy if needed.');
    }catch{
      if(!controller.runtime.isCurrent(workflow.api.scope))return;
      setPrintState('error');setPrintMessage('Booking saved. The receipt could not be printed. Retry printing without creating another booking.');
    }
  },[workflow,printState,controller]);
  useEffect(()=>{if(state.booking&&printRequested.current){printRequested.current=false;void printSaved();}},[state.booking,printSaved]);
  async function save(print:boolean){
    if(busy)return;
    if(state.bookingPhase!=='uncertain')printRequested.current=print;
    await workflow.save();
    if(!workflow.snapshot().booking&&workflow.snapshot().bookingPhase!=='uncertain')printRequested.current=false;
  }
  const field=(key:Field,label:string,helper?:string)=><TextField id={'counter-'+key} label={label} value={d[key]} disabled={disabled} error={state.errors[key]} helper={helper} maxLength={key==='name'?120:key==='address'?500:key==='gstin'?15:undefined} required={key!=='address'} onChange={value=>workflow.change(key,value)}/>;
  const select=(key:Field,label:string,options:{value:string;label:string}[])=><SelectField id={'counter-'+key} label={label} value={d[key]} disabled={disabled} error={state.errors[key]} onChange={value=>workflow.change(key,value)} options={options}/>;
  const parcelCount=1+state.additionalParcels.length;
  const packedWeight=displayUnits(totalWeight(d,state.additionalParcels),3);
  const serviceName=state.quote?.service_option?.name??selectedServiceLabel;
  const customerReady=state.customerPhase==='ready';
  const parcelReady=!!serviceName&&!!packedWeight&&[parcelErrors(d),...additionalParcelErrors(d,state.additionalParcels)].every(errors=>Object.keys(errors).length===0);
  const sectionReady=[customerReady,parcelReady,!!state.tax];
  const formHasError=Object.values(state.errors).some(Boolean)||state.parcelErrors.some(errors=>Object.values(errors).some(Boolean));
  const statusError=formHasError||['error','uncertain','stale'].some(phase=>[state.customerPhase,state.pricingPhase,state.taxPhase,state.bookingPhase].some(value=>value===phase));
  if(state.recoveryBlocked)return <section className="counter-section"><h1>Booking recovery required</h1><p role="alert">An earlier request may have saved. Check Receipts and ask your administrator to reconcile it before creating a replacement.</p><Link to="/business/receipts">Open Receipts</Link></section>;
  return <div className="booking-counter-page">
    <header className="booking-page-heading">
      <div><h1 ref={heading} tabIndex={-1}>{state.booking?(cancelled?'Booking cancelled':'Booking saved'):'New booking'}</h1>
      {state.booking&&<p>{cancelled?'All packages in this booking are cancelled.':'Your dockets are ready.'}</p>}</div>
      <button type="button" className="btn btn-text" onClick={close}>{state.booking?'Back to bookings':'Discard draft'}</button>
    </header>
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
    </div>:<form aria-label="New booking" noValidate onSubmit={event=>event.preventDefault()} className="booking-layout">
      <div className="booking-entry">
        <nav aria-label="Booking sections" className="booking-section-links jrn">{['Customer','Parcel','Charges'].map((name,index)=>
          <div key={name} className="jrn-step" data-state={sectionReady[index]?'done':index===sectionReady.findIndex(ready=>!ready)?'active':'todo'}>
            <button type="button" aria-label={name+' section'+(sectionReady[index]?', complete':'')} onClick={()=>document.getElementById('booking-section-'+index)?.focus()}>
              <span className="jrn-node" aria-hidden="true"><Msym name={sectionReady[index]?'check':['person','inventory_2','currency_rupee'][index]}/></span><span className="jrn-lbl">{name}</span>
            </button>{index<2&&<span className="jrn-link" aria-hidden="true"/>}
          </div>
        )}</nav>
        <section aria-labelledby="booking-section-0">
          <h2 id="booking-section-0" tabIndex={-1} className="form-sec-title">Customer</h2>
          {requestedCustomer&&linkedCustomer.phase==='loading'&&<p role="status">Loading the selected customer…</p>}
          {requestedCustomer&&linkedCustomer.phase==='error'&&<p role="alert">The selected customer could not be loaded in this workspace. <button type="button" className="btn btn-text" onClick={linkedCustomer.reload}>Retry selected customer</button></p>}
          {state.customer&&<div className="booking-selected"><div><strong>{state.customer.name}</strong><p>{state.customer.phone_display}</p></div>
            <button type="button" className="btn btn-text" disabled={disabled} onClick={()=>workflow.newCustomer()}>Change</button>
          </div>}
          <div>
            <div className="counter-grid"><PhoneField compact id="counter-phone" label="WhatsApp number" value={d.phone} disabled={disabled} error={state.errors.phone} onChange={value=>workflow.change('phone',value)}/>{field('name','Customer name')}</div>

          </div>
          <div className="booking-delivery-address">
            <TextField id="counter-recipientAddress" label="Delivery address" value={d.recipientAddress} disabled={disabled} error={state.errors.recipientAddress} required maxLength={500} autoComplete="shipping street-address" onChange={value=>workflow.change('recipientAddress',value)}/>
            <div className="counter-grid booking-location-grid">{field('recipientPin','PIN code')}{field('recipientCity','City')}{field('recipientRegion','State / region')}</div>
            <details className="booking-paperwork"><summary>Receiver name and phone (optional)</summary><div className="counter-grid">
              <TextField id="counter-recipientName" label="Recipient name" value={d.recipientName} disabled={disabled} error={state.errors.recipientName} maxLength={120} onChange={value=>workflow.change('recipientName',value)}/>
              <PhoneField compact id="counter-recipientPhone" label="Recipient phone" value={d.recipientPhone} disabled={disabled} error={state.errors.recipientPhone} onChange={value=>workflow.change('recipientPhone',value)}/>
            </div></details>
          </div>
          <div className="booking-customer-tools">
            <details className="booking-paperwork"><summary>Customer contact address (optional)</summary>{field('address','Customer address','Optional shop or contact address.')}</details>
            <div className="counter-actions"><button type="button" className="btn btn-outlined" disabled={state.busy||customerReady||state.bookingPhase==='uncertain'||state.pricingPhase==='uncertain'||state.taxPhase==='uncertain'} onClick={()=>void workflow.confirmCustomer()}>{state.customerPhase==='uncertain'?'Retry same customer request':state.customer?'Save customer changes':'Create customer'}</button>
            {state.customer&&<><button type="button" className="btn btn-text" disabled={disabled} onClick={()=>void workflow.refreshCustomer()}>Refresh customer</button><button type="button" className="btn btn-text" disabled={disabled} onClick={()=>workflow.useLatestCustomer()}>Use latest customer details</button></>}</div>
          </div>
          {customerReady&&<p className="counter-help" role="status">Customer details confirmed.</p>}
          {!state.customer&&<details className="booking-paperwork"><summary>Find an existing customer</summary><CustomerLookup workflow={workflow} disabled={disabled} onAdd={(name,phone)=>{workflow.newCustomer();workflow.change('name',name);workflow.change('phone',phone);}}/></details>}
        </section>
        <section aria-labelledby="booking-section-1">
          <h2 id="booking-section-1" tabIndex={-1} className="form-sec-title">Parcel</h2>
          <ParcelEntry number={1} parcel={d} errors={state.errors} disabled={disabled} onChange={workflow.change} hideReceiver primaryFields={
            <RateChoices workflow={workflow} refreshKey={rateRefresh} onAddService={()=>setServiceSetup(true)} onServiceLabel={setSelectedServiceLabel} disabled={disabled} destinationError={state.errors.destination} serviceError={state.errors.service} onChange={workflow.change}
              beforeDestination={<TextField id="counter-docket" label="Docket number" value={d.docket} disabled={disabled} error={state.errors.docket} required maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} helper="Copy it from your paper receipt book" onChange={value=>workflow.change('docket',value.toUpperCase())}/>}
              beforeService={<UnitField id="counter-weight" label="Weight (kg)" places={3} value={d.weight} disabled={disabled} error={state.errors.weight} required onChange={value=>workflow.change('weight',value)}/>}
              afterFields={<><UnitField id="counter-declaredValue" label="Declared goods value (₹)" places={2} value={d.declaredValue} disabled={disabled} error={state.errors.declaredValue} helper="Optional — used for e-way bill checks" onChange={value=>workflow.change('declaredValue',value)}/>{lot.picker}</>}/>
          }/>
          {state.additionalParcels.map((parcel,index)=><ParcelEntry key={parcel.localKey} number={index+2} parcel={parcel} earlier={[d,...state.additionalParcels.slice(0,index)]} copyReceiver={sourceNumber=>workflow.copyReceiver(index,sourceNumber)} errors={state.parcelErrors[index]??{}} disabled={disabled} onRemove={()=>workflow.removeParcel(index)} onChange={(key,value)=>workflow.changeParcel(index,key,value)}/>)}
          <button type="button" className="btn btn-outlined" disabled={disabled||parcelCount>=50} onClick={()=>workflow.addParcel()}><Msym name="add"/>Add package</button>
          <p className="counter-help">One booking, one docket per package. {parcelCount} of 50 packages.</p>
          <div className="attach-slot"><span className="field-legend">Proof of parcel</span><BookingAttachments queue={attachments} disabled={disabled}/></div>
        </section>
        <section aria-labelledby="booking-section-2">
          <h2 id="booking-section-2" tabIndex={-1} className="form-sec-title">Charges</h2>
          <AccountSelection key={state.customer?.id??'none'} workflow={workflow} disabled={disabled}/>
          <div className="counter-grid">
            <TextField label="Packing ₹" value={state.quote?displayUnits(String(state.quote.packing_paise),2):''} readOnly placeholder="From published rate" helper="Calculated from your service rate." onChange={()=>{}}/>
            <UnitField id="counter-override" label="Freight ₹" places={2} value={d.override|| (state.quote?String(state.quote.freight_paise):'')} disabled={disabled} error={state.errors.override} placeholder="From published rate" helper="Leave blank to use the service rate." onChange={value=>workflow.change('override',value)}/>
          </div>
          {d.override&&select('reason','Override reason',[{value:'customer_agreement',label:'Customer agreement'},{value:'service_recovery',label:'Service recovery'},{value:'commercial_exception',label:'Commercial exception'}])}
          <fieldset className="pay-choice booking-payment"><legend className="field-legend">Payment</legend><div className="seg" role="group" aria-label="Payment choice">
            {[{value:'paid_counter',label:'Paid now'},{value:'to_pay',label:'To Pay'}].map(choice=><button key={choice.value} type="button" className={'seg-btn'+(d.paymentMode===choice.value?' on':'')} aria-pressed={d.paymentMode===choice.value} disabled={disabled} onClick={()=>workflow.change('paymentMode',choice.value)}><Msym name="check"/>{choice.label}</button>)}
          </div></fieldset>
          {d.paymentMode==='paid_counter'&&<div className="counter-grid">{select('method','Payment method',[{value:'',label:'Choose method'},{value:'cash',label:'Cash'},{value:'upi',label:'UPI'}])}</div>}
          {d.paymentMode==='paid_counter'&&<p className="counter-help">After saving, record the amount received. This choice alone does not mark the booking as paid.</p>}
          <h3>Details for the bill</h3>
          <div className="counter-grid">{select('registration','GST registration',[{value:'unregistered',label:'Not GST registered'},{value:'registered',label:'GST registered'}])}{select('handoverState','Parcel handed over in',stateOptions)}
            {d.registration==='registered'&&<>{select('recipientState','Billing state',stateOptions)}{field('gstin','GSTIN')}</>}</div>
          <label className="booking-check"><input id="counter-evidenceRef" type="checkbox" disabled={disabled||!customerReady} checked={d.evidenceRef==='COUNTER_DECLARATION'} aria-describedby={!customerReady?'booking-customer-required':undefined} onChange={event=>workflow.confirmTaxFacts(event.target.checked)}/>I checked these billing and handover details with the customer.</label>
          {!customerReady&&<p id="booking-customer-required" className="counter-help">Select or create the customer before confirming the bill.</p>}
          {(state.errors.evidenceRef||state.errors.recipientRef)&&<p className="operator-error">Confirm the customer and billing details before calculating the price.</p>}
          <button type="button" className="btn btn-outlined" disabled={state.busy||state.bookingPhase==='uncertain'||state.customerPhase==='uncertain'} onClick={()=>void workflow.preview()}>{state.pricingPhase==='uncertain'||state.taxPhase==='uncertain'?'Retry same price and tax request':'Calculate booking price'}</button>
        </section>
      </div>
      <aside className="card booking-side booking-summary" aria-label="Booking summary">
        <div className="booking-summary-head"><h2>Booking summary</h2></div>
        <dl className="sum-list booking-shipment-facts">
          {d.name && <div><dt>Customer</dt><dd>{d.name||'—'}</dd></div>}
          <div><dt>Destination</dt><dd>{d.destination.replaceAll('_',' ')||'—'}</dd></div>
          <div><dt>Service</dt><dd>{serviceName||'—'}</dd></div>
          <div><dt>Parcels</dt><dd>{parcelCount}{packedWeight?' · '+packedWeight+' kg':''}</dd></div>
          {[d,...state.additionalParcels].map((parcel,index)=><div key={index}><dt>{parcelCount===1?'Docket':'Docket '+(index+1)}</dt><dd>{parcel.docket.trim().toUpperCase()||'—'}{parcelCount>1&&parcel.recipientName?' · '+parcel.recipientName:''}</dd></div>)}
          {state.accountId && <div><dt>Bill to</dt><dd>{state.accountId?state.accountName:d.name||'—'}</dd></div>}
          </dl>
        <dl className="sum-list booking-price-breakdown">
          <div><dt>Packing</dt><dd>{state.quote?receiptMoney(state.quote.packing_paise):'—'}</dd></div>
          <div><dt>Freight</dt><dd>{state.quote?receiptMoney(state.quote.freight_paise):'—'}</dd></div>
          {state.tax&&<><div><dt>CGST</dt><dd>{receiptMoney(state.tax.cgst_paise)}</dd></div><div><dt>SGST</dt><dd>{receiptMoney(state.tax.sgst_paise)}</dd></div><div><dt>IGST</dt><dd>{receiptMoney(state.tax.igst_paise)}</dd></div></>}
          {state.tax&&state.tax.rounding_adjustment_paise!==0&&<div><dt>Rounding</dt><dd>{receiptMoney(state.tax.rounding_adjustment_paise)}</dd></div>}
        </dl>
        <div className="booking-price-display" data-priced={!!state.tax}>
          <p className="sum-total">{state.tax?'Total payable '+receiptMoney(state.tax.final_payable_paise):'Total payable —'}</p>
          <p className="counter-help">{state.quote&&state.tax?'Price valid until '+formatKolkata(state.quote.expires_at)+'.':'Calculate the price to review freight, packing and GST.'}</p>
        </div>
        <p className="booking-payment-choice"><Msym name="account_balance_wallet"/>{d.paymentMode==='to_pay'?'To Pay':'Record collection after saving'}</p>
        <button type="button" className="btn btn-filled" disabled={state.busy||state.customerPhase==='uncertain'||state.pricingPhase==='uncertain'||state.taxPhase==='uncertain'||state.creditPhase==='uncertain'} onClick={()=>void save(false)}><Msym name="check"/>{state.bookingPhase==='uncertain'?'Retry same booking':'Save booking'}</button>
        <button type="button" className="btn btn-outlined" disabled={busy||uncertain} onClick={()=>void save(true)}><Msym name="print"/>Save and print</button>
        {state.message&&<p role={statusError?'alert':'status'} className="booking-status">{state.message}</p>}
      </aside>
    </form>}
    {cancelling&&state.booking&&<CancelBooking api={workflow.api} bookingId={state.booking.id} docket={state.booking.parcels[0].docket} close={()=>setCancelling(false)} refresh={()=>{}} onConfirmed={()=>setCancelled(true)} canReviewCharges={roles.includes('operator')||roles.includes('accountant')||canAdminister(roles,'bookings.cancel')}/>}
    <Dialog open={serviceSetup} title="Add a service" onClose={()=>{if(serviceBusy)setCloseBlocked(true);else setServiceSetup(false);}} size="lg">
      {serviceSetup&&<BookingServiceSetup controller={controller} destination={d.destination} onBusyChange={setServiceBusy} onCancel={()=>setServiceSetup(false)} onSaved={option=>{
        workflow.change('destination',option.destination_key);workflow.change('service',option.service);workflow.change('serviceOptionId',option.id);setRateRefresh(value=>value+1);setServiceBusy(false);setServiceSetup(false);
      }}/>}
    </Dialog>
    <Dialog open={exitPrompt} title={state.booking?'Leave the saved booking?':'Discard this booking draft?'} onClose={()=>setExitPrompt(false)}>
      <p>{state.booking?'Some selected files are not attached. Leaving clears the remaining local files.':'The unsaved booking and selected files will be cleared. Any customer already created remains saved.'}</p>
      <div className="counter-actions"><button type="button" className="btn btn-filled" onClick={()=>setExitPrompt(false)}>Keep editing</button><button type="button" className="btn btn-outlined" onClick={()=>{attachments.clear();navigate(exitDestination.current);}}>{state.booking?'Leave saved booking':'Discard booking draft'}</button></div>
    </Dialog>
  </div>;
}
