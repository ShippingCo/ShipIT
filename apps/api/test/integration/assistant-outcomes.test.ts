import { describe,it,expect } from 'vitest';
import { assistantEvaluation,injectionEvaluation } from '../assistant-evaluation.ts';
import { routeMessage } from '../../src/modules/conversations/router.ts';
import { outcomeEvidence,toolEvidence,isThanks } from '../../src/modules/conversations/outcomes.ts';
import { metricWindow,publicMetrics } from '../../src/modules/conversations/metrics.ts';
import { prepareInput } from '../../src/modules/conversations/interpreter.ts';

describe('#52 release-blocking assistant evaluation',()=>{
 it.each(assistantEvaluation)('routes English/Hindi $intent',row=>{
  expect(routeMessage(row.en).intent).toBe(row.intent);expect(routeMessage(row.hi).intent).toBe(row.intent);
 });
 it.each(injectionEvaluation)('rejects injected instructions: %s',text=>{
  expect(routeMessage(text).intent).toBe('clarify');expect(prepareInput(text)).toBeNull();
 });
 it('does not call unavailable facts, queued effects or failures a resolution',()=>{
  for(const outcome of ['not_found','forbidden','unavailable','stale','invalid'] as const)expect(outcomeEvidence('tracking',outcome).category).toBe('failure');
  expect(toolEvidence({tool:'eta',docket:'SC52',status:'booked',version:1,eta:{state:'unavailable',at:null},timeline:[]})).toEqual({category:'failure',reason:'missing_data'});
  expect(toolEvidence({tool:'resend',docket:'SC52',state:'queued',reason_code:'eligible'}).category).toBe('queued');
  expect(toolEvidence({tool:'resend',docket:'SC52',state:'failed',reason_code:'unavailable'}).category).toBe('failure');
 });
 it('keeps gratitude separate and does not swallow substantive requests',()=>{
  for(const text of ['Thank you!','thanks','धन्यवाद।','शुक्रिया'])expect(isThanks(text)).toBe(true);
  for(const text of ['thanks but where is it','thanks HUMAN','thanks STOP'])expect(isThanks(text)).toBe(false);
 });
 it('suppresses small cohorts including latency without revealing totals',()=>{
  const values=publicMetrics([{category:'success',events:'100',conversations:'1',latency_ms:22},{category:'failure',events:'5',conversations:'5',latency_ms:10}]);
  expect(values.find(x=>x.category==='success')).toEqual({category:'success',suppressed:true,events:null,latency_ms:null});
  expect(values.find(x=>x.category==='failure')?.events).toBe(5);
  const split=publicMetrics([{category:'failure',events:'6',conversations:'6',latency_ms:10},{category:'failure_missing_data',events:'5',conversations:'5',latency_ms:null},{category:'failure_authorization',events:'1',conversations:'1',latency_ms:null}]);
  expect(split.find(x=>x.category==='failure')?.events).toBeNull();
  expect(split.find(x=>x.category==='failure_authorization')?.events).toBeNull();
 });
 it('accepts only complete nonoverlapping UTC weeks after the abandonment grace',()=>{
  const now=new Date('2026-10-05T00:15:00Z');expect(metricWindow('2026-09-28',now).to.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  for(const week of ['2026-10-05','2026-09-29','2026-02-30','2024-01-01','garbage'])expect(()=>metricWindow(week,now)).toThrow();
  expect(()=>metricWindow('2026-09-28',new Date('2026-10-05T00:14:59Z'))).toThrow();
 });
});
