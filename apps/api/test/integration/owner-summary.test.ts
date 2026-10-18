import {describe,it,expect} from 'vitest';
import {ownerSummaryIdentity,ownerSummaryTiming,ownerScheduleInput} from '../../src/modules/reports/owner-summary-rules.ts';
const timing={frequency:'daily',timezone:'Asia/Kolkata',minute:540,weekday:1};
describe('owner summary scheduling boundaries',()=>{
 it('rejects malformed thresholds, duplicate selections, ownership fields and invalid configuration versions',()=>{
  const id='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012';
  const input={expected_version:0,name:'Owner report',timing,franchise_ids:[id],recipient_ids:[user],enabled:false,whatsapp:false,corrections:false,alerts:{enabled:true,notify:false,minimum_paise:'100',minimum_overdue_days:1,repeat_hours:null}};
  expect(ownerScheduleInput(input,id).alerts.minimum_paise).toBe('100');
  for(const patch of [{expected_version:-1},{expected_version:0.5},{franchise_ids:[id,id]},{recipient_ids:[user,user]},{recipient_ids:[]},{franchise_ids:[]},{whatsapp:'true'},{organization_id:id},{name:'Owner\nreport'}])expect(()=>ownerScheduleInput({...input,...patch},id)).toThrow();
  for(const patch of [{minimum_paise:'0'},{minimum_paise:'-1'},{minimum_paise:'1.5'},{minimum_overdue_days:0},{minimum_overdue_days:1.5},{repeat_hours:1},{repeat_hours:8761},{notify:'true'}])expect(()=>ownerScheduleInput({...input,alerts:{...input.alerts,...patch}},id)).toThrow();
 });
 it('rejects invalid calendar intent and ownership/clock mass assignment',()=>{
  expect(ownerSummaryTiming(timing)).toEqual(timing);
  for(const patch of [{timezone:'Unknown/Zone'},{frequency:'hourly'},{minute:-1},{minute:1440},{minute:1.5},{weekday:0},{weekday:8},{organization_id:'foreign'},{now:'2026-01-01'}])
   expect(()=>ownerSummaryTiming({...timing,...patch})).toThrow();
 });
 it('retains one logical identity across retries and separates explicit corrections and recipients',()=>{
  const period={frequency:'monthly' as const,timezone:'Asia/Kolkata',from:'2026-01-31T18:30:00.000Z',to:'2026-02-28T18:30:00.000Z',label:'2026-02-01 / 2026-02-28'};
  const original=ownerSummaryIdentity('schedule',period,'recipient',1);
  expect(ownerSummaryIdentity('schedule',{...period},'recipient',1)).toBe(original);
  expect(ownerSummaryIdentity('schedule',period,'recipient',2)).not.toBe(original);
  expect(ownerSummaryIdentity('schedule',period,'other',1)).not.toBe(original);
  expect(()=>ownerSummaryIdentity('schedule',period,'recipient',0)).toThrow();
 });
});
