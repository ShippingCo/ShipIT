import {financialAuditKinds,financialAuditStatuses,reportLimits,type FinancialAuditFilter,type FinancialAuditRow,type FinancialAuditSnapshot} from '@shippingco/shared';
import {object,uuid} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {reportFilter,csvCell} from './rules.ts';
export function financialAuditFilter(value:unknown):FinancialAuditFilter {
 const b=object(value,['from_day','to_day','sort','kind','status','actor_id','booking_id']);
 const base=reportFilter({from_day:b.from_day,to_day:b.to_day,sort:b.sort});
 const kind=b.kind??null,status=b.status??null;
 if((kind!==null&&!financialAuditKinds.includes(kind as FinancialAuditRow['kind']))||(status!==null&&!financialAuditStatuses.includes(status as FinancialAuditRow['status'])))throw new FieldValidationError('$','INVALID_FORMAT');
 return {...base,kind:kind as FinancialAuditFilter['kind'],status:status as FinancialAuditFilter['status'],actor_id:b.actor_id==null?null:uuid(b.actor_id,'$'),booking_id:b.booking_id==null?null:uuid(b.booking_id,'$')};
}
export const financialAuditColumns=['snapshot_id','as_of','from_day','to_day','id','kind','change_kind','status','source_type','source_id','booking_id','receipt_id','actor_id','recorded_at','reason','version','correction_of','policy_id','approval_threshold_paise','additional_review_required','approval_basis','approved_actor_id','amount_basis','before_paise','proposed_paise','decision_ids','document_ids'] as const;
export function financialAuditCsv(snapshot:FinancialAuditSnapshot,rows:readonly FinancialAuditRow[]) {
 const records=rows.map(r=>[snapshot.id,snapshot.as_of,snapshot.filter.from_day,snapshot.filter.to_day,r.id,r.kind,r.change_kind,r.status,r.source_type,r.source_id,r.booking_id??'',r.receipt_id??'',r.actor_id,r.recorded_at,r.reason,String(r.version),r.correction_of??'',r.policy_id??'',r.approval_threshold_paise??'',r.additional_review_required===null?'unknown':String(r.additional_review_required),r.approval_basis,r.approved_actor_id??'',r.amount_basis,r.before_paise??'',r.proposed_paise??'',r.decisions.map(d=>d.id).join('|'),r.document_links.map(d=>d.receipt_id??'unverified:'+d.external_ref).join('|')]);
 const csv=[financialAuditColumns,...records].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return csv;
}
