import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { TextField, SelectField } from '../../components/m3/Input';
import { Button, IconButton } from '../../components/m3/Button';
import { Card, EmptyState } from '../../components/m3/Surface';
import { ConfirmDialog } from '../../components/m3/Dialog';
import { useToast } from '../../components/m3/Snackbar';
import { db, fmtMoney, fmtDT, waFmt, markAllBizSeen, updateBusiness, resetDemo, openEscalations, resolveEscalation, replyWindow, prettyPhone, grossOf } from '../../data/store';

import { printReceipt } from '../../utils/receipt';
import { useDB } from '../../context/AppContext';
import type { CustomRange, DatePreset } from '../../components/m3/Controls';
import { downscaleImage } from '../../utils/image';
import { SearchBar, FilterChips, DateFilter, dateWindow } from '../../components/m3/Controls';
import { LANGS } from '../../data/messages';
import { GST_MODES } from '../../data/store';

function payChip(b) {
  const p = b.payment || { settled: true };
  return <span className={`pill ${p.settled ? 'st-delivered' : 'pill-warn'}`}>{p.settled ? 'Paid' : 'To Pay'}</span>;
}

/* ---------------- Receipts ---------------- */
export function ReceiptsPage() {
  const data = useDB();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<DatePreset>('all');
  const [custom, setCustom] = useState<CustomRange>({ from: '', to: '' });

  const rows = useMemo(() => {
    const [from, to] = dateWindow(range, custom);
    const s = q.trim().toLowerCase();
    return data.bookings.filter(
      (b) => b.createdAt >= from && b.createdAt <= to
        && (!s || (b.docket + b.name + b.phone + b.to).toLowerCase().includes(s)),
    );
  }, [data, q, range, custom]);

  const total = rows.reduce((n, b) => n + grossOf(b), 0);

  return (
    <div className="page">
      <div className="toolbar">
        <SearchBar value={q} onChange={setQ} placeholder="Search docket, name or phone" label="Search receipts" />
        <DateFilter preset={range} onPreset={setRange} custom={custom} onCustom={setCustom} />
      </div>
      <p className="chips-total-line">{rows.length} receipt{rows.length === 1 ? '' : 's'} · {fmtMoney(total)}</p>

      <Card>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Docket</th><th>Customer</th><th className="ta-r">Total</th><th>Payment</th><th className="ta-r">Booked</th><th></th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono cell-main">{b.docket}</td>
                  <td>{b.name} <span className="muted t-body-sm">→ {b.to}</span></td>
                  <td className="ta-r">{fmtMoney(grossOf(b))}</td>
                  <td>{payChip(b)}</td>
                  <td className="ta-r muted t-body-sm">{fmtDT(b.createdAt)}</td>
                  <td><Button size="sm" variant="text" icon="print" onClick={() => printReceipt(b.docket)}>Reprint</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <EmptyState
              icon={q || range !== 'all' ? 'search_off' : 'receipt_long'}
              title={q || range !== 'all' ? 'No receipts match' : 'No receipts yet'}
              sub={q || range !== 'all' ? 'Try a different search or date range.' : 'Receipts appear automatically with each booking.'}
              action={q || range !== 'all'
                ? <Button variant="outlined" style={{ marginTop: 12 }} onClick={() => { setQ(''); setRange('all'); }}>Clear filters</Button>
                : <Button icon="add" style={{ marginTop: 12 }} onClick={() => nav('/business/booking')}>Create first booking</Button>}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Automation Feed ---------------- */
export function AutomationFeedPage() {
  const data = useDB();
  const nav = useNavigate();
  const toast = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [kind, setKind] = useState('all');

  useEffect(() => {
    if (data.outbox.some((m) => !m.bizSeen)) {
      const id = setTimeout(markAllBizSeen, 600);
      return () => clearTimeout(id);
    }
  }, [data.outbox]);

  const KINDS = [
    { value: 'all', label: 'All' },
    { value: 'booking', label: 'Bookings', icon: 'note_add' },
    { value: 'status', label: 'Status', icon: 'local_shipping' },
    { value: 'delay', label: 'Delays', icon: 'warning' },
    { value: 'otp', label: 'OTP', icon: 'lock' },
  ];
  const kindOf = (m) => /Booking Confirmed/i.test(m.text) ? 'booking'
    : /Delay Alert/i.test(m.text) ? 'delay'
    : /OTP/i.test(m.text) ? 'otp' : 'status';
  const all = [...data.outbox].reverse();
  const counts = Object.fromEntries(KINDS.map((k) => [k.value, k.value === 'all' ? all.length : all.filter((m) => kindOf(m) === k.value).length]));
  const items = kind === 'all' ? all : all.filter((m) => kindOf(m) === kind);
  const escalations = openEscalations();
  return (
    <div className="page">
      <div className="page-actions">
        {items.length > 0 && (
          <Button variant="text" icon="delete_sweep" onClick={() => setConfirmClear(true)}>Clear log</Button>
        )}
      </div>

      {escalations.length > 0 && (
        <>
          <div className="section-label">
            <span className="sec-ic"><Msym name="support_agent" /></span>
            Needs a person
            <span className="count-note">{escalations.length} waiting</span>
          </div>
          <Card style={{ marginBottom: 24 }}>
            {escalations.map((e) => {
              const cust = data.bookings.find((b) => b.phone === e.phone);
              const win = replyWindow(e.phone);
              return (
                <div key={e.id} className="esc-row">
                  <Msym name="support_agent" className="row-ic" />
                  <div className="u-grow" style={{ minWidth: 0 }}>
                    <div className="li-head">
                      {cust ? cust.name : 'Unknown'} <span className="muted">· {prettyPhone(e.phone)}</span>
                    </div>
                    <div className="esc-quote">&ldquo;{e.text}&rdquo;</div>
                    <div className="li-sub">
                      {e.reason} · {fmtDT(e.ts)}
                      {win.open
                        ? <span className="win-badge is-open">Free reply · {win.hoursLeft}h left</span>
                        : <span className="win-badge">Needs a template</span>}
                    </div>
                  </div>
                  <div className="u-row">
                    <a className="btn btn-outlined btn-sm" href={`#/customer?phone=${encodeURIComponent(e.phone)}`}
                      target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      Open chat
                    </a>
                    <Button size="sm" icon="check" onClick={() => { resolveEscalation(e.id); toast('Marked as handled.'); }}>
                      Handled
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <div className="section-label">
        <span className="sec-ic"><Msym name="forward_to_inbox" /></span>
        Sent automatically
      </div>
      <FilterChips options={KINDS} value={kind} onChange={setKind} counts={counts} />
      <Card style={{ padding: '6px' }}>
        {items.length === 0 ? (
          <EmptyState icon="forward_to_inbox" title="Nothing sent yet"
            sub="Book a parcel or report a delay — automated messages appear here and land in the customer's WhatsApp view."
            action={<Button icon="bolt" style={{ marginTop: 12 }} onClick={() => nav('/business/routes')}>Trigger your first alert</Button>}
          />
        ) : (
          items.map((m) => {
            const cust = data.bookings.find((b) => b.phone === m.phone);
            return (
              <div key={m.id} style={{ display: 'flex', gap: 14, padding: '13px 16px', borderBottom: '1px solid var(--md-outline-variant)' }}>
                <Msym name="smart_toy" size={20} className="row-ic" style={{ marginTop: 2 }} />
                <div className="u-grow" style={{ minWidth: 0 }}>
                  <div className="t-body-sm">
                    <b>{cust ? cust.name : 'Unknown'}</b> <span className="muted">· {m.phone}</span>
                    <span className="faint"> · {fmtDT(m.ts)}</span>
                    {!m.delivered && <span className="chip chip-tonal" style={{ height: 22, fontSize: 11, marginLeft: 8 }}>queued</span>}
                  </div>
                  <div className="wa-preview" style={{ marginTop: 7 }}>
                    <div className="msg msg-bot" dangerouslySetInnerHTML={{ __html: waFmt(m.text) }} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        danger
        title="Clear automation log?"
        body="This only clears the feed history — customer chats stay intact."
        confirmLabel="Clear"
        onConfirm={() => { db().outbox.length = 0; markAllBizSeen(); toast('Log cleared.'); }}
      />
    </div>
  );
}

/* ---------------- Settings ---------------- */
export function SettingsPage() {
  const data = useDB();
  const biz = data.business;
  const toast = useToast();
  const [form, setForm] = useState({ ...biz });
  const [logoPending, setLogoPending] = useState<string | null>(null);
  const dirty = logoPending !== null || Object.keys(form).some((k) => form[k] !== biz[k]);
  const [resetAsk, setResetAsk] = useState(false);

  useEffect(() => { setForm({ ...biz }); }, [biz]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function onLogo(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataUrl = await downscaleImage(f, 220, 0.85);
      setLogoPending(dataUrl);
    } catch { /* ignore */ }
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Card pad>
        <h2 className="form-sec-title">Shop details</h2>
        <div className="form-grid">
          <TextField label="Business name" value={form.name} onChange={set('name')} />
          <TextField label="Tagline" value={form.tagline} onChange={set('tagline')} />
          <TextField label="Origin city" value={form.origin} onChange={set('origin')} />
          <TextField label="Support phone" value={form.phone} onChange={set('phone')} />
          <TextField label="Address" value={form.address} onChange={set('address')} className="span2" />
          <TextField label="GSTIN" value={form.gstin} onChange={set('gstin')} />
          <SelectField
            label="GST treatment" value={form.gstMode || 'courier18'} onChange={set('gstMode')}
            options={GST_MODES.map((g) => ({ value: g.value, label: g.label }))}
            helper="Drives the GST split on your reports"
            className="span2"
          />
        </div>

        <hr className="divider form-rule" />

        <h2 className="form-sec-title">Assistant</h2>
        <div className="form-grid">
          <TextField
            label="Assistant name" value={form.botName} onChange={set('botName')}
            helper="How it introduces itself on WhatsApp"
          />
          <SelectField
            label="Message language" value={form.msgLang || 'en'} onChange={set('msgLang')}
            options={LANGS}
            helper="Hindi gets 1.8-2.5x more replies in Tier 2/3 cities"
          />
        </div>

        <hr className="divider form-rule" />

        <h2 className="form-sec-title">Branding</h2>
        <div className="u-row u-wrap">
          {(logoPending || biz.logo) && (
            <img src={logoPending || biz.logo || undefined} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', border: '1px solid var(--md-outline-variant)' }} />
          )}
          <label className="btn btn-outlined" style={{ cursor: 'pointer' }}>
            <Msym name="image" /> Upload logo
            <input type="file" accept="image/*" hidden onChange={onLogo} />
          </label>
          <span className="t-body-sm faint">Shows on printed receipts</span>
        </div>

        <hr className="divider form-rule" />
        <div className="dlg-actions" style={{ alignItems: 'center', gap: 12 }}>
          {dirty && <span className="t-body-sm muted" style={{ marginRight: 'auto' }}>You have unsaved changes</span>}
          <button
            className="btn btn-filled"
            disabled={!dirty}
            onClick={() => {
              updateBusiness({ ...form, ...(logoPending ? { logo: logoPending } : {}) });
              setLogoPending(null);
              toast('Settings saved.');
            }}
          >Save settings</button>
        </div>
      </Card>

      <Card variant="outlined" pad style={{ marginTop: 16 }}>
        <div className="t-title-md">Demo data</div>
        <p className="t-body-sm muted" style={{ margin: '6px 0 12px' }}>
          Reset everything back to the sample courier shop with sample parcels, lots &amp; routes.
        </p>
        <Button variant="danger" icon="restart_alt" onClick={() => setResetAsk(true)}>Reset demo data</Button>
      </Card>

      <ConfirmDialog
        open={resetAsk}
        onClose={() => setResetAsk(false)}
        danger
        title="Reset demo data?"
        body="This wipes all bookings, chats and routes in this browser and restores the sample data."
        confirmLabel="Reset"
        onConfirm={() => { resetDemo(); toast('Demo data restored.'); }}
      />
    </div>
  );
}
