import {operationalParcelStatuses,dashboardSeriesDays,type OperationalDashboard} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';

/**
 * One statement snapshot, with the same membership ceiling as the parcel list.
 *
 * The trailing daily series (`days`) exists because every comparison the dashboard makes is
 * weekly, not daily: courier volume is cyclical, so Monday against Sunday is noise and Monday
 * against last Monday is a fact. One fixed-width series answers all of it — the same-weekday
 * comparison, the tile sparklines, and the 7/14/30-day chart — in a single query, so no range
 * parameter is needed and the cost of the endpoint does not vary with what the screen shows.
 */
export async function operationalDashboard(scope:TenantAccess,clock?:Date):Promise<OperationalDashboard> {
  const row=(await scopedQuery<{as_of:Date;day:string;booked_today:string;booked_yesterday:string;booked_same_weekday_last_week:string;delivered_today:string;stages:{status:string;count:string}[];week:{day:string;bookings:string}[];days:{day:string;bookings:string;delivered:string}[]}>(scope,['parcels.list'],`SELECT * FROM (
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
      AND b.confirmed_at<(w.day+1)::timestamp AT TIME ZONE 'Asia/Kolkata' GROUP BY w.day),
    series_days AS (SELECT (bounds.day-i)::date AS day FROM bounds CROSS JOIN generate_series(0,${dashboardSeriesDays-1}) i),
    series_bookings AS (SELECT s.day,count(b.id)::text AS bookings FROM series_days s LEFT JOIN bookings b
      ON b.confirmed_at>=s.day::timestamp AT TIME ZONE 'Asia/Kolkata'
      AND b.confirmed_at<(s.day+1)::timestamp AT TIME ZONE 'Asia/Kolkata' GROUP BY s.day),
    delivery_days AS (SELECT DISTINCT e.parcel_id,(e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day
      FROM shipit.domain_events e JOIN parcels p ON p.id=e.parcel_id
      WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_type IN ('delivery.completed','delivery.collected') AND p.status='delivered'),
    series_delivered AS (SELECT s.day,count(d.parcel_id)::text AS delivered FROM series_days s
      LEFT JOIN delivery_days d ON d.day=s.day GROUP BY s.day),
    series AS (SELECT b.day,b.bookings,d.delivered FROM series_bookings b JOIN series_delivered d ON d.day=b.day)
    SELECT bounds.now AS as_of,to_char(bounds.day,'YYYY-MM-DD') AS day,
      (SELECT count(*)::text FROM bookings b WHERE b.confirmed_at>=bounds.start AND b.confirmed_at<bounds.start+interval '1 day') AS booked_today,
      (SELECT count(*)::text FROM bookings b WHERE b.confirmed_at>=bounds.start-interval '1 day' AND b.confirmed_at<bounds.start) AS booked_yesterday,
      (SELECT count(*)::text FROM bookings b WHERE b.confirmed_at>=bounds.start-interval '7 days' AND b.confirmed_at<bounds.start-interval '6 days') AS booked_same_weekday_last_week,
      (SELECT count(DISTINCT e.parcel_id)::text FROM shipit.domain_events e JOIN parcels p ON p.id=e.parcel_id
        WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_type IN ('delivery.completed','delivery.collected')
        AND p.status='delivered' AND e.occurred_at>=bounds.start AND e.occurred_at<bounds.start+interval '1 day') AS delivered_today,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',count)) FROM stage_counts),'[]'::jsonb) AS stages,
      (SELECT jsonb_agg(jsonb_build_object('day',to_char(day,'YYYY-MM-DD'),'bookings',bookings) ORDER BY day) FROM week_counts) AS week,
      (SELECT jsonb_agg(jsonb_build_object('day',to_char(day,'YYYY-MM-DD'),'bookings',bookings,'delivered',delivered) ORDER BY day) FROM series) AS days
    FROM bounds
  ) dashboard`,[clock?.toISOString()??null])).rows[0];
  if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  const count=(value:string)=>{const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n<0)throw new HttpError('TEMPORARILY_UNAVAILABLE');return n;};
  const stages=Object.fromEntries(operationalParcelStatuses.map(status=>[status,0])) as OperationalDashboard['stages'];
  for(const entry of row.stages){if(!operationalParcelStatuses.includes(entry.status as typeof operationalParcelStatuses[number]))throw new HttpError('TEMPORARILY_UNAVAILABLE');stages[entry.status as keyof typeof stages]=count(entry.count);}
  if(row.days.length!==dashboardSeriesDays)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return {as_of:row.as_of.toISOString(),timezone:'Asia/Kolkata',day:row.day,booked_today:count(row.booked_today),booked_yesterday:count(row.booked_yesterday),
    booked_same_weekday_last_week:count(row.booked_same_weekday_last_week),delivered_today:count(row.delivered_today),stages,
    week:row.week.map(day=>({day:day.day,bookings:count(day.bookings)})),
    days:row.days.map(day=>({day:day.day,bookings:count(day.bookings),delivered:count(day.delivered)}))};
}
