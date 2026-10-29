import React from 'react';
import {Link} from 'react-router-dom';
import {Msym} from '../m3/Icon';

export interface WorkspaceNavigationLink {area:string;to:string;icon:string;label:string}
const groups=[
 {id:'overview',label:'Overview',areas:['workspace','reports']},
 {id:'booking',label:'Booking & pickups',areas:['booking','pickups','receipts']},
 {id:'shipments',label:'Shipments',areas:['packages','lots','routes','custody','deliveries','eway']},
 {id:'finance',label:'Finance',areas:['money-receipts','cashbook','customer-accounts','agent-settlements','financials','reconciliation']},
 {id:'administration',label:'Administration',areas:['automation','support','settings']},
];

/** Disclosure navigation keeps ordinary links and native keyboard behavior. */
export function WorkspaceNavigation({links,area,onNavigate}:{links:WorkspaceNavigationLink[];area:string;onNavigate:()=>void}){
 const activeGroup=groups.find(group=>group.areas.includes(area))?.id;
 const [expanded,setExpanded]=React.useState(()=>new Set(['overview',...(activeGroup?[activeGroup]:[])]));
 React.useEffect(()=>{
  if(activeGroup)setExpanded(previous=>previous.has(activeGroup)?previous:new Set([...previous,activeGroup]));
 },[activeGroup,area]);
 return <nav id="workspace-navigation" className="drawer-section workspace-tree" aria-label="Workspace navigation">
  {groups.map(group=>{
   const items=group.areas.flatMap(id=>links.filter(link=>link.area===id));
   if(!items.length)return null;
   const open=expanded.has(group.id),active=activeGroup===group.id;
   return <div className={`workspace-nav-group${active?' workspace-tree-current':''}${open?' workspace-tree-open':''}`} role="group" aria-label={group.label} key={group.id}>
    <button type="button" className="workspace-tree-folder" aria-expanded={open} aria-controls={`workspace-branch-${group.id}`} onClick={()=>setExpanded(previous=>{
     const next=new Set(previous);if(next.has(group.id))next.delete(group.id);else next.add(group.id);return next;
    })}>
     <Msym name="chevron_right" className="workspace-tree-chevron"/><Msym name={open?'folder_open':'folder'} className="workspace-tree-folder-icon"/>
     <span>{group.label}</span>{active&&<span className="workspace-tree-current-dot" aria-hidden="true"/>}
    </button>
    <ul id={`workspace-branch-${group.id}`} className="workspace-tree-branch" hidden={!open}>
     {items.map(link=><li className={`workspace-tree-leaf${area===link.area?' workspace-tree-selected':''}`} key={link.area}>
      <Link className={`drawer-item${area===link.area?' active':''}`} aria-current={area===link.area?'page':undefined} to={link.to} onClick={onNavigate}><Msym name={link.icon}/><span>{link.label}</span></Link>
     </li>)}
    </ul>
   </div>;
  })}
 </nav>;
}
