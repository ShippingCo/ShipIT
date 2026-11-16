import React,{useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {DashboardView,type DashboardRange,type DashboardStage,type DashboardTile,type DashboardTodoRow,type DashboardValueCell} from '../components/workspace/DashboardView';
import {Msym} from '../components/m3/Icon';
import {scopedApi} from '../data-access/scoped-api';
import {operationalDashboard} from '../data-access/operational-dashboard';
import {support} from '../data-access/support';
import {assistantCount,assistantMetrics,lastClosedWeek,type AssistantCount} from '../data-access/assistant-metrics';
import {useResource} from './hooks';
import {DataRefresh,Empty} from './AsyncState';
import {formatKolkata,formatMoney} from './format';
import {useDashboardMoney} from './dashboard-money';

/**
 * The seven steps a parcel actually takes through this product, which is one more than the
 * design plates draw.
 *
 * The plates merge "sent out" and "on the way" into a single stage. The product does not: an
 * operator presses Dispatch and later presses In transit, and both are real states a parcel
 * sits in. Merging them on screen would leave the stage's count and the list it opens
 * disagreeing — the list filter takes one status — and a figure that does not match the screen
 * it leads to is the one defect this dashboard cannot afford. Recorded as an amendment in the
 * PRD rather than silently diverged from.
 */
const journeyStages=[
  {key:'booked',label:'Booked',icon:'receipt_long'},
  {key:'checked_in',label:'At hub',icon:'warehouse'},
  {key:'dispatched',label:'Sent out',icon:'local_shipping'},
  {key:'in_transit',label:'On the way',icon:'alt_route'},
  {key:'out_for_delivery',label:'Out for delivery',icon:'moped'},
  {key:'delivered',label:'Delivered',icon:'task_alt'},
  {key:'rto',label:'Returned',icon:'assignment_return',alert:true},
] as const;

const has=(roles:readonly OperatorRole[],allowed:string[])=>roles.some(role=>allowed.includes(role));
const weekdayOf=(day:string)=>new Date(day+'T12:00:00Z').toLocaleDateString('en-IN',{weekday:'long',timeZone:'UTC'});

/**
 * The pattern, in words.
 *
 * A bar chart shows which day was biggest; it does not say that Fridays are always biggest,
 * which is the only thing on the card an owner can act on. So the caption is computed from the
 * same series the bars draw, and it says nothing at all rather than guess from a week that has
 * barely any bookings in it.
 */
function seriesCaption(days:{day:string;bookings:number}[]):string {
  const total=days.reduce((sum,day)=>sum+day.bookings,0);
  if(total===0)return 'No bookings in this period yet.';
  const byWeekday=new Map<number,{sum:number;n:number}>();
  for(const day of days) {
    const index=new Date(day.day+'T12:00:00Z').getUTCDay(),entry=byWeekday.get(index)??{sum:0,n:0};
    byWeekday.set(index,{sum:entry.sum+day.bookings,n:entry.n+1});
  }
  const averages=[...byWeekday.entries()].map(([index,entry])=>({index,mean:entry.sum/entry.n}));
  if(averages.length<3||total<7)return 'Too few bookings so far to show a pattern.';
  const busiest=averages.reduce((top,entry)=>entry.mean>top.mean?entry:top,averages[0]!);
  const quietest=averages.reduce((low,entry)=>entry.mean<low.mean?entry:low,averages[0]!);
  const name=(index:number)=>new Date(Date.UTC(2024,0,7+index)).toLocaleDateString('en-IN',{weekday:'long',timeZone:'UTC'});
  if(busiest.mean<=0)return 'No bookings in this period yet.';
  const busy='Busiest on '+name(busiest.index)+'s.';
  if(quietest.index===busiest.index||quietest.mean>=busiest.mean*0.7)return busy+' Every day runs about the same.';
  if(quietest.mean===0)return busy+' Nothing at all on '+name(quietest.index)+'s.';
  return busy+' '+name(quietest.index)+'s run about '+Math.max(1,Math.round(busiest.mean/quietest.mean))+' times quieter.';
}

export default function OperationsDashboard({controller,roles,workspaceName}:{controller:ScopeController;roles:readonly OperatorRole[];workspaceName:string}) {
  const api=useMemo(()=>scopedApi(controller),[controller]);
  const canRead=has(roles,['org_admin','franchise_admin','operator','dispatcher','read_only']);
  const canFinance=has(roles,['org_admin','franchise_admin','accountant']);
  const canSupport=has(roles,['org_admin','franchise_admin','operator']);
  const [range,setRange]=useState<DashboardRange>(7);
  const [tries,setTries]=useState({figures:1,assistant:1});
  const money=useDashboardMoney(controller,canFinance&&canRead);
  // Keyed on the franchise as well as the role: when the branch changes the question changes,
  // so the figures clear to skeletons. One branch's counts under another branch's name is the
  // worse error, and it is the one an owner would never notice.
  const resource=useResource(api.franchise+'-'+roles.join(','),async signal=>
    canRead?await operationalDashboard(api).read(signal):null);
  const week=useMemo(()=>lastClosedWeek(),[]);
  // What the assistant actually did is recorded per conversation and served one closed week at
  // a time with small groups hidden. It is the only honest answer to "is this software doing
  // anything for me": a count of messages sent cannot tell an answer the customer needed from
  // a notification nobody read.
  const outcomes=useResource(api.franchise+'-assistant-'+week+'-'+roles.join(','),async signal=>
    canSupport?await assistantMetrics(api).read(week,signal):null);
  const cases=useResource(api.franchise+'-cases-'+roles.join(','),async signal=>
    canSupport?await support(api).list(null,signal):null);

  const title=<h1 className="workspace-visually-hidden" id="workspace-title" tabIndex={-1}>Dashboard</h1>;
  if(!canRead)return <div className="page">{title}<Empty icon="space_dashboard" title={workspaceName}
    body="Choose an available task from the navigation. Financial reports and assigned delivery work retain their own access rules."/></div>;

  const summary=resource.value,failed=resource.phase==='error',loading=resource.phase==='loading'&&!summary;
  const bookingAllowed=canAdminister(roles,'bookings.create')||roles.includes('operator');
  const newBooking=bookingAllowed?'/business/new-booking':undefined;

  // ---- the series the chart and the sparkline both read -------------------------------
  const days=summary?.days??[];
  const window=days.slice(-range);
  const series=summary?window.map(day=>({day:day.day,n:day.bookings,
    label:formatKolkata(day.day+'T12:00:00Z',{weekday:'narrow'}),
    full:formatKolkata(day.day+'T12:00:00Z',{weekday:'long',day:'numeric',month:'short'})})):null;

  // ---- money -------------------------------------------------------------------------
  const snapshot=money.snapshot,outstanding=snapshot?.totals.outstanding;
  const stale=snapshot?BigInt(snapshot.buckets['31_60'])+BigInt(snapshot.buckets['61_plus']):0n;
  const moneyLink=snapshot?'/business/reports?ageing_snapshot='+snapshot.id:canFinance?'/business/reports':'/business/packages';
  const moneyBars=snapshot?(()=>{
    const rows=[['0_30','Under a month','0–30 days'],['31_60','1–2 months','31–60 days'],['61_plus','Over 2 months','61 days or more'],
      ['unknown','No date','Date unavailable'],['future','Future','Future booking date']] as const;
    const present=rows.filter(([key])=>BigInt(snapshot.buckets[key])!==0n);
    if(!present.length)return null;
    const peak=present.reduce((top,[key])=>{const value=BigInt(snapshot.buckets[key]);return value>top?value:top;},0n);
    return {bars:present.map(([key,label,full])=>({key,label,full,
      share:peak>0n?Number(BigInt(snapshot.buckets[key])*1000n/peak)/10:0,
      amount:formatMoney(snapshot.buckets[key])})),
      caption:stale>0n
        ?formatMoney(String(stale))+' of '+formatMoney(snapshot.totals.outstanding)+' has been waiting more than a month.'
        :'Everything owed is less than a month old.'};
  })():null;

  // ---- the assistant -----------------------------------------------------------------
  const count=(category:string)=>assistantCount(outcomes.value,category);
  const answered=count('success'),thanks=count('thanks'),handoff=count('handoff'),failures=count('failure'),opened=count('case_opened');
  const suppressed=[answered,thanks,handoff,failures,opened].some(cell=>cell.suppressed);
  const figure=(cell:AssistantCount)=>cell.suppressed?'under 5':cell.events===null?'—':cell.events.toLocaleString('en-IN');
  const finished=answered.events??0,handed=handoff.events??0,broke=failures.events??0,attempted=finished+handed+broke;
  const minutes=finished*2.5;
  const valueCells:DashboardValueCell[]=[
    {key:'answered',value:figure(answered),label:'questions answered without you'},
    {key:'share',value:attempted>0?Math.round(finished/attempted*100)+'%':'—',
      label:attempted>0?'handled start to finish ('+finished.toLocaleString('en-IN')+' of '+attempted.toLocaleString('en-IN')+')':'handled start to finish'},
    {key:'hours',value:finished>0?'≈ '+(minutes>=90?Math.round(minutes/60)+' hrs':Math.round(minutes)+' mins'):'—',
      label:'of phone calls you did not take',
      basis:'An estimate: '+finished.toLocaleString('en-IN')+' answered questions at two and a half minutes of phone time each.'},
    {key:'thanks',value:figure(thanks),label:'customers said thank you',tone:'happy'},
    {key:'handoff',value:figure(handoff),label:'passed to you to finish',tone:'warn'},
    {key:'cases',value:figure(opened),label:'became a case someone had to work',tone:'warn'},
  ];
  const nothingHandled=attempted===0&&(thanks.events??0)===0&&(opened.events??0)===0&&!suppressed;
  const weekFrom=formatKolkata(week+'T12:00:00Z',{day:'numeric',month:'short'});
  const weekTo=formatKolkata(new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString(),{day:'numeric',month:'short'});

  // ---- needs you, ranked: money at risk, then an unhappy customer, then stuck parcels --
  const openCases=cases.value?.items.filter(item=>item.state!=='resolved').length??0;
  const stages=summary?.stages;
  const rows:DashboardTodoRow[]=[];
  if(outstanding&&BigInt(outstanding)>0n)rows.push({key:'money',icon:'currency_rupee',tone:'warning',
    title:formatMoney(outstanding)+' is still to collect',
    detail:(snapshot?.count??0)+' delivered '+((snapshot?.count??0)===1?'booking':'bookings')+' unpaid. Decide: chase it or write it off.',
    go:moneyLink});
  if(openCases>0)rows.push({key:'support',icon:'support_agent',tone:'danger',
    title:openCases===1?'A customer is waiting for a person':openCases+' customers are waiting for a person',
    detail:'ShipIT could not finish these. Decide: reply or close the case.',go:'/business/support'});
  if(stages?.failed_attempt)rows.push({key:'failed',icon:'assignment_return',tone:'danger',
    title:stages.failed_attempt+' '+(stages.failed_attempt===1?'parcel came back':'parcels came back'),
    detail:'Delivery was attempted and failed. Decide: try again or return to sender.',
    go:'/business/packages?status=failed_attempt'});
  if(stages?.held_at_office)rows.push({key:'held',icon:'storefront',tone:'warning',
    title:stages.held_at_office+' '+(stages.held_at_office===1?'parcel is':'parcels are')+' held at the office',
    detail:'Waiting for the customer to collect. Decide: call them or return to sender.',
    go:'/business/packages?status=held_at_office'});

  // ---- the four figures ---------------------------------------------------------------
  const lastWeek=summary?.booked_same_weekday_last_week??0,booked=summary?.booked_today??0;
  const weekday=summary?weekdayOf(summary.day):'';
  const comparison=()=>{
    if(!summary)return null;
    if(lastWeek===0)return booked===0?<>none last {weekday} either</>:<>nothing last {weekday}</>;
    const change=Math.round((booked-lastWeek)/lastWeek*100);
    if(change===0)return <>the same as last {weekday}</>;
    // A quiet Sunday is not a fault, so the arrow is never red. Colouring an ordinary weekly
    // dip red teaches the owner to ignore red, and red is needed for one figure only.
    return <><span className={'delta '+(change>0?'up':'down')}>
      <Msym name={change>0?'arrow_upward':'arrow_downward'} aria-hidden="true"/>{Math.abs(change)}%</span> vs last {weekday}</>;
  };
  const tiles:DashboardTile[]=[
    {key:'booked',icon:'note_add',label:'Booked today',loading,missing:failed,
      value:failed?'—':booked.toLocaleString('en-IN'),foot:failed?'not loaded':comparison(),
      spark:(()=>{const last=days.slice(-7).map(day=>day.bookings);
        return new Set(last).size>1?last:undefined;})(),go:'/business/packages?booked=today'},
    {key:'money',icon:'currency_rupee',label:'Still to collect',
      loading:canFinance&&money.busy&&!snapshot,missing:!canFinance||money.error||outstanding===undefined,
      value:outstanding===undefined?'—':formatMoney(outstanding),
      foot:!canFinance?'needs the owner or accounting role'
        :money.error?'not loaded'
        :outstanding===undefined?'not loaded yet'
        :BigInt(outstanding)===0n?'every delivered booking is paid'
        :<>across {snapshot!.count} {snapshot!.count===1?'booking':'bookings'} · {stale>0n?formatMoney(String(stale))+' over a month old':'none over a month old'}</>,
      go:moneyLink},
    {key:'assistant',icon:'forum',label:'Answered by ShipIT',accent:true,
      loading:canSupport&&outcomes.phase==='loading'&&!outcomes.value,
      missing:!canSupport||outcomes.phase==='error'||answered.events===null,
      value:!canSupport?'—':figure(answered),
      foot:!canSupport?'needs the owner or counter role'
        :outcomes.phase==='error'?'not loaded'
        :answered.suppressed?'too few to show without naming a customer'
        :<>customers you did not have to call · week of {weekFrom}</>,
      go:'/business/reports'},
    {key:'needs',icon:rows.length?'warning':'check_circle',label:'Needs you',loading,
      value:rows.length?String(rows.length):'Nothing',danger:rows.length>0,quiet:rows.length===0,
      foot:rows.length?'ShipIT could not handle these':'everything is moving',
      go:rows[0]?.go??'/business/packages',missing:rows.length===0},
  ];

  const retryFigures=()=>{setTries(state=>({...state,figures:state.figures+1}));resource.reload();};
  const retryAssistant=()=>{setTries(state=>({...state,assistant:state.assistant+1}));outcomes.reload();};

  return <DashboardView
    date={summary?formatKolkata(summary.as_of,{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'Today'}
    asOf={summary?formatKolkata(summary.as_of,{hour:'numeric',minute:'2-digit'}):null}
    branch={workspaceName}
    newBooking={newBooking}
    contextAction={<DataRefresh resource={resource}/>}
    notices={[
      ...failed?[{key:'figures',title:'Today’s figures could not be loaded',
        body:'Everything below still works.',tries:tries.figures,busy:resource.phase==='loading',retry:retryFigures}]:[],
      ...canSupport&&outcomes.phase==='error'?[{key:'assistant',title:'What the assistant did could not be loaded',
        body:'No figure is shown rather than a wrong one.',tries:tries.assistant,busy:false,retry:retryAssistant}]:[],
    ]}
    tiles={tiles}
    stages={summary?journeyStages.map<DashboardStage>(stage=>({key:stage.key,icon:stage.icon,label:stage.label,
      n:summary.stages[stage.key],go:'/business/packages?status='+stage.key,alert:'alert' in stage&&stage.alert})):null}
    journeyTotal={summary?journeyStages.reduce((sum,stage)=>sum+summary.stages[stage.key],0):null}
    series={series} range={range} onRange={setRange}
    seriesCaption={summary?seriesCaption(window):''}
    seriesEmpty={<div className="chart-blank" role="status">
      <Msym name="analytics" aria-hidden="true"/>
      <p>Your first booking will appear here.</p>
      {newBooking&&<Link className="btn btn-filled" to={newBooking}>New booking</Link>}
    </div>}
    money={moneyBars}
    moneyFoot={<div className="money-foot">
      {!canFinance
        ? <p className="chart-caption">Payment totals need the owner or accounting role.</p>
        : money.error
          ? <p className="chart-caption" role="alert">Payment balances could not be loaded. No paid or unpaid total is assumed.</p>
          : snapshot&&!moneyBars
            ? <p className="chart-caption">Nothing is outstanding on delivered bookings right now.</p>
            : !snapshot&&<p className="chart-caption">Payment balances are not loaded yet.</p>}
      {canFinance&&<>
        {snapshot&&<p className="board-fineprint">Counted at {formatKolkata(snapshot.as_of)}</p>}
        <button className="btn btn-outlined" type="button" disabled={money.busy} onClick={money.reload}>
          {money.error?'Retry payment balances':snapshot?'Refresh payment balances':'Load payment balances'}</button>
      </>}
    </div>}
    value={canSupport&&outcomes.phase!=='error'&&outcomes.value&&!nothingHandled
      ?{range:weekFrom+' – '+weekTo,cells:valueCells,
        note:suppressed?'Where fewer than five customers sit behind a figure it is hidden rather than shown, so no single customer can be identified from it.':undefined}
      :null}
    valueInstead={!canSupport
      ?<section className="card value-card is-off" aria-labelledby="board-value-off">
        <h2 id="board-value-off">What ShipIT did for you this week</h2>
        <p>This panel counts the customers ShipIT answered for you — the questions it finished on
          its own, the thanks it collected, and what it passed back to a person. It needs the
          owner or counter role to read.</p>
      </section>
      :outcomes.phase==='loading'
        ?<section className="card value-card" aria-labelledby="board-value-wait">
          <h2 id="board-value-wait">What ShipIT did for you this week</h2>
          <p role="status">Counting what the assistant handled…</p>
        </section>
        :nothingHandled
          ?<section className="card value-card is-off" aria-labelledby="board-value-none">
            <h2 id="board-value-none">What ShipIT did for you this week</h2>
            <p>Nothing yet in the week of {weekFrom}. Once customers start messaging your shop,
              this panel counts the questions ShipIT answered without you, the hours of calls it
              saved, the customers who said thank you, and what it passed back to a person.</p>
            <Link className="btn btn-outlined" to="/business/automation">Open conversations</Link>
          </section>
          :undefined}
    todo={rows.slice(0,3)} todoTotal={rows.length} todoGo="/business/packages"/>;
}
