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
import { Msym } from '../../components/m3/Icon';
import { SelectField } from '../../components/m3/Input';
import {WorkspaceNavigation} from '../../components/workspace/WorkspaceNavigation';
import '../../operations/operations.css';

type Area='reconciliation'|'customer-accounts'|'agent-settlements'|'custody'|'cashbook'|'financials'|'money-receipts'|'reports'|'support'|'pickups'|'automation'|'workspace'|'packages'|'deliveries'|'lots'|'routes'|'eway'|'booking'|'receipts'|'settings';
const can=(roles:readonly OperatorRole[],allowed:readonly OperatorRole[])=>roles.some(role=>allowed.includes(role));
export default function BusinessShell({context,select,controller,profile}:{controller:ScopeController;context:OperatorContext;select:(id:string)=>void;profile?:React.ReactNode}){
 const [menuOpen,setMenuOpen]=React.useState(false),menuButton=React.useRef<HTMLButtonElement>(null),navigation=React.useRef<HTMLElement>(null);
 React.useEffect(()=>{
  if(!menuOpen)return;
  const visibleLinks=Array.from(navigation.current?.querySelectorAll<HTMLAnchorElement>('a')??[]).filter(link=>!link.closest('[hidden]'));
  (visibleLinks.find(link=>link.getAttribute('aria-current')==='page')??visibleLinks[0]??navigation.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);menuButton.current?.focus();}};
  document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
 },[menuOpen]);
 const location=useLocation(),current=context.franchises.find(franchise=>franchise.id===context.active_franchise_id);if(!current)return null;
 const segment=location.pathname.split('/').filter(Boolean)[1]??'';const area:Area=segment==='reconciliation'||segment==='customer-accounts'||segment==='agent-settlements'||segment==='custody'||segment==='cashbook'||segment==='financials'||segment==='money-receipts'||segment==='reports'||segment==='support'||segment==='pickups'||segment==='automation'||segment==='packages'||segment==='deliveries'||segment==='lots'||segment==='routes'||segment==='eway'||segment==='receipts'||segment==='settings'?segment:segment==='new-booking'||segment==='booking'?'booking':'workspace';
 const roles=current.roles,links=[
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
  {area:'workspace' as const,to:'/business',icon:'space_dashboard',label:'Workspace',show:true},
  {area:'packages' as const,to:'/business/packages',icon:'inventory_2',label:'Packages',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'deliveries' as const,to:'/business/deliveries',icon:'local_shipping',label:'Deliveries',show:canAdminister(roles,'deliveries.list')||can(roles,['delivery_agent','dispatcher'])},
  {area:'lots' as const,to:'/business/lots',icon:'layers',label:'Lots',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'routes' as const,to:'/business/routes',icon:'alt_route',label:'Routes',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','read_only'])},
  {area:'eway' as const,to:'/business/eway',icon:'fact_check',label:'E-way',show:can(roles,['org_admin','franchise_admin','operator','dispatcher','accountant'])},
  {area:'booking' as const,to:'/business/new-booking',icon:'add_box',label:'New Booking',show:canAdminister(roles,'bookings.create')||can(roles,['operator'])},
  {area:'receipts' as const,to:'/business/receipts',icon:'receipt_long',label:'Receipts',show:can(roles,['org_admin','franchise_admin','operator','accountant'])},
  {area:'automation' as const,to:'/business/automation',icon:'forum',label:'Automation & Messages',show:can(roles,['org_admin','franchise_admin','operator','dispatcher'])},
  {area:'settings' as const,to:'/business/settings',icon:'settings',label:'Settings',show:true},
 ].filter(link=>link.show);
 const permitted=area==='workspace'||links.some(link=>link.area===area);
 const title=links.find(link=>link.area===area)?.label??'Workspace';let content:React.ReactNode;
 if(!permitted)content=<section role="alert"><h1>Access unavailable</h1><p>This feature is unavailable for this role in the selected workspace.</p><Link to="/business">Return to workspace</Link></section>;else if(area==='reconciliation')content=<Reconciliation controller={controller} roles={roles}/>;else if(area==='customer-accounts')content=<CustomerAccounts controller={controller} roles={roles}/>;else if(area==='agent-settlements')content=<AgentSettlements controller={controller} roles={roles}/>;else if(area==='custody')content=<Custody controller={controller} roles={roles}/>;else if(area==='cashbook')content=<Cashbook controller={controller} roles={roles}/>;else if(area==='financials')content=<Financials controller={controller} roles={roles}/>;else if(area==='money-receipts')content=<MoneyReceipts controller={controller} roles={roles}/>;else if(area==='reports')content=<Reports controller={controller} roles={roles}/>;else if(area==='support')content=<Support controller={controller} roles={roles}/>;else if(area==='pickups')content=<Pickups controller={controller} roles={roles}/>;else if(area==='automation')content=<Messaging controller={controller} roles={roles}/>;else if(area==='packages')content=<Packages controller={controller} roles={roles}/>;else if(area==='deliveries')content=<Deliveries controller={controller} roles={roles}/>;else if(area==='lots')content=<Lots controller={controller} roles={roles}/>;else if(area==='routes')content=<Routes controller={controller} roles={roles}/>;else if(area==='eway')content=<Eway controller={controller} roles={roles}/>;else if(area==='booking')content=<NewBooking controller={controller}/>;else if(area==='receipts')content=<Receipts controller={controller}/>;else if(area==='settings')content=<Settings controller={controller} roles={roles} workspaceName={current.display_name}/>;else content=<><OperationsDashboard controller={controller} roles={roles} workspaceName={current.display_name}/>{can(roles,['org_admin','franchise_admin','accountant'])&&<DailyDashboard controller={controller} canExport={canAdminister(roles,'financial.export')||can(roles,['accountant'])}/>}</>;
 return <div className="shell operator-shell">
  <a className="workspace-skip-link" href="#workspace-content" onClick={event=>{event.preventDefault();document.getElementById('workspace-content')?.focus();}}>Skip to content</a>
  <aside ref={navigation} className={`drawer-pane workspace-sidebar${menuOpen?' workspace-sidebar-open':''}`} onBlur={event=>{
    if(menuOpen&&event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)&&event.relatedTarget!==menuButton.current)setMenuOpen(false);
  }}>
   <div className="workspace-brand"><span className="workspace-brand-mark"><Msym name="inventory_2"/></span><span>ShippingCo</span></div>
   <div className="drawer-head"><div><div className="t-title-md">{current.organization.display_name}</div><div className="workspace-role-label">{roles.map(role=>operatorRoleLabels[role]).join(' · ')}</div></div></div>
   <WorkspaceNavigation links={links} area={area} onNavigate={()=>setMenuOpen(false)}/>
   <div className="workspace-sidebar-foot"><div className="workspace-sidebar-location"><Msym name="storefront"/><span>{current.display_name}</span></div>{profile}</div>
  </aside>
  <div className="main-area"><header className="appbar workspace-appbar">
   <button ref={menuButton} type="button" className="workspace-nav-toggle" aria-label={menuOpen?'Close workspace navigation':'Open workspace navigation'} aria-controls="workspace-navigation" aria-expanded={menuOpen} onBlur={event=>{if(menuOpen&&event.relatedTarget instanceof Node&&!navigation.current?.contains(event.relatedTarget))setMenuOpen(false);}} onClick={()=>setMenuOpen(open=>!open)}><Msym name={menuOpen?'close':'menu'}/></button>
   <div className="workspace-breadcrumb"><span>Workspace</span><Msym name="chevron_right"/><strong>{title}</strong></div>
   <div className="workspace-franchise"><SelectField label="Franchise" aria-label="Franchise" value={current.id} onChange={select} options={context.franchises.map(franchise=>({value:franchise.id,label:`${franchise.organization.display_name} · ${franchise.display_name}`}))}/></div>
  </header><main id="workspace-content" tabIndex={-1} className="operator-workspace ops-workspace" key={current.id}>
   <OperatorDisplayPreference controller={controller} roles={roles}/>{content}
  </main></div>
 </div>;
}
