import { createHash, randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { reportLimits, type ReportPage, type ReportSnapshot } from '@shippingco/shared';
import { withReportScope } from '../memberships/service.ts';
import { selection, uuid, idempotencyKey, object } from '../pricing/validation.ts';
import { FieldValidationError, HttpError } from '../../plugins/errors.ts';
import { reportFilter, reportCsv, totals, exportColumns } from './rules.ts';
import * as repository from './repository.ts';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function page(saved:Pick<repository.SavedReport,'metadata'|'rows'>,offset=0):ReportPage {
  return {snapshot:saved.metadata,rows:saved.rows.slice(offset,offset+reportLimits.page),
    next_offset:offset+reportLimits.page<saved.rows.length?offset+reportLimits.page:null};
}
export function createReportService(database:DatabasePool) {
  return {
    async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
      const q=selection(query),filter=reportFilter(body),key=digest(idempotencyKey(keyInput,headers)),fingerprint=digest(JSON.stringify(filter));
      return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
        await repository.lock(scope);
        const previous=await repository.replay(scope,key);
        if(previous){
          if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
          if(previous.expired)throw new HttpError('REPORT_EXPIRED');
          return page(previous);
        }
        const captured=await repository.capture(scope,filter);
        const metadata:ReportSnapshot={id:randomUUID(),schema_version:1,definition:'booking_cohort_v1',timezone:'Asia/Kolkata',
          organization_id:q.organizationId,franchise_id:q.franchiseId,filter,as_of:captured.as_of,
          expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),
          freshness:{state:'captured',captured_at:captured.as_of},count:captured.rows.length,totals:totals(captured.rows)};
        await repository.save(scope,key,fingerprint,metadata,captured.rows);
        await repository.audit(scope,metadata.id,'report.capture');
        return page({metadata,rows:captured.rows});
      });
    },
    async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
      const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]);
      const q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
      const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
      if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
      return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
        const saved=await repository.get(scope,id);
        await repository.audit(scope,id,exporting?'report.export':'report.read');
        return exporting?{snapshot:saved.metadata,columns:exportColumns,csv:reportCsv(saved.metadata,saved.rows)}:page(saved,offset);
      });
    },
  };
}
