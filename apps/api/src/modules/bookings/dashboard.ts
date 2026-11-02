import {operationalParcelStatuses,type OperationalDashboard} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';

/** One statement snapshot, with the same membership ceiling as the parcel list. */
export async function operationalDashboard(scope:TenantAccess,clock?:Date):Promise<OperationalDashboard> {
  const row=(await scopedQuery<{as_of:Date;day:string;booked_today:string;booked_yesterday:string;delivered_today:string;stages:{status:string;count:string}[];week:{day:string;bookings:string}[]}>(scope,['parcels.list'],`SELECT * FROM (
    WITH clock AS (SELECT COALESCE($1::timestamptz,statement_timestamp()) AS now),
    days AS (SELECT now,(now AT TIME ZONE 'Asia/Kolkata')::date AS day FROM clock),
    bounds AS (SELECT now,day,day::timestamp AT TIME ZONE 'Asia/Kolkata' AS start,
      date_trunc('week',day::timestamp)::date AS monday FROM days),
    parcels AS (SELECT p.id,p.booking_id,p.status FROM shipit.parcels p WHERE {{franchise:p.organization_id:p.franchise_id}}),
    bookings AS (SELECT b.id,b.confirmed_at FROM shipit.bookings b WHERE {{franchise:b.organization_id:b.franchise_id}}),
    stage_counts AS (SELECT status,count(*)::text AS count FROM parcels GROUP BY status),
    week_days AS (SELECT (bounds.monday+i)::date AS day FROM bounds CROSS JOIN generate_series(0,6) i),
    week_counts AS (SELECT w.day,count(b.id)::text AS bookings FROM week_days w LEFT JOIN bookings b
      ON b.confirmed_at>=w.day::timestamp AT TIME ZONE 'Asia/Kolkata'
      AND b.confirmed_at<(w.day+1)::timestamp AT TIME ZONE 'Asia/Kolkata' GROUP BY w.day)
    SELECT bounds.now AS as_of,to_char(bounds.day,'YYYY-MM-DD') AS day,
      (SELECT count(*)::text FROM bookings b WHERE b.confirmed_at>=bounds.start AND b.confirmed_at<bounds.start+interval '1 day') AS booked_today,
      (SELECT count(*)::text FROM bookings b WHERE b.confirmed_at>=bounds.start-interval '1 day' AND b.confirmed_at<bounds.start) AS booked_yesterday,
      (SELECT count(DISTINCT e.parcel_id)::text FROM shipit.domain_events e JOIN parcels p ON p.id=e.parcel_id
        WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_type IN ('delivery.completed','delivery.collected')
        AND p.status='delivered' AND e.occurred_at>=bounds.start AND e.occurred_at<bounds.start+interval '1 day') AS delivered_today,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',count)) FROM stage_counts),'[]'::jsonb) AS stages,
      (SELECT jsonb_agg(jsonb_build_object('day',to_char(day,'YYYY-MM-DD'),'bookings',bookings) ORDER BY day) FROM week_counts) AS week
    FROM bounds
  ) dashboard`,[clock?.toISOString()??null])).rows[0];
  if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  const count=(value:string)=>{const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n<0)throw new HttpError('TEMPORARILY_UNAVAILABLE');return n;};
  const stages=Object.fromEntries(operationalParcelStatuses.map(status=>[status,0])) as OperationalDashboard['stages'];
  for(const entry of row.stages){if(!operationalParcelStatuses.includes(entry.status as typeof operationalParcelStatuses[number]))throw new HttpError('TEMPORARILY_UNAVAILABLE');stages[entry.status as keyof typeof stages]=count(entry.count);}
  return {as_of:row.as_of.toISOString(),timezone:'Asia/Kolkata',day:row.day,booked_today:count(row.booked_today),booked_yesterday:count(row.booked_yesterday),delivered_today:count(row.delivered_today),stages,week:row.week.map(day=>({day:day.day,bookings:count(day.bookings)}))};
}
