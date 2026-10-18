import {describe,it,expect} from 'vitest';
import type {DailyRow} from '@shippingco/shared';
import {dailyWindows,dailyMetrics,dailyComparison,dailyEvidence} from '../../src/modules/reports/daily-rules.ts';
import {dailyFilter} from '../../src/modules/reports/daily-service.ts';
const base:DailyRow={id:'00000000-0000-4000-8000-000000000001',franchise_id:'00000000-0000-4000-8000-000000000002',period:'today',kind:'booking',occurred_at:'2026-10-18T00:00:00.000Z',customer_id:'00000000-0000-4000-8000-000000000003',method:null,eligible:true,in_period:true,new_customer:true,billed_gross:'100000',tax_exclusive_revenue:'95000',collections:'0',refunds:'0',outstanding:'40000'};
describe('owner daily definitions',()=>{
 it('keeps IST midnight half-open and distinguishes complete versus elapsed yesterday',()=>{
  const midnight=new Date('2026-10-17T18:30:00.000Z');
  expect(dailyWindows(midnight,null,'same_elapsed')).toEqual([{period:'today',from:midnight.toISOString(),to:midnight.toISOString()},{period:'yesterday',from:'2026-10-16T18:30:00.000Z',to:'2026-10-16T18:30:00.000Z'}]);
  expect(dailyWindows(midnight,null,'complete_day')[1]!.to).toBe(midnight.toISOString());
  expect(dailyWindows(new Date('2026-10-18T03:30:00Z'),null,'same_elapsed')[1]!.to).toBe('2026-10-17T03:30:00.000Z');
  expect(()=>dailyWindows(midnight,'2026-10-19','same_elapsed')).toThrow();
  expect(()=>dailyFilter({day:'2026-02-30'},base.franchise_id)).toThrow();
  expect(()=>dailyFilter({franchise_ids:[base.franchise_id,base.franchise_id]},base.franchise_id)).toThrow();
 });
 it('counts distinct relationships, excludes cancellations and rounds eligible average in integer paise',()=>{
  const rows=[base,{...base,id:'second'},{...base,id:'third',billed_gross:'100001'}, {...base,id:'cancelled',eligible:false,billed_gross:'0',tax_exclusive_revenue:'0',outstanding:'0'}, {...base,id:'old',in_period:false,new_customer:false,billed_gross:'0',tax_exclusive_revenue:'0',outstanding:'100'}];
  const m=dailyMetrics(rows);expect(m.bookings).toBe(3);expect(m.customers).toBe(1);expect(m.new_customers).toBe(1);expect(m.returning_customers).toBe(0);expect(m.average_bill).toBe('100000');expect(m.outstanding).toBe('120100');
  const sibling={...base,franchise_id:'other',new_customer:false};expect(dailyMetrics([base,sibling]).customers).toBe(2);
  const empty=dailyMetrics([]);expect(empty.average_bill).toBeNull();expect(dailyComparison(m,empty).every(c=>c.percent===null)).toBe(true);
  expect(dailyComparison({...m,collections:'0'},{...m,collections:'40000'}).find(c=>c.metric==='collections')).toMatchObject({delta:'-40000',percent:'-100.00'});
 });
 it('separates receipt-day inflows, reversals and actual refunds with exact source drill-through',()=>{
  const receipt={...base,id:'receipt',kind:'receipt' as const,method:'cash',billed_gross:'0',tax_exclusive_revenue:'0',collections:'60000',outstanding:'0'},tomorrow={...receipt,period:'yesterday' as const,collections:'40000'},refund={...receipt,id:'refund',kind:'refund' as const,method:null,collections:'0',refunds:'500'};
  const rows=[base,receipt,tomorrow,refund];const today=dailyMetrics(rows.filter(r=>r.period==='today'));
  expect(today.billed_gross).toBe('100000');expect(today.collections).toBe('60000');expect(today.refunds).toBe('500');expect(today.methods).toEqual([{method:'cash',paise:'60000'}]);
  expect(dailyEvidence(rows,'today','collections')).toEqual([receipt]);expect(dailyEvidence(rows,'yesterday','collections')).toEqual([tomorrow]);expect(dailyEvidence(rows,'today','refunds')).toEqual([refund]);expect(dailyEvidence(rows,'today','outstanding')).toEqual([base]);
  expect(dailyEvidence(rows,'today','collections','cash')).toEqual([receipt]);expect(dailyEvidence(rows,'today','collections','upi')).toEqual([]);expect(()=>dailyEvidence(rows,'today','bookings','cash')).toThrow();
  expect(()=>dailyEvidence(rows,'foreign','collections')).toThrow();
 });
});
