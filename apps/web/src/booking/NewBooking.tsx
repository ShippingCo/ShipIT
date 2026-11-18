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
import {createBookingWorkflow,TAX_SETUP_REASON} from './workflow';
import {totalWeight,emptyDraft,validate,draftCode,type Field} from './form';
import {BookingPayment} from './BookingPayment';
import {BookingSaved} from './BookingSaved';
import {ReceiptPanel} from './ReceiptPanel';
import {receiptMoney,printReceiptFor} from '../utils/receipt';
import {useResource} from '../operations/hooks';
import {UnitField,displayUnits} from './UnitField';
import {RateChoices} from './RateChoices';
import {PhoneField} from './PhoneField';
import {Msym} from '../components/m3/Icon';
import {Card} from '../components/m3/Surface';
import {Button,SegmentedControl} from '../components/m3/Button';
import type {CustomerDto} from '@shippingco/shared';
import {useBookingAttachments,BookingAttachments} from './BookingAttachments';
import './counter.css';
import './booking-modal.css';
import './booking-form.css';
import {ParcelEntry} from './ParcelEntry';
import {WeightField,ParcelSize} from './WeightField';
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
  // A shop that has never configured GST cannot complete any booking: tax is refused and the
  // counter used to divert every press to a draft without saying so. The obstacle belongs on
  // the screen before the button is pressed, and it is fixed in Settings, not here.
  const taxSetupMissing=gst.phase==='ready'&&!(gst.value?.mode&&gst.value?.supplier_state);
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
  // Paise recorded against this booking from this screen, so the confirmation can say "Collected".
  const [paidPaise,setPaidPaise]=useState(0);
  const [printState,setPrintState]=useState<'idle'|'loading'|'error'>('idle');
  // How many copies of this booking's receipt have left this screen. The first is the
  // original; every one after it is marked on the document itself, with no way to suppress it.
  const printed=useRef(0);
  const [printMessage,setPrintMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  // A field says what is wrong with it as soon as the operator leaves it, not after Save.
  // Only fields that have been visited and hold something are judged: an empty field is
  // "not filled in yet", which the summary's list already covers without nagging.
  const [touched,setTouched]=useState<ReadonlySet<Field>>(()=>new Set());
  const touch=(field:Field)=>setTouched(previous=>previous.has(field)?previous:new Set(previous).add(field));
  const arrived=useRef(false);
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
  // A new booking starts with the cursor in the first field, so the operator can type the
  // phone number straight away. After a save the confirmation's heading takes focus instead,
  // and it is brought into view because the page is usually scrolled far down by then.
  useEffect(()=>{
    const first=!arrived.current;arrived.current=true;
    if(first&&!state.booking&&!state.entry&&!requestedCustomer&&!requestedDraft){
      // One frame later, because on a cold load the shell moves focus to its own title in the
      // same commit and would otherwise take the cursor back out of the field.
      const field=()=>document.getElementById('counter-phone')?.focus({preventScroll:true});
      field();const frame=requestAnimationFrame(field);return()=>cancelAnimationFrame(frame);
    }
    heading.current?.focus();if(state.booking||state.entry)heading.current?.scrollIntoView?.({block:'center'});
  },[state.booking,state.entry,requestedCustomer,requestedDraft]);
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
      const copy=printed.current>0?{duplicate:new Date().toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}:{};
      await printReceiptFor(workflow.api,dto,copy);printed.current+=1;setPrintState('idle');
      setPrintMessage(printed.current>1?'The booking is saved. Copies after the first are marked DUPLICATE on the receipt.':'The booking is saved. You can print another copy if needed.');
    }catch{
      if(!controller.runtime.isCurrent(workflow.api.scope))return;
      setPrintState('error');setPrintMessage('The receipt did not print. The booking is saved either way. Retry printing without creating another booking.');
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
    if(taxSetupMissing&&!workflow.entryPending()){await workflow.saveEntry(TAX_SETUP_REASON);return;}
    // Save booking always means a booking. With something required still missing it marks
    // those fields and moves the cursor to the first one (validateEntry below); it no longer
    // turns the press into a draft. Keeping a draft is its own, quieter action.
    if(workflow.entryPending()){await workflow.saveEntry();return;}
    if(state.bookingPhase==='uncertain'){await workflow.save();if(workflow.snapshot().booking&&d.paymentMode==='paid_counter')setPaymentOpen(true);return;}
    if(!workflow.validateEntry())return;
    setPreparing(true);
    try{
      if(workflow.snapshot().pricingPhase==='uncertain'){await workflow.price();if(workflow.snapshot().pricingPhase!=='ready')return;}
      if(!workflow.snapshot().customer&&!keepTypedCustomer.current){
        const current=workflow.snapshot().draft;
        const result=await workflow.customerApi.search('phone',current.phone,workflow.api.scope.signal);
        if(result.items.length){
          const same=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
          const exact=result.items.filter(item=>same(item.name)===same(current.name));
          const match=exact.length===1?exact[0]:result.items.length===1&&result.items[0].name.trim()===current.name.trim()?result.items[0]:undefined;
          // Never decide this quietly: a saved name that differs by one letter is not evidence
          // that the booking should stop being a booking.
          if(!match){setCustomerChoice(result.items);return;}
          workflow.select(match);
        }
      }
      if(workflow.snapshot().customerPhase!=='ready')await workflow.confirmCustomer();
      // A refusal the operator can fix on this screen — a wrong phone, a used docket, a missing
      // address, no published rate — stays on the form with the field highlighted. It used to be
      // turned into a draft automatically, which cleared the highlight and left the operator on
      // a "Draft saved" page with no idea which field to change.
      if(workflow.snapshot().customerPhase!=='ready')return;
      workflow.recordTaxEntry();
      if(!workflow.snapshot().tax)await workflow.preview();
      if(workflow.snapshot().tax){
        await workflow.save();
        if(workflow.snapshot().booking&&d.paymentMode==='paid_counter')setPaymentOpen(true);
      }
      // Only a tax problem nobody at the counter can fix keeps the work as a draft, with the
      // reason carried onto the draft page.
      else if(['TAX_POLICY_UNAVAILABLE','TAX_CONFLICT'].includes(workflow.snapshot().failureCode??''))await workflow.saveEntry();
    }catch{setLookupError('Customer lookup could not finish. Retry before saving.');}
    finally{setPreparing(false);}
  }
  async function saveDraft(){if(!busy)await workflow.saveEntry();}
  const parcelCount=1+state.additionalParcels.length;
  const packedWeight=displayUnits(totalWeight(d,state.additionalParcels),3);
  const serviceName=state.quote?.service_option?.name??selectedServiceLabel;
  const previewRate=gst.value?.mode==='none'?0:gst.value?.mode==='gta5'?5:gst.value?.mode?18:null;
  const previewTax=state.quote&&previewRate!==null?Math.round(state.quote.subtotal_paise*previewRate/100):null;
  const previewInter=!!gst.value?.supplier_state&&(d.registration==='registered'?d.recipientState:d.handoverState)!==gst.value.supplier_state;
  const displayTax=state.tax??(state.quote&&previewTax!==null?{taxable_basis_paise:state.quote.subtotal_paise,final_payable_paise:state.quote.subtotal_paise+previewTax,components:previewRate===0?[]:previewInter?[{id:'IGST',kind:'IGST',numerator:previewRate!,denominator:100,amount_paise:previewTax}]:[{id:'CGST',kind:'CGST',numerator:previewRate!,denominator:200,amount_paise:Math.ceil(previewTax/2)},{id:'SGST',kind:'SGST',numerator:previewRate!,denominator:200,amount_paise:Math.floor(previewTax/2)}]}:null);
  // What the customer owes right now, and the change against it. Both read the tax
  // calculation rather than recomputing a total here: two places that each work out a total
  // will disagree one day, and this is the figure read aloud across the counter.
  const due=displayTax?displayTax.final_payable_paise:null;
  const changeLine=(()=>{
    if(due===null||!/^[0-9]+$/.test(d.cashGiven))return null;
    const given=Number(d.cashGiven);
    return given>=due?{paise:given-due,short:false}:{paise:due-given,short:true};
  })();
  const live=validate(d,'booking');
  const shown=(field:Field)=>state.errors[field]??(touched.has(field)&&d[field]!==''?live[field]:undefined);
  const sizeErrors={lengthCm:shown('lengthCm'),widthCm:shown('widthCm'),heightCm:shown('heightCm')};
  const formHasError=Object.values(state.errors).some(Boolean)||state.parcelErrors.some(errors=>Object.values(errors).some(Boolean));
  // The counter has two different saves. Which one the button will do must be visible before
  // it is pressed, never discovered afterwards from the wording of a confirmation.
  const needs=state.booking||state.entry?[]:workflow.needs();
  const savedNeeds=state.entry?workflow.needs():[];
  const retrying=uncertain||state.bookingPhase==='uncertain';
  const draftOnly=needs.length>0||taxSetupMissing;
  // A price is on its way: either the request is out, or everything it needs has just been
  // typed and the request is about to go. Saying so beats a dash that looks like "no price".
  const pricing=!state.quote&&(state.pricingPhase==='loading'||needs.length===0&&state.pricingPhase==='editing'&&!state.booking);
  const statusError=formHasError||['error','uncertain','stale'].some(phase=>[state.customerPhase,state.pricingPhase,state.taxPhase,state.bookingPhase].some(value=>value===phase));
  if(state.recoveryBlocked)return <section className="counter-section"><h1>Booking recovery required</h1><p role="alert">An earlier request may have saved. Check Bookings and Receipts before creating a replacement.</p><Link to="/business/bookings">Open Bookings</Link><Link to="/business/receipts">Open Receipts</Link></section>;
  if(state.entry)return <section className="booking-saved counter-draft-saved">
    <span className="saved-mark" aria-hidden="true"><Msym name="draft"/></span>
    <h1 ref={heading} tabIndex={-1} className="saved-title">Draft saved</h1>
    <p role="status" className="saved-lede">This is <strong>not a booking yet</strong>. No docket was created, so the parcel cannot be dispatched.</p>
    <p className="saved-field-label">Draft number <span className="ops-mono saved-docket-value">{draftCode(state.entry.id)}</span></p>
    {state.entryReason&&<p role="alert" className="counter-draft-reason"><Msym name="info"/><span>{state.entryReason}</span></p>}
    {savedNeeds.length>0&&<p>Still needed: <strong>{savedNeeds.join(', ')}</strong>.</p>}
    {d.docket&&<p>You typed docket {d.docket}. It is only written on the draft; no parcel carries it yet.</p>}
    {attachments.count>0&&<p role="alert">Your selected files are still on this device and have not been attached.</p>}
    <div className="saved-actions">
      {taxSetupMissing
        ?<Link className="btn btn-filled" to="/business/settings">Open Settings</Link>
        :<button type="button" className="btn btn-filled" onClick={()=>workflow.reopenDraft()}>Finish this booking</button>}
      <Link className="btn btn-outlined" to="/business/bookings?filter=drafts">View drafts</Link>
      <button type="button" className="btn btn-text" onClick={()=>{attachments.clear();startAnother();}}>Start another booking</button>
    </div>
  </section>;
  return <div className="booking-counter-page booking-original">
    {/* One heading, always visible. The counter used to hide this header until a booking was
        saved, leaving the busiest screen in the product with no title at all and a second,
        sight-hidden h1 standing in for it. */}
    <header className={'booking-page-heading'+(state.booking?' booking-page-heading-quiet':'')}>
      {/* Only one heading on the page. Once a booking is saved the confirmation below
          owns it — it already states the verdict at 30px, and repeating those words here
          with a sentence under them was the worst of the stacked subtext in the product. */}
      {!state.booking&&<div><h1 ref={heading} tabIndex={-1}>New booking</h1></div>}
      <button type="button" className="btn btn-text" onClick={close}>{state.booking?'Back to bookings':'Discard draft'}</button>
    </header>
    {!state.booking&&<p className="counter-help workspace-visually-hidden" id="booking-optional-fields">A booking needs a docket number, a weight, a destination and a price. Without them you can still save a draft and finish it later.</p>}
    {closeBlocked&&<p role="alert" className="booking-inline-note">Finish or retry the current request before closing this booking.</p>}
    {state.booking?<div className="booking-saved-content">
      <BookingSaved
        cancelled={cancelled}
        figures={{
          dockets:state.booking.parcels.map(parcel=>parcel.docket),
          total:receiptMoney(state.booking.charges.tax.final_payable_paise),
          outstanding:receiptMoney(Math.max(0,state.booking.payment_obligation.outstanding_paise-paidPaise)),
          settled:state.booking.payment_obligation.outstanding_paise-paidPaise<=0,
          toPay:d.paymentMode==='to_pay',
          ...(state.booking.account?{billedTo:{name:state.booking.account.debtor.name,due:state.booking.account.due_date}}:{}),
        }}
        /* The heading already says "Booking saved"; repeating the workflow's identical line under the
           actions read as a second, weaker confirmation. Anything else it reports is still shown. */
        message={cancelled?'This booking is no longer available for intake or dispatch.':state.message==='Booking saved.'?'':state.message}
        printState={printState}
        printMessage={printMessage}
        busy={busy||attachments.pending||uncertain}
        canCancel={canCancel}
        headingRef={heading}
        onPrint={()=>void printSaved()}
        onRecordMoney={()=>setPaymentOpen(true)}
        onStartAnother={()=>{lot.reset();startAnother();}}
        onCancelBooking={()=>setCancelling(true)}
        paymentsHref={'/business/money-receipts?'+new URLSearchParams({customer_id:state.booking.account?.debtor.source_customer_id??state.booking.customer.source_customer_id,booking_id:state.booking.id,context:d.paymentMode})}/>
      {lot.result}
      <BookingAttachments queue={attachments}/>
      {paymentOpen&&!cancelled&&<BookingPayment controller={controller} booking={state.booking} onPendingChange={setPaymentPending}
        onRecorded={applied=>setPaidPaise(value=>value+applied)}
        {...(d.paymentMode==='paid_counter'&&!state.booking.account&&(d.method==='cash'||d.method==='upi')?{auto:{method:d.method}}:{})}/>}
      <ReceiptPanel controller={controller} api={workflow.api} bookingId={state.booking.id}/>
    </div>:<div className="page"><form aria-label="New booking" aria-describedby="booking-optional-fields" noValidate onSubmit={event=>event.preventDefault()}
      onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save();}}}>
      <div className="booking-layout">
        <div className="bk-form">
          <Card pad className="bk-section" role="group" aria-labelledby="bk-customer">
            <h2 className="form-sec-title" id="bk-customer"><Msym name="person"/>Customer</h2>
            <div className="form-grid">
              <PhoneField compact helper="" id="counter-phone" label="WhatsApp number" value={d.phone} disabled={disabled} error={shown('phone')} placeholder="98765 43210" onBlur={()=>{touch('phone');void lookupCustomer();}} onChange={value=>{if(state.customer)workflow.newCustomer();workflow.change('phone',value);setRepeat([]);setLookupError('');keepTypedCustomer.current=false;}}/>
              <TextField id="counter-name" label="Customer name" value={d.name} disabled={disabled} error={shown('name')} autoComplete="name" onBlur={()=>touch('name')} onChange={value=>workflow.change('name',value)}/>
            </div>
            {repeat.map(customer=><button key={customer.id} type="button" className="recall" disabled={disabled} onClick={()=>{workflow.select(customer);workflow.useLatestCustomer();setRepeat([]);setLookupError('');}}><Msym name="history"/><span className="u-grow"><b>{customer.name}</b> · {customer.phone_display} — fill it in</span><Msym name="arrow_forward"/></button>)}
            {lookupError&&<p role="alert" className="bk-note is-error">{lookupError} <button type="button" className="btn btn-text" disabled={disabled} onClick={()=>void lookupCustomer()}>Retry customer lookup</button></p>}
            {requestedCustomer&&linkedCustomer.phase==='error'&&<p role="alert" className="bk-note is-error">The selected customer could not be loaded. <button type="button" className="btn btn-text" onClick={linkedCustomer.reload}>Retry selected customer</button></p>}
          </Card>
          <RateChoices compact workflow={workflow} onServiceLabel={setSelectedServiceLabel} disabled={disabled} destinationError={shown('destination')} serviceError={state.errors.service} onChange={workflow.change} onDestinationBlur={()=>touch('destination')} render={rate=><>
          <Card pad className="bk-section" role="group" aria-labelledby="bk-delivery">
            <h2 className="form-sec-title" id="bk-delivery"><Msym name="pin_drop"/>Delivery</h2>
            <div className="form-grid bk-grid-delivery">
              {rate.destination}
              <TextField id="counter-recipientAddress" label="Delivery address" className="is-optional" value={d.recipientAddress} disabled={disabled} error={shown('recipientAddress')} autoComplete="off" placeholder="Building, street and area" onBlur={()=>touch('recipientAddress')} onChange={value=>workflow.change('recipientAddress',value)}/>
            </div>
          </Card>
          <Card pad className="bk-section" role="group" aria-labelledby="bk-parcel">
            <h2 className="form-sec-title" id="bk-parcel"><Msym name="inventory_2"/>Parcel{parcelCount>1&&<span className="bk-count">1 of {parcelCount}</span>}</h2>
            <div className="form-grid bk-grid-parcel">
              <TextField id="counter-docket" label="Docket number" value={d.docket} disabled={disabled} error={shown('docket')} className="mono" maxLength={32} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} helper="Copy it from your paper receipt book" onBlur={()=>touch('docket')} onChange={value=>workflow.change('docket',value.toUpperCase())}/>
              <WeightField id="counter-weight" label="Weight" value={d.weight} unit={d.weightUnit} disabled={disabled} error={shown('weight')} onBlur={()=>touch('weight')}
                onChange={value=>workflow.change('weight',value)} onUnit={value=>workflow.change('weightUnit',value)}/>
              <ParcelSize parcel={d} disabled={disabled} errors={{...state.errors,...sizeErrors}} idFor={field=>'counter-'+field} labelFor={side=>side}
                onBlur={()=>{touch('lengthCm');touch('widthCm');touch('heightCm');}} onChange={(field,value)=>workflow.change(field,value)}/>
              <UnitField id="counter-declaredValue" label="Declared goods value ₹" places={2} value={d.declaredValue} disabled={disabled} error={shown('declaredValue')} className="is-optional" helper={Number(d.declaredValue)>=5000000?'E-way bill likely needed':undefined} onBlur={()=>touch('declaredValue')} onChange={value=>workflow.change('declaredValue',value)}/>
              {lot.picker}
            </div>
            {state.additionalParcels.map((parcel,index)=><ParcelEntry key={parcel.localKey} number={index+2} parcel={parcel} earlier={[d,...state.additionalParcels.slice(0,index)]} copyReceiver={sourceNumber=>workflow.copyReceiver(index,sourceNumber)} errors={state.parcelErrors[index]??{}} disabled={disabled} onRemove={()=>workflow.removeParcel(index)} onChange={(key,value)=>workflow.changeParcel(index,key,value)}/>)}
            <div className="attach-slot"><span className="field-legend is-optional">Proof of parcel</span><BookingAttachments compact queue={attachments} disabled={disabled}/></div>
            <div className="booking-add-package"><Button type="button" variant="outlined" icon="add" disabled={disabled||parcelCount>=50} onClick={()=>workflow.addParcel()}>Add package</Button><span className="counter-help" role="status">{parcelCount} {parcelCount===1?'package':'packages'} in this booking{parcelCount>=50?' · Maximum reached':''}</span></div>
          </Card>
          <Card pad className="bk-section" role="group" aria-labelledby="bk-charges">
            <h2 className="form-sec-title" id="bk-charges"><Msym name="currency_rupee"/>Charges</h2>
            <div className="form-grid bk-service">{rate.service}</div>
            {rate.prices}
            {rate.notices}
            <div className="form-grid">
              <UnitField id="counter-override" label="Freight ₹" places={2} value={d.override||(state.quote?String(state.quote.freight_paise):'')} disabled={disabled} error={shown('override')} onBlur={()=>touch('override')} onChange={value=>workflow.change('override',value)}/>
              <UnitField id="counter-packing" label="Packing ₹" className="is-optional" places={2} value={d.packing||(state.quote?String(state.quote.packing_paise):'')} disabled={disabled} error={shown('packing')} onBlur={()=>touch('packing')} onChange={value=>{const freight=d.override||(state.quote?String(state.quote.freight_paise):'');workflow.change('override',freight);workflow.change('packing',value);}}/>
            </div>
            {state.quote?.rate_version_id&&d.override===''&&<p className="bk-note"><Msym name="sell"/>From your rate card. Type over either amount to change it for this booking.</p>}
            {state.quote?.rate_version_id&&d.override!==''&&Math.abs(Number(d.override)-state.quote.freight_suggestion_paise)>=1000&&<button type="button" className="recall" disabled={disabled} onClick={()=>{workflow.change('override','');workflow.change('packing','');}}><Msym name="auto_fix_high"/><span className="u-grow">Usual rate for {d.destination.replaceAll('_',' ')} at {packedWeight} kg is <b>{receiptMoney(state.quote.freight_suggestion_paise)}</b> — use it</span><Msym name="arrow_forward"/></button>}
            {/* How the money arrived, not merely whether it did. The counter used to record
                every paid booking as cash, because the method was fixed at load and never
                asked for — so a UPI payment entered the cashbook as notes in the drawer and
                the day would not reconcile. Three choices, because a booking is only ever
                paid at the counter or collected on delivery. */}
            <div className="pay-choice"><span className="field-legend" id="counter-pay-legend">Payment</span>
              <SegmentedControl label="Payment" options={[{value:'cash',label:'Cash now'},{value:'upi',label:'UPI now'},{value:'to_pay',label:'To Pay'}]}
                value={d.paymentMode==='to_pay'?'to_pay':d.method==='upi'?'upi':'cash'}
                onChange={value=>{
                  if(disabled)return;
                  workflow.change('paymentMode',value==='to_pay'?'to_pay':'paid_counter');
                  if(value!=='to_pay')workflow.change('method',value);
                  if(value!=='cash')workflow.change('cashGiven','');
                }}/>
              <p className="counter-help">{d.paymentMode==='to_pay'?'The receiver pays when the parcel is delivered. Nothing is collected now.':d.method==='upi'?'The customer pays by UPI at the counter now.':'The customer pays in cash at the counter now.'}</p>
            </div>
            {/* Optional, and never in the way. The most asked-for thing at the counter is the
                arithmetic the operator does in their head while a customer waits with a note in
                their hand. Short payment is legitimate — part payment happens — so a shortfall
                is named rather than blocked. */}
            {d.paymentMode==='paid_counter'&&d.method==='cash'&&due!==null&&<div className="pay-change">
              <UnitField id="counter-cashGiven" label="Cash given ₹" className="is-optional" places={2} value={d.cashGiven} disabled={disabled}
                onChange={value=>workflow.change('cashGiven',value)}/>
              {changeLine&&<p className={'pay-change-out'+(changeLine.short?' is-short':'')} role="status" aria-live="polite">
                {changeLine.short
                  ?<>Short by <b>{receiptMoney(changeLine.paise)}</b>. Saving is still allowed — record what was actually taken.</>
                  :<>Change to give back: <b>{receiptMoney(changeLine.paise)}</b></>}
              </p>}
            </div>}
          </Card>
          </>}/>
        </div>
        <aside className="booking-side" aria-label="Booking summary"><Card pad className="bk-summary">
          <h2 className="sum-head">Booking summary</h2>
          <dl className="sum-list">
            <div><dt>Docket</dt><dd className="mono">{d.docket||'—'}</dd></div>
            <div><dt>To</dt><dd>{d.destination.replaceAll('_',' ')||'—'}</dd></div>
            <div><dt>Service</dt><dd>{serviceName||'—'}</dd></div>
            {parcelCount>1&&<div><dt>Packages</dt><dd>{parcelCount}</dd></div>}
            {packedWeight&&<div><dt>Billed weight</dt><dd>{packedWeight} kg</dd></div>}
          </dl>
          <dl className="sum-list bk-money" aria-busy={pricing||undefined}>
            <div><dt>Freight</dt><dd>{state.quote?receiptMoney(state.quote.freight_paise):'—'}</dd></div>
            <div><dt>Packing</dt><dd>{state.quote?receiptMoney(state.quote.packing_paise):'—'}</dd></div>
            <div><dt>Taxable</dt><dd>{displayTax?receiptMoney(displayTax.taxable_basis_paise):'—'}</dd></div>
            {displayTax?.components.map(component=><div key={component.id}><dt>{component.kind} {100*component.numerator/component.denominator}%</dt><dd>{receiptMoney(component.amount_paise)}</dd></div>)}
          </dl>
          <div className="sum-total"><span>Total</span><strong>{displayTax?receiptMoney(displayTax.final_payable_paise):pricing?<span className="bk-calc">Calculating…</span>:'—'}</strong></div>
          <p className={'bk-payline'+(d.paymentMode==='to_pay'?' is-later':'')}><Msym name={d.paymentMode==='to_pay'?'local_shipping':'payments'}/><span>{d.paymentMode==='to_pay'?'Receiver pays on delivery':d.method==='upi'?'Customer pays now by UPI':'Customer pays now in cash'}</span></p>
          <div className="bk-action" data-total={displayTax?receiptMoney(displayTax.final_payable_paise):undefined}>
            <Button type="button" icon={taxSetupMissing&&!retrying?'draft':'check'} size="lg" block loading={busy} disabled={busy} className="sum-cta" aria-keyshortcuts="Control+Enter Meta+Enter" onClick={()=>void save()}>{state.bookingPhase==='uncertain'?'Retry same booking':uncertain?'Retry booking request':taxSetupMissing?'Save as draft'
              :d.paymentMode==='paid_counter'&&due!==null?'Save booking and collect '+receiptMoney(due):'Save booking'}</Button>
          </div>
          {state.message&&<p role={statusError?'alert':'status'} className="booking-status">{state.message}</p>}
          {taxSetupMissing&&!retrying&&<p className="booking-needs" id="booking-needs">
            <Msym name="info"/><span>No booking can be completed yet. <strong>{TAX_SETUP_REASON}</strong> Until then, saving keeps a draft — no docket is created. <Link to="/business/settings">Open Settings</Link></span>
          </p>}
          <div className="bk-secondary">
            {/* An unfinished booking can still be parked. It is a quiet second action, shown only
                while something required is missing, so it never competes with Save booking. */}
            {draftOnly&&!taxSetupMissing&&!retrying&&<Button type="button" variant="text" disabled={busy} onClick={()=>void saveDraft()}>Save as draft</Button>}
            <Button type="button" variant="text" disabled={busy||uncertain} onClick={close}>Discard this draft</Button>
          </div>
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
        <button type="button" className="btn btn-text" onClick={()=>setCustomerChoice(null)}>Keep editing</button>
      </div>
    </Dialog>
    <Dialog open={exitPrompt} title={state.booking?'Leave the saved booking?':'Discard this booking draft?'} onClose={()=>setExitPrompt(false)}>
      <p>{state.booking?'Some selected files are not attached. Leaving clears the remaining local files.':'The unsaved booking and selected files will be cleared. Any customer already created remains saved.'}</p>
      <div className="counter-actions"><button type="button" className="btn btn-filled" onClick={()=>setExitPrompt(false)}>Keep editing</button><button type="button" className="btn btn-outlined" onClick={()=>{attachments.clear();navigate(exitDestination.current);}}>{state.booking?'Leave saved booking':'Discard booking draft'}</button></div>
    </Dialog>
  </div>;
}
