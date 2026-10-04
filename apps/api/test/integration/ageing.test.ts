import { describe,it,expect } from 'vitest';
import { ageing,ageingFilter,ageingSummary } from '../../src/modules/reports/ageing-rules.ts';
import type { AgeingRow } from '@shippingco/shared';
describe('ageing business boundaries',()=>{
  it('assigns exactly one Kolkata calendar bucket at days 0,30,31,60,61 and midnight',()=>{
    const anchor='2026-01-01T18:30:00Z';
    for(const [days,bucket] of [[0,'0_30'],[30,'0_30'],[31,'31_60'],[60,'31_60'],[61,'61_plus']] as const)
      expect(ageing(anchor,new Date(Date.parse(anchor)+days*86400000).toISOString())).toEqual({age_days:days,bucket});
    expect(ageing(anchor,'2026-02-01T18:29:59.999Z').bucket).toBe('0_30');
    expect(ageing(anchor,'2026-02-01T18:30:00Z').bucket).toBe('31_60');
    expect(ageing(null,anchor)).toEqual({age_days:null,bucket:'unknown'});
    expect(ageing('2026-01-03T18:30:00Z',anchor)).toEqual({age_days:-2,bucket:'future'});
  });
  it('ages only residual debt, keeps credits separate and sums beyond safe JS integers',()=>{
    const row={original_gross:'9007199254740991',reductions:'0',gross:'9007199254740991',collections:'100',reversals:'50',refunds:'0',net_collections:'50',outstanding:'9007199254740941',refundable_credit:'0',bucket:'31_60'} as AgeingRow;
    const summary=ageingSummary([row,row]);expect(summary.totals.outstanding).toBe('18014398509481882');expect(summary.buckets['31_60']).toBe(summary.totals.outstanding);expect(summary.buckets['0_30']).toBe('0');
    expect(ageingSummary([]).totals.outstanding).toBe('0');
  });
  it('rejects invented cutoffs, ownership, policy and status instead of silently changing scope',()=>{
    expect(ageingFilter({})).toEqual({anchor:'booking',status:null,customer_id:null,balances:'outstanding'});
    for(const b of [{as_of:'2020-01-01'},{franchise_id:'foreign'},{anchor:'delivery'},{status:'paid'},{customer_id:'phone'},{balances:'due'},{buckets:[90]}])expect(()=>ageingFilter(b)).toThrow();
  });
});
