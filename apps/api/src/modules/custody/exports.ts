import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {ParcelCustodySnapshotDto} from '@shippingco/shared';
import {withCustodyScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {HttpError} from '../../plugins/errors.ts';
import {csvCell} from '../reports/rules.ts';
import * as repo from './repository.ts';
type Metadata=Omit<ParcelCustodySnapshotDto,'items'>;
type Saved={id:string;fingerprint:string;metadata:Metadata|null;rows:ParcelCustodySnapshotDto['items']|null;expired:boolean};
async function load(scope:TenantAccess,id:string,key=false){
 const c=assertTenantAccess(scope,['custody.capture']);
 return (await scopedQuery<Saved>(scope,['custody.capture'],`SELECT id,fingerprint,metadata,rows,expires_at<=clock_timestamp() expired FROM shipit.report_snapshots
 WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND (($3::boolean AND key_digest=$2) OR (NOT $3::boolean AND id::text=$2))`,[c.actor.id,id,key])).rows[0];
}
function dto(saved:Saved):ParcelCustodySnapshotDto{
 if(saved.expired||!saved.metadata||!saved.rows)throw new HttpError('REPORT_EXPIRED');
 if(saved.metadata.definition!=='custody_manifest_v1')throw new HttpError('RESOURCE_NOT_FOUND');
 return {...saved.metadata,items:saved.rows};
}
export function custodyCsv(snapshot:ParcelCustodySnapshotDto){
 const columns=['manifest_id','agent_id','as_of','total','delivered','returned','held','reassigned','pending','failed','item_id','parcel_id','outcome','origin_receipt_id','current_receipt_id','proof_id','failure_ids'];
 const r=snapshot.report,t=r.totals;
 const rows=snapshot.items.map(i=>[r.manifest_id,r.agent_id,snapshot.as_of,...[t.total,t.delivered,t.returned,t.held,t.reassigned,t.pending,t.failed].map(String),
 i.item_id,i.parcel_id,i.outcome,i.origin_receipt_id??'',i.current_receipt_id??'',i.proof_id??'',i.failure_ids.join(';')]);
 return [columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function createCustodyExportService(database:DatabasePool){
 return {
  async capture(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],correlation:string){
   const q=selection(query),id=uuid(idInput,'$'),key=keyDigest('custody.export:'+idempotencyKey(keyInput,headers)),fingerprint=digest({definition:'custody_manifest_v1',manifest_id:id});
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.export',correlation,async s=>{
    const c=assertTenantAccess(s.snapshots!,['custody.capture']),m=await repo.manifest(s.access,id,false);
    const previous=await load(s.snapshots!,key,true);
    if(previous){
     if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
     const result=dto(previous);await repo.accessAudit(s.audit,'custody.export.capture',id,result.id);return result;
    }
    await scopedQuery(s.snapshots!,['custody.capture'],`UPDATE shipit.report_snapshots SET metadata=NULL,rows=NULL
     WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND expires_at<=clock_timestamp() AND metadata IS NOT NULL`,[c.actor.id]);
    const count=(await scopedQuery<{n:number}>(s.snapshots!,['custody.capture'],`SELECT count(*)::int n FROM shipit.report_snapshots
     WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND expires_at>clock_timestamp()`,[c.actor.id])).rows[0]!.n;
    if(count>=20)throw new HttpError('REPORT_QUOTA_EXCEEDED');
    const report=await repo.manifestReport(s.access,m,await repo.cutoff(s.access)),{items,...summary}=report;
    const metadata:Metadata={id:randomUUID(),definition:'custody_manifest_v1',organization_id:q.organizationId,franchise_id:q.franchiseId,as_of:report.as_of,
     expires_at:new Date(Date.parse(report.as_of)+86400000).toISOString(),count:items.length,report:summary};
    await scopedQuery(s.snapshots!,['custody.capture'],`INSERT INTO shipit.report_snapshots(id,organization_id,franchise_id,actor_id,key_digest,fingerprint,metadata,rows,created_at,expires_at)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
     [metadata.id,q.franchiseId,c.actor.id,key,fingerprint,metadata,JSON.stringify(items),metadata.as_of,metadata.expires_at,c.organizationId]);
    await repo.accessAudit(s.audit,'custody.export.capture',id,metadata.id);return {...metadata,items};
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string,download=false){
   const q=selection(query),id=uuid(idInput,'$');return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.export',correlation,async s=>{
    const saved=await load(s.snapshots!,id);if(!saved||saved.expired)throw new HttpError('RESOURCE_NOT_FOUND');const result=dto(saved);
    await repo.accessAudit(s.audit,download?'custody.export.download':'custody.export.read',result.report.manifest_id,id);
    return download?{snapshot:result,csv:custodyCsv(result)}:result;
   });
  }
 };
}
