import React from 'react';
import {Link} from 'react-router-dom';
import {PageHeader} from './Workspace';
import {Msym} from '../m3/Icon';
import {workspaceSections,type WorkspaceNavigationLink} from './WorkspaceNavigation';
const guidance:Record<string,string>={pickups:'Review requests and arrange a collection.',lots:'Keep parcels going to the same destination together.',routes:'Plan a route and review its manifest.',custody:'Record who is holding parcels and money.',deliveries:'Check progress and record the required delivery proof.',eway:'Check transport records and reminders.','money-receipts':'Record money received, match bookings or use an advance.',cashbook:'Record expenses, count cash and close the day.','customer-accounts':'Review customer dues, credit and monthly bills.','agent-settlements':'Review money held by delivery agents.',financials:'Review refunds, corrections and approvals.',reconciliation:'Match bank records to saved receipts.'};
export function WorkArea({area,links}:{area:'delivery'|'money';links:WorkspaceNavigationLink[]}){
 const group=workspaceSections.find(item=>item.id===area)!;
 return <section className="ops-page workspace-task-home"><PageHeader title={area==='delivery'?'Delivery work':'Money'} eyebrow="Workspace" description={area==='delivery'?'Keep parcels moving. Choose the work you want to complete.':'Record what came in, review what is due and manage expenses.'}/>
 <div className="workspace-task-list">{links.filter(link=>group.areas.includes(link.area)&&link.area!==area).map(link=><Link className="workspace-task-link" key={link.area} to={link.to}><span className="workspace-task-icon"><Msym name={link.icon}/></span><span><strong>{link.label}</strong><small>{guidance[link.area]}</small></span><Msym name="chevron_right"/></Link>)}</div></section>;
}
