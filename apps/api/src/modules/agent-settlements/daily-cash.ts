import {reportLimits} from '@shippingco/shared';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {uuid,timestamp} from '../pricing/validation.ts';
import {reportFilter} from '../reports/rules.ts';
import {countedCustody} from './rules.ts';

export interface DailyCashFact {
 source_kind:string;source_id:string;location_id:string;direction:'in'|'out';amount_paise:string;
 occurred_at:string;recorded_at:string;request_id:string|null;correction_of:string|null;
}
export interface DailyReceiptRef {
 receipt_id:string;method:string;amount_paise:string;receiver_id:string;initial_custodian_id:string|null;
 occurred_at:string;recorded_at:string;
}
export interface DailyCashFrame {
 agent_id:string;day:string;timezone:'Asia/Kolkata';counted_at:string;as_of:string;source_version:string;
 cash_facts:DailyCashFact[];receipts:DailyReceiptRef[];unassigned_franchise_sources_count:number;
 totals:{opening_known_paise:string;day_in_paise:string;day_out_paise:string;expected_paise:string;counted_paise:string;variance_paise:string;shortage_paise:string;excess_paise:string;ledger_exception:boolean};
}
/** One SELECT fixes visibility for every source. It is an internal capture input, not an approval or cash producer. */
export async function dailyCashFrame(scope:TenantAccess,agentInput:unknown,dayInput:unknown,countInput:unknown,counted:bigint):Promise<DailyCashFrame> {
 const agent=uuid(agentInput,'$'),day=reportFilter({from_day:dayInput,to_day:dayInput}).from_day,count=timestamp(countInput,'occurred_at');
 const countedResult=countedCustody(0n,counted);
 const row=(await scopedQuery<{agent_id:string;day:string;counted_at:string;as_of:string;source_version:string;valid:boolean;cash_facts:DailyCashFact[];receipts:DailyReceiptRef[];unassigned_franchise_sources_count:number;opening:string;inflow:string;outflow:string;source_count:number}>(scope,['agent_money.read','agent_statement.capture'],`
 SELECT * FROM (WITH frame AS (
 SELECT f.organization_id,f.id franchise_id,$1::uuid agent_id,$2::date AS day,$3::timestamptz counted_at,date_trunc('milliseconds',statement_timestamp()) as_of,
 $2::date::timestamp AT TIME ZONE 'Asia/Kolkata' day_start
 FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}
 AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 WHERE m.organization_id=f.organization_id AND ms.franchise_id=f.id AND m.user_id=$1 AND m.role='delivery_agent')
 ), facts AS (
 SELECT sf.* FROM frame p JOIN shipit.cashbook_source_facts sf ON sf.organization_id=p.organization_id AND sf.franchise_id=p.franchise_id
 JOIN shipit.cash_locations l ON l.organization_id=sf.organization_id AND l.franchise_id=sf.franchise_id AND l.id=sf.location_id
 WHERE l.kind='cash' AND l.custodian_id=p.agent_id AND sf.occurred_at<=p.counted_at AND sf.recorded_at<=p.as_of
 ), receipt_sources AS (
 SELECT r.* FROM frame p JOIN shipit.money_receipts r ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id
 WHERE (r.initial_custodian_id=p.agent_id OR r.receiver_id=p.agent_id) AND r.occurred_at<=p.counted_at AND r.recorded_at<=p.as_of
 )
 SELECT p.agent_id,p.day::text,to_char(p.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') counted_at,
 to_char(p.as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as_of,
 COALESCE((SELECT v.version::text FROM shipit.cashbook_source_versions v WHERE v.organization_id=p.organization_id AND v.franchise_id=p.franchise_id),'0') source_version,
 p.counted_at>=p.day_start AND p.counted_at<p.day_start+interval '1 day' AND p.counted_at<=p.as_of valid,
 (SELECT count(*)::int FROM facts)+(SELECT count(*)::int FROM receipt_sources) source_count,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('source_kind',f.source_kind,'source_id',f.source_id,'location_id',f.location_id,'direction',f.direction,'amount_paise',f.amount_paise::text,
 'occurred_at',to_char(f.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(f.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'request_id',f.request_id,'correction_of',f.correction_of) ORDER BY f.occurred_at,f.recorded_at,f.source_kind,f.source_id,f.location_id,f.direction)
 FROM (SELECT * FROM facts ORDER BY occurred_at,recorded_at,source_kind,source_id,location_id,direction LIMIT $4) f),'[]'::jsonb) cash_facts,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('receipt_id',r.id,'method',r.method,'amount_paise',r.amount_paise::text,'receiver_id',r.receiver_id,'initial_custodian_id',r.initial_custodian_id,
 'occurred_at',to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY r.occurred_at,r.recorded_at,r.id)
 FROM (SELECT * FROM receipt_sources ORDER BY occurred_at,recorded_at,id LIMIT $4) r),'[]'::jsonb) receipts,
 (SELECT count(*)::int FROM shipit.cashbook_source_facts u WHERE u.organization_id=p.organization_id AND u.franchise_id=p.franchise_id AND u.location_id IS NULL
 AND (u.payment_method='cash' OR u.payment_method IS NULL) AND u.occurred_at<=p.counted_at AND u.recorded_at<=p.as_of) unassigned_franchise_sources_count,
 COALESCE((SELECT sum(CASE direction WHEN 'in' THEN amount_paise::numeric ELSE -amount_paise::numeric END) FROM facts WHERE occurred_at<p.day_start),0)::text opening,
 COALESCE((SELECT sum(amount_paise::numeric) FROM facts WHERE occurred_at>=p.day_start AND direction='in'),0)::text inflow,
 COALESCE((SELECT sum(amount_paise::numeric) FROM facts WHERE occurred_at>=p.day_start AND direction='out'),0)::text outflow
 FROM frame p) captured`,[agent,day,count,reportLimits.rows+1])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(!row.valid)throw new FieldValidationError('occurred_at','OUT_OF_RANGE');
 if(row.source_count>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 const expected=BigInt(row.opening)+BigInt(row.inflow)-BigInt(row.outflow);
 const result:DailyCashFrame={agent_id:row.agent_id,day:row.day,timezone:'Asia/Kolkata',counted_at:row.counted_at,as_of:row.as_of,source_version:row.source_version,
 cash_facts:row.cash_facts,receipts:row.receipts,unassigned_franchise_sources_count:row.unassigned_franchise_sources_count,
 totals:{opening_known_paise:row.opening,day_in_paise:row.inflow,day_out_paise:row.outflow,...countedCustody(expected,BigInt(countedResult.counted_paise)),ledger_exception:expected<0n}};
 if(Buffer.byteLength(JSON.stringify(result),'utf8')>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return result;
}
