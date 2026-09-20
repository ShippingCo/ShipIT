import React,{useMemo} from 'react';
import { Link } from 'react-router-dom';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { parcels } from '../data-access/parcels';
import { lots } from '../data-access/lots';
import { routes } from '../data-access/routes';
import { eway } from '../data-access/eway';
import { useResource } from './hooks';
import { Empty,Failure,Loading } from './AsyncState';
import { Msym } from '../components/m3/Icon';

const parcelRead=new Set<OperatorRole>(['org_admin','franchise_admin','operator','dispatcher','read_only']);
const lotRead=new Set<OperatorRole>(['org_admin','franchise_admin','operator','dispatcher','read_only']);
const routeRead=new Set<OperatorRole>(['org_admin','franchise_admin','operator','dispatcher','read_only']);
const ewayRead=new Set<OperatorRole>(['org_admin','franchise_admin','operator','dispatcher','accountant']);
const allowed=(roles:readonly OperatorRole[],set:Set<OperatorRole>)=>roles.some(role=>set.has(role));
type Summary={parcels:{items:number;more:boolean;attention:number}|null;lots:{items:number;more:boolean;members:number}|null;routes:{items:number;more:boolean;planning:number}|null;eway:{items:number;more:boolean;attention:number}|null};

export default function OperationsDashboard({controller,roles,workspaceName}:{controller:ScopeController;roles:readonly OperatorRole[];workspaceName:string}){
 const api=useMemo(()=>scopedApi(controller),[controller]),p=useMemo(()=>parcels(api),[api]),l=useMemo(()=>lots(api),[api]),r=useMemo(()=>routes(api),[api]),e=useMemo(()=>eway(api),[api]);
 const key=roles.slice().sort().join(',');
 const resource=useResource<Summary>(key,async signal=>{
  const [ps,ls,rs,es]=await Promise.all([
   allowed(roles,parcelRead)?p.list({limit:100},signal):null,
   allowed(roles,lotRead)?l.list({state:'active',limit:100},signal):null,
   allowed(roles,routeRead)?r.list({limit:100},signal):null,
   allowed(roles,ewayRead)?e.reminders({limit:100},signal):null,
  ]);
  return {parcels:ps?{items:ps.items.length,more:ps.page.has_more,attention:ps.items.filter(item=>item.status==='failed_attempt'||item.status==='held_at_office').length}:null,
   lots:ls?{items:ls.items.length,more:ls.page.has_more,members:ls.items.reduce((sum,item)=>sum+item.active_member_count,0)}:null,
   routes:rs?{items:rs.items.length,more:rs.page.has_more,planning:rs.items.filter(item=>item.state==='planning').length}:null,
   eway:es?{items:es.items.length,more:es.page.has_more,attention:es.items.filter(item=>item.state.reminder_reasons.length>0).length}:null};
 },value=>Object.values(value).every(item=>item===null));
 const header=<section className="card ops-card" aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>{workspaceName}</h1><h2 className="t-title-lg">Operational workspace</h2><p>Server-backed work for parcels, grouping, dispatch and external e-way records.</p><p className="ops-note">Every figure below is explicitly a loaded bounded page, not a franchise-wide total. Open a work area for authoritative pagination and detail.</p></section>;
 if(resource.phase==='loading')return <div className="ops-page">{header}<Loading label="Loading operational workspace…"/></div>;
 if(resource.phase==='error')return <div className="ops-page">{header}<Failure retry={resource.reload} label="Operational summaries could not be loaded."/></div>;
 if(resource.phase==='empty')return <div className="ops-page">{header}<Empty icon="lock" title="No operational views for this role" body="Your current memberships do not include these operational read projections."/></div>;
 const s=resource.value!;
 const metrics=[
  s.parcels&&{to:'/business/packages',icon:'inventory_2',number:s.parcels.items,label:'Parcels loaded',note:`${s.parcels.attention} need recovery review${s.parcels.more?' · more pages available':''}`},
  s.lots&&{to:'/business/lots',icon:'layers',number:s.lots.items,label:'Active lots loaded',note:`${s.lots.members} server-counted active memberships${s.lots.more?' · more lots available':''}`},
  s.routes&&{to:'/business/routes',icon:'alt_route',number:s.routes.items,label:'Routes loaded',note:`${s.routes.planning} still in planning${s.routes.more?' · more routes available':''}`},
  s.eway&&{to:'/business/eway',icon:'fact_check',number:s.eway.attention,label:'E-way checks need review',note:`From ${s.eway.items} loaded reminders${s.eway.more?' · more reminders available':''}`},
 ].filter(Boolean) as {to:string;icon:string;number:number;label:string;note:string}[];
 return <div className="ops-page">
  {header}
  <section aria-label="Current operational summaries" className="ops-grid">{metrics.map(metric=><Link className="card ops-kpi" to={metric.to} key={metric.to}><span className="ops-kpi-icon"><Msym name={metric.icon}/></span><span><strong className="ops-kpi-number">{metric.number}{metric.note.includes('more')?'+':''}</strong><span className="ops-kpi-label">{metric.label}</span><span className="ops-kpi-note">{metric.note}</span></span></Link>)}</section>
  {metrics.every(metric=>metric.number===0)&&<Empty icon="inventory_2" title="No records on the current pages" body="Create a booking or operational record, then retry this dashboard."/>}
 </div>;
}
