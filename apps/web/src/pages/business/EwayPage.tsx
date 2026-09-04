import React, { useMemo, useState } from 'react';
import { Msym } from '../../components/m3/Icon';
import { Button } from '../../components/m3/Button';
import { TextField } from '../../components/m3/Input';
import { Card, EmptyState, StatusPill } from '../../components/m3/Surface';
import { FilterChips, IconTile } from '../../components/m3/Controls';
import { Dialog } from '../../components/m3/Dialog';
import DataTable from '../../components/m3/DataTable';
import type { Column } from '../../components/m3/DataTable';
import { useToast } from '../../components/m3/Snackbar';
import { useDB } from '../../context/AppContext';
import type { Booking } from '../../data/types';
import {
  ewayList, setEwayBill, ewayState, ewayValidDays, EWAY_THRESHOLD,
  financialYear, fmtMoney, fmtDT, STATUS_LABEL,
} from '../../data/store';

/*
  E-way bills are a compliance checklist, not a report, so this page answers one
  question and stops: which consignments crossed the value threshold, has the
  portal-generated bill been recorded against them, and is it still valid.

  It does not generate e-way bills — those are raised on the government portal.
*/

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'fy', label: 'Financial year' },
];

function windowFor(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') return { from: new Date(y, m, 1).getTime(), to: Date.now(), label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  if (period === 'lastmonth') {
    const from = new Date(y, m - 1, 1);
    return { from: from.getTime(), to: new Date(y, m, 0, 23, 59, 59).getTime(), label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  const fy = financialYear(now);
  return { from: fy.from, to: fy.to, label: fy.label };
}

const EW_STATE = {
  pending: { label: 'Not recorded', pill: 'pill-warn' },
  recorded: { label: 'Recorded', pill: 'st-delivered' },
  expired: { label: 'Expired', pill: 'pill-err' },
};

export default function EwayPage() {
  const data = useDB();
  const toast = useToast();
  const [period, setPeriod] = useState('fy');
  const [editing, setEditing] = useState<Booking | null>(null);
  /* distanceKm is held as the raw string the operator typed; it is parsed on save,
     so a half-entered number never becomes NaN in the middle of typing. */
  const [draft, setDraft] = useState({ no: '', vehicleNo: '', distanceKm: '' });
  const [draftErr, setDraftErr] = useState<string | null>(null);

  const win = useMemo(() => windowFor(period), [period]);
  const rows = useMemo(() => ewayList(win.from, win.to), [data, win]);

  const pending = rows.filter((b) => ewayState(b) !== 'recorded');
  const value = rows.reduce((n, b) => n + (Number(b.goodsValue) || 0), 0);

  function openEdit(b: Booking) {
    setEditing(b);
    setDraft({ no: b.eway?.no || '', vehicleNo: b.eway?.vehicleNo || '', distanceKm: String(b.eway?.distanceKm ?? '') });
    setDraftErr(null);
  }

  function save() {
    if (!editing) return;
    const no = draft.no.trim();
    if (no && !/^\d{12}$/.test(no)) { setDraftErr('E-way bill numbers are exactly 12 digits'); return; }
    if (!no && (draft.vehicleNo.trim() || draft.distanceKm)) { setDraftErr('Enter a bill number first — or clear everything to unrecord'); return; }
    setEwayBill(editing.id, { no, vehicleNo: draft.vehicleNo, distanceKm: Number(draft.distanceKm) || null });
    toast(no ? `E-way bill saved for ${editing.docket}.` : 'E-way bill cleared.');
    setEditing(null);
  }

  const distDays = Number(draft.distanceKm) > 0 ? ewayValidDays(Number(draft.distanceKm)) : null;

  const columns: Array<Column<Booking>> = [
    { key: 'docket', label: 'Docket', type: 'text', render: (b) => <span className="mono">{b.docket}</span> },
    { key: 'name', label: 'Customer', type: 'text' },
    { key: 'to', label: 'Destination', type: 'enum' },
    { key: 'goodsValue', label: 'Goods value', type: 'money', total: true, fmt: (n) => fmtMoney(Math.round(n)), render: (b) => fmtMoney(b.goodsValue) },
    { key: 'createdAt', label: 'Booked', type: 'date', accessor: (b) => b.createdAt, render: (b) => new Date(b.createdAt).toLocaleDateString('en-IN') },
    {
      key: 'state', label: 'Status', type: 'enum',
      accessor: (b) => EW_STATE[ewayState(b)].label,
      render: (b) => {
        const st = ewayState(b);
        const s = EW_STATE[st];
        const till = b.eway?.validUntil
          ? ` · till ${new Date(b.eway.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
          : '';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className={`pill ${s.pill}`}>{s.label}</span>
            {st === 'expired' && till && <span className="t-label-sm muted">{till}</span>}
          </span>
        );
      },
    },
    {
      key: 'no', label: 'Bill number', type: 'text', accessor: (b) => b.eway?.no || '',
      render: (b) => (b.eway?.no
        ? <button type="button" className="eway-no" onClick={() => openEdit(b)}>
            <span className="mono">{b.eway.no}</span><Msym name="edit" />
          </button>
        : <Button size="sm" variant="outlined" onClick={() => openEdit(b)}>Record</Button>),
    },
  ];

  return (
    <div className="page">
      <FilterChips options={PERIODS} value={period} onChange={setPeriod} />

      <div className="stat3">
        <Card pad className="stat">
          <span className="stat-label">Need an e-way bill</span>
          <span className="stat-value">{rows.length}</span>
          <p className="stat-empty">over {fmtMoney(EWAY_THRESHOLD)} · {win.label}</p>
        </Card>
        <Card pad className="stat">
          <span className="stat-label">To record or renew</span>
          <span className={`stat-value${pending.length ? ' is-alert' : ''}`}>{pending.length}</span>
          <p className="stat-empty">{pending.length ? 'missing or expired' : 'all covered'}</p>
        </Card>
        <Card pad className="stat">
          <span className="stat-label">Goods value covered</span>
          <span className="stat-value">{fmtMoney(Math.round(value))}</span>
          <p className="stat-empty">across {rows.length} consignment{rows.length === 1 ? '' : 's'}</p>
        </Card>
      </div>

      <div className="section-label">
        <IconTile name="local_shipping" size="sm" tone={pending.length ? 'warn' : 'ok'} />
        Consignments over {fmtMoney(EWAY_THRESHOLD)}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="task_alt" title="Nothing over the threshold"
            sub={`No booking in ${win.label} declared goods worth ${fmtMoney(EWAY_THRESHOLD)} or more.`} />
        ) : (
          <DataTable columns={columns} rows={rows} />
        )}
        <p className="rep-note">
          <Msym name="info" />
          <span>
            Raised on the government portal (ewaybillgst.gov.in) — this page tracks what it gave you.
            An e-way bill stays valid for one day per 200 km of movement; the Part-B vehicle number
            must be filled before the goods move on road.
          </span>
        </p>
      </Card>

      <Dialog
        open={!!editing} onClose={() => setEditing(null)}
        title={editing ? `E-way bill for ${editing.docket}` : ''}
        actions={<>
          <button className="btn btn-text" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn btn-filled" onClick={save}>Save</button>
        </>}>
        {editing && (
          <>
            <div className="ew-doc-facts">
              <span>{STATUS_LABEL[editing.status] || editing.status}</span>
              <span>{editing.name} → {editing.to}</span>
              <span>Goods worth {fmtMoney(editing.goodsValue)}</span>
              <span>GSTIN {data.business.gstin || '—'}</span>
            </div>
            <TextField
              label="E-way bill number" value={draft.no}
              onChange={(v) => { setDraft((d) => ({ ...d, no: v.replace(/\D/g, '').slice(0, 12) })); setDraftErr(null); }}
              error={draftErr} inputMode="numeric" autoFocus
              helper="12 digits, as generated on the portal"
            />
            <TextField
              label="Vehicle number (Part-B)" value={draft.vehicleNo}
              onChange={(v) => setDraft((d) => ({ ...d, vehicleNo: v.toUpperCase() }))}
              helper="Required before road movement — e.g. GJ-01-AB-1234"
            />
            <TextField
              label="Approx road distance (km)" value={draft.distanceKm} type="number"
              onChange={(v) => setDraft((d) => ({ ...d, distanceKm: v }))}
              min="0" inputMode="numeric"
              helper={distDays ? `Valid for ${distDays} day${distDays === 1 ? '' : 's'} — until ${fmtDT(Date.now() + distDays * 864e5)}` : undefined}
            />
          </>
        )}
      </Dialog>
    </div>
  );
}
