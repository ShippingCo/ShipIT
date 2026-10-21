import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {accountantRows,reconcileControls,accountantCsv,accountantFiles,reconciliationEvidence} from '../../src/modules/reports/accountant-rules.ts';
import {accountantFilter} from '../../src/modules/reports/accountant-service.ts';
import type {AccountantRow,AccountantSnapshot} from '@shippingco/shared';
import {csvRecords} from '../report-csv-support.ts';
const franchise='00000000-0000-4000-8000-000000000001';
const raw:Omit<AccountantRow,'id'>={family:'receipts',meaning:'economic_receipt',basis:'period',fields:{source_id:'receipt',franchise_id:franchise,received_paise:'9007199254740991',external_reference:'=private'}};
const snapshot:AccountantSnapshot={id:franchise,schema_version:1,definition:'accountant_register_v1',mapping_version:'generic_csv_v1',timezone:'Asia/Kolkata',organization_id:franchise,franchise_id:franchise,filter:accountantFilter({from_day:'2026-10-01',to_day:'2026-10-31'},franchise),as_of:'2026-10-19T00:00:00.000001Z',expires_at:'2026-10-20T00:00:00.000001Z',count:0,controls:[],qualification:'generic_only',reconciliation_state:'disabled'};
describe('accountant register boundaries',()=>{
 it('exports distinct period basis and fee basis without ambiguous duplicate headers',()=>{
  const fee:AccountantRow={id:'fee-line',family:'agent_fees',meaning:'reference_fee_entitlement',basis:'period',fields:{source_id:'fee',franchise_id:franchise,basis:'agreed_period',earned_paise:'2000'}};
  const file=accountantFiles(snapshot,[fee]).find(f=>f.name==='agent_fees.csv')!;
  const decoded=csvRecords(file.csv);expect(decoded).toHaveLength(1);expect(decoded[0]!.basis).toBe('period');expect(decoded[0]!.fee_basis).toBe('agreed_period');expect(decoded[0]!.earned_paise).toBe('2000');
 });
 it('keeps export capture distinct from settlement source capture and every bundle header unique',()=>{
  const settlement:AccountantRow={id:'settlement-line',family:'settlements',meaning:'reference_settlement',basis:'period',fields:{source_id:'submission',franchise_id:franchise,capture_id:'source-capture'}};
  const files=accountantFiles(snapshot,[settlement]);for(const file of files)csvRecords(file.csv);
  const row=csvRecords(files.find(f=>f.name==='settlements.csv')!.csv)[0]!;expect(row.capture_id).toBe(snapshot.id);expect(row.source_capture_id).toBe('source-capture');
 });
 it('reproduces the exact unqualified accountant review pack',()=>{expect(execFileSync(process.execPath,[fileURLToPath(new URL('../../../../scripts/generate-accountant-review-pack.mjs',import.meta.url)),'--check'],{encoding:'utf8'})).toContain('target import remains pending');});
 it('keeps source IDs stable across captures, references and revised values; rejects duplicate lines',()=>{
  const a=accountantRows([raw],false)[0]!,b=accountantRows([{...raw,fields:{...raw.fields,received_paise:'1'}}],true)[0]!;
  expect(a.id).toBe(b.id);expect(a.fields.external_reference).toBeNull();expect(b.fields.external_reference).toBe('=private');expect(()=>accountantRows([raw,raw],false)).toThrow();
 });
 it('compares independent controls without floating point and rejects a discrepancy',()=>{
  const rows=accountantRows([raw,{...raw,fields:{...raw.fields,source_id:'second'}}],false);
  const control={family:'receipts',basis:'period',column:'received_paise',source_paise:'18014398509481982'};
  expect(reconcileControls(rows,[control])[0]!.difference_paise).toBe('0');expect(()=>reconcileControls(rows,[{...control,source_paise:'18014398509481981'}])).toThrow();
 });
 it('escapes arbitrary text but preserves exact signed integer paise',()=>{
  for(const value of ['=cmd','+cmd','-cmd','@cmd','\tcmd','\r=1','\n=1','  =1','\uFEFF+1','＝1'])expect(accountantCsv(['reference'],[[value]])).toContain('"\'');
  const csv=accountantCsv(['amount_paise','reference'],[['-40','one,"two"\r\nthree']]);
  expect(csvRecords(csv)).toEqual([{amount_paise:'-40',reference:'one,"two"\r\nthree'}]);
 });
 it('rejects unsupported formats, invalid dates, duplicate scopes and mass assignment',()=>{
  for(const value of [{format:'gnucash'},{from_day:'2026-02-30'},{to_day:'2026-12-01'},{franchise_ids:[franchise,franchise]},{organization_id:franchise},{include_references:'true'}])expect(()=>accountantFilter({from_day:snapshot.filter.from_day,to_day:snapshot.filter.to_day,...value},franchise)).toThrow();
 });
 it('always emits every family and dictionary, bounded as one bundle',()=>{
  const files=accountantFiles(snapshot,[]);for(const name of ['sales','refunds','booking_positions','advance_positions','cod_positions','reconciliation','shipments','gst_summary','controls','dictionary','manifest'])expect(files.some(f=>f.name===name+'.csv')).toBe(true);
  expect(files.find(f=>f.name==='manifest.csv')!.csv).toContain('not delta');
  expect(()=>accountantFiles(snapshot,accountantRows([{...raw,fields:{...raw.fields,external_reference:'x'.repeat(8*1024*1024)}}],true))).toThrow();
 });
 it('retains matching amounts and source versions without raw statement payloads',()=>{
  expect(reconciliationEvidence({external_id:'PRIVATE',candidate:{raw:'PRIVATE'},reason:'PRIVATE',matches:[{id:'match',sources:[{source_id:'receipt',source_version:'2',amount_paise:'490000',is_fee:false}],reason:'PRIVATE'}],receipts:[{source_id:'receipt',source_version:'2',amount_paise:'500000'}],fees:[{source_id:'fee',amount_paise:'10000'}]})).toEqual({matches:[{id:'match',sources:[{source_id:'receipt',source_version:'2',amount_paise:'490000',is_fee:false}]}],receipts:[{source_id:'receipt',source_version:'2',amount_paise:'500000'}],fees:[{source_id:'fee',amount_paise:'10000'}]});
 });
});
