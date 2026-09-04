import React, { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { Button } from '../../components/m3/Button';
import { Card, EmptyState, StatusPill } from '../../components/m3/Surface';
import { FilterChips, IconTile } from '../../components/m3/Controls';
import DataTable from '../../components/m3/DataTable';
import type { Column, DataRow } from '../../components/m3/DataTable';
import { useToast } from '../../components/m3/Snackbar';
import { useDB } from '../../context/AppContext';
import {
  reportFor, financialYear, GST_MODES, grossOf, activeDelayFor,
  fmtMoney, fmtDT, prettyPhone, STATUS_LABEL, STATE_OF_CITY,
} from '../../data/store';
import type { Booking, CityTotal, ParcelStatus, RateTotal } from '../../data/types';

/*
  Reports is an index of cards. Each opens its own screen with a chart, a
  spreadsheet-style table you can filter and sort, and an export of exactly the
  rows left after filtering. Nothing computes GST here — bookings carry their own.
*/

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'fy', label: 'Financial year' },
];

export function windowFor(period: string): { from: number; to: number; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') return { from: new Date(y, m, 1).getTime(), to: Date.now(), label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  if (period === 'lastmonth') {
    const from = new Date(y, m - 1, 1);
    return { from: from.getTime(), to: new Date(y, m, 0, 23, 59, 59).getTime(), label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'quarter') {
    /* Indian fiscal quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar */
    const fyY = m >= 3 ? y : y - 1;
    const qIdx = Math.floor(((m - 3 + 12) % 12) / 3);
    return { from: new Date(fyY, 3 + qIdx * 3, 1).getTime(), to: Date.now(), label: `Q${qIdx + 1} · FY ${fyY}-${String(fyY + 1).slice(2)}` };
  }
  const fy = financialYear(now);
  return { from: fy.from, to: fy.to, label: fy.label };
}

const REPORTS = [
  { id: 'sales', icon: 'list_alt', title: 'Sales register', desc: 'Every booking with its charges and tax' },
  { id: 'gst', icon: 'receipt_long', title: 'GST summary', desc: 'Taxable value and GST, grouped by rate' },
  { id: 'due', icon: 'currency_rupee', title: 'Outstanding', desc: 'To Pay parcels still to be collected' },
  { id: 'city', icon: 'pin_drop', title: 'Destinations', desc: 'Where your volume and money go' },
  { id: 'delivery', icon: 'check_circle', title: 'Delivery performance', desc: 'Delivered, delayed and failed attempts' },
];

function download(name, rowsCsv, biz, label, toast) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [[`${biz.name} — ${name} — ${label}`], [`GSTIN: ${biz.gstin || '-'}`], [], ...rowsCsv]
    .map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/\s+/g, '-')}-${label.replace(/\s+/g, '-').toLowerCase()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${name} exported.`);
}

/* ---------------- index ---------------- */
export default function ReportsPage() {
  const { id } = useParams();
  if (id) return <ReportDetail id={id} />;
  return <ReportsIndex />;
}

function ReportsIndex() {
  const data = useDB();
  const nav = useNavigate();
  const [period, setPeriod] = useState('month');
  const win = useMemo(() => windowFor(period), [period]);
  const rep = useMemo(() => reportFor(win.from, win.to), [data, win]);

  const failed = rep.rows.filter((b) => ['failed_attempt', 'rto'].includes(b.status)).length;
  const headline = {
    sales: { v: fmtMoney(Math.round(rep.gross)), l: `${rep.count} bookings` },
    gst: { v: fmtMoney(Math.round(rep.gst)), l: 'GST on sales' },
    due: { v: fmtMoney(Math.round(rep.pending.value)), l: `${rep.pending.n} to collect` },
    city: { v: String(rep.byCity.length), l: 'cities served' },
    delivery: { v: String(failed), l: failed ? 'need attention' : 'all clean' },
  };

  return (
    <div className="page">
      <FilterChips options={PERIODS} value={period} onChange={setPeriod} />
      <div className="repgrid">
        {REPORTS.map((r) => (
          <button key={r.id} type="button" className="repcard" onClick={() => nav(`/business/reports/${r.id}`)}>
            <IconTile name={r.icon} size="lg" />
            <span className="repcard-v">{headline[r.id].v}</span>
            <span className="repcard-l">{headline[r.id].l}</span>
            <span className="repcard-t">{r.title}</span>
            <span className="repcard-d">{r.desc}</span>
            <span className="repcard-go">Open <Msym name="arrow_forward" /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/*
  Each report picks its own row shape at runtime from the report id — bookings for
  sales, rate totals for GST, city totals for the destination report. The table is
  generic over its row type, but this component cannot fix that parameter, so these two
  helpers erase it at the single boundary where the shapes converge. Inside each branch
  the column callbacks stay fully typed against the real row.
*/
const asRows = <R extends DataRow>(rows: R[]): DataRow[] => rows;
const asColumns = <R extends DataRow>(cols: Array<Column<R>>): Array<Column<DataRow>> =>
  cols as unknown as Array<Column<DataRow>>;

/* ---------------- detail ---------------- */
function ReportDetail({ id }: { id: string }) {
  const data = useDB();
  const nav = useNavigate();
  const toast = useToast();
  const [period, setPeriod] = useState('month');
  const viewRef = useRef<DataRow[]>([]);

  const meta = REPORTS.find((r) => r.id === id) ?? REPORTS[0]!;
  const win = useMemo(() => windowFor(period), [period]);
  const rep = useMemo(() => reportFor(win.from, win.to), [data, win]);
  const mode = GST_MODES.find((m) => m.value === (data.business.gstMode || 'courier18')) || GST_MODES[0];

  const money = (n: number) => fmtMoney(Math.round(n));

  /* --- per-report chart + columns --- */
  let chart: React.ReactNode = null;
  let columns: Array<Column<DataRow>> = [];
  let rows: DataRow[] = asRows(rep.rows);

  if (id === 'sales') {
    const days: Record<string, number> = {};
    rep.rows.forEach((b) => {
      const k = new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      days[k] = (days[k] || 0) + grossOf(b);
    });
    const entries = Object.entries(days).slice(-14);
    const peak = Math.max(1, ...entries.map(([, v]) => v));
    chart = (
      <div className="cols" role="img" aria-label="Billing per day">
        {entries.map(([k, v]) => (
          <span key={k} className="cols-col" title={`${k}: ${money(v)}`}>
            <span className="cols-bar is-today" style={{ height: `${Math.max(6, (v / peak) * 100)}%` }} />
            <span className="cols-lbl">{k.split(' ')[0]}</span>
          </span>
        ))}
      </div>
    );
    columns = asColumns<Booking>([
      { key: 'docket', label: 'Docket', type: 'text', render: (b) => <span className="mono">{b.docket}</span> },
      { key: 'createdAt', label: 'Date', type: 'date', accessor: (b) => b.createdAt, render: (b) => new Date(b.createdAt).toLocaleDateString('en-IN') },
      { key: 'name', label: 'Customer', type: 'text' },
      { key: 'to', label: 'Destination', type: 'enum' },
      { key: 'serviceType', label: 'Service', type: 'enum' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true, fmt: money, accessor: (b) => (b.tax ? b.tax.taxable : 0), render: (b) => money(b.tax ? b.tax.taxable : 0) },
      { key: 'cgst', label: 'CGST', type: 'money', total: true, fmt: money, accessor: (b) => (b.tax?.cgst || 0), render: (b) => money(b.tax?.cgst || 0) },
      { key: 'sgst', label: 'SGST', type: 'money', total: true, fmt: money, accessor: (b) => (b.tax?.sgst || 0), render: (b) => money(b.tax?.sgst || 0) },
      { key: 'igst', label: 'IGST', type: 'money', total: true, fmt: money, accessor: (b) => (b.tax?.igst || 0), render: (b) => money(b.tax?.igst || 0) },
      { key: 'total', label: 'Total', type: 'money', total: true, fmt: money, accessor: grossOf, render: (b) => money(grossOf(b)) },
      { key: 'pay', label: 'Payment', type: 'enum', accessor: (b) => (b.payment && !b.payment.settled ? 'To Pay' : 'Paid'),
        render: (b) => <span className={`pill ${b.payment && !b.payment.settled ? 'pill-warn' : 'st-delivered'}`}>{b.payment && !b.payment.settled ? 'To Pay' : 'Paid'}</span> },
    ]);
  } else if (id === 'gst') {
    const rateRows = rep.byRate.map((r) => ({ id: String(r.rate), ...r }));
    rows = asRows(rateRows);
    const peak = Math.max(1, ...rateRows.map((r) => r.gst));
    chart = (
      <ul className="rows">
        {rateRows.map((r) => (
          <li key={r.rate}>
            <span className="rows-lbl">{(r.rate * 100).toFixed(0)}% slab</span>
            <span className="rows-track"><span className="rows-fill" style={{ width: `${Math.max(4, (r.gst / peak) * 100)}%` }} /></span>
            <span className="rows-val">{money(r.gst)}</span>
          </li>
        ))}
      </ul>
    );
    columns = asColumns<RateTotal>([
      { key: 'rate', label: 'Rate', type: 'text', render: (r) => `${(r.rate * 100).toFixed(0)}%` },
      { key: 'n', label: 'Bookings', type: 'num', total: true },
      { key: 'taxable', label: 'Taxable value', type: 'money', total: true, fmt: money, render: (r) => money(r.taxable) },
      { key: 'cgst', label: 'CGST', type: 'money', total: true, fmt: money, render: (r) => money(r.cgst) },
      { key: 'sgst', label: 'SGST', type: 'money', total: true, fmt: money, render: (r) => money(r.sgst) },
      { key: 'igst', label: 'IGST', type: 'money', total: true, fmt: money, render: (r) => money(r.igst) },
      { key: 'gst', label: 'Total GST', type: 'money', total: true, fmt: money, render: (r) => money(r.gst) },
    ]);
  } else if (id === 'due') {
    const dueRows = rep.rows.filter((b) => b.payment && !b.payment.settled);
    rows = asRows(dueRows);
    const buckets = [{ k: '0-3 days', n: 0 }, { k: '4-7 days', n: 0 }, { k: 'Over a week', n: 0 }];
    dueRows.forEach((b) => {
      const d = Math.floor((Date.now() - b.createdAt) / 864e5);
      (d <= 3 ? buckets[0]! : d <= 7 ? buckets[1]! : buckets[2]!).n += grossOf(b);
    });
    const peak = Math.max(1, ...buckets.map((b) => b.n));
    chart = (
      <ul className="rows">
        {buckets.map((b, i) => (
          <li key={b.k}>
            <span className="rows-lbl">{b.k}</span>
            <span className="rows-track"><span className={`rows-fill tone-${['good', 'warning', 'critical'][i]}`} style={{ width: `${Math.max(4, (b.n / peak) * 100)}%` }} /></span>
            <span className="rows-val">{money(b.n)}</span>
          </li>
        ))}
      </ul>
    );
    columns = asColumns<Booking>([
      { key: 'docket', label: 'Docket', type: 'text', render: (b) => <span className="mono">{b.docket}</span> },
      { key: 'name', label: 'Customer', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text', render: (b) => prettyPhone(b.phone) },
      { key: 'to', label: 'Destination', type: 'enum' },
      { key: 'age', label: 'Days old', type: 'num', accessor: (b) => Math.floor((Date.now() - b.createdAt) / 864e5) },
      { key: 'total', label: 'Amount', type: 'money', total: true, fmt: money, accessor: grossOf, render: (b) => money(grossOf(b)) },
      { key: 'call', label: '', type: 'text', accessor: () => '', render: (b) => (
        <a className="btn btn-text btn-sm" href={`tel:${b.phone}`} style={{ textDecoration: 'none' }}><Msym name="call" /> Call</a>
      ) },
    ]);
  } else if (id === 'city') {
    const cityRows = rep.byCity.map((c) => ({ id: c.city, ...c }));
    rows = asRows(cityRows);
    const peak = Math.max(1, ...cityRows.map((r) => r.value));
    chart = (
      <ul className="rows">
        {cityRows.slice(0, 8).map((c) => (
          <li key={c.city}>
            <span className="rows-lbl">{c.city}</span>
            <span className="rows-track"><span className="rows-fill" style={{ width: `${Math.max(4, (c.value / peak) * 100)}%` }} /></span>
            <span className="rows-val">{money(c.value)}</span>
          </li>
        ))}
      </ul>
    );
    columns = asColumns<CityTotal>([
      { key: 'city', label: 'City', type: 'text' },
      { key: 'n', label: 'Parcels', type: 'num', total: true },
      { key: 'value', label: 'Billed', type: 'money', total: true, fmt: money, render: (c) => money(c.value) },
    ]);
  } else {
    const groups: Partial<Record<ParcelStatus, number>> = {};
    rep.rows.forEach((b) => { groups[b.status] = (groups[b.status] || 0) + 1; });
    const entries = Object.entries(groups) as Array<[ParcelStatus, number]>;
    const peak = Math.max(1, ...entries.map(([, n]) => n));
    chart = (
      <ul className="rows">
        {entries.map(([st, n]) => (
          <li key={st}>
            <span className="rows-lbl">{STATUS_LABEL[st] || st}</span>
            <span className="rows-track">
              <span className={`rows-fill${['failed_attempt', 'rto'].includes(st) ? ' tone-critical' : st === 'delivered' ? ' tone-good' : ''}`}
                style={{ width: `${Math.max(4, (n / peak) * 100)}%` }} />
            </span>
            <span className="rows-val">{n}</span>
          </li>
        ))}
      </ul>
    );
    columns = asColumns<Booking>([
      { key: 'docket', label: 'Docket', type: 'text', render: (b) => <span className="mono">{b.docket}</span> },
      { key: 'name', label: 'Customer', type: 'text' },
      { key: 'to', label: 'Destination', type: 'enum' },
      { key: 'status', label: 'Status', type: 'enum', accessor: (b) => STATUS_LABEL[b.status] || b.status, render: (b) => <StatusPill status={b.status} /> },
      { key: 'attempts', label: 'Attempts', type: 'num', accessor: (b) => b.attempts || 0 },
      { key: 'late', label: 'On a delay', type: 'enum', accessor: (b) => (activeDelayFor(b) ? 'Yes' : 'No') },
      { key: 'booked', label: 'Booked', type: 'date', accessor: (b) => b.createdAt, render: (b) => fmtDT(b.createdAt) },
    ]);
  }

  function exportCsv() {
    const head = columns.filter((c) => c.label).map((c) => c.label);
    const body = (viewRef.current?.length ? viewRef.current : rows).map((r) =>
      columns.filter((c) => c.label).map((c) => {
        const v = c.accessor ? c.accessor(r) : (r as Record<string, unknown>)[c.key];
        return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
      }));
    download(meta.title, [head, ...body], data.business, win.label, toast);
  }

  return (
    <div className="page">
      <button type="button" className="backlink" onClick={() => nav('/business/reports')}>
        <Msym name="arrow_back" /> All reports
      </button>

      <div className="rep-head">
        <IconTile name={meta.icon} size="lg" />
        <div className="u-grow">
          <h1 className="rep-title">{meta.title}</h1>
          <p className="rep-desc">{meta.desc} · {win.label}</p>
        </div>
        <Button icon="download" variant="outlined" onClick={exportCsv} disabled={!rows.length}>Export</Button>
      </div>

      <FilterChips options={PERIODS} value={period} onChange={setPeriod} />

      {rows.length === 0 ? (
        <Card><EmptyState icon="query_stats" title={`Nothing in ${win.label}`} sub="Try another period." /></Card>
      ) : (
        <>
          <Card pad className="rep-chart">{chart}</Card>
          <Card>
            <DataTable columns={columns} rows={rows} viewRef={viewRef} />
            {id === 'gst' && (
              <p className="rep-note">
                <Msym name="info" />
                <span>
                  GST is calculated on each booking and stored with it — treatment: <b>{mode.label}</b>.
                  Deliveries inside {STATE_OF_CITY[data.business.origin] || 'your state'} split half CGST + half SGST;
                  other states carry IGST.
                </span>
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
