import {customerAccounts} from '../data-access/customer-accounts';
import type { CustomerDto, TaxCalculationDto, TaxIntentInput } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { customers } from '../data-access/customers';
import { commercial, type Quote } from '../data-access/commercial';
import { bookings, type BookingConfirmation } from '../data-access/bookings';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
import { emptyDraft, commercialFields, pricingInput, taxFacts, validate, type Draft, type Field, type Errors } from './form';
import { clearRecovery, recoveryMarker, retainRecovery } from './recovery';
import { failureMessage, uncertain } from './failures';
export type Phase = 'editing' | 'loading' | 'ready' | 'error' | 'uncertain' | 'stale';
interface State {
  draft: Draft; errors: Errors; customer?: CustomerDto; customerPhase: Phase; quote?: Quote; tax?: TaxCalculationDto;
  pricingPhase: Phase; taxPhase: Phase; booking?: BookingConfirmation; bookingPhase: Phase;
  accountId?:string;creditRequestId?:string;creditApprovalId?:string;creditReason?:string;creditPhase?:Phase;
  settingsVersion?: string; message: string; recoveryBlocked: boolean; busy: boolean;
}
export function createBookingWorkflow(controller: ScopeController) {
  const api = scopedApi(controller), customerApi = customers(api), commercialApi = commercial(api), bookingApi = bookings(api), accountApi=customerAccounts(api);
  let state: State = { draft: emptyDraft(), errors: {}, customerPhase: 'editing', pricingPhase: 'editing', taxPhase: 'editing',
    bookingPhase: 'editing', message: '', recoveryBlocked: recoveryMarker(api.scope), busy: false };
  const listeners = new Set<() => void>();
  let live = true, customerIntent: CommandIntent | undefined, quoteIntent: CommandIntent | undefined,
    prepareIntent: CommandIntent | undefined, calculateIntent: CommandIntent | undefined, bookingIntent: CommandIntent | undefined,
    taxInput: TaxIntentInput | undefined, creditIntent:CommandIntent|undefined;
  const current = () => live && controller.runtime.isCurrent(api.scope);
  const set = (patch: Partial<State>) => { if (!current()) return; state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const invalidateCommercial = () => { quoteIntent = prepareIntent = calculateIntent = undefined; taxInput = undefined;
    creditIntent=undefined;set({creditRequestId:undefined,creditApprovalId:undefined,creditReason:undefined,creditPhase:'editing',quote: undefined, tax: undefined, pricingPhase: 'editing', taxPhase: 'editing' }); };
  const locked = () => state.busy || state.recoveryBlocked || !!bookingIntent || state.customerPhase === 'uncertain' || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain' || state.creditPhase==='uncertain' || !!state.booking;
  function validation(section: Parameters<typeof validate>[1]) {
    const errors = validate(state.draft, section); set({ errors, message: Object.keys(errors).length ? 'Review the highlighted fields.' : '' });
    return Object.keys(errors).length === 0;
  }
  function failed(error: unknown, phase: 'customerPhase' | 'pricingPhase' | 'taxPhase' | 'bookingPhase') {
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
  const bookingBody=()=> {
    if(!state.customer||!state.tax||!taxInput)return null;
    const d=state.draft;
    return {customer_id:state.customer.id,expected_customer_version:state.customer.version,tax_calculation_id:state.tax.id,tax_intent:taxInput,
      parcels:[{weight_grams:Number(d.weight),...(d.docket?{docket:d.docket}:{}),recipient:{name:d.recipientName,phone:d.recipientPhone,address:d.recipientAddress}}]};
  };
  let unsubscribe = () => {};
  const purge = () => {
    live = false; customerIntent = quoteIntent = prepareIntent = calculateIntent = bookingIntent = creditIntent = undefined; taxInput = undefined;
    state = { draft: emptyDraft(), errors: {}, customerPhase: 'editing', pricingPhase: 'editing', taxPhase: 'editing', bookingPhase: 'editing', message: '', recoveryBlocked: false, busy: false };
    listeners.forEach(l => l());
  };
  return {
    api, customerApi, accountApi,
    selectAccount(id:string) {if(locked())return;set({accountId:id||undefined});invalidateCommercial();},
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { live = true; unsubscribe = controller.runtime.onInvalidate(purge); },
    dispose() { unsubscribe(); live = false; },
    acceptServiceSuggestion(service: Draft['service'], version: string) {
      if (locked() || state.quote) return;
      set({draft:{...state.draft,service},settingsVersion:version,message:'Configured service accepted for this new booking draft.'});
      invalidateCommercial();
    },
    change(field: Field, value: string) {
      if (locked()) return;
      creditIntent=undefined;set({creditRequestId:undefined,creditApprovalId:undefined,creditReason:undefined});
      set({ ...(field === 'service' ? {settingsVersion:undefined} : {}), draft: { ...state.draft, [field]: value }, errors: { ...state.errors, [field]: undefined } });
      if (commercialFields.includes(field)) invalidateCommercial();
      if (['name', 'phone', 'address'].includes(field)) { customerIntent = undefined; set({ customerPhase: 'editing' }); }
    },
    select(customer: CustomerDto) {
      if (locked()) return;
      const d = state.draft;
      const draft = { ...d, name: d.name || customer.name, phone: d.phone || customer.phone_display, address: d.address || customer.address };
      customerIntent = undefined;
      invalidateCommercial();set({accountId:undefined,customer, draft, customerPhase: draft.name === customer.name && draft.phone === customer.phone_display && draft.address === customer.address ? 'ready' : 'editing',
        message: 'Customer selected. Entered values were preserved. Confirm any customer changes before booking.' });
    },
    newCustomer() { if (!locked()) { customerIntent = undefined; invalidateCommercial();set({accountId:undefined,customer: undefined, customerPhase: 'editing', message: 'New customer selected. Entered contact values retained.' }); } },
    async refreshCustomer() {
      if (locked() || !state.customer || !current()) return;
      invalidateCommercial();
      set({ busy: true });
      try { const customer = await customerApi.read(state.customer.id); set({ customer, customerPhase: 'editing', message: 'Latest customer loaded. Your entered values are unchanged. Review and deliberately save customer changes or use the latest record.' }); }
      catch (error) { failed(error, 'customerPhase'); } finally { set({ busy: false }); }
    },
    useLatestCustomer() {
      if (!state.customer || locked()) return;
      invalidateCommercial();
      const c = state.customer; set({ draft: { ...state.draft, name: c.name, phone: c.phone_display, address: c.address }, customerPhase: 'ready', message: 'Latest customer details selected.' });
    },
    async confirmCustomer() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking || bookingIntent || state.pricingPhase === 'uncertain' || state.taxPhase === 'uncertain' || state.creditPhase==='uncertain' || !validation('customer')) return;
      const d = state.draft;
      customerIntent ??= state.customer ? customerApi.update(state.customer, { name: d.name, phone: d.phone, address: d.address, expected_version: state.customer.version })
        : customerApi.create({ name: d.name, phone: d.phone, address: d.address });
      set({ busy: true, customerPhase: 'loading', message: 'Saving customer…' });
      try { retainRecovery(customerIntent); const customer = await customerApi.execute(customerIntent);
        if (!current()) return; clearRecovery(api.scope); customerIntent = undefined; invalidateCommercial();set({ customer, customerPhase: 'ready', message: 'Customer confirmed.' });
      } catch (error) { if (!current()) return; if (!failed(error, 'customerPhase')) { clearRecovery(api.scope); customerIntent = undefined; } }
      finally { set({ busy: false }); }
    },
    async preview() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking || bookingIntent || state.customerPhase === 'uncertain' || state.creditPhase==='uncertain' || !validation('commercial')) return;
      if (state.taxPhase === 'ready') invalidateCommercial();
      set({ busy: true, message: 'Requesting server price and tax…' });
      let phase: 'pricingPhase' | 'taxPhase' = 'pricingPhase';
      try {
        if (!state.quote) { set({ pricingPhase: 'loading' }); quoteIntent ??= commercialApi.quote({...pricingInput(state.draft),...(state.accountId?{customer_account_id:state.accountId}:{}),...(state.settingsVersion?{settings_version_id:state.settingsVersion}:{})});
          const quote = await commercialApi.executeQuote(quoteIntent); if (!current()) return; set({ quote, pricingPhase: 'ready' }); }
        phase = 'taxPhase'; set({ taxPhase: 'loading' });
        taxInput ??= { quote_id: state.quote!.id, pricing_input: {...pricingInput(state.draft),...(state.accountId?{customer_account_id:state.accountId}:{}),...(state.settingsVersion?{settings_version_id:state.settingsVersion}:{})}, facts: taxFacts(state.draft) };
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
    async requestCredit() {
      if(!current()||state.busy||state.booking||state.recoveryBlocked||bookingIntent)return;
      const body=bookingBody();if(!body||!state.accountId||!validation('booking'))return;
      set({busy:true,creditPhase:'loading'});
      try {creditIntent??=accountApi.request(body);const result=await accountApi.executeRequest(creditIntent);if(!current())return;
        creditIntent=undefined;set({creditRequestId:result.id,creditPhase:'ready',message:'Credit exception requested. Ask a franchise admin to review it in Customer accounts before this price expires.'});
      }catch(error){if(!current())return;const pending=uncertain(error);if(!pending)creditIntent=undefined;set({creditPhase:pending?'uncertain':'error',message:failureMessage(error)});}
      finally{set({busy:false});}
    },
    async refreshCreditApproval() {
      if(!current()||state.busy||!state.creditRequestId)return;set({busy:true});
      try{const result=await accountApi.requestStatus(state.creditRequestId);if(!current())return;
        set({creditApprovalId:result.approval_id??undefined,creditReason:result.reason??undefined,message:result.approval_id?'Owner approval received for this exact booking. Review and save before expiry.':'Waiting for franchise-admin approval.'});
      }catch(error){if(current())set({message:failureMessage(error)});}finally{set({busy:false});}
    },
    async save() {
      if (!current() || state.busy || state.recoveryBlocked || state.booking || state.creditPhase==='uncertain') return;
      if (!bookingIntent) {
        if (!validation('booking')) return;
        if (state.customerPhase !== 'ready' || !state.customer) { set({ errors: { name: 'Confirm the customer before booking.' }, message: 'Confirm the customer before booking.' }); return; }
        if (!state.tax || !state.quote || !taxInput) { set({ message: 'Get a server price and tax calculation before saving.' }); return; }
        if (Date.parse(state.quote.expires_at) <= Date.now() || Date.parse(state.tax.expires_at) <= Date.now()) {
          invalidateCommercial(); set({ pricingPhase: 'stale', taxPhase: 'stale', message: 'Pricing or tax expired. Refresh and review the new amounts before saving.' }); return;
        }
        bookingIntent = bookingApi.create({...bookingBody()!,...(state.creditApprovalId?{credit_approval_id:state.creditApprovalId}:{})});
      }
      set({ busy: true, bookingPhase: 'loading', message: 'Saving booking…', errors: {} });
      try { retainRecovery(bookingIntent); const booking = await bookingApi.execute(bookingIntent); if (!current()) return;
        clearRecovery(api.scope); set({ booking, bookingPhase: 'ready', message: 'Booking saved.' });
      } catch (error) { if (!current()) return; if (!failed(error, 'bookingPhase')) { clearRecovery(api.scope); bookingIntent = undefined; } }
      finally { set({ busy: false }); }
    },
    locked,
  };
}
export type BookingWorkflow = ReturnType<typeof createBookingWorkflow>;
