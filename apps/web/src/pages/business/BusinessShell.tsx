import {canAdminister,operatorRoleLabels} from '@shippingco/shared';
import Reconciliation from '../../operations/Reconciliation';
import CustomerAccounts from '../../operations/CustomerAccounts';
import AgentSettlements from '../../operations/AgentSettlements';
import Custody from '../../operations/Custody';
import Cashbook from '../../operations/Cashbook';
import Financials from '../../operations/Financials';
import MoneyReceipts from '../../operations/MoneyReceipts';
import Reports from '../../operations/Reports';
import Settings from '../../operations/Settings';
import {OperatorDisplayPreference} from '../../operations/SettingsPreferences';
import Support from '../../operations/Support';
import Pickups from '../../operations/Pickups';
import React from 'react';
import type { OperatorContext,OperatorRole } from '@shippingco/shared';
import { Link,useLocation } from 'react-router-dom';
import type { ScopeController } from '../../operator/scope';
import NewBooking from '../../booking/NewBooking';
import Receipts from '../../booking/Receipts';
import OperationsDashboard from '../../operations/Dashboard';
import DailyDashboard from '../../operations/DailyDashboard';
import Packages from '../../operations/Packages';
import Lots from '../../operations/Lots';
import Routes from '../../operations/Routes';
import Eway from '../../operations/Eway';
import Messaging from '../../operations/Messaging';
import Deliveries from '../../operations/Deliveries';
import { SelectField } from '../../components/m3/Input';
import Customers from '../../operations/Customers';
import {WorkArea} from '../../components/workspace/WorkArea';
import {workspaceSections} from '../../components/workspace/WorkspaceNavigation';
import {ConsoleFrame} from '../../components/workspace/ConsoleFrame';
import {consoleLinks} from '../../components/workspace/console-navigation';
import {OperatorSearch} from '../../operations/OperatorSearch';
import {useCommandPalette} from '../../components/workspace/use-command-palette';
import '../../operations/operations.css';

type Area='delivery'|'money'|'customers'|'reconciliation'|'customer-accounts'|'agent-settlements'|'custody'|'cashbook'|'financials'|'money-receipts'|'reports'|'support'|'pickups'|'automation'|'workspace'|'packages'|'deliveries'|'lots'|'routes'|'eway'|'booking'|'receipts'|'settings';
const can=(roles:readonly OperatorRole[],allowed:readonly OperatorRole[])=>roles.some(role=>allowed.includes(role));
export default function BusinessShell({context,select,controller,profile}:{controller:ScopeController;context:OperatorContext;select:(id:string)=>void;profile?:React.ReactNode}){
 const [searchOpen,setSearchOpen]=useCommandPalette();
 const location=useLocation(),current=context.franchises.find(franchise=>franchise.id===context.active_franchise_id);if(!current)return null;
 const rawSegment=location.pathname.split('/').filter(Boolean)[1]??'';const segment=rawSegment==='feed'?'automation':rawSegment==='bookings'?'packages':rawSegment;const area:Area=segment==='delivery'||segment==='money'||segment==='customers'||segment==='reconciliation'||segment==='customer-accounts'||segment==='agent-settlements'||segment==='custody'||segment==='cashbook'||segment==='financials'||segment==='money-receipts'||segment==='reports'||segment==='support'||segment==='pickups'||segment==='automation'||segment==='packages'||segment==='deliveries'||segment==='lots'||segment==='routes'||segment==='eway'||segment==='receipts'||segment==='settings'?segment:segment==='new-booking'||segment==='booking'?'booking':'workspace';
 const roles=current.roles,baseLinks=[
  {area:'reconciliation' as const,to:'/business/reconciliation',icon:'fact_check',label:'Reconciliation',show:can(roles,['org_admin','franchise_admin','accountant'])},
  {area:'customer-accounts' as const,to:'/business/customer-accounts',icon:'account_balance',label:'Customer accounts',show:can(roles,['org_admin','franchise_admin','accountant'])},
  {area:'agent-settlements' as const,to:'/business/agent-settlements',icon:'receipt_long',label:'Agent settlements',show:can(roles,['org_admin','franchise_admin','operator','accountant','delivery_agent'])},
  {area:'custody' as const,to:'/business/custody',icon:'inventory_2',label:'Parcel custody',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','delivery_agent','read_only'])},
  {area:'cashbook' as const,to:'/business/cashbook',icon:'account_balance_wallet',label:'Expenses and cashbook',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'financials' as const,to:'/business/financials',icon:'fact_check',label:'Financial approvals',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'money-receipts' as const,to:'/business/money-receipts',icon:'payments',label:'Money receipts',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'reports' as const,to:'/business/reports',icon:'query_stats',label:'Reports',show:can(roles,['org_admin','franchise_admin','accountant','operator','dispatcher','read_only','delivery_agent'])},
  {area:'support' as const,to:'/business/support',icon:'support_agent',label:'Human support',show:can(roles,['org_admin','franchise_admin','operator'])},
  {area:'pickups' as const,to:'/business/pickups',icon:'local_shipping',label:'Pickups',show:can(roles,['org_admin','franchise_admin','operator'])},
  {area:'customers' as const,to:'/business/customers',icon:'group',label:'Customers',show:canAdminister(roles,'customer.list')||roles.includes('operator')},
  {area:'workspace' as const,to:'/business',icon:'space_dashboard',label:'Workspace',show:true},
  {area:'packages' as const,to:'/business/bookings',icon:'inventory_2',label:'Bookings',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'deliveries' as const,to:'/business/deliveries',icon:'local_shipping',label:'Deliveries',show:canAdminister(roles,'deliveries.list')||can(roles,['delivery_agent','dispatcher'])},
  {area:'lots' as const,to:'/business/lots',icon:'layers',label:'Lots',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'routes' as const,to:'/business/routes',icon:'alt_route',label:'Routes',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'eway' as const,to:'/business/eway',icon:'fact_check',label:'E-way',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','accountant'])},
  {area:'booking' as const,to:'/business/new-booking',icon:'add_box',label:'New Booking',show:canAdminister(roles,'bookings.create')||can(roles,['operator'])},
  {area:'receipts' as const,to:'/business/receipts',icon:'receipt_long',label:'Receipts',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'automation' as const,to:'/business/automation',icon:'forum',label:'Automation & Messages',show:can(roles,['org_admin','franchise_admin','operator','dispatcher'])},
  {area:'settings' as const,to:'/business/settings',icon:'settings',label:'Settings',show:true},
 ].filter(link=>link.show);
 const links=consoleLinks([...baseLinks,...(['delivery','money'] as const).flatMap(id=>workspaceSections.find(group=>group.id===id)!.areas.some(child=>baseLinks.some(link=>link.area===child))?[{area:id,to:'/business/'+id,icon:id==='delivery'?'local_shipping':'account_balance_wallet',label:id==='delivery'?'Delivery':'Money'}]:[])]);
 const permitted=area==='workspace'||links.some(link=>link.area===area);
 let content:React.ReactNode;
 if(!permitted)content=<section role="alert"><h1>Access unavailable</h1><p>This feature is unavailable for this role in the selected workspace.</p><Link to="/business">Return to workspace</Link></section>;else if(area==='delivery'||area==='money')content=<WorkArea area={area} links={links}/>;else if(area==='customers')content=<Customers controller={controller} canBook={links.some(link=>link.area==='booking')} canReadAccounts={can(roles,['org_admin','franchise_admin','accountant'])}/>;else if(area==='reconciliation')content=<Reconciliation controller={controller} roles={roles}/>;else if(area==='customer-accounts')content=<CustomerAccounts controller={controller} roles={roles}/>;else if(area==='agent-settlements')content=<AgentSettlements controller={controller} roles={roles}/>;else if(area==='custody')content=<Custody controller={controller} roles={roles}/>;else if(area==='cashbook')content=<Cashbook controller={controller} roles={roles}/>;else if(area==='financials')content=<Financials controller={controller} roles={roles}/>;else if(area==='money-receipts')content=<MoneyReceipts controller={controller} roles={roles}/>;else if(area==='reports')content=<Reports controller={controller} roles={roles}/>;else if(area==='support')content=<Support controller={controller} roles={roles}/>;else if(area==='pickups')content=<Pickups controller={controller} roles={roles}/>;else if(area==='automation')content=<Messaging controller={controller} roles={roles}/>;else if(area==='packages')content=<Packages controller={controller} roles={roles}/>;else if(area==='deliveries')content=<Deliveries controller={controller} roles={roles}/>;else if(area==='lots')content=<Lots controller={controller} roles={roles}/>;else if(area==='routes')content=<Routes controller={controller} roles={roles}/>;else if(area==='eway')content=<Eway controller={controller} roles={roles}/>;else if(area==='booking')content=<NewBooking controller={controller}/>;else if(area==='receipts')content=<Receipts controller={controller}/>;else if(area==='settings')content=<Settings controller={controller} roles={roles} workspaceName={current.display_name}/>;else content=<><OperationsDashboard controller={controller} roles={roles} workspaceName={current.display_name}/>{can(roles,['org_admin','franchise_admin','accountant'])&&<DailyDashboard controller={controller} canExport={canAdminister(roles,'financial.export')||can(roles,['accountant'])}/>}</>;
 return <ConsoleFrame className="operator-shell" links={links} area={area} businessName={current.organization.display_name} subtitle={current.display_name+' · '+roles.map(role=>operatorRoleLabels[role]).join(' · ')} footer={profile} onSearch={()=>setSearchOpen(true)} scopeSelector={<SelectField label="Franchise" aria-label="Franchise" value={current.id} onChange={select} options={context.franchises.map(franchise=>({value:franchise.id,label:`${franchise.organization.display_name} · ${franchise.display_name}`}))}/> }>
   <main id="workspace-content" tabIndex={-1} className="operator-workspace ops-workspace" key={current.id}>
     <OperatorDisplayPreference controller={controller} roles={roles}/>{content}
   </main>
   {searchOpen&&<OperatorSearch key={current.id} controller={controller} links={links} close={()=>setSearchOpen(false)}/>}
 </ConsoleFrame>;
}
