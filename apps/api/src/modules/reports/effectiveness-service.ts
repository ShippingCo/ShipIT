import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type EffectivenessPage,type EffectivenessCell,type EffectivenessSnapshot,type EffectivenessSection} from '@shippingco/shared';
import {withMessagingReportScope} from '../memberships/service.ts';
import {selection,uuid,idempotencyKey,object} from '../pricing/validation.ts';
import {metricWindow} from '../conversations/metrics.ts';
import {HttpError} from '../../plugins/errors.ts';
import type {SupportHours} from '../support/rules.ts';
import {captureEffectiveness} from './effectiveness-repository.ts';
import {messagingCells,assistantCells,queueCells} from './effectiveness-rules.ts';
import * as repository from './repository.ts';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const page=(snapshot:EffectivenessSnapshot,items:EffectivenessCell[],section:EffectivenessSection|null=null,category:string|null=null):EffectivenessPage=>({snapshot,items:items.filter(r=>(section===null||r.section===section)&&(category===null||r.category===category)),selection:{section,category}});
export function createEffectivenessService(database:DatabasePool,hours:readonly SupportHours[]=[]) {
  return {
    async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
      const q=selection(query),b=object(body,['week']),window=metricWindow(b.week),filter={week:window.from.toISOString().slice(0,10)};
      const key=digest(idempotencyKey(keyInput,headers)),fingerprint=digest('messaging_effectiveness_v1:'+JSON.stringify(filter));
      return withMessagingReportScope(database,session,q.organizationId,q.franchiseId,correlation,async scope=>{
        await repository.lock(scope);const previous=await repository.replay<EffectivenessSnapshot,EffectivenessCell>(scope,key);
        if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
        const staffing=hours.find(h=>h.franchise_id===q.franchiseId),source=await captureEffectiveness(scope,window.from,window.to,staffing);
        const as_of=source.as_of.toISOString(),items=[...messagingCells(source.messaging),...assistantCells(source.assistant),...queueCells(source.queue)];
        const metadata:EffectivenessSnapshot={id:randomUUID(),schema_version:1,definition:'messaging_effectiveness_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,
          filter,count:items.length,timezone:'UTC',as_of,expires_at:new Date(source.as_of.getTime()+reportLimits.lifetimeSeconds*1000).toISOString(),minimum_subjects:5,freshness:{state:'captured',captured_at:as_of},
          staffing:{state:staffing?.staffed?'configured':'unavailable',timezone:staffing?.timezone??null,weekdays:staffing?.weekdays??[],start_minute:staffing?.start_minute??null,end_minute:staffing?.end_minute??null,policy:'captured_current_schedule'}};
        await repository.save(scope,key,fingerprint,metadata,items);await repository.audit(scope,metadata.id,'report.capture');return page(metadata,items);
      });
    },
    async read(session:string,idInput:unknown,query:unknown,correlation:string) {
      const b=object(query,['organization_id','franchise_id','section','category']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput);
      if(b.section!==undefined&&!['messaging','assistant','queue'].includes(String(b.section))||b.category!==undefined&&(typeof b.category!=='string'||!/^[a-z_]{1,64}$/.test(b.category)||b.section===undefined))throw new HttpError('VALIDATION_FAILED');
      const section=(b.section??null) as EffectivenessSection|null,category=(b.category??null) as string|null;
      return withMessagingReportScope(database,session,q.organizationId,q.franchiseId,correlation,async scope=>{
        const saved=await repository.get<EffectivenessSnapshot,EffectivenessCell>(scope,id);
        if(saved.metadata.definition!=='messaging_effectiveness_v1'||category!==null&&!saved.rows.some(r=>r.section===section&&r.category===category))throw new HttpError('RESOURCE_NOT_FOUND');
        await repository.audit(scope,id,'report.read');return page(saved.metadata,saved.rows,section,category);
      });
    },
  };
}

