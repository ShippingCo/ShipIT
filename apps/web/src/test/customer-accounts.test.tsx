import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createMemoryRouter,RouterProvider,Outlet} from 'react-router-dom';
import {SettingsNavigationGuard} from '../operator/SettingsNavigationGuard';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import CustomerAccounts from '../operations/CustomerAccounts';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
const account={id:f.id(70),revision_id:f.id(71),version:1,debtor_customer_id:f.customerId,name:'Synthetic Monthly',shipping_customer_ids:[f.customerId],billing_contact:{name:'Synthetic Contact',phone:'+12025550100',authorization_ref:'OWNER_ATTESTED'},closing_day:31,due_days:10,credit_limit_paise:100000,state:'active',recorded_at:f.now};
let calls:{path:string;options:RequestInit}[],created:boolean,uncertain:boolean,pending:boolean;
beforeEach(()=>{
 calls=[];created=false;uncertain=false;pending=false;vi.stubEnv('VITE_DATA_MODE','production');
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  calls.push({path,options});
  if(path==='/auth/bootstrap')return f.json({csrf_token:'SYN-CSRF'});
  if(path.startsWith('/api/v1/operator-context'))return f.json(f.context);
  if(path.includes('/customers'))return f.json({items:[f.customer],page:{has_more:false,next_cursor:null}});
  if(path.includes('/customer-credit-requests/')&&path.includes('/review'))return f.json({id:f.id(90),account,credit:{outstanding_paise:'0',available_paise:'100000',overdue_paise:'0',credit_limit_paise:100000,state:'active',as_of:f.now},customer_id:f.customerId,customer_version:1,parcels:[{recipient_name:'Fictional Recipient',weight_grams:500,docket:null}],destination_key:'SYN_DEST',service:'standard',quote_id:f.id(7),tax_calculation_id:f.id(12),approval_id:null});
  if(path.includes('/customer-credit-requests/')&&path.includes('/approval')){pending=false;return f.json({id:f.id(91),expires_at:f.expiry});}
  if(path.includes('/customer-credit-requests'))return f.json({items:pending?[{id:f.id(90),account_id:account.id,name:account.name,operator_id:f.id(6),total_paise:13400,expires_at:f.expiry}]:[],next_cursor:null});
  if(path.includes('/statements?'))return f.json({items:[],next_cursor:null});
  if(path.includes('/history'))return f.json({items:[{...account,attested_by:f.id(6),reason:'Approved original terms'}],next_cursor:null});
  if(path.includes('/credit'))return f.json({outstanding_paise:'0',available_paise:'100000',overdue_paise:'0',credit_limit_paise:100000,state:'active',as_of:f.now});
  if(path.includes('/rates'))return f.json({items:[],next_cursor:null});
  if(path.startsWith('/api/v1/customer-accounts')&&options.method==='POST'){created=true;if(uncertain){uncertain=false;throw new TypeError('SYN_ACK_LOST');}return f.json(account);}
  if(path.startsWith('/api/v1/customer-accounts'))return f.json({items:created?[account]:[],next_cursor:null});
  throw new Error('Unexpected synthetic account endpoint');
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:false}),{target:{value}});
async function start(roles:('franchise_admin'|'read_only'|'accountant')[]=['franchise_admin']){const controller=createScopeController();await controller.load();const router=createMemoryRouter([{element:<><SettingsNavigationGuard controller={controller}/><Outlet/></>,children:[{path:'/business',element:<p>Previous workspace</p>},{path:'/business/customer-accounts',element:<CustomerAccounts controller={controller} roles={roles}/>}]}],{initialEntries:['/business','/business/customer-accounts'],initialIndex:1});render(<RouterProvider router={router}/>);return {controller,router};}
it('requires an explicit contact attestation, keeps an uncertain command and retries its exact body/key',async()=>{
 const {router}=await start();await screen.findByText('No customer accounts');fireEvent.click(screen.getByRole('button',{name:'New account'}));
 fill('Account name','Synthetic Monthly');fill('Customer name prefix','Synthetic');fireEvent.click(screen.getByRole('button',{name:'Search customers'}));fireEvent.click(await screen.findByRole('button',{name:/Synthetic Sender/}));
 fill('Billing contact name','Synthetic Contact');fill('Billing contact phone','+12025550100');fill('Contact authority evidence reference','OWNER_ATTESTED');fill('Monthly closing day','31');fill('Calendar days after closing','10');fill('Credit limit','1000.00');fill('Reason for this revision','Owner approved terms');
 fireEvent.click(screen.getByRole('button',{name:'Save account revision'}));await screen.findByText(/Choose a debtor, linked shipping customers/);expect(calls.filter(c=>c.options.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('checkbox',{name:/I attest as franchise administrator/}));uncertain=true;fireEvent.click(screen.getByRole('button',{name:'Save account revision'}));await screen.findByRole('button',{name:'Retry same request'});
 for(let i=0;i<2;i++){await act(async()=>{await router.navigate(-1);});expect(router.state.location.pathname).toBe('/business/customer-accounts');}
 await screen.findByText('Resolve the retained command before leaving or changing accounts.');
 expect(screen.getByRole('button',{name:'New account'})).toBeDisabled();expect(screen.getByLabelText('Account name')).toBeDisabled();expect(screen.getByLabelText('Billing contact phone')).toHaveValue('+12025550100');
 fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByRole('heading',{name:'Synthetic Monthly'});
 const posts=calls.filter(c=>c.options.method==='POST');expect(posts).toHaveLength(2);expect(posts[0].options.body).toBe(posts[1].options.body);expect((posts[0].options.headers as Record<string,string>)['Idempotency-Key']).toBe((posts[1].options.headers as Record<string,string>)['Idempotency-Key']);
 expect(JSON.parse(posts[1].options.body as string)).toMatchObject({debtor_customer_id:f.customerId,shipping_customer_ids:[f.customerId],credit_limit_paise:100000,billing_contact:account.billing_contact});
 expect(screen.getByText(/Attested by/)).toBeVisible();expect(localStorage.length).toBe(0);
});
it('reviews exact shipment evidence before approving and refreshes the pending queue',async()=>{
 pending=true;await start();const radio=await screen.findByRole('radio');radio.focus();expect(radio).toHaveFocus();fireEvent.click(radio);
 await screen.findByRole('heading',{name:'Review requested booking'});expect(screen.getByText(/Fictional Recipient · 500 g/)).toBeVisible();expect(screen.getByRole('button',{name:'Approve this booking only'})).toBeDisabled();
 fill('Credit exception approval reason','Reviewed the exact shipment');fireEvent.click(screen.getByRole('button',{name:'Approve this booking only'}));await screen.findByText('Server update confirmed.');
 await waitFor(()=>expect(screen.queryByRole('radio')).toBeNull());const post=calls.find(c=>c.options.method==='POST')!;expect(post.path).toContain('/'+f.id(90)+'/approval');expect(JSON.parse(post.options.body as string)).toEqual({reason:'Reviewed the exact shipment'});
});
it('read-only cannot mount account directory reads or configuration',async()=>{
 await start(['read_only']);await screen.findByText('Customer account access unavailable');expect(calls.some(c=>c.path.includes('/customer-account'))).toBe(false);
});
