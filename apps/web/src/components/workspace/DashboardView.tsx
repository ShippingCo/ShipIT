import React,{useId} from 'react';
import {Link} from 'react-router-dom';
import {Msym} from '../m3/Icon';
import './dashboard-view.css';

/**
 * The owner's dashboard.
 *
 * This screen has one job the rest of the console does not: it has to be the reason the shop
 * keeps paying. An owner who opens it and sees parcels counted learns nothing — they counted
 * those parcels themselves. So the order here is deliberate and fixed: four figures that
 * answer the four questions an owner already has when they unlock the shutter, the parcel
 * journey as the operation actually runs, two charts, and then the one panel that states what
 * the assistant did instead of them.
 *
 * Three rules hold throughout, and each exists because breaking it has a real cost:
 *
 *  - A figure that did not load is an em dash and the words "not loaded", never a zero. An
 *    owner who reads a missing number as "nothing came in today" makes a decision on a number
 *    that does not exist.
 *  - Figures do not animate. A number counting up cannot be read until it stops, and this
 *    screen is read in three seconds or not at all.
 *  - Red is spent once, on "Needs you". A second red figure teaches the owner to ignore red.
 */

export interface DashboardTile {
  key:string;icon:string;label:string;
  value:React.ReactNode;foot:React.ReactNode;
  spark?:number[];
  accent?:boolean;danger?:boolean;quiet?:boolean;
  go:string;loading?:boolean;missing?:boolean;
}
export interface DashboardStage {key:string;icon:string;label:string;n:number;go:string;alert?:boolean}
export interface DashboardSeriesPoint {day:string;label:string;full:string;n:number}
export interface DashboardMoneyBar {key:string;label:string;full:string;share:number;amount:string}
export interface DashboardValueCell {key:string;value:string;label:string;tone?:'happy'|'warn';basis?:string}
export interface DashboardTodoRow {key:string;icon:string;tone:'danger'|'warning';title:string;detail:string;go:string}
export interface DashboardNotice {key:string;title:string;body:string;tries:number;busy:boolean;retry?:()=>void}
export type DashboardRange=7|14|30;
export interface DashboardViewProps {
  date:string;asOf:string|null;branch:string;
  newBooking?:string;contextAction?:React.ReactNode;
  notices:DashboardNotice[];
  tiles:DashboardTile[];
  stages:DashboardStage[]|null;journeyTotal:number|null;
  series:DashboardSeriesPoint[]|null;range:DashboardRange;onRange:(range:DashboardRange)=>void;
  seriesCaption:string;seriesEmpty?:React.ReactNode;
  money:{bars:DashboardMoneyBar[];caption:string}|null;moneyFoot?:React.ReactNode;
  value:{range:string;cells:DashboardValueCell[];note?:string}|null;valueInstead?:React.ReactNode;
  todo:DashboardTodoRow[];todoTotal:number;todoGo:string;
}

const n=(value:number)=>value.toLocaleString('en-IN');

/**
 * A seven-point trend, drawn once and never read on its own.
 *
 * It is hidden from assistive technology on purpose: the direction it shows is also written in
 * the tile's own foot line, in words. A line an operator cannot read a value off is a shape,
 * and a shape with no words beside it is decoration.
 */
function Spark({points}:{points:number[]}) {
  if(points.length<2)return null;
  const high=Math.max(...points),low=Math.min(...points),span=high-low||1;
  const path=points.map((value,index)=>
    (index/(points.length-1)*96).toFixed(1)+','+(26-((value-low)/span)*22).toFixed(1)).join(' ');
  return <svg className="kpi-spark" viewBox="0 0 96 28" width="96" height="28" aria-hidden="true" focusable="false">
    <polyline points={path} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

function Tile({tile}:{tile:DashboardTile}) {
  const className='kpi'+(tile.accent?' kpi-accent':'')+(tile.missing?' kpi-missing':'');
  const body=<>
    <span className="label"><Msym name={tile.icon} aria-hidden="true"/>{tile.label}</span>
    {tile.loading
      ? <><span className="sk sk-value" aria-hidden="true"/><span className="sk sk-foot" aria-hidden="true"/></>
      : <>
        <span className={'value'+(tile.danger?' danger':'')+(tile.quiet||tile.missing?' muted':'')}>{tile.value}</span>
        <span className="foot">{tile.foot}</span>
        {tile.spark&&tile.spark.length>1&&<Spark points={tile.spark}/>}
      </>}
  </>;
  // A tile with no number behind it is not a link. Pressing through to a filtered list built
  // from a figure the screen could not read would be a second failure.
  if(tile.loading||tile.missing)return <div className={className}>{body}</div>;
  return <Link className={className} to={tile.go}>{body}</Link>;
}

/**
 * Where every parcel is right now, left to right in the order a parcel moves.
 *
 * The pipe between two stages thickens with the number standing at the next one, so the shape
 * carries the reading before any digit is read. It stays a line — between two and six pixels —
 * because a shape that grows into a block stops being comparable to the one beside it.
 */
function Journey({stages,total}:{stages:DashboardStage[]|null;total:number|null}) {
  if(!stages)return <div className="journey" aria-hidden="true">
    {Array.from({length:6},(_,index)=><React.Fragment key={index}>
      {index>0&&<span className="journey-pipe"><i style={{height:'2px'}}/></span>}
      <span className="sk sk-stage"/>
    </React.Fragment>)}
  </div>;
  const peak=Math.max(...stages.map(stage=>stage.n),1);
  return <>
    <ol className="journey">
      {stages.map((stage,index)=><li className="journey-cell" key={stage.key}>
        {index>0&&<span className="journey-pipe" aria-hidden="true">
          <i style={{height:Math.max(2,Math.min(6,Math.round(stage.n/peak*6)))+'px',opacity:stage.n?1:.4}}/>
        </span>}
        <Link className={'journey-stage'+(stage.alert&&stage.n>0?' alert':'')+(stage.n?'':' is-zero')} to={stage.go}
          aria-label={n(stage.n)+' '+(stage.n===1?'parcel':'parcels')+' '+stage.label.toLowerCase()}>
          <span className="j-icon" aria-hidden="true"><Msym name={stage.icon}/></span>
          <span className="j-n">{n(stage.n)}</span>
          <span className="j-label">{stage.label}</span>
        </Link>
      </li>)}
    </ol>
    {total!==null&&<p className="journey-total">{n(total)} {total===1?'parcel':'parcels'} in the network</p>}
  </>;
}

/**
 * Bars, with the newest one in the accent colour carrying its own value.
 *
 * An owner reads "today against the rest" in one movement and never traces a bar back to an
 * axis, which is why there is no axis. The table underneath is the same numbers for a screen
 * reader; the picture is explicitly not the only copy of the data.
 */
function Bars({points,caption,empty}:{points:DashboardSeriesPoint[]|null;caption:string;empty?:React.ReactNode}) {
  const table=useId();
  if(!points)return <div className="sk sk-chart" aria-hidden="true"/>;
  const peak=Math.max(...points.map(point=>point.n),0);
  if(peak===0&&empty)return <>{empty}</>;
  const scale=Math.max(peak,1),last=points.length-1;
  const every=points.length>14?7:points.length>7?2:1;
  return <>
    <div className="bars" role="img" aria-describedby={table}
      aria-label={'Parcels booked each day over '+points.length+' days, ending at '+n(points[last]!.n)+' today.'}>
      {points.map((point,index)=><span key={point.day} className={'bar'+(index===last?' is-now':'')} title={point.full+': '+n(point.n)}>
        <span className="bar-plot">
          {index===last&&<b className="bar-value">{n(point.n)}</b>}
          <i style={{height:Math.max(point.n/scale*100,point.n?4:1.5)+'%'}}/>
        </span>
        <span className="bar-day">{index===last?'Today':index%every===0?point.label:''}</span>
      </span>)}
    </div>
    <p className="chart-caption">{caption}</p>
    <table id={table} className="workspace-visually-hidden">
      <caption>Parcels booked each day</caption>
      <tbody>{points.map(point=><tr key={point.day}><th scope="row">{point.full}</th><td>{n(point.n)}</td></tr>)}</tbody>
    </table>
  </>;
}

function MoneyBars({money,foot}:{money:{bars:DashboardMoneyBar[];caption:string}|null;foot?:React.ReactNode}) {
  const table=useId();
  if(!money)return <>{foot}</>;
  return <>
    <div className="bars is-money" role="img" aria-describedby={table}
      aria-label={'Money still to collect by age: '+money.bars.map(bar=>bar.full+' '+bar.amount).join(', ')+'.'}>
      {money.bars.map(bar=><span key={bar.key} className="bar" title={bar.full+': '+bar.amount}>
        <span className="bar-plot"><i style={{height:Math.max(bar.share,bar.share>0?4:1.5)+'%'}}/></span>
        <span className="bar-day">{bar.label}</span>
      </span>)}
    </div>
    <p className="chart-caption">{money.caption}</p>
    <table id={table} className="workspace-visually-hidden">
      <caption>Money still to collect, by age</caption>
      <tbody>{money.bars.map(bar=><tr key={bar.key}><th scope="row">{bar.full}</th><td>{bar.amount}</td></tr>)}</tbody>
    </table>
    {foot}
  </>;
}

export function DashboardView(p:DashboardViewProps) {
  const ranges:DashboardRange[]=[7,14,30];
  return <div className="page board">
    <header className="board-head">
      <div>
        <h1 id="workspace-title" tabIndex={-1}>Dashboard</h1>
        <p className="board-sub">{p.date}</p>
      </div>
      <div className="board-head-side">
        {p.contextAction}
        {p.newBooking&&<Link className="btn btn-filled" to={p.newBooking}><Msym name="add" aria-hidden="true"/>New booking</Link>}
      </div>
    </header>

    {/* One notice per surface that failed, each retrying only its own request. The sentence
        that matters is the second one: an owner who reads a dash as a zero acts on a number
        that was never there. */}
    {p.notices.map(notice=><div className="notice notice-warning" key={notice.key}>
      <span className="ico" aria-hidden="true"><Msym name="error"/></span>
      <div className="body">
        <strong role="alert">{notice.title}</strong>
        <p>{notice.body} <b>These numbers are missing, not zero.</b>{notice.tries>1?' Tried '+(notice.tries===2?'twice':notice.tries+' times')+'.':''}</p>
        {notice.retry&&<button className="btn btn-outlined" type="button" disabled={notice.busy} onClick={notice.retry}>
          {notice.busy?'Trying…':'Try again'}</button>}
      </div>
    </div>)}

    <div className="kpi-row">{p.tiles.map(tile=><Tile key={tile.key} tile={tile}/>)}</div>

    <section className="card board-card" aria-labelledby="board-journey">
      <header className="card-head"><h2 id="board-journey">Where every parcel is right now</h2></header>
      <Journey stages={p.stages} total={p.journeyTotal}/>
    </section>

    <div className="board-charts">
      <section className="card board-card" aria-labelledby="board-booked">
        <header className="card-head">
          <h2 id="board-booked">Parcels booked</h2>
          {/* The range moves the chart and nothing else. The figures above are always today. */}
          <div className="segmented" role="group" aria-label="Chart range">
            {ranges.map(range=><button key={range} type="button" aria-pressed={p.range===range}
              onClick={()=>p.onRange(range)}>{range===30?'Month':range+' days'}</button>)}
          </div>
        </header>
        <Bars points={p.series} caption={p.seriesCaption} empty={p.seriesEmpty}/>
      </section>

      <section className="card board-card" aria-labelledby="board-money">
        <header className="card-head"><h2 id="board-money">Money still to collect</h2></header>
        <MoneyBars money={p.money} foot={p.moneyFoot}/>
      </section>
    </div>

    {p.value
      ? <section className="card value-card" aria-labelledby="board-value">
        <header className="card-head">
          <h2 id="board-value">What ShipIT did for you this week</h2>
          <span className="pill pill-accent">{p.value.range}</span>
        </header>
        <div className="value-grid">
          {p.value.cells.map(cell=><div className="value-cell" key={cell.key}>
            <span className={'v-n'+(cell.tone?' is-'+cell.tone:'')} title={cell.basis}>{cell.value}</span>
            <span className="v-l">{cell.label}</span>
          </div>)}
        </div>
        {p.value.note&&<p className="value-note">{p.value.note}</p>}
      </section>
      : p.valueInstead}

    {/* Nothing needing a person is not a headline, an empty state or a reassurance. The card
        is simply not here, and its absence is the message. */}
    {p.todo.length>0&&<section className="card board-card" aria-labelledby="board-todo">
      <header className="card-head">
        <h2 id="board-todo">Needs you</h2>
        {p.todoTotal>p.todo.length&&<Link className="btn btn-text" to={p.todoGo}>See all {p.todoTotal}</Link>}
      </header>
      <div className="todo">
        {p.todo.map(row=><Link className={'todo-row tone-'+row.tone} key={row.key} to={row.go}>
          <span className="t-ico" aria-hidden="true"><Msym name={row.icon}/></span>
          <span className="t-body"><b>{row.title}</b><span>{row.detail}</span></span>
          <span className="t-go" aria-hidden="true"><Msym name="arrow_forward"/></span>
        </Link>)}
      </div>
    </section>}

    <p className="board-asof" aria-live="polite">{p.asOf?'Counted at '+p.asOf+' · '+p.branch:'Counting…'}</p>
  </div>;
}
