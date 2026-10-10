import {reportLimits,type CashbookReportFilter,type CashbookSourceRow,type CashbookReportSnapshot} from '@shippingco/shared';
import {object,uuid} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {reportFilter,csvCell} from '../reports/rules.ts';
export const cashbookSourceKinds=['receipt','refund','refund_correction','legacy_collection','legacy_collection_correction','expense','opening_float','owner_funds','deposit','withdrawal','correction','handover'] as const;
export function cashbookReportFilter(value:unknown):CashbookReportFilter {
 const b=object(value,['from_day','to_day','sort','kind','location_id']),sort=b.sort??'occurred_desc',kind=b.kind??null;
 if(sort!=='occurred_asc'&&sort!=='occurred_desc'||kind!==null&&!cashbookSourceKinds.includes(kind as CashbookSourceRow['source_kind']))throw new FieldValidationError('$','INVALID_FORMAT');
 const base=reportFilter({from_day:b.from_day,to_day:b.to_day,sort:sort==='occurred_asc'?'confirmed_asc':'confirmed_desc'});
 return {from_day:base.from_day,to_day:base.to_day,sort,kind:kind as CashbookReportFilter['kind'],location_id:b.location_id==null?null:uuid(b.location_id,'$')};
}
export const cashbookSourceColumns=['snapshot_id','as_of','timezone','from_day','to_day','source_version','filtered_count','filtered_known_inflows_paise','filtered_known_outflows_paise','filtered_known_net_paise','filtered_unknown_inflows_paise','filtered_unknown_outflows_paise','filtered_unknown_sources','id','source_kind','source_id','location_id','account_id','direction','amount_paise','occurred_at','recorded_at','actor_id','request_id','correction_of','unknown_reason','current_location_recorded_paise','current_location_pending_reserved_paise','current_location_available_paise','current_location_shortfall_paise','current_location_state'] as const;
export function cashbookSourceCsv(snapshot:CashbookReportSnapshot,rows:readonly CashbookSourceRow[]) {
 const positions=new Map(snapshot.position.locations.map(p=>[p.location_id,p]));
 const records=rows.map(r=>{const p=r.location_id?positions.get(r.location_id):undefined,t=snapshot.totals;return [snapshot.id,snapshot.as_of,snapshot.timezone,snapshot.filter.from_day,snapshot.filter.to_day,String(snapshot.position.source_version),String(t.count),t.known_inflows_paise,t.known_outflows_paise,t.known_net_paise,t.unknown_inflows_paise,t.unknown_outflows_paise,String(t.unknown_sources),r.id,r.source_kind,r.source_id,r.location_id??'',r.account_id??'',r.direction,r.amount_paise,r.occurred_at,r.recorded_at,r.actor_id,r.request_id??'',r.correction_of??'',r.unknown_reason??'',p?.known_recorded_paise??'',p?.pending_reserved_paise??'',p?.available_paise??'',p?.shortfall_paise??'',p?.state??'unknown'];});
 const csv=[cashbookSourceColumns,...records].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return csv;
}
