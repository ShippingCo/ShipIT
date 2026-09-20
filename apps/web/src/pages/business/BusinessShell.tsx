import React from 'react';
import type { OperatorContext,OperatorRole } from '@shippingco/shared';
import { Link,useLocation } from 'react-router-dom';
import type { ScopeController } from '../../operator/scope';
import NewBooking from '../../booking/NewBooking';
import Receipts from '../../booking/Receipts';
import OperationsDashboard from '../../operations/Dashboard';
import Packages from '../../operations/Packages';
import Lots from '../../operations/Lots';
import Routes from '../../operations/Routes';
import Eway from '../../operations/Eway';
import { Msym } from '../../components/m3/Icon';
import { SelectField } from '../../components/m3/Input';
import '../../operations/operations.css';

type Area='workspace'|'packages'|'lots'|'routes'|'eway'|'booking'|'receipts'|'settings';
const can=(roles:readonly OperatorRole[],allowed:readonly OperatorRole[])=>roles.some(role=>allowed.includes(role));
export default function BusinessShell({context,select,controller}:{controller:ScopeController;context:OperatorContext;select:(id:string)=>void}){
 const location=useLocation(),current=context.franchises.find(franchise=>franchise.id===context.active_franchise_id);if(!current)return null;
 const segment=location.pathname.split('/').filter(Boolean)[1]??'';const area:Area=segment==='packages'||segment==='lots'||segment==='routes'||segment==='eway'||segment==='receipts'||segment==='settings'?segment:segment==='new-booking'||segment==='booking'?'booking':'workspace';
 const roles=current.roles,links=[
  {area:'workspace' as const,to:'/business',icon:'space_dashboard',label:'Workspace',show:true},
  {area:'packages' as const,to:'/business/packages',icon:'inventory_2',label:'Packages',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'lots' as const,to:'/business/lots',icon:'layers',label:'Lots',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'routes' as const,to:'/business/routes',icon:'alt_route',label:'Routes',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'eway' as const,to:'/business/eway',icon:'fact_check',label:'E-way',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','accountant'])},
  {area:'booking' as const,to:'/business/new-booking',icon:'add_box',label:'New Booking',show:can(roles,['franchise_admin','operator','dispatcher'])},
  {area:'receipts' as const,to:'/business/receipts',icon:'receipt_long',label:'Receipts',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'settings' as const,to:'/business/settings',icon:'settings',label:'Settings',show:true},
 ].filter(link=>link.show);
 const title=links.find(link=>link.area===area)?.label??'Workspace';let content:React.ReactNode;
 if(area==='packages')content=<Packages controller={controller} roles={roles}/>;else if(area==='lots')content=<Lots controller={controller} roles={roles}/>;else if(area==='routes')content=<Routes controller={controller} roles={roles}/>;else if(area==='eway')content=<Eway controller={controller} roles={roles}/>;else if(area==='booking')content=<NewBooking controller={controller}/>;else if(area==='receipts')content=<Receipts controller={controller}/>;else if(area==='settings')content=<Settings name={current.display_name} roles={roles}/>;else content=<OperationsDashboard controller={controller} roles={roles} workspaceName={current.display_name}/>;
 return <div className="shell operator-shell"><aside className="drawer-pane"><div className="drawer-head"><div className="avatar lg"><Msym name="storefront"/></div><div className="t-title-md">{current.organization.display_name}</div></div><nav className="drawer-section" aria-label="Workspace navigation">{links.map(link=><Link className={`drawer-item${area===link.area?' active':''}`} to={link.to} key={link.area}><Msym name={link.icon}/>{link.label}</Link>)}</nav></aside><div className="main-area"><header className="appbar"><div className="appbar-title t-title-lg">{title}</div></header><main className="operator-workspace ops-workspace" key={current.id}><SelectField label="Franchise" aria-label="Franchise" value={current.id} onChange={select} options={context.franchises.map(franchise=>({value:franchise.id,label:`${franchise.organization.display_name} · ${franchise.display_name}`}))}/><nav className="operator-mobile-nav" aria-label="Mobile workspace navigation">{links.map(link=><Link to={link.to} key={link.area}>{link.label}</Link>)}</nav>{content}</main></div></div>;
}
function Settings({name,roles}:{name:string;roles:readonly OperatorRole[]}){return <section className="card ops-card" aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>{name}</h1><p role="status">Workspace access confirmed.</p><p>{roles.map(role=>role.replaceAll('_',' ')).join(', ')}</p><p className="ops-note">Business, location and access are server-owned. Ask an administrator for membership changes.</p></section>}
