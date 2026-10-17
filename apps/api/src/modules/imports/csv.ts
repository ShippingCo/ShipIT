import { createHash } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';

export const csvLimits = { bytes: 65536, rows: 200, columns: 16, cell: 256, batch: 20 } as const;
export class CsvError extends HttpError {
  readonly issue: string;
  readonly row: number;
  constructor(issue: string, row = 0) { super('VALIDATION_FAILED'); this.issue=issue; this.row=row; }
}
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
