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

/** Reference layout, with all facts and destinations supplied by the data adapter. */
export function DashboardView(p:DashboardViewProps) {
  const navigate=useNavigate();
  const peak=Math.max(1,...p.week.map(day=>day.n));
  return <div className="page page-glance dashboard-reference">
    <h1 className="workspace-visually-hidden" id="workspace-title" tabIndex={-1}>Dashboard</h1>
    <div className="ctxbar"><span className="ctxbar-date">{p.date}</span>{p.contextAction}</div>
    <Card className={`glance${p.queue.length?'':' is-clear'}`}>
      <div className="glance-head"><span className="glance-ic"><Msym name={p.queue.length?'priority_high':'check'}/></span><div><h2 className="glance-t">{p.queue.length?<><b>{p.queue.length}</b> {p.queue.length===1?'thing needs':'things need'} you now</>:p.emptyQueueTitle}</h2><div className="glance-sub">{p.queue.length?'Most urgent first.':p.emptyQueueNote}</div></div></div>
      {p.queue.map(item=><div className={`glance-row${item.tone?' tone-'+item.tone:''}`} key={item.key}><span className="glance-row-ic"><Msym name={item.icon}/></span><span className="glance-row-t u-grow">{item.title}</span><Link className="btn btn-outlined" to={item.go}>{item.cta}</Link></div>)}
      {p.queueNote&&<p className="dashboard-note">{p.queueNote}</p>}
    </Card>
    <div className="section-label dashboard-section">Your assistant</div>{p.assistant}
    <div className="kpi4">{p.metrics.map(metric=><KpiCard key={metric.key} icon={metric.icon} label={metric.label} value={metric.value} foot={metric.foot} delta={metric.delta} tone={metric.tone} onClick={()=>navigate(metric.go)}/>)}</div>
    <div className="section-label dashboard-section">Where your parcels are</div>
    <Card><div className="pipe">{p.stages.map((stage,index)=><Link key={stage.key} to={stage.go} className={`pipe-step is-link${stage.n?' has':''}`} aria-label={`${stage.n} ${stage.n===1?'parcel':'parcels'} ${stage.label}`}>
      {index<p.stages.length-1&&<span className={`pipe-link${stage.n?' is-on':''}`} aria-hidden="true"/>}<span className="pipe-ic"><Msym name={stage.icon}/></span><span className="pipe-n">{stage.n}</span><span className="pipe-l">{stage.label}</span>
    </Link>)}</div></Card>
    <div className="glance-band">
      <div><div className="section-label">This week</div><Card><div className="wk" role="img" aria-label={'Bookings by day, Monday to Sunday: '+p.week.map(day=>day.full+': '+day.n).join('; ')}>{p.week.map(day=><div key={day.day} className={`wk-col${day.today?' is-today':''}`} title={`${day.full}: ${day.n}`}><span className="wk-n">{day.n}</span><span className="wk-bar" style={{height:`${Math.max(4,day.n/peak*100)}%`}}/></div>)}</div><div className="wk dashboard-week-labels">{p.week.map(day=><span key={day.day} className="wk-d">{day.label}</span>)}</div></Card></div>
      <div><div className="section-label">How old that money is</div>{p.moneyAge}</div>
    </div>
    <div className="section-label dashboard-section">Today's dispatch</div>
    <Card>{p.routes.map(route=><Link className="li clickable" key={route.id} to={route.go}><Msym name={route.icon} size={24} className="row-ic"/><span className="u-grow"><span className="li-head">{route.title}</span><span className="li-sub dashboard-record-detail">{route.detail}</span></span>{route.status&&<span className={`pill ${route.statusClass??''}`}>{route.status}</span>}</Link>)}{p.routes.length===0&&<EmptyState icon="alt_route" title="No dispatches to show" sub={p.routesNote??'Plan a route to organize the next dispatch.'}/>}{p.routes.length>0&&p.routesNote&&<p className="dashboard-note">{p.routesNote}</p>}<Link className="card-foot-link" to="/business/routes">View all routes</Link></Card>
    <div className="section-label dashboard-section">Recent bookings</div><p className="muted t-body-sm">{p.recentNote??'Latest bookings across days; Booked today shows only today in Asia/Kolkata.'}</p>
    <Card>{p.recent.map(record=><Link className="bk" key={record.id} to={record.go}><span className={`bk-ic${record.tone?' '+record.tone:''}`}><Msym name={record.icon}/></span><span className="bk-main"><span className="bk-l1">{record.title}</span><span className="bk-l2">{record.detail}</span></span><span className="bk-right">{record.amount&&<span className="bk-amt">{record.amount}</span>}{record.status&&<span className={`bk-pay${record.paymentDue?' is-due':''}`}>{record.status}</span>}</span></Link>)}{!p.recent.length&&<EmptyState icon="note_add" title="No bookings yet" sub="New bookings will appear here after confirmation." action={p.newBooking&&<Link className="btn btn-filled" to={p.newBooking}>New Booking</Link>}/>}<Link className="card-foot-link" to="/business/packages">View all packages</Link></Card>
  </div>;
}
