import {describe,it,expect} from 'vitest';
import {performanceFilter,performanceTiming,performanceSummary,performanceGroups,performanceCsv} from '../../src/modules/reports/performance-rules.ts';
import type {PerformanceRow,PerformanceSnapshot} from '@shippingco/shared';
const row:Omit<PerformanceRow,'duration_seconds'|'outcome'>={id:'p',booking_id:'b',customer_id:'c',confirmed_at:'2026-10-01T00:00:00.000Z',version:2,
  destination:'DELHI',service:'standard',courier:null,status:'delivered',failed_attempts:0,dispatched_at:'2026-10-01T01:00:00.000Z',delivered_at:'2026-10-01T03:00:00.000Z',
  original_eta_at:'2026-10-01T02:00:00.000Z',revised_eta_at:'2026-10-01T04:00:00.000Z',original_eta_version:3,revised_eta_version:4,
  route_id:'r',manifest_id:'m',route_departed_at:null,route_arrived_at:null};
describe('delivery performance cohort and timing boundaries',()=>{
  it('keeps original and revised ETA results separate and includes equality',()=>{
    expect(performanceTiming(row,'original').outcome).toBe('delayed');expect(performanceTiming(row,'revised').outcome).toBe('on_time');
    expect(performanceTiming({...row,original_eta_at:row.delivered_at},'original').outcome).toBe('on_time');
    expect(performanceTiming(row,'original').duration_seconds).toBe(7200);
  });
  it('excludes open/RTO/missing timing from the delivered-only rate and preserves failed attempts',()=>{
    const rows=[performanceTiming({...row,original_eta_at:row.delivered_at},'original'),performanceTiming(row,'original'),
      performanceTiming({...row,status:'in_transit',delivered_at:null,failed_attempts:1},'original'),
      performanceTiming({...row,status:'rto',delivered_at:null,failed_attempts:2},'original'),
      performanceTiming({...row,delivered_at:null,dispatched_at:null,destination:null},'original')];
    const summary=performanceSummary(rows);
    expect(summary.on_time).toEqual({numerator:1,denominator:2,excluded:1});expect(summary.duration).toEqual({total_seconds:14400,denominator:2,excluded:1});
    expect(summary).toMatchObject({booked:5,delivered:3,open:1,rto:1,failed_parcels:2,failed_attempts:3,unknown_destination:1,unknown_courier:5});
    const groups=performanceGroups(rows,'destination');expect(groups.reduce((n,g)=>n+g.summary.booked,0)).toBe(summary.booked);
    expect(groups.find(g=>g.key===null)?.summary.booked).toBe(1);
  });
  it('does not invent duration from missing or backwards timestamps',()=>{
    expect(performanceTiming({...row,dispatched_at:null},'original').duration_seconds).toBeNull();
    expect(performanceTiming({...row,dispatched_at:'2026-10-02T00:00:00.000Z'},'original').duration_seconds).toBeNull();
    expect(performanceTiming({...row,original_eta_at:null},'original').outcome).toBe('unknown');
    expect(performanceSummary([]).on_time).toEqual({numerator:0,denominator:0,excluded:0});
  });
  it('bounds filters and exports exact rows with formula-safe unknown dimensions',()=>{
    const filter=performanceFilter({from_day:'2026-10-01',to_day:'2026-10-01'});expect(filter.eta).toBe('original');
    for(const eta of ['latest',false])expect(()=>performanceFilter({...filter,eta})).toThrow();
    expect(()=>performanceFilter({...filter,franchise_id:'other'})).toThrow();
    const r=performanceTiming({...row,destination:'=formula'},'original');
    const snapshot:PerformanceSnapshot={id:'s',schema_version:1,definition:'delivery_performance_v1',timezone:'Asia/Kolkata',organization_id:'o',franchise_id:'f',filter,
      as_of:row.confirmed_at,expires_at:row.confirmed_at,freshness:{state:'captured',captured_at:row.confirmed_at},count:1,summary:performanceSummary([r]),destinations:performanceGroups([r],'destination'),routes:performanceGroups([r],'route_id')};
    const csv=performanceCsv(snapshot,[r]);expect(csv).toContain('"\'=formula"');expect(csv.split('\r\n')).toHaveLength(3);
  });
});
