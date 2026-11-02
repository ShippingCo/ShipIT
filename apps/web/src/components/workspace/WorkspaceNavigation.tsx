import React from 'react';
import {Link} from 'react-router-dom';
import {Msym} from '../m3/Icon';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
export interface WorkspaceNavigationLink {area:string;to:string;icon:string;label:string}
export const workspaceSections=[
 {id:'bookings',label:'Bookings',icon:'inventory_2',primary:'packages',areas:['packages','booking','receipts']},
 {id:'delivery',label:'Delivery',icon:'local_shipping',primary:'delivery',areas:['delivery','pickups','lots','routes','custody','deliveries','eway']},
 {id:'money',label:'Money',icon:'account_balance_wallet',primary:'money',areas:['money','money-receipts','cashbook','customer-accounts','agent-settlements','financials','reconciliation']},
 {id:'customers',label:'Customers',icon:'group',primary:'customers',areas:['customers']},
 {id:'settings',label:'Settings & help',icon:'settings',primary:'settings',areas:['settings','automation','support']},
];
/** Shallow task navigation; the shell supplies only permitted destinations. */
export function WorkspaceNavigation({links,area,onNavigate}:{links:WorkspaceNavigationLink[];area:string;onNavigate:()=>void}){
 const active=workspaceSections.find(group=>group.areas.includes(area));
 const create=links.filter(link=>['booking','money-receipts','pickups'].includes(link.area));
 const renderLink=(link:WorkspaceNavigationLink,label=link.label,selected=area===link.area)=>
  <Link key={link.area} className={`drawer-item${selected?' active':''}`} aria-current={area===link.area?'page':undefined} to={link.to} onClick={onNavigate}><Msym name={link.icon}/><span>{label}</span></Link>;
 return <nav id="workspace-navigation" className="drawer-section workspace-navigation" aria-label="Workspace navigation">
  {create.length>0&&<DropdownMenu.Root><DropdownMenu.Trigger className="btn btn-filled workspace-create"><Msym name="add"/>Create<Msym name="expand_more"/></DropdownMenu.Trigger>
   <DropdownMenu.Portal><DropdownMenu.Content className="workspace-create-menu" align="start" sideOffset={8}>
    <DropdownMenu.Label className="workspace-create-label">Start a task</DropdownMenu.Label>
    {create.map(link=><DropdownMenu.Item asChild key={link.area}><Link to={link.to} onClick={onNavigate}><Msym name={link.icon}/><span>{link.area==='booking'?'New booking':link.area==='money-receipts'?'Record received money':'Arrange a pickup'}</span></Link></DropdownMenu.Item>)}
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
  <p className="workspace-navigation-label">Workspace</p>
  {links.filter(link=>link.area==='workspace').map(link=>renderLink(link,'Overview'))}
  {workspaceSections.filter(group=>group.id!=='settings').map(group=>{
   const destination=links.find(link=>link.area===group.primary)??links.find(link=>group.areas.includes(link.area));
   return destination?renderLink({...destination,icon:group.icon},group.label,active?.id===group.id):null;
  })}
  <div className="workspace-navigation-secondary">{links.filter(link=>link.area==='reports').map(link=>renderLink(link))}{links.filter(link=>link.area==='settings').map(link=>renderLink(link,'Settings & help',active?.id==='settings'))}</div>
  {active&&links.some(link=>active.areas.includes(link.area)&&link.area!==active.primary)&&<div className="workspace-context-links" role="group" aria-label={`${active.label} tools`}>
   <p className="workspace-navigation-label">{active.label} tools</p>
   {links.filter(link=>active.areas.includes(link.area)&&link.area!==active.primary).map(link=>renderLink(link))}
  </div>}
 </nav>;
}
