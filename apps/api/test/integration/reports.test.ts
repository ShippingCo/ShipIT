import { describe,it,expect } from 'vitest';
import { csvCell,reportFilter,utcRange,totals } from '../../src/modules/reports/rules.ts';
import type { ReportRow } from '@shippingco/shared';
describe('report boundaries',()=>{
  it('uses inclusive Kolkata days and an exclusive UTC end',()=>{
    expect(utcRange(reportFilter({from_day:'2026-10-01',to_day:'2026-10-01'}))).toEqual({from:'2026-09-30T18:30:00.000Z',to:'2026-10-01T18:30:00.000Z'});
    for(const from_day of ['2026-02-29','2026-13-01','2026-01-01\n'])expect(()=>reportFilter({from_day,to_day:'2026-03-01'})).toThrow();
    expect(()=>reportFilter({from_day:'2026-01-01',to_day:'2026-02-01'})).toThrow();
    expect(()=>reportFilter({from_day:'2026-10-01',to_day:'2026-10-01',franchise_id:'foreign'})).toThrow();
  });
  it('neutralizes formula/control prefixes and quotes delimiters',()=>{
    for(const cell of ['=SUM(1,2)','+2','-1','@cmd','\tcmd','\r=1','\n=1','  =1','\uFEFF+1','＝1'])expect(csvCell(cell).startsWith('"\'')).toBe(true);
    expect(csvCell('one,"two"\r\nthree')).toBe('"one,""two""\r\nthree"');
  });
  it('empty totals distinguish zero from unavailable source',()=>{
    expect(totals([]).collections).toEqual({state:'known',paise:'0'});
    expect(totals([]).seller_cod_liability).toEqual({state:'unknown',reason:'source_unavailable'});
  });
  it('aggregates exact paise beyond safe JS numbers without treating custody or credit as revenue',()=>{
    const row:ReportRow={id:'booking',confirmed_at:'2026-10-01T00:00:00.000Z',source:{type:'booking',id:'booking',version:1,correction_of:null},
      payment_source:{type:'payment_ledger',id:'obligation',version:2,correction_of:null},billed_gross:'9007199254740991',tax_exclusive_revenue:'9007199254740990',
      collections:'3',outstanding:'9007199254740988',cost:{state:'unknown',reason:'evidence_missing'},due_at:null};
    const total=totals([row,row]);expect(total.billed_gross).toEqual({state:'known',paise:'18014398509481982'});
    expect(total.collections).toEqual({state:'known',paise:'6'});expect(total.agent_custody.state).toBe('unknown');expect(total.refundable_credit.state).toBe('unknown');
  });
});
