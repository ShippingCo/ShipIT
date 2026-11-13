import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardSeriesDays,type OperationalDashboard} from '@shippingco/shared';
import {bookingSetup} from '../booking-support.ts';
import {org,A,B,otherOrg,C} from '../audit-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';

await test('dashboard counts all parcels and distinct bookings beyond a list page, with Monday/IST boundaries',{timeout:45000},async t=>{
  const s=await bookingSetup(t),parcels=Array.from({length:50},(_,i)=>({...s.body.parcels[0]!,weight_grams:i===49?68:19}));
  for(let i=0;i<3;i++){const result=await s.book({...s.body,parcels});assert.equal(result.statusCode,201,result.body);}
  const get=()=>s.app.inject({url:'/api/v1/parcels/summary?'+new URLSearchParams({organization_id:org,franchise_id:A}),cookies:s.cookies(s.operator.token)});
  const response=await get();assert.equal(response.statusCode,200,response.body);const value=response.json<OperationalDashboard>();
  assert.equal(value.booked_today,3);assert.equal(value.booked_yesterday,0);assert.equal(value.stages.booked,150);assert.equal(value.delivered_today,0);
  assert.equal(value.week.length,7);assert.equal(value.week[0]!.day,'2098-12-29');assert.equal(value.week[6]!.day,'2099-01-04');assert.equal(value.week.reduce((n,d)=>n+d.bookings,0),3);
  // The trailing series the tiles, the sparkline and the chart ranges all read. It is a fixed
  // width ending today, and its last day has to agree with the day's own figures or the screen
  // would show a chart that contradicts the number printed beside it.
  assert.equal(value.days.length,dashboardSeriesDays);
  assert.equal(value.days[dashboardSeriesDays-1]!.day,'2099-01-01');
  assert.equal(value.days[0]!.day,'2098-12-03');
  assert.equal(value.days[dashboardSeriesDays-1]!.bookings,value.booked_today);
  assert.equal(value.days[dashboardSeriesDays-1]!.delivered,value.delivered_today);
  assert.equal(value.days.reduce((n,d)=>n+d.bookings,0),3);
  assert.equal(value.days.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.day)),true);
  // Courier volume is weekly-cyclical, so the comparison the dashboard shows is the same
  // weekday a week ago, never yesterday. Nothing was booked a week before these three.
  assert.equal(value.booked_same_weekday_last_week,0);
  s.setNow('2099-01-01T18:29:59.999Z');assert.equal((await get()).json().booked_today,3);
  s.setNow('2099-01-01T18:30:00.000Z');const next=(await get()).json<OperationalDashboard>();assert.equal(next.day,'2099-01-02');assert.equal(next.booked_today,0);assert.equal(next.booked_yesterday,3);
  s.setNow('2099-01-04T18:30:00.000Z');const monday=(await get()).json<OperationalDashboard>();assert.equal(monday.week[0]!.day,'2099-01-05');assert.equal(monday.week.reduce((n,d)=>n+d.bookings,0),0);
  // A week on, the same three bookings are what "last Thursday" means, and they are still in
  // the thirty-day series while the Monday week no longer contains them.
  s.setNow('2099-01-08T12:00:00.000Z');const later=(await get()).json<OperationalDashboard>();
  assert.equal(later.day,'2099-01-08');assert.equal(later.booked_today,0);assert.equal(later.booked_same_weekday_last_week,3);
  assert.equal(later.days.length,dashboardSeriesDays);assert.equal(later.days[dashboardSeriesDays-1]!.day,'2099-01-08');
  assert.equal(later.days.find(d=>d.day==='2099-01-01')!.bookings,3);
  s.setNow('2099-02-01T12:00:00.000Z');const month=(await get()).json<OperationalDashboard>();
  // Past the window the series reports zeros rather than dropping days: a chart with holes in
  // it cannot be compared across ranges.
  assert.equal(month.days.length,dashboardSeriesDays);assert.equal(month.days.reduce((n,d)=>n+d.bookings,0),0);
  s.setNow('2099-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(value).includes(s.source.phone),false);assert.equal(JSON.stringify(value).includes('paise'),false);
});

await test('dashboard preserves the parcel-read role ceiling and rejects sibling or foreign scopes',{timeout:45000},async t=>{
  const s=await bookingSetup(t);assert.equal((await s.book()).statusCode,201);
  const get=(token:string,franchise=A,organization=org)=>s.app.inject({url:'/api/v1/parcels/summary?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),cookies:s.cookies(token)});
  for(const role of ['franchise_admin','operator','dispatcher','read_only']){const actor=await s.grant(role,[A]);const result=await get(actor.token);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().stages.booked,1);}
  for(const role of ['delivery_agent','accountant'])assert.equal((await get((await s.grant(role,[A])).token)).statusCode,403);
  const sibling=await s.grant('read_only',[B]);assert.equal((await get(sibling.token)).statusCode,404);assert.equal((await get(sibling.token,B)).json().stages.booked,0);
  const foreign=await s.beta('read_only');assert.equal((await get(foreign.token)).statusCode,403);assert.equal((await get(foreign.token,C,otherOrg)).json().stages.booked,0);
  assert.equal((await get(s.admin.token,B)).json().stages.booked,0);
  assert.equal((await s.app.inject({url:'/api/v1/parcels/summary?'+new URLSearchParams({organization_id:org}),cookies:s.cookies(s.admin.token)})).statusCode,422);
  assert.equal((await s.app.inject({url:'/api/v1/parcels/summary?'+new URLSearchParams({organization_id:org,franchise_id:A,from:'2099-01-01'}),cookies:s.cookies(s.operator.token)})).statusCode,422);
});

await test('delivered today counts persisted delivery proof once and never collects money',{timeout:45000},async t=>{
  const s=await bookingSetup(t),created=await s.book();assert.equal(created.statusCode,201,created.body);
  const parcel=created.json().parcels[0],agent=await s.grant('delivery_agent',[A]);
  const {service,state}=await startTestDelivery(s,parcel.id,agent),proof=await testDeliveryCode(s,parcel.id),key=randomUUID();
  const body={expected_version:5,challenge_ref:state.challenge_ref,challenge_version:state.challenge_version,proof};
  await service.complete(agent.token,parcel.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,false,randomUUID());
  await service.complete(agent.token,parcel.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,false,randomUUID());
  const value=await s.booking.dashboard(s.operator.token,{organization_id:org,franchise_id:A},randomUUID());
  assert.equal(value.delivered_today,1);assert.equal(value.stages.delivered,1);assert.equal(value.stages.booked,0);
  const obligations=await s.db.adminQuery('SELECT collected_paise FROM shipit.booking_obligations');assert.equal(Number(obligations.rows[0]!.collected_paise),0);
  s.setNow('2099-01-01T18:30:00.000Z');assert.equal((await s.booking.dashboard(s.operator.token,{organization_id:org,franchise_id:A},randomUUID())).delivered_today,0);
});
