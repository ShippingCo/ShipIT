import { createHash } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { timestamp } from '../pricing/validation.ts';
import { code, object, statuses } from './validation.ts';
import type { ObservationStatus } from './contract.ts';

export const csvLimits = { bytes: 65536, rows: 200, columns: 16, cell: 256, batch: 20 } as const;
export type ImportKind = 'shipments' | 'tracking';
export type RowError = 'COLUMN_COUNT' | 'INVALID_CODE' | 'INVALID_TIMESTAMP' | 'UNMAPPED_STATUS' |
  'REFERENCE_NOT_FOUND' | 'STALE_STATE' | 'SOURCE_CONFLICT';
export interface Candidate {
  docket: string; external_docket: string; source_id?: string; status_code?: string;
  status?: ObservationStatus; occurred_at?: string; service_code?: string; origin_code?: string; destination_code?: string;
}
export interface PreviewRow { row: number; error: RowError | null; field: string | null; candidate: Candidate | null;
  parcel_id?: string; parcel_version?: number; reference_id?: string | null; dimensions_digest?: string;
  identity?: string; fingerprint?: string }
export class CsvError extends HttpError {
  readonly issue: string;
  readonly row: number;
  constructor(issue: string, row = 0) { super('VALIDATION_FAILED'); this.issue=issue; this.row=row; }
}
const fields = {
  shipments: ['docket','external_docket','service_code','origin_code','destination_code'],
  tracking: ['docket','external_docket','source_id','status_code','occurred_at'],
} as const;

/** Bounded RFC 4180 grammar; LF and CRLF accepted, quoted fields are always inert strings. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', state: 'plain'|'quoted'|'closed' = 'plain';
  const field = () => { row.push(cell); cell = ''; state = 'plain'; if (row.length > csvLimits.columns) throw new CsvError('TOO_MANY_COLUMNS', rows.length + 1); };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > csvLimits.rows + 1) throw new CsvError('TOO_MANY_ROWS', rows.length); };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (state === 'quoted') {
      if (ch === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else state = 'closed'; }
      else cell += ch;
    } else if (ch === ',') field();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r') { if (source[i + 1] !== '\n') throw new CsvError('INVALID_CSV', rows.length + 1); i++; }
      record();
    } else if (ch === '"' && !cell && state === 'plain') state = 'quoted';
    else if (ch === '"' || state === 'closed') throw new CsvError('INVALID_CSV', rows.length + 1);
    else cell += ch;
    if (cell.length > csvLimits.cell) throw new CsvError('CELL_TOO_LONG', rows.length + 1);
  }
  if (state === 'quoted') throw new CsvError('INVALID_CSV', rows.length + 1);
  if (cell || row.length || state === 'closed') record();
  return rows;
}

export function decodeCsv(content: unknown) {
  if (typeof content !== 'string' || content.length > Math.ceil(csvLimits.bytes / 3) * 4)
    throw new CsvError('FILE_TOO_LARGE');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new CsvError('INVALID_BASE64');
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > csvLimits.bytes) throw new CsvError('FILE_TOO_LARGE');
  if (bytes.toString('base64') !== content) throw new CsvError('INVALID_BASE64');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new CsvError('UTF8_REQUIRED'); }
  if ([...source].some(ch => { const n=ch.charCodeAt(0); return (n<32 && ![9,10,13].includes(n)) || n===127; })) throw new CsvError('TEXT_CSV_REQUIRED');
  const records = parseCsv(source), headers = records.shift();
  if (!headers?.length || !records.length) throw new CsvError('EMPTY_FILE');
  if (headers.some(h => !/^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(h)) || new Set(headers).size !== headers.length) throw new CsvError('INVALID_HEADERS', 1);
  return {headers,records,file_sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function upload(value: unknown) {
  const b = object(value, ['kind','content_base64','columns','status_mapping']);
  if (b.kind !== 'shipments' && b.kind !== 'tracking') throw new CsvError('INVALID_KIND');
  const kind: ImportKind = b.kind, wanted = fields[kind];
  const {headers,records,file_sha256}=decodeCsv(b.content_base64);
  const columns = object(b.columns, [...wanted]);
  if (wanted.some(f => typeof columns[f] !== 'string' || !headers.includes(columns[f] as string)) ||
      new Set(Object.values(columns)).size !== wanted.length || headers.length !== wanted.length) throw new CsvError('COLUMN_MAPPING', 1);
  const mapping: Record<string, ObservationStatus> = Object.create(null) as Record<string, ObservationStatus>;
  if (!Array.isArray(b.status_mapping) || b.status_mapping.length > 32 || (kind === 'shipments' && b.status_mapping.length)) throw new CsvError('STATUS_MAPPING');
  for (const entry of b.status_mapping) {
    const m = object(entry, ['source_code','status']); const sourceCode = code(m.source_code);
    if (!statuses.includes(m.status as ObservationStatus) || mapping[sourceCode]) throw new CsvError('STATUS_MAPPING');
    mapping[sourceCode] = m.status as ObservationStatus;
  }
  const rows: PreviewRow[] = records.map((cells, index) => {
    const result: PreviewRow = { row: index + 2, error: null, field: null, candidate: null };
    if (cells.length !== headers.length) return { ...result, error: 'COLUMN_COUNT' };
    const values: Record<string,string> = {};
    for (const name of wanted) {
      const raw = cells[headers.indexOf(columns[name] as string)]!;
      try { values[name] = name === 'occurred_at' ? timestamp(raw, '$') : code(raw); }
      catch { return { ...result, error: name === 'occurred_at' ? 'INVALID_TIMESTAMP' : 'INVALID_CODE', field: name }; }
    }
    if (kind === 'tracking' && !mapping[values.status_code!]) return { ...result, error: 'UNMAPPED_STATUS', field: 'status_code' };
    result.candidate = { ...values, ...(kind === 'tracking' ? {status: mapping[values.status_code!]!} : {}) } as unknown as Candidate;
    return result;
  });
  return { kind, file_sha256, rows };
}
