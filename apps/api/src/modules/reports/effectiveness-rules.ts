import type {EffectivenessCell,EffectivenessSection} from '@shippingco/shared';
import {metricNames,publicMetrics,type MetricRow} from '../conversations/metrics.ts';
export interface AggregateCell {category:string;n:number;subjects:number;latency_ms?:number|null;business_minutes?:number|null;age_subjects?:number;unknown_age?:number}
export const messagingCategories=['logical_intents','delivery_unknown','accepted','sent','delivered','read','provider_failed','consent_suppressed','policy_suppressed','pre_send_failed','canceled','queued','retry_wait','dispatching','uncertain','unclassified','recorded_send_attempts','provider_failure_observed','known_customers','confirmed_customers','unknown_customer_intents'] as const;
const parents=new Set(['logical_intents','delivery_unknown','recorded_send_attempts','known_customers','confirmed_customers']);
const base=(section:EffectivenessSection,category:string):EffectivenessCell=>({section,category,count:0,suppressed:false,denominator:null,denominator_kind:'unknown',excluded:0,latency_ms:null,business_minutes:null,age_suppressed:false});
export function messagingCells(rows:AggregateCell[]):EffectivenessCell[] {
  const hidden=rows.some(r=>r.n>0&&r.subjects<5),total=rows.find(r=>r.category==='logical_intents')?.n??0;
  const unknown=rows.find(r=>r.category==='unknown_customer_intents'),unknownHidden=!!unknown&&unknown.n>0&&unknown.subjects<5;
  return messagingCategories.map(category=>{
    const row=rows.find(r=>r.category===category),n=row?.n??0,suppressed=n>0&&((row?.subjects??0)<5||(hidden&&parents.has(category)));
    return {...base('messaging',category),count:suppressed?null:n,suppressed,
      denominator:hidden?null:total,denominator_kind:'logical_intents',excluded:category.endsWith('customers')?(unknownHidden?null:unknown?.n??0):0};
  });
}
export function assistantCells(rows:MetricRow[]):EffectivenessCell[] {
  const publicRows=publicMetrics(rows),turns=new Set(['success','clarification','handoff','paused','consent','thanks','control','failure','queued']);
  const sum=(names:Set<string>)=>rows.filter(r=>names.has(r.category)).reduce((n,r)=>n+Number(r.events),0);
  const caseNames=new Set(['case_opened','case_resolved','case_reopened']);
  const hiddenTurns=publicRows.some(r=>r.suppressed&&(turns.has(r.category)||r.category.startsWith('failure_')||r.category==='unmeasured'));
  const hiddenCases=publicRows.some(r=>r.suppressed&&caseNames.has(r.category)),unknown=publicRows.find(r=>r.category==='unmeasured')!;
  return metricNames.map(category=>{
    const row=publicRows.find(r=>r.category===category)!;
    const isCase=caseNames.has(category),isTurn=turns.has(category)||category.startsWith('failure_');
    return {...base('assistant',category),count:row.events,suppressed:row.suppressed,latency_ms:row.latency_ms,
      denominator:isCase?(hiddenCases?null:sum(caseNames)):isTurn?(hiddenTurns?null:sum(turns)):null,
      denominator_kind:isCase?'case_events':isTurn?'measured_turns':'unknown',excluded:isTurn?unknown.events:0};
  });
}
export function queueCells(rows:AggregateCell[]):EffectivenessCell[] {
  const hidden=rows.some(r=>r.n>0&&r.subjects<5),total=rows.find(r=>r.category==='all_active')?.n??0;
  return ['all_active','open','claimed','age_unknown'].map(category=>{
    const row=rows.find(r=>r.category===category),n=row?.n??0,suppressed=n>0&&((row?.subjects??0)<5||(hidden&&category==='all_active'));
    const ageSuppressed=!!row&&row.business_minutes!==null&&row.business_minutes!==undefined&&(row.age_subjects??0)>0&&(row.age_subjects??0)<5;
    return {...base('queue',category),count:suppressed?null:n,suppressed,denominator:hidden?null:total,denominator_kind:'active_cases',
      excluded:hidden?null:row?.unknown_age??0,business_minutes:suppressed||ageSuppressed?null:row?.business_minutes??null,age_suppressed:!suppressed&&ageSuppressed};
  });
}
