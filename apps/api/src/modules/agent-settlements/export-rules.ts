import {reportLimits} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {csvCell} from '../reports/rules.ts';
import type {readStatementDetail} from './statement-service.ts';
export interface StatementExportMetadata {
 timezone:'Asia/Kolkata';currency:'INR';id:string;definition:'agent_statement_v1';schema_version:1;organization_id:string;franchise_id:string;as_of:string;expires_at:string;count:number;source_count:number;
 statement_id:string;agent_id:string;day:string;revision:number;status:string;counted_at:string;source_as_of:string;summaries:StatementExportRow[];
}
export interface StatementExportRow {record_kind:string;record_id:string;fields:Record<string,string>}
import {statementExportSpecs as specs,statementExportColumns,statementExportStatementFields,statementExportCashFields,statementExportFinanceFields,statementExportParcelFields} from '@shippingco/shared';
export {statementExportColumns} from '@shippingco/shared';
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new HttpError('TEMPORARILY_UNAVAILABLE');return v as Record<string,unknown>;};
function project(v:unknown,keys:string){const source=object(v);return Object.fromEntries(keys.split(' ').map(key=>{const value=source[key];if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new HttpError('TEMPORARILY_UNAVAILABLE');return [key,value===null?'':String(value)];}));}
/** Public field allowlists only; no raw snapshot/OTP/contact/private attribution credit serialization. */
export function statementExportRows(statement:Awaited<ReturnType<typeof readStatementDetail>>):{rows:StatementExportRow[];source_count:number}{
 const snapshot=object(statement.source_snapshot),cash=object(snapshot.cash),finance=object(snapshot.finance),parcels=object(snapshot.parcels);
 if(snapshot.schema_version!==1||snapshot.kind!=='physical_cash_capture'||snapshot.timezone!=='Asia/Kolkata'||finance.schema_version!==1||finance.seller_liability_is_agent_debt!==false)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 const d=statement.decision,rows:StatementExportRow[]=[{record_kind:'statement',record_id:statement.id,fields:project({...statement,decision_id:d?.id??null,decision_kind:d?.kind??null,decision_actor_id:d?.actor_id??null,decision_reason:d?.reason??null,decision_recorded_at:d?.recorded_at??null,decision_expected_version:d?.expected_version??null},statementExportStatementFields)},
 {record_kind:'cash_summary',record_id:statement.id,fields:project({...object(snapshot.totals),unassigned_franchise_sources_count:cash.unassigned_franchise_sources_count,source_version:cash.source_version},statementExportCashFields)},
 {record_kind:'finance_summary',record_id:statement.id,fields:project({...object(finance.totals),legacy_unattributed_handovers:finance.legacy_unattributed_handovers,seller_liability_is_agent_debt:finance.seller_liability_is_agent_debt},statementExportFinanceFields)},
 {record_kind:'parcel_summary',record_id:statement.id,fields:project(parcels.totals,statementExportParcelFields)}];
 const frames={cash,finance,parcels},counts={cash:0,finance:0,parcels:0};
 for(const [frame,kind,id,keys] of specs){const entries=frames[frame][kind];if(!Array.isArray(entries))throw new HttpError('TEMPORARILY_UNAVAILABLE');counts[frame]+=entries.length;if(counts.cash+counts.finance+counts.parcels>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  for(const entry of entries){const record=object(entry);if(typeof record[id]!=='string')throw new HttpError('TEMPORARILY_UNAVAILABLE');rows.push({record_kind:kind,record_id:record[id]+(kind==='handover_attributions'?'/'+record.ordinal:''),fields:project(kind==='financial_effects'?{...record,fee_direct_paid_paise:record.fee_cash_paise}:record,keys)});}
 }
 if(Object.entries(counts).some(([frame,n])=>frames[frame as keyof typeof frames].source_count!==n))throw new HttpError('TEMPORARILY_UNAVAILABLE');
 return {rows,source_count:rows.length-4};
}
export function statementExportCsv(snapshot:StatementExportMetadata,rows:readonly StatementExportRow[]){
 const records=rows.map(r=>{const base={snapshot_id:snapshot.id,timezone:snapshot.timezone,currency:snapshot.currency,export_as_of:snapshot.as_of,statement_id:snapshot.statement_id,agent_id:snapshot.agent_id,day:snapshot.day,revision:String(snapshot.revision),status:snapshot.status,counted_at:snapshot.counted_at,source_as_of:snapshot.source_as_of,record_kind:r.record_kind,record_id:r.record_id};return statementExportColumns.map(key=>key in base?base[key as keyof typeof base]:r.fields[key]??'');});
 const result=[statementExportColumns,...records].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 if(Buffer.byteLength(result)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return result;
}
