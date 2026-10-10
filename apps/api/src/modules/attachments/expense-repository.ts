import {randomUUID} from 'node:crypto';
import {attachmentLimits,type ExpenseAttachmentIntent} from '@shippingco/shared';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import type {AttachmentRow,AttachmentScope} from './types.ts';
const actions=['cashbook.select','cashbook.read','cashbook.request'] as const;
export async function parent(s:AttachmentScope,id:string,parcel:string|null,purpose:string,write:boolean) {
 const c=assertTenantAccess(s.access,actions);if(parcel!==null||purpose!=='expense_evidence')throw new HttpError('RESOURCE_NOT_FOUND');
 const franchise=(await scopedQuery<{lifecycle:string}>(s.access,['cashbook.select','cashbook.read','cashbook.request'],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 // The immutable proposal needs no UPDATE grant; the held franchise lock serializes review and evidence writes.
 const row=(await scopedQuery(s.access,['cashbook.select','cashbook.read','cashbook.request'],`SELECT id FROM shipit.cashbook_requests WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND kind='expense' AND (NOT $2::boolean OR actor_id=$3)`,[id,!!s.ownOnly,c.actor.id])).rows[0];
 if(!franchise||!row)throw new HttpError('RESOURCE_NOT_FOUND');if(write&&franchise.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function find(s:AttachmentScope,parentId:string,id:string) {
 await parent(s,parentId,null,'expense_evidence',false);
 const row=(await scopedQuery<AttachmentRow>(s.access,['cashbook.select','cashbook.read','cashbook.request'],`SELECT * FROM shipit.attachments WHERE {{franchise:organization_id:franchise_id}} AND expense_request_id=$1 AND id=$2 AND purpose='expense_evidence' AND booking_id IS NULL FOR UPDATE`,[parentId,id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function list(s:AttachmentScope,id:string,parcel:string|null) {
 await parent(s,id,parcel,'expense_evidence',false);
 return (await scopedQuery<AttachmentRow>(s.access,['cashbook.select','cashbook.read','cashbook.request'],`SELECT * FROM shipit.attachments WHERE {{franchise:organization_id:franchise_id}} AND expense_request_id=$1 AND booking_id IS NULL AND purpose='expense_evidence' AND state<>'deleted' ORDER BY created_at,id LIMIT 10`,[id])).rows;
}
export async function quota(scope:TenantAccess,id:string,size:number) {
 const row=(await scopedQuery<{count:number;bytes:number;pending:number}>(scope,['cashbook.request'],`SELECT count(*)::int count,COALESCE(sum(declared_size),0)::int bytes,count(*) FILTER(WHERE state<>'ready')::int pending FROM shipit.attachments WHERE {{franchise:organization_id:franchise_id}} AND expense_request_id=$1 AND state<>'deleted'`,[id])).rows[0]!;
 if(row.count>=attachmentLimits.count||row.bytes+size>attachmentLimits.aggregateBytes||row.pending>=attachmentLimits.pending)throw new HttpError('ATTACHMENT_LIMIT_EXCEEDED');
}
export async function insert(scope:TenantAccess,parentId:string,input:ExpenseAttachmentIntent,now:Date) {
 const c=assertTenantAccess(scope,['cashbook.request']),id=randomUUID();
 return (await scopedQuery<AttachmentRow>(scope,['cashbook.request'],`INSERT INTO shipit.attachments(id,organization_id,franchise_id,expense_request_id,purpose,kind,object_key,declared_size,declared_type,expected_digest,retention_class,initiated_actor,actor_type,actor_id,correlation_id,created_at,upload_expires_at,cleanup_due_at)
 SELECT $1,{{organization}},$2,$3,'expense_evidence',$4,$5,$6,$7,$8,'operational_evidence',$9::uuid,'user',$9::text,$10,$11,$11::timestamptz+interval '15 minutes',$11::timestamptz+interval '30 minutes' WHERE {{franchise:$12:$2}} RETURNING *`,[id,c.permittedFranchiseIds[0],parentId,input.kind,'evidence/'+randomUUID(),input.size_bytes,input.media_type,input.sha256,c.actor.id,c.correlationId,now,c.organizationId])).rows[0]!;
}
export async function newWrite(s:AttachmentScope,id:string,operation:string,writesEnabled:boolean) {
 if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');await parent(s,id,null,'expense_evidence',operation!=='cancel');
 const decision=(await scopedQuery<{decision:string}>(s.access,['cashbook.request'],`SELECT decision FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[id])).rows[0];
 if(decision&&(operation!=='cancel'||decision.decision!=='rejected'))throw new HttpError('VERSION_CONFLICT');
}
