import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { TextField, SelectField } from '../components/m3/Input';
import { AttachmentUploader } from '../components/m3/AttachmentUploader';
import { createApiClient } from '../data-access/api-client';
import { ApiFailure } from '../data-access/errors';
import { createAttachmentClient } from '../data-access/attachments';
import type { ScopeController } from '../operator/scope';
import { createBookingWorkflow } from './workflow';
import type { Field } from './form';
import { CustomerLookup } from './CustomerLookup';
import { ReceiptPanel } from './ReceiptPanel';
import { receiptMoney } from '../utils/receipt';
import './counter.css';
const stateOptions = [{ value: '', label: 'Not supplied' }, ...[
  ['02','Himachal Pradesh'],['03','Punjab'],['05','Uttarakhand'],['06','Haryana'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['32','Kerala'],['33','Tamil Nadu'],['36','Telangana'],['37','Andhra Pradesh'],
].map(([value, label]) => ({ value, label }))];
export default function NewBooking({ controller }: { controller: ScopeController }) {
  const [serial, setSerial] = useState(0);
  return <BookingForm key={serial} controller={controller} startAnother={() => setSerial(s => s + 1)} />;
}
function BookingForm({ controller, startAnother }: { controller: ScopeController; startAnother: () => void }) {
  const [workflow] = useState(() => createBookingWorkflow(controller));
  const state = useSyncExternalStore(workflow.subscribe, workflow.snapshot), d = state.draft;
  useEffect(() => { workflow.activate(); return () => workflow.dispose(); }, [workflow]);
  useEffect(() => {
    const first = Object.entries(state.errors).find(([, value]) => value)?.[0];
    if (first) document.getElementById(`counter-${first}`)?.focus();
  }, [state.errors]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (state.busy || [state.bookingPhase, state.customerPhase, state.paymentPhase].includes('uncertain')) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLoss); return () => window.removeEventListener('beforeunload', preventLoss);
  }, [state.busy, state.bookingPhase, state.customerPhase, state.paymentPhase]);
  const attachmentClient = useMemo(() => state.booking ? createAttachmentClient(controller.runtime, state.booking.id, {
    async request<T>(path: string, options?: Parameters<ReturnType<typeof createApiClient>['request']>[1]): Promise<T> {
      try { return await createApiClient().request<T>(path, options); }
      catch (error) { if (controller.runtime.isCurrent(workflow.api.scope) && error instanceof ApiFailure && error.code === 'UNAUTHENTICATED') controller.clear('signed_out'); throw error; }
    },
  }) : null, [state.booking, controller, workflow]);
  const disabled = workflow.locked();
  const field = (key: Field, label: string, helper?: string, props: { inputMode?: 'numeric' | 'tel'; type?: string } = {}) => <div>
    <TextField id={`counter-${key}`} label={label} value={d[key]} disabled={disabled} onChange={v => workflow.change(key, v)} className={state.errors[key] ? 'err' : undefined} aria-invalid={state.errors[key] ? true : undefined} aria-describedby={`counter-${key}-help`} {...props} />
    <p className="counter-help" id={`counter-${key}-help`}>{state.errors[key] || helper}</p>
  </div>;
  const select = (key: Field, label: string, options: { value: string; label: string }[]) => <div><SelectField id={`counter-${key}`} label={label} value={d[key]} disabled={disabled} onChange={v => workflow.change(key, v)} options={options} className={state.errors[key] ? 'err' : undefined} aria-invalid={state.errors[key] ? true : undefined} aria-describedby={`counter-${key}-help`} /><p className="counter-help" id={`counter-${key}-help`}>{state.errors[key]}</p></div>;
  if (state.recoveryBlocked) return <section className="card counter-section"><h1 className="t-headline-sm">Booking recovery required</h1><p role="alert">An earlier customer, booking or payment request may have committed. Its private draft was cleared. Do not enter it again. Use Receipts and ask your authorized franchise administrator to reconcile the original request before starting a replacement.</p><Link to="/business/receipts">Open Receipts</Link></section>;
  if (state.booking) return <div className="counter-flow">
    <section className="card counter-section"><h1 className="t-headline-sm" tabIndex={-1}>Booking saved</h1>
      <p>{state.booking.parcels.map(p => p.docket).join(', ')}</p><p className="t-headline-sm">Booked total {receiptMoney(state.booking.charges.tax.final_payable_paise)}</p>
      <p role="status" aria-live="polite">{state.message}</p>
      <p>Outstanding {state.balance ? receiptMoney(state.balance.outstanding_paise) : receiptMoney(state.booking.payment_obligation.outstanding_paise)}{!state.balance && ' at booking confirmation'}</p>
      {d.paymentMode === 'to_pay' ? <p>To Pay: no collection was recorded.</p> : <><p>Payment: {state.paymentPhase === 'ready' ? 'recorded' : state.paymentPhase === 'loading' ? 'recording…' : 'not confirmed'}</p>
        {state.paymentPhase !== 'ready' && <button className="btn btn-filled" disabled={state.busy} onClick={() => { void workflow.collect(); }}>Retry payment</button>}
        <button className="btn btn-outlined" disabled={state.busy} onClick={() => { void workflow.refreshPayment(); }}>Refresh payment status</button></>}
      <div className="counter-actions"><button className="btn btn-outlined" disabled={state.busy || state.paymentPhase === 'uncertain'} onClick={startAnother}>Start another booking</button><Link to="/business/receipts">Open Receipts</Link></div>
    </section>
    <ReceiptPanel controller={controller} api={workflow.api} bookingId={state.booking.id} />
    {state.payment && <ReceiptPanel controller={controller} api={workflow.api} bookingId={state.booking.id} paymentId={state.payment.entry.id} />}
    <section className="card counter-section"><h2 className="t-title-lg">Private attachments</h2><p>Booking is saved independently of each upload. Files are saved only after server safety validation.</p>{attachmentClient && <AttachmentUploader client={attachmentClient} runtime={controller.runtime} />}</section>
  </div>;
  return <form className="counter-flow" noValidate onSubmit={event => { event.preventDefault(); void workflow.save(); }} aria-label="New booking">
    <h1 className="t-headline-sm">New Booking</h1>
    <section className="card counter-section"><h2 className="t-title-lg">1 · Customer / sender</h2><p>The booking customer supplies the sender snapshot. Enter the parcel recipient separately.</p>
      <CustomerLookup workflow={workflow} disabled={disabled} />
      <div className="counter-grid">{field('name', 'Customer name')}{field('phone', 'Customer phone', 'International format including + and country code.', { inputMode: 'tel' })}{field('address', 'Customer address', 'Optional single-line contact address.')}</div>
      {state.customer && <p>Selected customer: {state.customer.name} · {state.customer.phone_display} · {state.customer.address} (version {state.customer.version})</p>}
      <div className="counter-actions">
        <button type="button" className="btn btn-outlined" disabled={state.busy || state.customerPhase === 'ready' || state.bookingPhase === 'uncertain' || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain'} onClick={() => { void workflow.confirmCustomer(); }}>{state.customerPhase === 'uncertain' ? 'Retry same customer request' : state.customer ? 'Save customer changes' : 'Create customer'}</button>
        {state.customer && <><button type="button" className="btn btn-text" disabled={disabled} onClick={() => workflow.newCustomer()}>Use as new customer</button><button type="button" className="btn btn-text" disabled={disabled} onClick={() => { void workflow.refreshCustomer(); }}>Refresh customer</button><button type="button" className="btn btn-text" disabled={disabled} onClick={() => workflow.useLatestCustomer()}>Use latest customer details</button></>}
      </div><p role="status">Customer: {state.customerPhase}</p>
    </section>
    <section className="card counter-section"><h2 className="t-title-lg">2 · Parcel recipient and service</h2><div className="counter-grid">
      {field('recipientName', 'Recipient name')}{field('recipientPhone', 'Recipient phone', 'International format including + and country code.', { inputMode: 'tel' })}{field('recipientAddress', 'Recipient address')}
      {field('destination', 'Destination key', 'Use the franchise rate-card key, not a tax jurisdiction.')}
      {select('service', 'Service', [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'same_city', label: 'Same-city' }])}
      {field('weight', 'Weight (grams)', 'Whole grams.', { inputMode: 'numeric' })}{field('docket', 'Manual docket', 'Leave blank for collision-safe server allocation.')}
      {field('override', 'Freight override (paise)', 'Optional. The server checks the reason, tolerance and your permission.', { inputMode: 'numeric' })}
      {select('reason', 'Override reason', [{ value: 'customer_agreement', label: 'Customer agreement' }, { value: 'service_recovery', label: 'Service recovery' }, { value: 'commercial_exception', label: 'Commercial exception' }])}
    </div></section>
    <section className="card counter-section"><h2 className="t-title-lg">3 · Tax facts</h2><p>These facts describe the service recipient. They are not inferred from the parcel destination, sender, recipient or payer. Ordinary domestic state supplies only.</p><div className="counter-grid">
      {field('recipientRef', 'Service recipient reference', 'Actual reference to the party receiving the courier service; no personal narrative.')}
      {select('registration', 'Service recipient registration', [{ value: 'unregistered', label: 'Unregistered' }, { value: 'registered', label: 'Registered' }])}
      {select('recipientState', 'Service recipient state', stateOptions)}
      {d.registration === 'registered' && field('gstin', 'Service recipient GSTIN')}
      {select('handoverState', 'Handover state', stateOptions)}
      {field('evidenceRef', 'Tax evidence reference', 'Reference to the actual supporting record; no invented values.')}
      {select('specialCase', 'Tax case', [{ value: 'none', label: 'Ordinary domestic supply' }, { value: 'unsupported', label: 'Special case / needs review' }])}
    </div><button type="button" className="btn btn-outlined" disabled={state.busy || state.bookingPhase === 'uncertain' || state.customerPhase === 'uncertain'} aria-busy={state.pricingPhase === 'loading' || state.taxPhase === 'loading'} onClick={() => { void workflow.preview(); }}>{state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain' ? 'Retry same price and tax request' : 'Get server price and tax'}</button>
      <p role="status">Pricing: {state.pricingPhase}. Tax: {state.taxPhase}.</p>
    </section>
    <section className="card counter-section"><h2 className="t-title-lg">4 · Review and confirm</h2>
      {state.quote && <><p>Server freight suggestion {receiptMoney(state.quote.freight_suggestion_paise)} · Freight {receiptMoney(state.quote.freight_paise)} · Packing {receiptMoney(state.quote.packing_paise)}</p><p>Override: {state.quote.override_status.replaceAll('_', ' ')} · Rate version {state.quote.rate_version_number}</p></>}
      {state.tax ? <><p>CGST {receiptMoney(state.tax.cgst_paise)} · SGST {receiptMoney(state.tax.sgst_paise)} · IGST {receiptMoney(state.tax.igst_paise)}</p><p>Tax {receiptMoney(state.tax.tax_total_paise)} · Rounding {receiptMoney(state.tax.rounding_adjustment_paise)}</p><p className="t-headline-sm">Server payable {receiptMoney(state.tax.final_payable_paise)}</p><p>Quote valid until {state.quote?.expires_at}. Tax valid until {state.tax.expires_at}. Final validation occurs at confirmation.</p></> : <p>Totals are not yet confirmed. Request server pricing and tax.</p>}
      <div className="counter-grid">{select('paymentMode', 'Payment choice', [{ value: 'to_pay', label: 'To Pay' }, { value: 'paid_counter', label: 'Paid now' }])}{d.paymentMode === 'paid_counter' && select('method', 'Payment method', [{ value: '', label: 'Select method' }, { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI (manual recording)' }])}</div>
      {d.paymentMode === 'paid_counter' && <p>Records money actually received after the booking is saved. Collection requires a separate franchise-admin grant.</p>}
      <p role={['error', 'uncertain', 'stale'].some(p => [state.customerPhase, state.pricingPhase, state.taxPhase, state.bookingPhase].includes(p as typeof state.bookingPhase)) || Object.values(state.errors).some(Boolean) ? 'alert' : 'status'} aria-live="polite">{state.message}</p>
      <button className="btn btn-filled" disabled={state.busy || state.customerPhase === 'uncertain' || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain'} aria-busy={state.bookingPhase === 'loading'}>{state.bookingPhase === 'uncertain' ? 'Retry same booking' : 'Save booking'}</button>
      <p>Files can be attached after the booking is confirmed. Printing is optional.</p>
    </section>
  </form>;
}
