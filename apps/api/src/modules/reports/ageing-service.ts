import { createHash,randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { reportLimits,type AgeingPage,type AgeingSnapshot,type AgeingRow } from '@shippingco/shared';
import { withReportScope } from '../memberships/service.ts';
import { selection,uuid,idempotencyKey,object } from '../pricing/validation.ts';
import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { ageingFilter,ageingSummary,ageingCustomers,ageingCsv,ageingColumns } from './ageing-rules.ts';
import { captureAgeing,checkAgeingCustomer } from './ageing-repository.ts';
import * as repository from './repository.ts';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const page=(snapshot:AgeingSnapshot,rows:AgeingRow[],offset=0):AgeingPage=>({snapshot,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
export function createAgeingService(database:DatabasePool) {
  return {
    async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
      const q=selection(query),filter=ageingFilter(body),key=digest('ageing:'+idempotencyKey(keyInput,headers)),fingerprint=digest(JSON.stringify(filter));
      return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
        await repository.lock(scope);
        await checkAgeingCustomer(scope,filter.customer_id);
        const previous=await repository.replay<AgeingSnapshot,AgeingRow>(scope,key);
        if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
        const captured=await captureAgeing(scope,filter);
        const metadata:AgeingSnapshot={id:randomUUID(),schema_version:1,definition:'to_pay_ageing_v1',timezone:'Asia/Kolkata',organization_id:q.organizationId,franchise_id:q.franchiseId,filter,as_of:captured.as_of,
          expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),...ageingSummary(captured.rows),customers:ageingCustomers(captured.rows),due_date_source:'unavailable',advance_source:'unavailable'};
        ageingCsv(metadata,captured.rows);
        await repository.save(scope,key,fingerprint,metadata,captured.rows);
        await repository.audit(scope,metadata.id,'report.capture');return page(metadata,captured.rows);
      });
    },
    async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
      const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
      const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
      if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
      return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
        const saved=await repository.get<AgeingSnapshot,AgeingRow>(scope,id);
        if(saved.metadata.definition!=='to_pay_ageing_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');
        await repository.audit(scope,id,exporting?'report.export':'report.read');
        return exporting?{snapshot:saved.metadata,columns:ageingColumns,csv:ageingCsv(saved.metadata,saved.rows)}:page(saved.metadata,saved.rows,offset);
      });
    },
  };
}
