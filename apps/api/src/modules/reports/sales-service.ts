import { createHash,randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { reportLimits,type SalesPage,type SalesSnapshot,type SalesRow,type SalesFilter } from '@shippingco/shared';
import { withReportScope } from '../memberships/service.ts';
import { selection,uuid,idempotencyKey,object } from '../pricing/validation.ts';
import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { reportFilter } from './rules.ts';
import { salesTotals,salesGroups,salesColumns,salesCsv } from './sales-rules.ts';
import { captureSales } from './sales-repository.ts';
import * as repository from './repository.ts';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const page=(metadata:SalesSnapshot,rows:SalesRow[],offset=0):SalesPage=>({snapshot:metadata,rows:rows.slice(offset,offset+reportLimits.page),next_offset:offset+reportLimits.page<rows.length?offset+reportLimits.page:null});
export function salesFilter(body:unknown,franchise:string):SalesFilter {
  const b=object(body,['from_day','to_day','sort','rate','franchise_ids']);
  const base=reportFilter({from_day:b.from_day,to_day:b.to_day,sort:b.sort});
  let rate=b.rate??null;
  if(rate!==null&&(typeof rate!=='string'||!/^\d{1,9}\/\d{1,9}$/.test(rate)||BigInt(rate.split('/')[1]!)===0n))throw new FieldValidationError('$','INVALID_FORMAT');
  if(typeof rate==='string'){let [n,d]=rate.split('/').map(BigInt) as [bigint,bigint];let a=n,b=d;while(b){[a,b]=[b,a%b];}n/=a;d/=a;rate=`${n}/${d}`;}
  const ids=b.franchise_ids??[franchise];
  if(!Array.isArray(ids)||ids.length<1||ids.length>50)throw new FieldValidationError('$','OUT_OF_RANGE');
  const franchise_ids=[...new Set(ids.map(id=>uuid(id,'franchise_id')))].sort();
  if(franchise_ids.length!==ids.length||!franchise_ids.includes(franchise))throw new FieldValidationError('$','INVALID_FORMAT');
  return {...base,rate:typeof rate==='string'?rate:null,franchise_ids};
}
export function createSalesService(database:DatabasePool) {
  return {
    async create(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
      const q=selection(query),filter=salesFilter(body,q.franchiseId),key=digest('sales:'+idempotencyKey(keyInput,headers)),fingerprint=digest(JSON.stringify(filter));
      return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{
        await repository.lock(scope);
        const previous=await repository.replay<SalesSnapshot,SalesRow>(scope,key);
        if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');if(previous.expired)throw new HttpError('REPORT_EXPIRED');return page(previous.metadata,previous.rows);}
        const captured=await captureSales(scope,filter);
        const metadata:SalesSnapshot={id:randomUUID(),schema_version:1,definition:'sales_gst_v1',timezone:'Asia/Kolkata',organization_id:q.organizationId,franchise_id:q.franchiseId,filter,as_of:captured.as_of,
          expires_at:new Date(Date.parse(captured.as_of)+reportLimits.lifetimeSeconds*1000).toISOString(),count:captured.rows.length,totals:salesTotals(captured.rows),groups:salesGroups(captured.rows)};
        salesCsv(metadata,captured.rows);
        await repository.save(scope,key,fingerprint,metadata,captured.rows);await repository.audit(scope,metadata.id,'report.capture');return page(metadata,captured.rows);
      },filter.franchise_ids);
    },
    async read(session:string,idInput:unknown,query:unknown,correlation:string,exporting=false) {
      const b=object(query,['organization_id','franchise_id',...(exporting?[]:['offset'])]),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');
      const offset=b.offset===undefined?0:typeof b.offset==='string'&&/^\d{1,4}$/.test(b.offset)?Number(b.offset):-1;
      if(offset<0||offset>reportLimits.rows||offset%reportLimits.page!==0)throw new FieldValidationError('$','OUT_OF_RANGE');
      const filter=await withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
        const saved=await repository.get<SalesSnapshot,SalesRow>(scope,id);
        if(saved.metadata.definition!=='sales_gst_v1'||saved.metadata.franchise_id!==q.franchiseId)throw new HttpError('RESOURCE_NOT_FOUND');return saved.metadata.filter;
      });
      // Reauthorize every saved franchise before returning any row, total or export.
      return withReportScope(database,session,q.organizationId,q.franchiseId,exporting,correlation,async scope=>{
        const saved=await repository.get<SalesSnapshot,SalesRow>(scope,id);await repository.audit(scope,id,exporting?'report.export':'report.read');
        return exporting?{snapshot:saved.metadata,columns:salesColumns,csv:salesCsv(saved.metadata,saved.rows)}:page(saved.metadata,saved.rows,offset);
      },filter.franchise_ids);
    },
  };
}
