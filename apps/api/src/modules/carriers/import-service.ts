import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withCarrierScope } from '../memberships/service.ts';
import { digest } from '../pricing/idempotency.ts';
import type { TenantAccess } from '../security/scope.ts';
import type { Observation, Dimensions } from './contract.ts';
import { upload, csvLimits, type PreviewRow, type RowError } from './csv.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
import * as ir from './import-repository.ts';

async function dimensions(s:TenantAccess,installation:r.InstallationRow,row:PreviewRow):Promise<Dimensions> {
  const c=row.candidate!;
  return {courierId:installation.courier_id,service:await r.dimension(s,installation.id,'service',c.service_code!),
    origin:await r.dimension(s,installation.id,'location',c.origin_code!),destination:await r.dimension(s,installation.id,'location',c.destination_code!)};
}
async function validate(s:TenantAccess,installation:r.InstallationRow,kind:ir.ImportRun['kind'],row:PreviewRow,now:Date,committing=false):Promise<RowError|null> {
  const c=row.candidate!,parcel=await ir.docket(s,c.docket);
  if(!parcel)return 'REFERENCE_NOT_FOUND';
  if(parcel.state!=='active'||['delivered','rto'].includes(parcel.status))return 'STALE_STATE';
  const reference=await r.currentReference(s,installation.id,parcel.id);
  if(committing&&(row.parcel_id!==parcel.id||row.parcel_version!==parcel.version||row.reference_id!==(reference?.id??null)))return 'STALE_STATE';
  if(kind==='shipments'){
    const reserved=await ir.reserved(s,installation.id,c.external_docket);
    if(reference||(reserved&&reserved.parcel_id!==parcel.id))return 'SOURCE_CONFLICT';
    const hash=digest(await dimensions(s,installation,row));
    if(committing&&row.dimensions_digest!==hash)return 'STALE_STATE';
    row.dimensions_digest=hash;
  }else{
    if(!reference||reference.external_docket!==c.external_docket)return 'REFERENCE_NOT_FOUND';
    const at=new Date(c.occurred_at!).getTime(),latest=await ir.latestTime(s,parcel.id,reference.id);
    if(at>now.getTime()||at<new Date(parcel.created_at).getTime()||(latest&&at<new Date(latest).getTime()))return 'STALE_STATE';
  }
  row.parcel_id=parcel.id;row.parcel_version=parcel.version;row.reference_id=reference?.id??null;return null;
}
export function summarize(run:ir.ImportRun,outcomes:ir.Outcome[]) {
  const byRow=new Map(outcomes.map(o=>[o.row_number,o]));
  const counts={total:run.rows.length,valid:0,rejected:0,conflicted:0,applied:0,duplicate:0};
  const rows=run.rows.map(row=>{
    const outcome=byRow.get(row.row);
    const state=outcome?.state??(row.error?(row.error==='STALE_STATE'||row.error==='SOURCE_CONFLICT'?'conflicted':'rejected'):'valid');
    counts[state]++;
    // Never return rejected source cells, file bytes, actor IDs, or ownership internals.
    return {row:row.row,state,error:outcome?.error??row.error,field:row.field,
      candidate:row.error?null:row.candidate,resource_id:outcome?.resource_id??null};
  });
  return {id:run.id,installation_id:run.installation_id,kind:run.kind,file_sha256:run.file_sha256,
    state:counts.valid?'ready':'completed',counts,rows};
}
export function createCarrierImportService(database:DatabasePool,clock=()=>new Date()) {
  async function create(session:string,installationInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    const installationId=v.uuid(installationInput,'$'),q=v.selection(query),key=v.keyDigest(v.idempotencyKey(keyInput));
    // Authorization precedes parsing and every tenant lookup. Raw bytes live only in this request.
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.write',correlation,async({access:s})=>{
      const installation=await r.fileInstallation(s,installationId),parsed=upload(body),fingerprint=digest({installationId,body});
      const old=await ir.priorRun(s,key,fingerprint);
      if(old){const saved=await ir.run(s,old.id);return summarize(saved,await ir.outcomes(s,saved.id));}
      const now=clock(),seen=new Map<string,string>();
      for(const row of parsed.rows){
        if(row.error)continue;
        const c=row.candidate!;
        row.identity=digest(parsed.kind==='tracking'?{source_id:c.source_id}:{external_docket:c.external_docket});
        row.fingerprint=digest(c);
        const prior=await ir.sourceOutcome(s,installationId,parsed.kind,row.identity);
        // Still resolve the docket in scope, even for a deduplicated source.
        const parcel=await ir.docket(s,c.docket);
        if(!parcel)row.error='REFERENCE_NOT_FOUND';
        else if(seen.has(row.identity)&&seen.get(row.identity)!==row.fingerprint)row.error='SOURCE_CONFLICT';
        else if(prior)row.error=prior.fingerprint===row.fingerprint?null:'SOURCE_CONFLICT';
        else row.error=await validate(s,installation,parsed.kind,row,now);
        if(!row.error)seen.set(row.identity,row.fingerprint);
        if(row.error)row.candidate=null;
      }
      const id=randomUUID();await ir.insertRun(s,id,installationId,parsed.kind,parsed.file_sha256,key,fingerprint,parsed.rows,now);
      return summarize(await ir.run(s,id),[]);
    });
  }
  async function status(session:string,idInput:unknown,query:unknown,correlation:string) {
    const id=v.uuid(idInput,'$'),q=v.selection(query);
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.read',correlation,async({access:s,agentOnly})=>{
      if(agentOnly)throw new HttpError('ACTION_FORBIDDEN');
      const run=await ir.run(s,id);await r.fileInstallation(s,run.installation_id);
      return summarize(run,await ir.outcomes(s,id));
    });
  }
  async function commit(session:string,idInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    const id=v.uuid(idInput,'$'),q=v.selection(query),key=v.keyDigest(v.idempotencyKey(keyInput)),b=v.object(body,['rows']);
    if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>csvLimits.batch||b.rows.some(n=>!Number.isInteger(n)||n<2||n>csvLimits.rows+1)||new Set(b.rows).size!==b.rows.length)throw new HttpError('VALIDATION_FAILED');
    const selected=(b.rows as number[]).slice().sort((a,b)=>a-b);
    const scope=<T>(work:(s:TenantAccess)=>Promise<T>)=>withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.write',correlation,({access})=>work(access));
    await scope(async s=>{
      const run=await ir.run(s,id);await r.fileInstallation(s,run.installation_id);
      if(selected.some(n=>!run.rows.some(row=>row.row===n&&!row.error)))throw new HttpError('VALIDATION_FAILED');
      await ir.commitIntent(s,randomUUID(),id,key,digest({id,rows:selected}),clock());
    });
    // Deliberately sequential, independently atomic rows. A dependency failure leaves later rows unapplied.
    for(const number of selected)await scope(async s=>{
      const run=await ir.run(s,id),installation=await r.fileInstallation(s,run.installation_id);
      if((await ir.outcomes(s,id)).some(o=>o.row_number===number))return;
      const row=run.rows.find(row=>row.row===number)!,c=row.candidate!,now=clock();
      const parcel=await ir.docket(s,c.docket);
      const prior=await ir.sourceOutcome(s,run.installation_id,run.kind,row.identity!);
      let error:RowError|null=!parcel?'REFERENCE_NOT_FOUND':prior&&prior.fingerprint!==row.fingerprint?'SOURCE_CONFLICT':null;
      if(!error&&!prior)error=await validate(s,installation,run.kind,row,now,true);
      if(error){await ir.saveOutcome(s,run,row,'conflicted',error,null,null,now);return;}
      if(prior){await ir.saveOutcome(s,run,row,'duplicate',null,prior.resource_id,null,now);return;}
      const command=randomUUID(),resource=randomUUID();
      if(run.kind==='shipments')await r.addReference(s,resource,installation.id,row.parcel_id!,c.external_docket,1,await dimensions(s,installation,row),command);
      else{
        const reference=await r.reference(s,row.reference_id!,row.parcel_id!);
        const evidence:Observation={contractVersion:1,reference:{organizationId:q.organizationId,franchiseId:q.franchiseId,
          installationId:installation.id,externalDocket:c.external_docket},dimensions:reference.dimensions,
          status:{state:'mapped',status:c.status!,mappingVersionId:run.id},occurredAt:{state:'known',at:c.occurred_at!},receivedAt:now.toISOString(),
          provenance:{mode:'file',importId:run.id,fileSha256:run.file_sha256,row:row.row},sourceRecordId:c.source_id!};
        await r.ingest(s,resource,row.parcel_id!,reference.id,row.parcel_version!,evidence,command,now,c.status_code!);
      }
      await r.receipt(s,command,run.kind==='shipments'?'reference':'observation',digest({run:id,row:number}),row.fingerprint!,
        {id:resource,version:1},run.kind==='shipments'?'file_reference':'file_observation',now);
      await ir.saveOutcome(s,run,row,'applied',null,resource,command,now);
    });
    return status(session,id,qToQuery(q),correlation);
  }
  return {create,status,commit};
}
function qToQuery(q:{organizationId:string;franchiseId:string}) {return {organization_id:q.organizationId,franchise_id:q.franchiseId};}
