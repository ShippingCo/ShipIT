import React,{useMemo} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {DashboardView,type DashboardQueueItem} from '../components/workspace/DashboardView';
import {Card} from '../components/m3/Surface';
import {Msym} from '../components/m3/Icon';
import {scopedApi} from '../data-access/scoped-api';
import {operationalDashboard} from '../data-access/operational-dashboard';
import {parcels} from '../data-access/parcels';
import {routes} from '../data-access/routes';
import {messaging} from '../data-access/messaging';
import {support} from '../data-access/support';
import {useResource} from './hooks';
import {Loading,Failure,Empty} from './AsyncState';
import {businessDay} from './business-dates';
import {formatKolkata,formatMoney} from './format';
import {useDashboardMoney} from './dashboard-money';
import WeeklyBusiness from './WeeklyBusiness';

const stages=[{key:'booked',label:'Booked',icon:'receipt_long'},{key:'checked_in',label:'At hub',icon:'warehouse'},{key:'dispatched',label:'Dispatched',icon:'local_shipping'},{key:'in_transit',label:'On the way',icon:'alt_route'},{key:'out_for_delivery',label:'Out for delivery',icon:'moped'}] as const;
const icons={road:'local_shipping',rail:'train',air:'flight',sea:'directions_boat'};
const has=(roles:readonly OperatorRole[],allowed:string[])=>roles.some(role=>allowed.includes(role));

export default function OperationsDashboard({controller,roles,workspaceName}:{controller:ScopeController;roles:readonly OperatorRole[];workspaceName:string}) {
 const api=useMemo(()=>scopedApi(controller),[controller]);
 const canRead=has(roles,['org_admin','franchise_admin','operator','dispatcher','read_only']);
 const canFinance=has(roles,['org_admin','franchise_admin','accountant']);
 const canMessages=has(roles,['org_admin','franchise_admin','operator','dispatcher']);
 const canSupport=has(roles,['org_admin','franchise_admin','operator']);
 const money=useDashboardMoney(controller,canFinance&&canRead);
 const resource=useResource(roles.join(','),async signal=>{
   if(!canRead)return null;
   const [summary,recent,dispatch]=await Promise.all([operationalDashboard(api).read(signal),parcels(api).list({limit:6},signal),routes(api).list({limit:100},signal)]);
   return {summary,recent,dispatch};
 });
 const assistance=useResource('assistant-'+roles.join(','),async signal=>{
   const [history,cases]=await Promise.all([canMessages?messaging(api).list('messages',{},signal):null,canSupport?support(api).list(null,signal):null]);
   return {history,cases};
 });
 const title=<h1 className="workspace-visually-hidden" id="workspace-title" tabIndex={-1}>Dashboard</h1>;
 if(!canRead)return <div className="page">{title}<Empty icon="space_dashboard" title={workspaceName} body="Choose an available task from the navigation. Financial reports and assigned delivery work retain their own access rules."/></div>;
 if(resource.phase==='loading')return <div className="page">{title}<Loading label="Loading dashboard…"/></div>;
 if(resource.phase==='error'||!resource.value)return <div className="page">{title}<Failure retry={resource.reload} label="The dashboard could not be loaded."/></div>;
 const {summary,recent,dispatch}=resource.value;
 const counts=summary.stages,moving=stages.reduce((sum,stage)=>sum+counts[stage.key],0);
 const queue:DashboardQueueItem[]=[];
 if(counts.failed_attempt)queue.push({key:'failed',icon:'assignment_return',tone:'error',title:`${counts.failed_attempt} ${counts.failed_attempt===1?'parcel needs':'parcels need'} delivery follow-up`,cta:'Review',go:'/business/packages?status=failed_attempt'});
 if(counts.held_at_office)queue.push({key:'held',icon:'storefront',tone:'warning',title:`${counts.held_at_office} ${counts.held_at_office===1?'parcel is':'parcels are'} held at the office`,cta:'Review',go:'/business/packages?status=held_at_office'});
 if(counts.out_for_delivery)queue.push({key:'delivery',icon:'moped',title:`${counts.out_for_delivery} ${counts.out_for_delivery===1?'parcel is':'parcels are'} out for delivery`,cta:'View parcels',go:'/business/packages?status=out_for_delivery'});
 const openCases=assistance.value?.cases?.items.filter(item=>item.state!=='resolved').length??0;
 if(openCases)queue.push({key:'support',icon:'support_agent',tone:'error',title:`${assistance.value?.cases?.page.has_more?'At least ':''}${openCases} ${openCases===1?'customer case needs':'customer cases need'} a person`,cta:'Reply',go:'/business/support'});
 const snapshot=money.snapshot,amount=snapshot?.totals.outstanding;
 if(amount&&BigInt(amount)>0n)queue.push({key:'money',icon:'currency_rupee',tone:'warning',title:`${formatMoney(amount)} outstanding on bookings with delivered parcels`,cta:'Review payments',go:'/business/reports?ageing_snapshot='+snapshot!.id});
 const moneyLink=snapshot?'/business/reports?ageing_snapshot='+snapshot.id:canFinance?'/business/reports':'/business/packages';
 const moneyAge=<Card>{canFinance?<>
   {money.busy&&<p className="dashboard-note" role="status">Loading payment balances…</p>}
   {money.error&&<p className="dashboard-note" role="alert">Payment balances could not be loaded. No paid or unpaid total is assumed.</p>}
   {snapshot&&<><div className="age">{Object.entries(snapshot.buckets).map(([key,value])=><div className="age-row" key={key}><div className="age-top"><span className="age-dot"/><span className="age-lbl">{({'0_30':'0–30 days','31_60':'31–60 days','61_plus':'61 days or more',unknown:'Date unavailable',future:'Future booking date'})[key]}</span><span className="age-val">{formatMoney(value)}</span></div></div>)}</div><p className="dashboard-note">Age follows the accounting report's booking-date rule. Each booking balance is counted once, including corrections. Captured {formatKolkata(snapshot.as_of)}.</p></>}
   <button className="card-foot-link" type="button" disabled={money.busy} onClick={money.reload}>{money.error?'Retry payment balances':snapshot?'Refresh payment balances':'Load payment balances'}</button>
 </>:<p className="dashboard-note">Financial summaries are available to the owner and accounting team. Use a parcel's payment record for permitted counter work.</p>}</Card>;
 const accepted=assistance.value?.history?.items.filter(row=>row.message&&row.message.progress!=='none').length;
 const assistant=<Card pad className="agent">
   {assistance.phase==='loading'?<p role="status">Loading customer activity…</p>:assistance.phase==='error'?<><p role="alert">Customer activity could not be loaded.</p><button className="btn btn-outlined" type="button" onClick={assistance.reload}>Retry customer activity</button></>:<>
    <div className="bot-grid">{[{icon:'send',label:'Updates accepted',value:accepted===undefined?'—':String(accepted)+(assistance.value?.history?.page.has_more?'+':'')},{icon:'support_agent',label:'Need a person',value:assistance.value?.cases?String(openCases)+(assistance.value.cases.page.has_more?'+':''):'—'}].map(cell=><div className="bot-cell" key={cell.label}><div className="bot-top"><span className="bot-ic"><Msym name={cell.icon}/></span><span className="bot-l">{cell.label}</span></div><div className="bot-n">{cell.value}</div></div>)}</div>
    <p className="dashboard-note">Accepted means the provider accepted the update. A plus means more records are available.</p>
   </>}
   {canMessages&&<Link className="card-foot-link agent-cta" to="/business/automation">Open conversations</Link>}
 </Card>;
 const todayRoutes=dispatch.items.filter(route=>route.state!=='archived'&&businessDay(new Date(route.scheduled_departure_at))===summary.day);
 const bookingAllowed=canAdminister(roles,'bookings.create')||roles.includes('operator');
 return <>
  <DashboardView date={formatKolkata(summary.as_of,{weekday:'long',day:'numeric',month:'long'})} contextAction={<button className="btn btn-text" type="button" onClick={resource.reload}><Msym name="refresh"/>Refresh</button>} queue={queue} queueNote="Parcel counts are for the selected branch." emptyQueueTitle="No flagged parcels in this snapshot" emptyQueueNote="Review customer messages and payment balances for other work." assistant={assistant}
   metrics={[
    {key:'booked',icon:'note_add',label:'Booked today',tone:'info',value:summary.booked_today,delta:summary.booked_today-summary.booked_yesterday,foot:'bookings, including multi-parcel bookings',go:'/business/packages?booked=today'},
    {key:'moving',icon:'local_shipping',label:'Parcels moving',tone:'info',value:moving,foot:'in the delivery network',go:'/business/packages'},
    {key:'delivered',icon:'task_alt',label:'Delivered today',tone:'ok',value:summary.delivered_today,foot:'confirmed deliveries',go:'/business/packages?status=delivered'},
    {key:'money',icon:'currency_rupee',label:'Money to collect',tone:'warning',value:amount===undefined?'—':formatMoney(amount),foot:snapshot?`${snapshot.count} ${snapshot.count===1?'booking':'bookings'} with deliveries`:canFinance?'Loading or awaiting a verified report':'Open permitted payment records',go:moneyLink},
   ]}
   stages={stages.map(stage=>({...stage,n:counts[stage.key],go:'/business/packages?status='+stage.key}))}
   week={summary.week.map(day=>({day:day.day,n:day.bookings,today:day.day===summary.day,label:formatKolkata(day.day+'T12:00:00Z',{weekday:'narrow'}),full:formatKolkata(day.day+'T12:00:00Z',{weekday:'long',day:'numeric',month:'short'})}))} moneyAge={moneyAge}
   routes={todayRoutes.map(route=>({id:route.id,icon:icons[route.mode],title:route.origin+' → '+route.destination,detail:formatKolkata(route.scheduled_departure_at),status:route.state,go:'/business/routes'}))} routesNote={dispatch.page.has_more?'Scheduled today among the latest 100 routes. Open all routes for the complete list.':undefined}
   recent={recent.items.map(parcel=>({id:parcel.id,icon:stages.find(stage=>stage.key===parcel.status)?.icon??'inventory_2',title:<><span className="mono bk-dk">{parcel.docket}</span>{parcel.details?.city&&<span className="bk-to">to {parcel.details.city}</span>}</>,detail:parcel.sender.name+' · '+parcel.sender.phone_display+' · '+formatKolkata(parcel.confirmed_at),status:parcel.status.replaceAll('_',' '),go:'/business/packages?parcel='+parcel.id}))} recentNote="Each row is one parcel. One booking can have several tracking numbers." newBooking={bookingAllowed?'/business/new-booking':undefined}/>
  {canFinance&&<details className="dashboard-supplement"><summary>Custom booking trends</summary><WeeklyBusiness controller={controller}/></details>}
 </>;
}
