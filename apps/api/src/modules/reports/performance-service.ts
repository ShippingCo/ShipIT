import {createHash,randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {reportLimits,type PerformanceRow,type PerformanceSnapshot,type PerformancePage,type PerformanceSelection} from '@shippingco/shared';
import {withPerformanceScope} from '../memberships/service.ts';
import {selection,uuid,idempotencyKey,object} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {performanceFilter,performanceSummary,performanceGroups,performanceCsv,performanceColumns} from './performance-rules.ts';
import {capturePerformance} from './performance-repository.ts';
import * as repository from './repository.ts';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const page=(snapshot:PerformanceSnapshot,rows:PerformanceRow[],offset=0,destination:string|null=null,route_id:string|null=null):PerformancePage=>({snapshot,selection:{destination,route_id,count:rows.length,summary:performanceSummary(rows)},rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
export function createPerformanceService(database:DatabasePool) {
  return {
    async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
      const q=selection(query),filter=performanceFilter(body),key=digest(idempotencyKey(keyInput,headers)),fingerprint=digest('delivery_performance_v1:'+JSON.stringify(filter));
      return withPerformanceScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
        await repository.lock(scope);const previous=await repository.replay<PerformanceSnapshot,PerformanceRow>(scope,key);
        if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
        const captured=await capturePerformance(scope,filter);
        const metadata:PerformanceSnapshot={id:randomUUID(),schema_version:1,definition:'delivery_performance_v1',timezone:'Asia/Kolkata',
          organization_id:q.organizationId,franchise_id:q.franchiseId,filter,as_of:captured.as_of,
          expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),freshness:{state:'captured',captured_at:captured.as_of},
          count:captured.rows.length,summary:performanceSummary(captured.rows),destinations:performanceGroups(captured.rows,'destination'),routes:performanceGroups(captured.rows,'route_id')};
        performanceCsv(metadata,captured.rows);await repository.save(scope,key,fingerprint,metadata,captured.rows);await repository.audit(scope,metadata.id,'report.capture');return page(metadata,captured.rows);
      });
    },
    async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
      const b=object(query,['organization_id','franchise_id','destination','route_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
      const destination=b.destination===undefined?null:b.destination;
      if(destination!==null&&(typeof destination!=='string'||(destination!=='$unknown'&&!/^[A-Z][A-Z0-9_]{0,31}$/.test(destination))))throw new FieldValidationError('$','INVALID_FORMAT');
      const route_id=b.route_id===undefined?null:b.route_id==='$unknown'?'$unknown':uuid(b.route_id,'$');
      const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
      if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
      return withPerformanceScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
        const saved=await repository.get<PerformanceSnapshot,PerformanceRow>(scope,id);
        if(saved.metadata.definition!=='delivery_performance_v1')throw new HttpError('RESOURCE_NOT_FOUND');
        if(route_id!==null&&!saved.metadata.routes.some(g=>g.key===(route_id==='$unknown'?null:route_id)))throw new HttpError('RESOURCE_NOT_FOUND');
        const rows=saved.rows.filter(r=>(destination===null||r.destination===(destination==='$unknown'?null:destination))&&(route_id===null||r.route_id===(route_id==='$unknown'?null:route_id)));
        const selected:PerformanceSelection={destination,route_id,count:rows.length,summary:performanceSummary(rows)};
        await repository.audit(scope,id,exporting?'report.export':'report.read');
        return exporting?{snapshot:saved.metadata,selection:selected,columns:performanceColumns,csv:performanceCsv(saved.metadata,rows)}:page(saved.metadata,rows,offset,destination,route_id);
      });
    },
  };
}
