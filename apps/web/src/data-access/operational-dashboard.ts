import {operationalParcelStatuses,type OperationalDashboard} from '@shippingco/shared';
import {array,choice,instant,integer,object,text,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import {businessDay,shiftDay,weekMonday} from '../operations/business-dates';

const shape=object({as_of:instant,timezone:choice('Asia/Kolkata'),day:text,booked_today:integer(),booked_yesterday:integer(),delivered_today:integer(),
  stages:object(Object.fromEntries(operationalParcelStatuses.map(status=>[status,integer()])) as Record<typeof operationalParcelStatuses[number],Decoder<number>>),week:array(object({day:text,bookings:integer()}),7)});
export const operationalDashboardDto:Decoder<OperationalDashboard>=value=>{
  const result=shape(value),monday=weekMonday(businessDay(new Date(result.as_of)));
  if(result.day!==businessDay(new Date(result.as_of))||result.week.length!==7||result.week.some((day,index)=>day.day!==shiftDay(monday,index))||result.week.find(day=>day.day===result.day)?.bookings!==result.booked_today||result.delivered_today>result.stages.delivered)return protocol();
  return result;
};
export const operationalDashboard=(api:ScopedApi)=>({read:(signal?:AbortSignal)=>api.read(api.path('/api/v1/parcels/summary'),operationalDashboardDto,signal)});
