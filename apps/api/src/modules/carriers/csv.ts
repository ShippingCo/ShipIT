import {CsvError,decodeCsv} from '../imports/csv.ts';
export {csvLimits,CsvError,decodeCsv,parseCsv} from '../imports/csv.ts';
import { timestamp } from '../pricing/validation.ts';
import { code, object, statuses } from './validation.ts';
import type { ObservationStatus } from './contract.ts';

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
const fields = {
  shipments: ['docket','external_docket','service_code','origin_code','destination_code'],
  tracking: ['docket','external_docket','source_id','status_code','occurred_at'],
} as const;

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
