import {operationalParcelStatuses,dashboardSeriesDays,type OperationalDashboard} from '@shippingco/shared';
import {array,choice,instant,integer,object,text,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import {businessDay,shiftDay,weekMonday} from '../operations/business-dates';

const shape=object({as_of:instant,timezone:choice('Asia/Kolkata'),day:text,booked_today:integer(),booked_yesterday:integer(),booked_same_weekday_last_week:integer(),delivered_today:integer(),
  stages:object(Object.fromEntries(operationalParcelStatuses.map(status=>[status,integer()])) as Record<typeof operationalParcelStatuses[number],Decoder<number>>),
  week:array(object({day:text,bookings:integer()}),7),
  days:array(object({day:text,bookings:integer(),delivered:integer()}),dashboardSeriesDays)});
export const operationalDashboardDto:Decoder<OperationalDashboard>=value=>{
  const result=shape(value),monday=weekMonday(businessDay(new Date(result.as_of)));
  if(result.day!==businessDay(new Date(result.as_of))||result.week.length!==7||result.week.some((day,index)=>day.day!==shiftDay(monday,index))||result.week.find(day=>day.day===result.day)?.bookings!==result.booked_today||result.delivered_today>result.stages.delivered)return protocol();
  // The series is the dashboard's only evidence of a trend, so its shape is checked rather
  // than trusted: a fixed width, contiguous ascending days, ending today, and a last entry
  // that agrees with the day's own figures. A series that disagrees with the tile beside it
  // would make the screen argue with itself, which is worse than showing no trend at all.
  const first=shiftDay(result.day,-(dashboardSeriesDays-1)),last=result.days[result.days.length-1];
  if(result.days.length!==dashboardSeriesDays||result.days.some((day,index)=>day.day!==shiftDay(first,index))
    ||last?.bookings!==result.booked_today||last?.delivered!==result.delivered_today)return protocol();
  return result;
};
export const operationalDashboard=(api:ScopedApi)=>({read:(signal?:AbortSignal)=>api.read(api.path('/api/v1/parcels/summary'),operationalDashboardDto,signal)});
