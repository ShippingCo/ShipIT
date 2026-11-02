import React from 'react';
import {ConsoleNavigation} from './ConsoleFrame';
import {consoleLinks} from './console-navigation';
export interface WorkspaceNavigationLink {area:string;to:string;icon:string;label:string}
export const workspaceSections=[
 {id:'bookings',label:'Bookings',icon:'inventory_2',primary:'packages',areas:['packages','booking','receipts']},
 {id:'delivery',label:'Delivery',icon:'local_shipping',primary:'delivery',areas:['delivery','pickups','lots','routes','custody','deliveries','eway']},
 {id:'money',label:'Money',icon:'account_balance_wallet',primary:'money',areas:['money','money-receipts','cashbook','customer-accounts','agent-settlements','financials','reconciliation']},
 {id:'customers',label:'Customers',icon:'group',primary:'customers',areas:['customers']},
 {id:'settings',label:'Settings & help',icon:'settings',primary:'settings',areas:['settings','automation','support']},
];
/** Compatibility wrapper; permissions are supplied by the authenticated shell. */
export function WorkspaceNavigation({links,area,onNavigate}:{links:WorkspaceNavigationLink[];area:string;onNavigate:()=>void}){
 return <ConsoleNavigation links={consoleLinks(links)} area={area} onNavigate={onNavigate}/>;
}
