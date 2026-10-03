import { describe, expect, it } from 'vitest';
import { CsvError, csvLimits, parseCsv, upload } from '../../src/modules/carriers/csv.ts';
const columns={docket:'docket',external_docket:'external_docket',source_id:'source_id',status_code:'status_code',occurred_at:'occurred_at'};
const header=Object.keys(columns).join(',');
const row='SIT-1,EXT-1,EV-1,MOVING,2026-10-03T06:00:00Z';
const body=(csv=header+'\n'+row)=>({kind:'tracking',content_base64:Buffer.from(csv).toString('base64'),columns,status_mapping:[{source_code:'MOVING',status:'in_transit_claim'}]});
describe('bounded carrier CSV grammar and semantic validation',()=>{
  it('handles BOM, CRLF, LF, doubled quotes and quoted newlines as inert data',()=>{
    expect(upload(body('\uFEFF'+header+'\r\n'+row+'\r\n')).rows[0]?.candidate?.status).toBe('in_transit_claim');
    expect(parseCsv('a,b\r\n"hello\nworld","a""b"\r\n')).toEqual([['a','b'],['hello\nworld','a"b']]);
    expect(parseCsv('x\n"=SUM(1,2)"')).toEqual([['x'],['=SUM(1,2)']]);
  });
  it.each(['x\n"open','x\n"closed"extra','x\na"b','x\ra'])('rejects ambiguous grammar %s',csv=>expect(()=>parseCsv(csv)).toThrow(CsvError));
  it('rejects non-UTF8, binary and oversized data without returning source bytes',()=>{
    expect(()=>upload({...body(),content_base64:Buffer.from([0xff,0xfe,0]).toString('base64')})).toThrow('VALIDATION_FAILED');
    expect(()=>upload(body(header+'\n\u0000'))).toThrow(CsvError);
    expect(()=>upload(body('a'.repeat(csvLimits.bytes+1)))).toThrow(CsvError);
    expect(()=>upload({...body(),content_base64:'!!!!'})).toThrow(CsvError);
  });
  it('bounds cells, columns and row count',()=>{
    expect(()=>parseCsv('x\n'+'a'.repeat(257))).toThrow(CsvError);
    expect(()=>parseCsv(Array(17).fill('a').join(','))).toThrow(CsvError);
    expect(()=>parseCsv('x\n'+Array(201).fill('a').join('\n'))).toThrow(CsvError);
    expect(parseCsv('x\n'+Array(200).fill('a').join('\n'))).toHaveLength(201);
  });
  it('requires unambiguous exact column mapping and rejects extra PII columns',()=>{
    expect(()=>upload(body(header+',address\n'+row+',Private address'))).toThrow(CsvError);
    expect(()=>upload({...body(),columns:{...columns,docket:'external_docket'}})).toThrow(CsvError);
    expect(()=>upload(body('docket,docket\nx,y'))).toThrow(CsvError);
    expect(()=>upload(body(''))).toThrow(CsvError);
  });
  it('preserves row numbering and removes invalid values from preview candidates',()=>{
    const result=upload(body(header+'\n'+row+'\nSIT-2,EXT-2\n'+row.replace('MOVING','UNKNOWN')+'\n'+row.replace('EXT-1','"=SUM(1,2)"')));
    expect(result.rows.map(r=>[r.row,r.error])).toEqual([[2,null],[3,'COLUMN_COUNT'],[4,'UNMAPPED_STATUS'],[5,'INVALID_CODE']]);
    expect(result.rows.slice(1).every(r=>r.candidate===null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SUM');
  });
  it.each(['2026-02-30T06:00:00Z','2026-10-03','2026-10-03T06:00:00','2026-10-03T25:00:00Z'])('rejects ambiguous or invalid time %s',at=>{
    expect(upload(body(header+'\n'+row.replace('2026-10-03T06:00:00Z',at))).rows[0]?.error).toBe('INVALID_TIMESTAMP');
  });
  it('normalizes explicit timezone without interpreting statuses heuristically',()=>{
    expect(upload(body(header+'\n'+row.replace('06:00:00Z','11:30:00+05:30'))).rows[0]?.candidate?.occurred_at).toBe('2026-10-03T06:00:00Z');
    expect(()=>upload({...body(),status_mapping:[{source_code:'MOVING',status:'delivered'}]})).toThrow(CsvError);
  });
});
