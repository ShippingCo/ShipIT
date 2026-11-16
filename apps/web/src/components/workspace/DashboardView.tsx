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
 *    screen is read in three seconds or not at all. (The 21st.dev Stats Band this layout is
 *    adapted from counts up; that part was deliberately left out.)
 *  - Red is spent once, on "Needs you". A second red figure teaches the owner to ignore red.
 *
 * Layout adapted from two 21st.dev components: Stats Band (kuratlielia) for the hairline grid of
 * figures and its trend line, and Revenue Bars Chart (olewandowski1) for the card header with
 * a description, ruled gridlines and value labels sitting above slim bars. Both are drawn here
 * in plain SVG and CSS on the app's tokens rather than through Recharts, which would add a
 * dependency for a chart that needs no axis maths.
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
 * The one shape every empty, waiting and failed panel on this screen takes: an icon in a quiet
 * disc, one short line saying what is true, one line saying what happens next, and at most one
 * action. Adapted from the 21st.dev empty and error states, without their illustrations.
 */
export function DashboardState({icon,title,body,action,tone='neutral',role}:{
  icon:string;title:React.ReactNode;body?:React.ReactNode;action?:React.ReactNode;
  tone?:'neutral'|'error';role?:'status'|'alert';
}) {
  return <div className={'board-state tone-'+tone} role={role}>
    <span className="board-state-ico" aria-hidden="true"><Msym name={icon}/></span>
    <div className="board-state-text">
      <p className="board-state-title">{title}</p>
      {body&&<p className="board-state-body">{body}</p>}
    </div>
    {action&&<div className="board-state-action">{action}</div>}
  </div>;
}

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
  const xy=points.map((value,index)=>[index/(points.length-1)*100,34-((value-low)/span)*30] as const);
  const line=xy.map(([x,y],index)=>(index?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
  const [endX,endY]=xy[xy.length-1]!;
  return <span className="kpi-spark" aria-hidden="true"><span className="kpi-spark-plot">
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" focusable="false">
      <path className="kpi-spark-area" d={line+' L100 36 L0 36 Z'}/>
      <path className="kpi-spark-line" d={line} vectorEffect="non-scaling-stroke"/>
    </svg>
    <i className="kpi-spark-dot" style={{left:endX+'%',top:(endY/36*100)+'%'}}/>
  </span></span>;
}

function Tile({tile}:{tile:DashboardTile}) {
  const className='kpi'+(tile.accent?' kpi-accent':'')+(tile.missing?' kpi-missing':'');
  const live=!tile.loading&&!tile.missing;
  const body=<>
    <span className="kpi-top">
      <span className="label"><span className="kpi-ico" aria-hidden="true"><Msym name={tile.icon}/></span>{tile.label}</span>
      {live&&<span className="kpi-go" aria-hidden="true"><Msym name="arrow_forward"/></span>}
    </span>
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
  if(!live)return <div className={className}>{body}</div>;
  return <Link className={className} to={tile.go}>{body}</Link>;
}

/**
 * Where every parcel is right now, left to right in the order a parcel moves.
 *
 * Each stage carries a short meter scaled to the busiest stage, so the shape of the operation
 * reads before any digit does. It is a hairline-thin bar, never a block, so neighbouring stages
 * stay comparable.
 */
function Journey({stages}:{stages:DashboardStage[]|null}) {
  if(!stages)return <div className="journey" aria-hidden="true">
    {Array.from({length:7},(_,index)=><span key={index} className="sk sk-stage"/>)}
  </div>;
  const peak=Math.max(...stages.map(stage=>stage.n),1);
  return <ol className="journey">
    {stages.map(stage=><li className="journey-cell" key={stage.key}>
      <Link className={'journey-stage'+(stage.alert&&stage.n>0?' alert':'')+(stage.n?'':' is-zero')} to={stage.go}
        aria-label={n(stage.n)+' '+(stage.n===1?'parcel':'parcels')+' '+stage.label.toLowerCase()}>
        <span className="j-head">
          <span className="j-icon" aria-hidden="true"><Msym name={stage.icon}/></span>
          <span className="j-label">{stage.label}</span>
        </span>
        <span className="j-n">{n(stage.n)}</span>
        <span className="j-meter" aria-hidden="true"><i style={{width:(stage.n?Math.max(4,stage.n/peak*100):0)+'%'}}/></span>
      </Link>
    </li>)}
  </ol>;
}

/** A round step above the peak, so the top gridline sits just over the tallest bar. */
function niceCeiling(peak:number) {
  if(peak<=4)return 4;
  const magnitude=10**Math.floor(Math.log10(peak));
  for(const step of [1,1.5,2,2.5,3,4,5,6,8,10]){const top=step*magnitude;if(top>=peak)return top;}
  return peak;
}

/**
 * Bars, with the newest one in the accent colour carrying its own value.
 *
 * An owner reads "today against the rest" in one movement and never traces a bar back to an
 * axis, which is why the gridlines carry no numbers: every bar worth reading has its value
 * printed above it. The table underneath is the same numbers for a screen reader; the picture
 * is explicitly not the only copy of the data.
 */
function Bars({points,empty}:{points:DashboardSeriesPoint[]|null;empty?:React.ReactNode}) {
  const table=useId();
  if(!points)return <div className="sk sk-chart" aria-hidden="true"/>;
  const peak=Math.max(...points.map(point=>point.n),0);
  if(peak===0&&empty)return <>{empty}</>;
  const top=niceCeiling(Math.max(peak,1)),last=points.length-1;
  const dense=points.length>14;
  const every=dense?7:points.length>7?2:1;
  // Thirty labels over thirty slim bars is noise; at a month only today and the peak are named.
  const labelled=(point:DashboardSeriesPoint,index:number)=>index===last||(point.n>0&&(!dense||point.n===peak));
  return <>
    <div className={'bars'+(dense?' is-dense':'')} role="img" aria-describedby={table}
      aria-label={'Parcels booked each day over '+points.length+' days, ending at '+n(points[last]!.n)+' today.'}>
      <div className="bars-grid" aria-hidden="true"><i/><i/><i/><i/></div>
      <div className="bars-plot">
        {points.map((point,index)=><span key={point.day} className={'bar'+(index===last?' is-now':'')}>
          <span className="bar-plot">
            <span className="bar-fill" style={{height:(point.n/top*100)+'%'}}>
              {labelled(point,index)&&<b className="bar-value">{n(point.n)}</b>}
            </span>
            <span className="bar-tip" aria-hidden="true">{point.full}<b>{n(point.n)}</b></span>
          </span>
          <span className="bar-day">{index===last?'Today':index%every===0&&last-index>=(dense?4:every)?point.label:''}</span>
        </span>)}
      </div>
    </div>
    <table id={table} className="workspace-visually-hidden">
      <caption>Parcels booked each day</caption>
      <tbody>{points.map(point=><tr key={point.day}><th scope="row">{point.full}</th><td>{n(point.n)}</td></tr>)}</tbody>
    </table>
  </>;
}

/** How old the money is, as rows: a label, a bar that is the amount, and the amount itself. */
function MoneyBars({money}:{money:{bars:DashboardMoneyBar[];caption:string}}) {
  const table=useId();
  return <>
    <ul className="age-bars" role="img" aria-describedby={table}
      aria-label={'Money still to collect by age: '+money.bars.map(bar=>bar.full+' '+bar.amount).join(', ')+'.'}>
      {money.bars.map((bar,index)=><li key={bar.key} className={'age-row age-'+bar.key+(index===0?' is-fresh':'')}>
        <span className="age-label">{bar.label}</span>
        <span className="age-track"><i style={{width:Math.max(bar.share,bar.share>0?3:0)+'%'}}/></span>
        <span className="age-amount">{bar.amount}</span>
      </li>)}
    </ul>
    <table id={table} className="workspace-visually-hidden">
      <caption>Money still to collect, by age</caption>
      <tbody>{money.bars.map(bar=><tr key={bar.key}><th scope="row">{bar.full}</th><td>{bar.amount}</td></tr>)}</tbody>
    </table>
  </>;
}

export function DashboardView(p:DashboardViewProps) {
  const ranges:DashboardRange[]=[7,14,30];
  const showCaption=Boolean(p.series&&p.series.some(point=>point.n>0)&&p.seriesCaption);
  return <div className="page board">
    <header className="board-head">
      <div className="board-title">
        <h1 id="workspace-title" tabIndex={-1}>Dashboard</h1>
        <p className="board-sub">
          <span>{p.date}</span>
          <span className="board-asof" aria-live="polite">{p.asOf?'Counted at '+p.asOf+' · '+p.branch:'Counting…'}</span>
        </p>
      </div>
      <div className="board-head-side">
        {p.contextAction}
        {p.newBooking&&<Link className="btn btn-filled" to={p.newBooking}><Msym name="add" aria-hidden="true"/>New booking</Link>}
      </div>
    </header>

    {/* One notice per surface that failed, each retrying only its own request. The sentence
        that matters is the second one: an owner who reads a dash as a zero acts on a number
        that was never there. */}
    {p.notices.map(notice=><div className="notice notice-warning board-notice" key={notice.key}>
      <span className="ico" aria-hidden="true"><Msym name="error"/></span>
      <div className="body">
        <strong role="alert">{notice.title}</strong>
        <p>{notice.body} <b>These numbers are missing, not zero.</b>{notice.tries>1?' Tried '+(notice.tries===2?'twice':notice.tries+' times')+'.':''}</p>
      </div>
      {notice.retry&&<button className="btn btn-outlined" type="button" disabled={notice.busy} onClick={notice.retry}>
        <Msym name="refresh" aria-hidden="true"/>{notice.busy?'Trying…':'Try again'}</button>}
    </div>)}

    <div className="kpi-row">{p.tiles.map(tile=><Tile key={tile.key} tile={tile}/>)}</div>

    <section className="card board-card" aria-labelledby="board-journey">
      <header className="card-head">
        <div className="board-card-title">
          <h2 id="board-journey">Where every parcel is right now</h2>
          {p.journeyTotal!==null&&<p className="journey-total">{n(p.journeyTotal)} {p.journeyTotal===1?'parcel':'parcels'} in the network</p>}
        </div>
      </header>
      <div className="board-body"><Journey stages={p.stages}/></div>
    </section>

    <div className="board-charts">
      <section className="card board-card" aria-labelledby="board-booked">
        <header className="card-head">
          <div className="board-card-title">
            <h2 id="board-booked">Parcels booked</h2>
            {showCaption&&<p className="chart-caption">{p.seriesCaption}</p>}
          </div>
          {/* The range moves the chart and nothing else. The figures above are always today. */}
          <div className="segmented board-range" role="group" aria-label="Chart range">
            {ranges.map(range=><button key={range} type="button" aria-pressed={p.range===range}
              onClick={()=>p.onRange(range)}>{range===30?'Month':range+' days'}</button>)}
          </div>
        </header>
        <div className="board-body"><Bars points={p.series} empty={p.seriesEmpty}/></div>
      </section>

      <section className="card board-card" aria-labelledby="board-money">
        <header className="card-head">
          <div className="board-card-title">
            <h2 id="board-money">Money still to collect</h2>
            {p.money&&<p className="chart-caption">{p.money.caption}</p>}
          </div>
        </header>
        <div className="board-body board-body-money">
          {p.money&&<MoneyBars money={p.money}/>}
          {p.moneyFoot}
        </div>
      </section>
    </div>

    {p.value
      ? <section className="card board-card value-card" aria-labelledby="board-value">
        <header className="card-head">
          <div className="board-card-title">
            <h2 id="board-value">What ShipIT did for you this week</h2>
            <p className="chart-caption">Counted from every customer conversation in the week.</p>
          </div>
          <span className="pill pill-accent">{p.value.range}</span>
        </header>
        <dl className="value-grid">
          {p.value.cells.map(cell=><div className="value-cell" key={cell.key}>
            <dt className="v-l">{cell.label}</dt>
            <dd><span className={'v-n'+(cell.tone?' is-'+cell.tone:'')} title={cell.basis}>{cell.value}</span></dd>
          </div>)}
        </dl>
        {p.value.note&&<p className="value-note"><Msym name="info" aria-hidden="true"/>{p.value.note}</p>}
      </section>
      : p.valueInstead}

    {/* Nothing needing a person is not a headline, an empty state or a reassurance. The card
        is simply not here, and its absence is the message. */}
    {p.todo.length>0&&<section className="card board-card" aria-labelledby="board-todo">
      <header className="card-head">
        <div className="board-card-title"><h2 id="board-todo">Needs you</h2></div>
        {p.todoTotal>p.todo.length&&<Link className="btn btn-text" to={p.todoGo}>See all {p.todoTotal}</Link>}
      </header>
      <div className="todo">
        {p.todo.map(row=><Link className={'todo-row tone-'+row.tone} key={row.key} to={row.go}>
          <span className="t-ico" aria-hidden="true"><Msym name={row.icon}/></span>
          <span className="t-body"><b>{row.title}</b><span>{row.detail}</span></span>
          <span className="t-go" aria-hidden="true"><Msym name="chevron_right"/></span>
        </Link>)}
      </div>
    </section>}
  </div>;
}
