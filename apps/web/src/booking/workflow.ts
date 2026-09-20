import type { CustomerDto, PaymentProjection, PaymentResult, TaxCalculationDto, TaxIntentInput } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { customers } from '../data-access/customers';
import { commercial, type Quote } from '../data-access/commercial';
import { bookings, type BookingConfirmation } from '../data-access/bookings';
import { payments } from '../data-access/payments';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
import { emptyDraft, commercialFields, pricingInput, taxFacts, validate, type Draft, type Field, type Errors } from './form';
import { clearRecovery, recoveryMarker, retainRecovery } from './recovery';
import { failureMessage, uncertain } from './failures';
export type Phase = 'editing' | 'loading' | 'ready' | 'error' | 'uncertain' | 'stale';
interface State {
  draft: Draft; errors: Errors; customer?: CustomerDto; customerPhase: Phase; quote?: Quote; tax?: TaxCalculationDto;
  pricingPhase: Phase; taxPhase: Phase; booking?: BookingConfirmation; bookingPhase: Phase;
  payment?: PaymentResult; balance?: PaymentProjection; paymentPhase: Phase; message: string; recoveryBlocked: boolean; busy: boolean;
}
export function createBookingWorkflow(controller: ScopeController) {
  const api = scopedApi(controller), customerApi = customers(api), commercialApi = commercial(api), bookingApi = bookings(api);
  let state: State = { draft: emptyDraft(), errors: {}, customerPhase: 'editing', pricingPhase: 'editing', taxPhase: 'editing',
    bookingPhase: 'editing', paymentPhase: 'editing', message: '', recoveryBlocked: recoveryMarker(api.scope), busy: false };
  const listeners = new Set<() => void>();
  let live = true, customerIntent: CommandIntent | undefined, quoteIntent: CommandIntent | undefined,
    prepareIntent: CommandIntent | undefined, calculateIntent: CommandIntent | undefined, bookingIntent: CommandIntent | undefined,
    paymentIntent: CommandIntent | undefined, taxInput: TaxIntentInput | undefined;
  const current = () => live && controller.runtime.isCurrent(api.scope);
  const set = (patch: Partial<State>) => { if (!current()) return; state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const invalidateCommercial = () => { quoteIntent = prepareIntent = calculateIntent = undefined; taxInput = undefined;
    set({ quote: undefined, tax: undefined, pricingPhase: 'editing', taxPhase: 'editing' }); };
  const locked = () => state.busy || state.recoveryBlocked || !!bookingIntent || state.customerPhase === 'uncertain' || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain' || !!state.booking;
  function validation(section: Parameters<typeof validate>[1]) {
    const errors = validate(state.draft, section); set({ errors, message: Object.keys(errors).length ? 'Review the highlighted fields.' : '' });
    return Object.keys(errors).length === 0;
  }
  function failed(error: unknown, phase: 'customerPhase' | 'pricingPhase' | 'taxPhase' | 'bookingPhase' | 'paymentPhase') {
    const pending = uncertain(error) || error instanceof ApiFailure && ['IDEMPOTENCY_CONFLICT', 'PAYMENT_REFERENCE_CONFLICT'].includes(error.code);
    const errors: Errors = {};
    if (error instanceof ApiFailure) {
      if (error.code === 'DOCKET_CONFLICT') errors.docket = failureMessage(error);
      if (error.code.startsWith('TAX_') || error.details.some(d => d.field.startsWith('tax'))) errors.recipientRef = failureMessage(error);
      const mapping: Record<string, Field> = { destination_key: 'destination', weight_grams: 'weight', freight_paise: 'override', reason_code: 'reason', docket: 'docket', name: phase === 'customerPhase' ? 'name' : 'recipientName', phone: phase === 'customerPhase' ? 'phone' : 'recipientPhone', address: phase === 'customerPhase' ? 'address' : 'recipientAddress' };
      for (const detail of error.details) { const field = mapping[detail.field]; if (field) errors[field] = 'Review this value against the server requirements.'; }
      if (['QUOTE_STALE', 'TAX_STALE'].includes(error.code)) { invalidateCommercial(); set({ pricingPhase: 'stale', taxPhase: 'stale' }); }
      if (error.code === 'VERSION_CONFLICT') set({ customerPhase: 'stale' });
    }
    set({ [phase]: pending ? 'uncertain' : 'error', errors, message: failureMessage(error) });
    return pending;
  }
  let unsubscribe = () => {};
  const purge = () => {
    live = false; customerIntent = quoteIntent = prepareIntent = calculateIntent = bookingIntent = paymentIntent = undefined; taxInput = undefined;
    state = { draft: emptyDraft(), errors: {}, customerPhase: 'editing', pricingPhase: 'editing', taxPhase: 'editing', bookingPhase: 'editing', paymentPhase: 'editing', message: '', recoveryBlocked: false, busy: false };
    listeners.forEach(l => l());
  };
  async function collect() {
    if (!current() || !state.booking || state.busy || state.paymentPhase === 'ready') return;
    const b = state.booking, pay = payments(api, b.id);
    if (b.payment_obligation.total_paise === 0) { set({ paymentPhase: 'ready', message: 'Booking saved. No collection is required for a zero total.' }); return; }
    paymentIntent ??= pay.collect({ amount_paise: b.payment_obligation.outstanding_paise, currency: 'INR', context: 'paid_counter',
      method: state.draft.method as 'cash' | 'upi', collection_reference: crypto.randomUUID() });
    set({ busy: true, paymentPhase: 'loading', message: 'Booking saved. Recording payment…' });
    try {
      retainRecovery(paymentIntent, b.id);
      const result = await pay.execute(paymentIntent);
      if (!current()) return;
      clearRecovery(api.scope); set({ payment: result, balance: result.payment, paymentPhase: 'ready', message: 'Booking saved. Payment recorded.' });
      // Replay returns its historical projection. Obtain the current authorized ledger separately.
      try { const balance = await pay.read(); set({ balance }); }
      catch (error) { set({ message: 'Booking saved. Payment recorded; current balance could not be refreshed. ' + failureMessage(error) }); }
    } catch (error) {
      if (!current()) return;
      if (!failed(error, 'paymentPhase')) clearRecovery(api.scope);
      set({ message: 'Booking saved. Payment not confirmed. ' + failureMessage(error) });
    } finally { set({ busy: false }); }
  }
  return {
    api, customerApi,
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { live = true; unsubscribe = controller.runtime.onInvalidate(purge); },
    dispose() { unsubscribe(); live = false; },
    change(field: Field, value: string) {
      if (locked()) return;
      set({ draft: { ...state.draft, [field]: value }, errors: { ...state.errors, [field]: undefined } });
      if (commercialFields.includes(field)) invalidateCommercial();
      if (['name', 'phone', 'address'].includes(field)) { customerIntent = undefined; set({ customerPhase: 'editing' }); }
    },
    select(customer: CustomerDto) {
      if (locked()) return;
      const d = state.draft;
      const draft = { ...d, name: d.name || customer.name, phone: d.phone || customer.phone_display, address: d.address || customer.address };
      customerIntent = undefined;
      set({ customer, draft, customerPhase: draft.name === customer.name && draft.phone === customer.phone_display && draft.address === customer.address ? 'ready' : 'editing',
        message: 'Customer selected. Entered values were preserved. Confirm any customer changes before booking.' });
    },
    newCustomer() { if (!locked()) { customerIntent = undefined; set({ customer: undefined, customerPhase: 'editing', message: 'New customer selected. Entered contact values retained.' }); } },
    async refreshCustomer() {
      if (state.busy || !state.customer || !current()) return;
      set({ busy: true });
      try { const customer = await customerApi.read(state.customer.id); set({ customer, customerPhase: 'editing', message: 'Latest customer loaded. Your entered values are unchanged. Review and deliberately save customer changes or use the latest record.' }); }
      catch (error) { failed(error, 'customerPhase'); } finally { set({ busy: false }); }
    },
    useLatestCustomer() {
      if (!state.customer || locked()) return;
      const c = state.customer; set({ draft: { ...state.draft, name: c.name, phone: c.phone_display, address: c.address }, customerPhase: 'ready', message: 'Latest customer details selected.' });
    },
    async confirmCustomer() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking || bookingIntent || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain' || !validation('customer')) return;
      const d = state.draft;
      customerIntent ??= state.customer ? customerApi.update(state.customer, { name: d.name, phone: d.phone, address: d.address, expected_version: state.customer.version })
        : customerApi.create({ name: d.name, phone: d.phone, address: d.address });
      set({ busy: true, customerPhase: 'loading', message: 'Saving customer…' });
      try { retainRecovery(customerIntent); const customer = await customerApi.execute(customerIntent);
        if (!current()) return; clearRecovery(api.scope); customerIntent = undefined; set({ customer, customerPhase: 'ready', message: 'Customer confirmed.' });
      } catch (error) { if (!current()) return; if (!failed(error, 'customerPhase')) { clearRecovery(api.scope); customerIntent = undefined; } }
      finally { set({ busy: false }); }
    },
    async preview() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking || bookingIntent || state.customerPhase === 'uncertain' || !validation('commercial')) return;
      if (state.taxPhase === 'ready') invalidateCommercial();
      set({ busy: true, message: 'Requesting server price and tax…' });
      let phase: 'pricingPhase' | 'taxPhase' = 'pricingPhase';
      try {
        if (!state.quote) { set({ pricingPhase: 'loading' }); quoteIntent ??= commercialApi.quote(pricingInput(state.draft));
          const quote = await commercialApi.executeQuote(quoteIntent); if (!current()) return; set({ quote, pricingPhase: 'ready' }); }
        phase = 'taxPhase'; set({ taxPhase: 'loading' });
        taxInput ??= { quote_id: state.quote!.id, pricing_input: pricingInput(state.draft), facts: taxFacts(state.draft) };
        if (!calculateIntent) {
          prepareIntent ??= commercialApi.prepare(taxInput);
          const preparation = await commercialApi.executePrepare(prepareIntent); if (!current()) return;
          if (preparation.jurisdiction_status !== 'known') throw new ApiFailure('TAX_CONFLICT', { status: 409 });
          calculateIntent = commercialApi.calculate(preparation.id);
        }
        const tax = await commercialApi.executeCalculation(calculateIntent); if (!current()) return;
        if (tax.quote_id !== state.quote!.id) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol', dispatched: true });
        set({ tax, taxPhase: 'ready', message: 'Server price and tax ready. Review the amounts before saving.' });
      } catch (error) { if (!failed(error, phase)) { quoteIntent = prepareIntent = calculateIntent = undefined; taxInput = undefined;
          set({ quote: undefined, tax: undefined }); } }
      finally { set({ busy: false }); }
    },
    async save() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking) return;
      if (!bookingIntent) {
        if (!validation('booking')) return;
        if (state.customerPhase !== 'ready' || !state.customer) { set({ errors: { name: 'Confirm the customer before booking.' }, message: 'Confirm the customer before booking.' }); return; }
        if (!state.tax || !state.quote || !taxInput) { set({ message: 'Get a server price and tax calculation before saving.' }); return; }
        if (Date.parse(state.quote.expires_at) <= Date.now() || Date.parse(state.tax.expires_at) <= Date.now()) {
          invalidateCommercial(); set({ pricingPhase: 'stale', taxPhase: 'stale', message: 'Pricing or tax expired. Refresh and review the new amounts before saving.' }); return;
        }
        const d = state.draft;
        bookingIntent = bookingApi.create({ customer_id: state.customer.id, expected_customer_version: state.customer.version, tax_calculation_id: state.tax.id, tax_intent: taxInput,
          parcels: [{ weight_grams: Number(d.weight), ...(d.docket ? { docket: d.docket } : {}), recipient: { name: d.recipientName, phone: d.recipientPhone, address: d.recipientAddress } }] });
      }
      set({ busy: true, bookingPhase: 'loading', message: 'Saving booking…', errors: {} });
      try { retainRecovery(bookingIntent); const booking = await bookingApi.execute(bookingIntent); if (!current()) return;
        clearRecovery(api.scope); set({ booking, bookingPhase: 'ready', message: 'Booking saved.' });
      } catch (error) { if (!current()) return; if (!failed(error, 'bookingPhase')) { clearRecovery(api.scope); bookingIntent = undefined; } }
      finally { set({ busy: false }); }
      if (current() && state.booking && state.draft.paymentMode === 'paid_counter') await collect();
    },
    collect,
    async refreshPayment() { if (!state.booking || state.busy) return; set({ busy: true });
      try { const balance = await payments(api, state.booking.id).read(); set({ balance, message: 'Current server payment balance loaded. Reconcile any uncertain collection using its original request.' }); }
      catch (error) { set({ message: 'Booking saved. ' + failureMessage(error) }); } finally { set({ busy: false }); } },
    locked,
  };
}
export type BookingWorkflow = ReturnType<typeof createBookingWorkflow>;
