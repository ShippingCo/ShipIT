import React from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {Msym} from '../m3/Icon';
import {Card,EmptyState} from '../m3/Surface';
import {KpiCard} from '../m3/Kpi';
import './dashboard-view.css';

export interface DashboardQueueItem {key:string;icon:string;tone?:string;title:string;cta:string;go:string}
export interface DashboardMetric {key:string;icon:string;label:string;value:React.ReactNode;foot?:string;delta?:number;tone?:string;go:string}
export interface DashboardStage {key:string;icon:string;label:string;n:number;go:string}
export interface DashboardWeekDay {day:string;label:string;full:string;n:number;today:boolean}
export interface DashboardRecord {id:string;icon:string;title:React.ReactNode;detail:string;status?:string;statusClass?:string;paymentDue?:boolean;amount?:string;tone?:string;go:string}
export interface DashboardViewProps {
  date:string;contextAction?:React.ReactNode;queue:DashboardQueueItem[];queueNote?:string;emptyQueueTitle:string;emptyQueueNote:string;
  assistant:React.ReactNode;metrics:DashboardMetric[];stages:DashboardStage[];week:DashboardWeekDay[];moneyAge:React.ReactNode;
  routes:DashboardRecord[];routesNote?:string;recent:DashboardRecord[];recentNote?:string;newBooking?:string;
}

const compactCount=new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1});
const chartNumber=(value:number)=>value<10000?value.toLocaleString('en-IN'):compactCount.format(value);

function BookingWeek({days}:{days:DashboardWeekDay[]}) {
  const peak=Math.max(0,...days.map(day=>day.n));
  const magnitude=10**Math.max(0,Math.floor(Math.log10(Math.max(1,peak/3))));
  const step=([1,2,5,10].find(unit=>unit*magnitude>=peak/3)??10)*magnitude;
  const intervals=Math.max(1,Math.ceil(peak/step));
  const ceiling=intervals*step;
  const ticks=Array.from({length:intervals+1},(_,i)=>(intervals-i)*step);
  const today=days.findIndex(day=>day.today);
  const total=days.reduce((sum,day)=>sum+day.n,0);
  const plotted=days.map((day,index)=>{
    const upcoming=today>=0&&index>today&&day.n===0;
    const reading=upcoming?'upcoming':day.n.toLocaleString('en-IN');
    return {...day,upcoming,reading};
  });
  return <section className="board-week" aria-labelledby="board-week-heading">
    <div className="board-week-head">
      <div><h2 id="board-week-heading">Bookings this week</h2><p>Daily booking count</p></div>
      <div className="week-total"><strong>{total.toLocaleString('en-IN')}</strong><span>Week total</span></div>
    </div>
    <div className="week-figure" role="img" aria-label={'Bookings by day, Monday to Sunday: '+plotted.map(day=>day.full+': '+day.reading+(day.today?' (today)':'')).join('; ')}>
      <div className="week-scale" aria-hidden="true">
        {ticks.map(value=><span key={value} style={{bottom:(value/ceiling*100)+'%'}}>{chartNumber(value)}</span>)}
      </div>
      <div className="week-series" aria-hidden="true">
        {ticks.map(value=><i className={'week-rule'+(value===0?' is-baseline':'')} key={value} style={{bottom:(value/ceiling*100)+'%'}}/>)}
        {plotted.map(day=><div key={day.day} className={'week-column'+(day.today?' is-current':'')} title={day.full+': '+day.reading}>
          <div className="week-bar" style={{height:(day.n/ceiling*100)+'%'}}>
            <strong>{day.upcoming?'—':chartNumber(day.n)}</strong>
          </div>
          <span className="week-day">{day.full.split(',')[0]?.slice(0,3)||day.label}{day.today&&<small>Today</small>}</span>
        </div>)}
      </div>
    </div>
  </section>;
}

function WorkQueue({items,emptyTitle,emptyNote,note}:{items:DashboardQueueItem[];emptyTitle:string;emptyNote:string;note?:string}) {
  return <section className="board-queue" aria-labelledby="board-queue-heading">
    <div className="board-section-head"><h2 id="board-queue-heading">Needs attention</h2><span className="board-count">{items.length}</span></div>
    {items.length?<ul>{items.map(item=><li key={item.key}>
      <span className={'board-task-icon task-'+(item.tone??'info')}><Msym name={item.icon}/></span>
      <span>{item.title}</span><Link to={item.go} className="board-task-link">{item.cta}<Msym name="arrow_forward"/></Link>
    </li>)}</ul>:<div className="board-empty"><Msym name="check_circle"/><div><strong>{emptyTitle}</strong><p>{emptyNote}</p></div></div>}
    {note&&<p className="board-note">{note}</p>}
  </section>;
}

function ParcelStages({stages}:{stages:DashboardStage[]}) {
  const total=stages.reduce((sum,stage)=>sum+stage.n,0);
  return <section className="board-stages" aria-labelledby="board-stages-heading">
    <div className="board-section-head"><h2 id="board-stages-heading">Parcel stages</h2><span>{total.toLocaleString('en-IN')} active</span></div>
    <div className="board-stage-list">{stages.map(stage=><Link key={stage.key} to={stage.go} aria-label={stage.n+' '+(stage.n===1?'parcel':'parcels')+' '+stage.label}>
      <span>{stage.label}</span><span className="board-stage-track" aria-hidden="true"><i style={{width:(total?stage.n/total*100:0)+'%'}}/></span><strong>{stage.n.toLocaleString('en-IN')}</strong>
    </Link>)}</div>
  </section>;
}

export function DashboardView(p:DashboardViewProps) {
  const navigate=useNavigate();
  return <div className="page dashboard-reference dispatch-board">
    <header className="board-heading"><div><h1 id="workspace-title" tabIndex={-1}>Dashboard</h1><p>{p.date}</p></div>{p.contextAction}</header>
    <div className="board-metrics">{p.metrics.map(metric=><KpiCard key={metric.key} className={'board-metric metric-'+metric.key} icon={metric.icon} label={metric.label} value={metric.value} foot={metric.foot} delta={metric.delta} onClick={()=>navigate(metric.go)}/>)}</div>
    <div className="board-main">
      <WorkQueue items={p.queue} emptyTitle={p.emptyQueueTitle} emptyNote={p.emptyQueueNote} note={p.queueNote}/>
      <BookingWeek days={p.week}/>
    </div>
    <div className="board-secondary">
      <ParcelStages stages={p.stages}/>
      <section className="board-module"><h2>Customer activity</h2>{p.assistant}</section>
      <section className="board-module board-balances"><h2>Outstanding by age</h2>{p.moneyAge}</section>
    </div>
    <div className="board-records">
    <h2 className="board-section-title">Today's dispatch</h2>
    <Card>{p.routes.map(route=><Link className="li clickable" key={route.id} to={route.go}><Msym name={route.icon} size={24} className="row-ic"/><span className="u-grow"><span className="li-head">{route.title}</span><span className="li-sub dashboard-record-detail">{route.detail}</span></span>{route.status&&<span className={`pill ${route.statusClass??''}`}>{route.status}</span>}</Link>)}{p.routes.length===0&&<EmptyState icon="alt_route" title="No dispatches to show" sub={p.routesNote??'Plan a route to organize the next dispatch.'}/>}{p.routes.length>0&&p.routesNote&&<p className="dashboard-note">{p.routesNote}</p>}<Link className="card-foot-link" to="/business/routes">View all routes</Link></Card>
    <h2 className="board-section-title">Recent bookings</h2><p className="muted t-body-sm">{p.recentNote??'Latest bookings across days; Booked today shows only today in Asia/Kolkata.'}</p>
    <Card>{p.recent.map(record=><Link className="bk" key={record.id} to={record.go}><span className={`bk-ic${record.tone?' '+record.tone:''}`}><Msym name={record.icon}/></span><span className="bk-main"><span className="bk-l1">{record.title}</span><span className="bk-l2">{record.detail}</span></span><span className="bk-right">{record.amount&&<span className="bk-amt">{record.amount}</span>}{record.status&&<span className={`bk-pay${record.paymentDue?' is-due':''}`}>{record.status}</span>}</span></Link>)}{!p.recent.length&&<EmptyState icon="note_add" title="No bookings yet" sub="New bookings will appear here after confirmation." action={p.newBooking&&<Link className="btn btn-filled" to={p.newBooking}>New Booking</Link>}/>}<Link className="card-foot-link" to="/business/packages">View all packages</Link></Card>
    </div>
  </div>;
}
