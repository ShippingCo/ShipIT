import React, { useMemo, useState } from 'react';
import { Msym } from './Icon';

/* ============================================================
   DataTable — a small spreadsheet.

   Columns declare their type and the table works out the right filter for it:
   text gets a contains box, enum gets a dropdown of the values actually present,
   numbers get min/max. Sorting is per column. The parent is handed the filtered
   rows back so Export writes exactly what is on screen.
   ============================================================ */

/**
 * Any object. A table is generic over the record it is showing.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: an interface such as
 * Booking has no implicit index signature, so it does not satisfy a Record constraint,
 * and every caller would have to launder its rows through a cast to use this table.
 */
export type DataRow = object;

export type ColumnType = 'text' | 'enum' | 'num' | 'money' | 'date';

export interface Column<R extends DataRow = DataRow> {
  key: string;
  label: React.ReactNode;
  /** Drives which filter control the column gets, and how it sorts. */
  type?: ColumnType;
  /** Pulls the value when it is not simply row[key] — a join, a computed total. */
  accessor?: (row: R) => unknown;
  /** Renders the cell. Defaults to the raw value. */
  render?: (row: R) => React.ReactNode;
  /** Sums the column into a footer row. */
  total?: boolean;
  /** Formats that footer total, e.g. as rupees. Defaults to a rounded number. */
  fmt?: (n: number) => React.ReactNode;
}

/** A numeric column filters on a range; everything else filters on a single value. */
type RangeFilter = { min?: string; max?: string };
type FilterValue = string | RangeFilter | undefined;

interface SortState {
  key: string;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}

const val = <R extends DataRow>(col: Column<R>, row: R): unknown =>
  (col.accessor ? col.accessor(row) : (row as Record<string, unknown>)[col.key]);

const isRange = (f: FilterValue): f is RangeFilter => typeof f === 'object' && f !== null;

/** Narrows a stored filter to the shape the control for that column type expects. */
const asText = (f: FilterValue): string => (typeof f === 'string' ? f : '');
const asRange = (f: FilterValue): RangeFilter => (isRange(f) ? f : {});

function passes<R extends DataRow>(col: Column<R>, row: R, f: FilterValue) {
  if (f == null || f === '' || (isRange(f) && !f.min && !f.max)) return true;
  if (f == null || f === '' || (typeof f === 'object' && !f.min && !f.max)) return true;
  const v = val(col, row);
  if (col.type === 'num' || col.type === 'money') {
    if (!isRange(f)) return true;
    const n = Number(v) || 0;
    if (f.min !== '' && f.min != null && n < Number(f.min)) return false;
    if (f.max !== '' && f.max != null && n > Number(f.max)) return false;
    return true;
  }
  if (col.type === 'enum') return String(v) === String(f);
  return String(v ?? '').toLowerCase().includes(String(f).toLowerCase());
}

export interface DataTableProps<R extends DataRow = DataRow> {
  columns: Array<Column<R>>;
  rows: R[];
  /** Receives the filtered, sorted rows so Export writes what is on screen. */
  viewRef?: React.MutableRefObject<R[]>;
  empty?: React.ReactNode;
}

export default function DataTable<R extends DataRow = DataRow>({ columns, rows, viewRef, empty }: DataTableProps<R>) {
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [sort, setSort] = useState<SortState | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const enums = useMemo(() => {
    const out: Record<string, string[]> = {};
    columns.filter((c) => c.type === 'enum').forEach((c) => {
      out[c.key] = [...new Set(rows.map((r) => String(val(c, r))))].sort();
    });
    return out;
  }, [columns, rows]);

  const view = useMemo(() => {
    let out = rows.filter((r) => columns.every((c) => passes(c, r, filters[c.key])));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (!col) return out;
      out = [...out].sort((a, b) => {
        const va = val(col, a); const vb = val(col, b);
        const na = col.type === 'num' || col.type === 'money' || col.type === 'date';
        const cmp = na ? (Number(va) || 0) - (Number(vb) || 0) : String(va ?? '').localeCompare(String(vb ?? ''));
        return cmp * sort.dir;
      });
    }
    return out;
  }, [rows, columns, filters, sort]);

  /* Hand the filtered rows out through a ref so Export writes what is on screen,
     without triggering a parent re-render (which would loop back into this memo). */
  React.useEffect(() => { if (viewRef) viewRef.current = view; }, [view, viewRef]);

  const activeFilters = Object.entries(filters).filter(([, v]) =>
    v && (!isRange(v) || v.min || v.max)).length;

  const toggleSort = (key: string) =>
    setSort((s): SortState | null => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const sortIcon = (key: string) => (sort?.key !== key ? 'unfold_more' : sort.dir === 1 ? 'arrow_upward' : 'arrow_downward');

  const totals = columns.map((c) =>
    (c.total ? view.reduce((n, r) => n + (Number(val(c, r)) || 0), 0) : null));

  return (
    <>
      <div className="dt-bar">
        <button type="button" className={`dt-toggle${showFilters ? ' on' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          <Msym name="filter_alt" />
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </button>
        <span className="dt-count">
          {view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length} rows`}
        </span>
        {activeFilters > 0 && (
          <button type="button" className="dt-clear" onClick={() => setFilters({})}>Clear filters</button>
        )}
      </div>

      <div className="tbl-wrap">
        <table className="tbl dt">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.type === 'num' || c.type === 'money' ? 'ta-r' : undefined}>
                  <button type="button" className={`th-sort${c.type === 'num' || c.type === 'money' ? ' is-r' : ''}`}
                    onClick={() => toggleSort(c.key)}>
                    {c.label} <Msym name={sortIcon(c.key)} />
                  </button>
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr className="dt-filters">
                {columns.map((c) => (
                  <th key={c.key}>
                    {c.type === 'enum' ? (
                      <select value={asText(filters[c.key])} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}>
                        <option value="">All</option>
                        {(enums[c.key] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : c.type === 'num' || c.type === 'money' ? (
                      <span className="dt-range">
                        <input type="number" placeholder="min" value={asRange(filters[c.key]).min ?? ''}
                          onChange={(e) => setFilters((f) => ({ ...f, [c.key]: { ...asRange(f[c.key]), min: e.target.value } }))} />
                        <input type="number" placeholder="max" value={asRange(filters[c.key]).max ?? ''}
                          onChange={(e) => setFilters((f) => ({ ...f, [c.key]: { ...asRange(f[c.key]), max: e.target.value } }))} />
                      </span>
                    ) : (
                      <input type="text" placeholder="contains" value={asText(filters[c.key])}
                        onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={typeof (r as { id?: unknown }).id === 'string' ? String((r as { id?: unknown }).id) : i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.type === 'num' || c.type === 'money' ? 'ta-r' : undefined}>
                    {c.render ? c.render(r) : String(val(c, r) ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals.some(Boolean) && view.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.type === 'num' || c.type === 'money' ? 'ta-r' : undefined}>
                    {i === 0 ? 'Total' : totals[i] != null ? (c.fmt ? c.fmt(totals[i]!) : Math.round(totals[i]!)) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {view.length === 0 && <div className="dt-empty">{empty || 'Nothing matches these filters.'}</div>}
      </div>
    </>
  );
}
