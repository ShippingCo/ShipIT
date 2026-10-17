import {describe,it,expect} from 'vitest';
import {mappingInput} from '../../src/modules/reconciliation/validation.ts';
import {statementMoney,statementPreview} from '../../src/modules/reconciliation/csv.ts';
const map=()=>mappingInput({expected_version:0,name:'Fictional configurable format',identity_namespace:'SYNTHETIC',date_column:'Date',date_format:'yyyy-mm-dd',amount:{mode:'signed',unit:'rupees',amount_column:'Amount',positive_direction:'credit'},reference_column:'Ref',identity_column:'ID',currency_column:null});
const file=(rows:string)=>Buffer.from('Date,Amount,Ref,ID,Private unused note\r\n'+rows).toString('base64');
const preview=(rows:string)=>statementPreview(file(rows),map(),'2026-01-01','2026-01-31');
describe('private configurable statement CSV',()=>{
 it('parses exact paise and selected evidence while dropping unselected private cells',()=>{
  const result=preview('2026-01-05,500.01,UPI-X,TX-1,"Fictional, private note"\r\n2026-01-06,-3.2,,TX-2,unused');
  expect(result.rows).toEqual([{row:2,error:null,candidate:{business_date:'2026-01-05',direction:'credit',amount_paise:50001,currency:'INR',external_reference:'UPI-X',external_id:'TX-1'}},{row:3,error:null,candidate:{business_date:'2026-01-06',direction:'debit',amount_paise:320,currency:'INR',external_reference:null,external_id:'TX-2'}}]);
  expect(JSON.stringify(result)).not.toContain('private note');expect(result.file_sha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it('never guesses separators, unsafe money, signs or sub-paise rounding',()=>{
  for(const value of ['1,000','1e3','NaN','Infinity','0.001','+500','-500','90071992547410','01.00','=500'])expect(()=>statementMoney(value,'rupees')).toThrow();
  expect(statementMoney('90071992547409.91','rupees')).toBe(Number.MAX_SAFE_INTEGER);expect(()=>statementMoney('90071992547409.92','rupees')).toThrow();
  expect(statementMoney('500','paise')).toBe(500);expect(()=>statementMoney('5.00','paise')).toThrow();
 });
 it('rejects invalid calendar dates, out-of-period rows and malformed column counts without returning source cells',()=>{
  expect(preview('2026-02-30,1,X,Y,secret\n2026-02-01,1,X,Y,secret\n2026-01-01,1,X,Y').rows.map(r=>[r.error,r.candidate])).toEqual([['INVALID_DATE',null],['OUTSIDE_PERIOD',null],['COLUMN_COUNT',null]]);
  expect(()=>statementPreview(file('2026-01-01,1,X,Y,x'),map(),'2026-02-30','2026-03-01')).toThrow();
 });
 it('supports explicitly selected DMY and separate credit/debit fields; both/zero amounts are rejected',()=>{
  const m=mappingInput({...map(),date_format:'dd/mm/yyyy',amount:{mode:'credit_debit',unit:'rupees',credit_column:'Credit',debit_column:'Debit'},currency_column:'Currency'});
  const content=Buffer.from('Date,Credit,Debit,Ref,ID,Currency\n05/01/2026,500,,R,I,INR\n06/01/2026,,25,R,J,INR\n07/01/2026,2,3,R,K,INR\n08/01/2026,0,,R,L,INR\n09/01/2026,1,,R,M,USD').toString('base64');
  const rows=statementPreview(content,m,'2026-01-01','2026-01-31').rows;
  expect(rows[0]!.candidate?.amount_paise).toBe(50000);expect(rows[1]!.candidate?.direction).toBe('debit');expect(rows.slice(2).map(r=>r.error)).toEqual(['INVALID_AMOUNT','INVALID_AMOUNT','CURRENCY_MISMATCH']);
 });
 it('supports explicit direction tokens and leaves missing IDs unproven',()=>{
  const m=mappingInput({...map(),date_format:'dd-mm-yyyy',identity_column:null,amount:{mode:'direction',unit:'paise',amount_column:'Amount',direction_column:'Kind',credit_value:'CR',debit_value:'DR'}});
  const rows=statementPreview(Buffer.from('Date,Amount,Kind,Ref\n02-01-2026,500,CR,R\n02-01-2026,500,credit,R').toString('base64'),m,'2026-01-01','2026-01-31').rows;
  expect(rows[0]!.candidate).toMatchObject({amount_paise:500,direction:'credit',external_id:null});expect(rows[1]!.error).toBe('INVALID_DIRECTION');
 });
 it('keeps spreadsheet-looking references inert and makes no identity from equal amounts/dates',()=>{
  const rows=preview('2026-01-01,100,=SUM(A1),,x\n2026-01-01,100,=SUM(A1),,x').rows;
  expect(rows).toHaveLength(2);expect(rows.every(r=>r.candidate?.external_id===null)).toBe(true);expect(rows[0]!.candidate?.external_reference).toBe('=SUM(A1)');
 });
 it('bounds bytes, rows and cells and rejects unknown/missing mapping fields',()=>{
  expect(()=>statementPreview('not base64',map(),'2026-01-01','2026-01-31')).toThrow();
  expect(()=>preview('2026-01-01,1,X,Y,'+'x'.repeat(257))).toThrow();
  expect(()=>preview(Array(201).fill('2026-01-01,1,X,Y,x').join('\n'))).toThrow();
  expect(()=>mappingInput({...map(),organization_id:'injected'})).toThrow();
  expect(()=>mappingInput({...map(),amount:{...map().amount,unknown:true}})).toThrow();
  expect(()=>statementPreview(Buffer.from('Date,Amount\n2026-01-01,1').toString('base64'),map(),'2026-01-01','2026-01-31')).toThrow();
 });
});
