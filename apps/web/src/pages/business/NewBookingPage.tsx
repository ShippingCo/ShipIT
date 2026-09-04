import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { TextField, SelectField } from '../../components/m3/Input';
import { Button, SegmentedControl } from '../../components/m3/Button';
import { Card } from '../../components/m3/Surface';
import { useToast } from '../../components/m3/Snackbar';
import {
  addBooking, bookingsByPhone, normPhone, estimateEtaDays, suggestFreight,
  fmtMoney, CITIES, EWAY_THRESHOLD, taxOn, gstRate, peekDocket, findByDocket, placeOfSupply,
} from '../../data/store';
import { useDB } from '../../context/AppContext';
import type { Attachment, Booking } from '../../data/types';
import type { PaymentMode, ServiceType } from '../../data/types';
import type { Step } from '../../components/m3/Journey';
import { printReceipt } from '../../utils/receipt';
import { AttachmentPicker } from '../../components/m3/Controls';
import { StepTrack } from '../../components/m3/Journey';

/*
  The job: a clerk with a customer standing at the counter must produce a docket in
  well under a minute, without pricing it differently from the clerk on the next shift.

  So the two things this page does beyond collecting fields:
   - recognises a repeat customer from their phone number and fills the rest in
   - suggests the freight from destination, weight and service, overridable

  Text is deliberately sparse: labels carry the meaning, helper lines only appear
  where they change what the clerk does.
*/

const SERVICES = [
  { value: 'Standard', label: 'Standard' },
  { value: 'Express', label: 'Express' },
  { value: 'Same-city', label: 'Same-city' },
];

function phoneError(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.length === 12 && d.startsWith('91') ? d.slice(2)
    : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!local) return 'Required';
  if (local.length !== 10) return 'Must be 10 digits';
  if (!/^[6-9]/.test(local)) return 'Must start with 6, 7, 8 or 9';
  return null;
}

/** The counter form as the operator types it: every field is a string until save. */
interface BookingForm {
  docket: string;
  name: string;
  phone: string;
  to: string;
  address: string;
  weightKg: string;
  serviceType: ServiceType;
  packing: string;
  freight: string;
  paymentMode: PaymentMode;
  lotId: string;
  goodsValue: string;
}

type FormErrors = Partial<Record<keyof BookingForm, string>>;

function validate(f: BookingForm): FormErrors {
  const e: FormErrors = {};
  const dk = f.docket.trim().toUpperCase();
  if (!dk) e.docket = 'Required';
  else if (!/^[A-Z0-9-]{3,20}$/.test(dk)) e.docket = 'Letters, numbers and dashes only';
  else if (findByDocket(dk)) e.docket = 'Already used';
  if (!f.name.trim()) e.name = 'Required';
  const pe = phoneError(f.phone);
  if (pe) e.phone = pe;
  if (!f.to.trim()) e.to = 'Required';
  if (!(Number(f.weightKg) > 0)) e.weightKg = 'Must be more than 0';
  if (Number(f.packing) < 0) e.packing = 'Cannot be negative';
  if (Number(f.freight) < 0) e.freight = 'Cannot be negative';
  return e;
}

export default function NewBookingPage() {
  const data = useDB();
  const toast = useToast();
  const nav = useNavigate();

  const [form, setForm] = useState<BookingForm>({
    docket: peekDocket(),
    name: '', phone: '', to: '', address: '',
    weightKg: '1', serviceType: 'Standard',
    packing: '30', freight: '150', paymentMode: 'paid', lotId: '', goodsValue: '',
  });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [touched, setTouched] = useState<Partial<Record<keyof BookingForm, boolean>>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [repeat, setRepeat] = useState<Booking | null>(null); // previous booking matched by phone

  const set = (k: keyof BookingForm) => (v: string) => setForm((f) => {
    const next = { ...f, [k]: k === 'docket' ? v.toUpperCase() : v };
    if (touched[k]) setErrors(validate(next));
    return next;
  });
  const blur = (k: keyof BookingForm) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(validate(form));
  };
  const err = (k: keyof BookingForm) => (touched[k] ? errors[k] : undefined);

  const packing = Number(form.packing) || 0;
  const freight = Number(form.freight) || 0;
  const supply = placeOfSupply(form.to.trim());
  const tax = taxOn(packing, freight, gstRate(), supply === 'intra');
  const total = tax.total;
  const city = form.to.trim();
  const etaDays = city ? estimateEtaDays(city) : null;
  const suggested = city ? suggestFreight(city, form.weightKg, form.serviceType) : null;
  const freightOff = suggested !== null && Math.abs(suggested - freight) >= 10;

  /* What is still missing, by section. Validated live and independently of `touched`,
     because this track reports progress rather than scolding — it must never light up
     a section red for a field the clerk has not reached yet. */
  const live = validate(form);
  const filled = (k: keyof BookingForm) => String(form[k] ?? '').trim() !== '';
  const sections: Step[] = [
    { key: 'customer', icon: 'person', label: 'Customer',
      done: (['docket', 'name', 'phone', 'to'] as const).every((k) => filled(k) && !live[k]) },
    { key: 'parcel', icon: 'inventory_2', label: 'Parcel',
      done: filled('weightKg') && !live.weightKg },
    { key: 'charges', icon: 'currency_rupee', label: 'Charges',
      done: !live.packing && !live.freight },
  ];

  /* Repeat customer: look the phone up as soon as it is complete. */
  function onPhoneBlur() {
    blur('phone')();
    const digits = String(form.phone).replace(/\D/g, '');
    if (digits.length < 10) { setRepeat(null); return; }
    const prev = bookingsByPhone(normPhone(form.phone))[0];
    setRepeat(prev || null);
  }
  function applyRepeat() {
    if (!repeat) return;
    setForm((f) => ({
      ...f,
      name: f.name.trim() || repeat.name,
      address: f.address.trim() || repeat.address || '',
      to: f.to.trim() || repeat.to,
    }));
    setRepeat(null);
    toast('Filled from their last booking.');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    setTouched({ docket: true, name: true, phone: true, to: true, weightKg: true, packing: true, freight: true });
    if (Object.keys(errs).length) { toast('Check the highlighted fields.', { tone: 'err' }); return; }

    setSaving(true);
    try {
      const b = addBooking({
        docket: form.docket.trim().toUpperCase(),
        name: form.name, phone: form.phone, to: form.to, address: form.address,
        weightKg: form.weightKg, serviceType: form.serviceType,
        packing: form.packing, freight: form.freight,
        lotId: form.lotId || null, attachments: files, paymentMode: form.paymentMode,
        goodsValue: Number(form.goodsValue) || 0,
      });
      toast(`Docket ${b.docket} saved · WhatsApp sent`, {
        action: { label: 'Print receipt', onClick: () => printReceipt(b.docket) },
      });
      nav('/business/packages');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <form onSubmit={submit} noValidate>
        <div className="booking-layout">
          <div>
            <Card pad>
              <div className="jrn-wrap">
                <StepTrack steps={sections} />
              </div>

              {/* ---- customer ---- */}
              <h2 className="form-sec-title">Customer</h2>
              <div className="form-grid">
                <TextField
                  label="WhatsApp number" value={form.phone} onChange={set('phone')}
                  onBlur={onPhoneBlur} error={err('phone')}
                  inputMode="tel" autoComplete="tel" required
                />
                <TextField
                  label="Customer name" value={form.name} onChange={set('name')}
                  onBlur={blur('name')} error={err('name')} autoComplete="name" required
                />
                <TextField
                  label="Delivery address" value={form.address} onChange={set('address')}
                  autoComplete="street-address" className="span2"
                />
              </div>

              {repeat && (
                <button type="button" className="recall" onClick={applyRepeat}>
                  <Msym name="history" />
                  <span className="u-grow">
                    <b>{repeat.name}</b> shipped to {repeat.to} before — fill it in
                  </span>
                  <Msym name="arrow_forward" />
                </button>
              )}

              <hr className="divider form-rule" />

              {/* ---- parcel ---- */}
              <h2 className="form-sec-title">Parcel</h2>
              <div className="form-grid">
                <TextField
                  label="Docket number" value={form.docket} onChange={set('docket')}
                  onBlur={blur('docket')} error={err('docket')} className="mono"
                  autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  helper="Copy it from your paper receipt book"
                />
                <TextField
                  label="Destination city" value={form.to} onChange={set('to')}
                  onBlur={blur('to')} error={err('to')} list="city-list" required
                  helper={etaDays ? `Usually ${etaDays} day${etaDays === 1 ? '' : 's'}` : undefined}
                />
                <datalist id="city-list">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
                <TextField
                  label="Weight (kg)" type="number" value={form.weightKg} onChange={set('weightKg')}
                  onBlur={blur('weightKg')} error={err('weightKg')} min="0" step="0.1" inputMode="decimal"
                />
                <SelectField label="Service" value={form.serviceType} onChange={set('serviceType')} options={SERVICES} />
                <TextField
                  label="Declared goods value ₹" type="number" value={form.goodsValue} onChange={set('goodsValue')}
                  min="0" inputMode="numeric"
                  helper={Number(form.goodsValue) >= EWAY_THRESHOLD ? 'E-way bill likely needed' : 'Optional — used for e-way bill checks'}
                />
                <SelectField
                  label="Add to lot" value={form.lotId} onChange={set('lotId')}
                  options={[
                    { value: '', label: 'None' },
                    ...data.lots.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
                  ]}
                />
              </div>

              <div className="attach-slot">
                <span className="field-legend">Proof of parcel</span>
                <AttachmentPicker
                  items={files}
                  onChange={setFiles}
                  onError={(m) => toast(m, { tone: 'err' })}
                />
              </div>

              <hr className="divider form-rule" />

              {/* ---- charges ---- */}
              <h2 className="form-sec-title">Charges</h2>
              <div className="form-grid">
                <TextField
                  label="Packing ₹" type="number" value={form.packing} onChange={set('packing')}
                  onBlur={blur('packing')} error={err('packing')} min="0" inputMode="numeric"
                />
                <TextField
                  label="Freight ₹" type="number" value={form.freight} onChange={set('freight')}
                  onBlur={blur('freight')} error={err('freight')} min="0" inputMode="numeric"
                />
              </div>

              {freightOff && (
                <button type="button" className="recall" onClick={() => setForm((f) => ({ ...f, freight: String(suggested) }))}>
                  <Msym name="auto_fix_high" />
                  <span className="u-grow">
                    Usual rate for {city} at {form.weightKg} kg is <b>{fmtMoney(suggested)}</b> — use it
                  </span>
                  <Msym name="arrow_forward" />
                </button>
              )}

              <div className="pay-choice">
                <span className="field-legend">Payment</span>
                <SegmentedControl
                  options={[{ value: 'paid', label: 'Paid now' }, { value: 'topay', label: 'To Pay' }]}
                  value={form.paymentMode}
                  onChange={set('paymentMode')}
                />
              </div>
            </Card>
          </div>

          {/* ---- summary ---- */}
          <aside className="booking-side">
            <Card pad>
              <div className="sum-head">Booking summary</div>
              <dl className="sum-list">
                <div><dt>Docket</dt><dd className="mono">{form.docket || '—'}</dd></div>
                <div><dt>To</dt><dd>{city || '—'}</dd></div>
                <div><dt>Service</dt><dd>{form.serviceType}</dd></div>
                {etaDays && <div><dt>Expected</dt><dd>{etaDays} day{etaDays === 1 ? '' : 's'}</dd></div>}
                <div><dt>Packing</dt><dd>{fmtMoney(packing)}</dd></div>
                <div><dt>Freight</dt><dd>{fmtMoney(freight)}</dd></div>
                <div><dt>Taxable</dt><dd>{fmtMoney(tax.taxable)}</dd></div>
                {tax.rate > 0 && (tax.igst > 0 ? (
                  <div><dt>IGST {Math.round(tax.rate * 100)}%</dt><dd>{fmtMoney(tax.igst)}</dd></div>
                ) : (
                  <>
                    <div><dt>CGST {Math.round((tax.rate / 2) * 1000) / 10}%</dt><dd>{fmtMoney(tax.cgst)}</dd></div>
                    <div><dt>SGST {Math.round((tax.rate / 2) * 1000) / 10}%</dt><dd>{fmtMoney(tax.sgst)}</dd></div>
                  </>
                ))}
              </dl>
              <div className="sum-total">
                <span>Total</span>
                <strong>{fmtMoney(total)}</strong>
              </div>
              <span className={`pill ${form.paymentMode === 'topay' ? 'pill-warn' : 'st-delivered'} sum-pay`}>
                {form.paymentMode === 'topay' ? 'Collect on delivery' : 'Paid now'}
              </span>
              <Button type="submit" icon="check" size="lg" block loading={saving} className="sum-cta">
                Save booking
              </Button>
            </Card>
          </aside>
        </div>
      </form>
    </div>
  );
}
