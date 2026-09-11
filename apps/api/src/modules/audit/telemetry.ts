import { denialActions, denialReasons, resourceTypes, type DenialAction, type DenialReason, type ResourceType } from './types.ts';
export interface DenialLabels { action:DenialAction;resource_type:ResourceType;reason_code:DenialReason;result:'denied' }
export interface SecurityTelemetry { denied(labels:DenialLabels):void; recordingFailed():void }
// In-process counters are bounded by the closed Cartesian product; no identifiers.
// #70 may consume snapshot or provide an adapter using this interface.
export function createSecurityCounters():SecurityTelemetry & {snapshot():{counters:{labels:DenialLabels;count:number}[];recording_failures:number}} {
  const counts=new Map<string,{labels:DenialLabels;count:number}>();let failures=0;
  return {
    denied(input) {
      if(!denialActions.includes(input.action)||!denialReasons.includes(input.reason_code)||!resourceTypes.includes(input.resource_type))return;
      const labels:DenialLabels={action:input.action,resource_type:input.resource_type,reason_code:input.reason_code,result:'denied'};
      const key=JSON.stringify(labels),entry=counts.get(key)??{labels,count:0};
      entry.count=Math.min(Number.MAX_SAFE_INTEGER,entry.count+1);counts.set(key,entry);
    },
    recordingFailed(){failures=Math.min(Number.MAX_SAFE_INTEGER,failures+1);},
    snapshot(){return {counters:[...counts.values()].map(x=>({labels:{...x.labels},count:x.count})),recording_failures:failures};},
  };
}
