import React from 'react';
import {Link} from 'react-router-dom';
import {PageHeader} from './Workspace';
import {Msym} from '../m3/Icon';
import {type WorkspaceNavigationLink} from './WorkspaceNavigation';
const guidance:Record<string,string>={pickups:'Say yes or no to a customer asking to be collected from.',lots:'Keep parcels going to the same destination together.',routes:'Load bags onto a vehicle and print the list that goes with it.',custody:'See who is holding which parcels, and how much money.',deliveries:'Check progress and record the required delivery proof.',eway:'Check transport records and reminders.','money-receipts':'Record money received, match bookings or use an advance.',cashbook:'Record expenses, count cash and close the day.','customer-accounts':'Review customer dues, credit and monthly bills.','agent-settlements':'Review money held by delivery agents.',financials:'Review refunds, corrections and approvals.',reconciliation:'Match bank records to saved receipts.'};
export function WorkArea({area,links}:{area:'delivery'|'money';links:WorkspaceNavigationLink[]}){
 const groups: ReadonlyArray<readonly [string, readonly string[]]> = area==='delivery'
   ? [['Prepare parcels',['pickups','lots','routes']],['Track and hand over',['custody','deliveries','eway']]] as const
   : [['Daily money',['money-receipts','cashbook']],['Balances',['customer-accounts','agent-settlements']],['Review and verify',['financials','reconciliation']]] as const;
 return <section className={"ops-page workspace-task-home"+(area==='money'?' finance-task-home':'')}><PageHeader title={area==='delivery'?'Delivery work':'Money'} eyebrow="Workspace" description={area==='delivery'?'Keep parcels moving. Choose the work you want to complete.':'Record what came in, review what is due and manage expenses.'}/>
 {groups.map(([title,areas])=>{
   const tasks=areas.flatMap(id=>links.filter(link=>link.area===id));
   if(!tasks.length)return null;
   return <section className="workspace-task-group" key={title}><h2>{title}</h2><div className="workspace-task-list">{tasks.map(link=><Link className="workspace-task-link" key={link.area} to={link.to}><span className="workspace-task-icon"><Msym name={link.icon}/></span><span><strong>{link.label}</strong><small>{guidance[link.area]}</small></span><Msym name="chevron_right"/></Link>)}</div></section>;
 })}</section>;
}
