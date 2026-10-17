import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createMemoryRouter,RouterProvider,Outlet} from 'react-router-dom';
import {SettingsNavigationGuard} from '../operator/SettingsNavigationGuard';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import Reconciliation from '../operations/Reconciliation';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
const account=f.id(70),transaction=f.id(71),source='receipt:'+f.id(72),match=f.id(73),snapshot=f.id(74);
const report={snapshot:{id:snapshot,schema_version:1,definition:'manual_reconciliation_v1',organization_id:f.org,franchise_id:f.A,timezone:'Asia/Kolkata',filter:{account_id:account,from_day:'2099-01-01',to_day:'2099-01-01'},as_of:f.now,expires_at:'2099-01-02T00:00:00.000Z',count:1,controls:[{kind:'transaction',direction:'credit',count:1,amount_paise:'50000',matched_paise:'50000',remaining_paise:'0'}],status_counts:{recorded:0,verified:1,pending:0,different:0,unassigned:0}},rows:[{id:'transaction:'+transaction,resource_id:transaction,kind:'transaction',business_date:'2099-01-01',direction:'credit',amount_paise:'50000',matched_paise:'50000',remaining_paise:'0',status:'verified',classification:'unassigned',external_reference:'SYN-500',evidence:{transaction_id:transaction,external_id:'SYN-BANK-ID',identity_namespace:'SYNTHETIC',classification_version:0,matches:[{id:match,method:'manual',amount_paise:'50000',actor_id:f.id(6),reviewed_at:f.now,reason:'Checked fictional statement evidence',sources:[{source_id:source,source_version:f.id(75),amount_paise:'50000',is_fee:false}]}]}}],next_offset:null};
let calls:{path:string;options:RequestInit}[],enabled:boolean,uncertain:boolean,matched:boolean,denied:boolean;
beforeEach(()=>{calls=[];enabled=false;uncertain=false;matched=false;denied=false;vi.stubEnv('VITE_DATA_MODE','production');vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
 calls.push({path,options});if(path==='/auth/bootstrap')return f.json({csrf_token:'SYN-CSRF'});if(path.startsWith('/api/v1/operator-context'))return f.json(f.context);
 const route=new URL(path,'http://localhost').pathname.replace('/api/v1/reconciliation/',''),post=options.method==='POST';
 if(post&&route==='config'){enabled=JSON.parse(options.body as string).enabled;if(uncertain){uncertain=false;throw new TypeError('SYN_ACK_LOST');}return f.json({id:f.id(77),version:1,enabled});}
 if(route==='config')return f.json({version:enabled?1:0,enabled,writes_available:true,recorded_at:null});
 if(route==='accounts')return f.json({items:[{id:account,name:'Synthetic bank',active:true,methods:['upi','card']}],next_cursor:null});
 if(route==='sources')return f.json({items:[{id:source,source_kind:'receipt',source_id:f.id(72),version:f.id(75),account_id:account,direction:'credit',amount_paise:'50000',available_paise:matched?'0':'50000',currency:'INR',method:'upi',external_reference:'SYN-500',business_date:'2099-01-01',recorded_at:f.now}],next_cursor:null});
 if(route==='transactions')return f.json({items:[{id:transaction,business_date:'2099-01-01',direction:'credit',amount_paise:'50000',available_paise:matched?'0':'50000',external_reference:'SYN-500',external_id:'SYN-BANK-ID',classification:'unassigned',classification_version:0}],next_cursor:null});
 if(route.endsWith('/suggestions'))return f.json({items:[{source_id:source,source_version:f.id(75),source_kind:'receipt',amount_paise:'50000',available_paise:'50000',external_reference:'SYN-500',business_date:'2099-01-01',kind:'exact'}],next_cursor:null});
 if(route==='matches'&&post){matched=true;return f.json({id:match});}
 if(route==='reports'&&post)return f.json(report);
 if(route==='reports/'+snapshot)return denied?f.json({error:{code:'RESOURCE_NOT_FOUND'}},404):f.json(report);
 if(route==='reports/'+snapshot+'/export')return f.json({snapshot:report.snapshot,columns:['id'],csv:'id\r\n'+transaction+'\r\n'});
 if(route.startsWith('history/'))return f.json({items:[{id:f.id(80),action:'match',actor_id:f.id(6),resource_id:match,recorded_at:f.now,reason:'Synthetic review reason'}],next_cursor:null});
 if(['mappings','imports','batches'].includes(route))return f.json({items:[],next_cursor:null});
 throw new Error('Unexpected synthetic reconciliation route '+route);
}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function start(roles:('franchise_admin'|'read_only'|'accountant')[]=['franchise_admin']){const controller=createScopeController();await controller.load();const router=createMemoryRouter([{element:<><SettingsNavigationGuard controller={controller}/><Outlet/></>,children:[{path:'/business',element:<p>Previous workspace</p>},{path:'/business/reconciliation',element:<Reconciliation controller={controller} roles={roles}/>}]}],{initialEntries:['/business','/business/reconciliation'],initialIndex:1});render(<RouterProvider router={router}/>);return {controller,router};}
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:false}),{target:{value}});
it('shows disabled default and preserves the exact uncertain opt-in command across back navigation',async()=>{
 const {router}=await start();await screen.findByText(/Disabled for this franchise/);await screen.findByRole('option',{name:'Synthetic bank'});expect(screen.getByRole('button',{name:'Enable reconciliation'})).toBeDisabled();fill('Reason for enabling','Explicit synthetic opt-in');uncertain=true;fireEvent.click(screen.getByRole('button',{name:'Enable reconciliation'}));await screen.findByRole('button',{name:'Retry same request'});
 await act(async()=>{await router.navigate(-1);});expect(router.state.location.pathname).toBe('/business/reconciliation');expect(screen.getByLabelText('Receiving account',{exact:false})).toBeDisabled();expect(screen.getByRole('button',{name:'Statements and mappings'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByText('Action confirmed. Current evidence refreshed.');const posts=calls.filter(c=>c.options.method==='POST');expect(posts).toHaveLength(2);expect(posts[0].options.body).toBe(posts[1].options.body);expect((posts[0].options.headers as Record<string,string>)['Idempotency-Key']).toBe((posts[1].options.headers as Record<string,string>)['Idempotency-Key']);expect(localStorage.length).toBe(0);
});
it('requires explicit selection and reason before confirming an exact suggestion',async()=>{
 enabled=true;await start(['accountant']);await screen.findByRole('option',{name:'Synthetic bank'});fill('Receiving account',account);fireEvent.click(screen.getByRole('button',{name:'Match evidence'}));const bank=await screen.findByRole('checkbox',{name:/2099-01-01 · credit · SYN-500/});bank.focus();expect(bank).toHaveFocus();fireEvent.click(bank);fireEvent.click(await screen.findByRole('button',{name:/Exact candidate/}));expect(screen.getByRole('button',{name:'Confirm evidence match'})).toBeDisabled();fill('Match or batch review reason','Reviewed exact synthetic evidence');fireEvent.click(screen.getByRole('button',{name:'Confirm evidence match'}));await screen.findByText('Action confirmed. Current evidence refreshed.');
 const post=calls.find(c=>c.options.method==='POST'&&c.path.includes('/matches'))!;expect(JSON.parse(post.options.body as string)).toMatchObject({account_id:account,method:'exact',transactions:[{transaction_id:transaction,amount_paise:50000}],sources:[{source_id:source,source_version:f.id(75),amount_paise:50000}],fees:[]});expect(screen.queryByLabelText('Reason for enabling or disabling reconciliation')).toBeNull();
});
it('captures controls and drills into verifier/source evidence; external references default out of CSV',async()=>{
 await start();await screen.findByRole('option',{name:'Synthetic bank'});fill('Receiving account',account);fireEvent.click(screen.getByRole('button',{name:'Capture current review'}));fireEvent.click(await screen.findByRole('button',{name:/2099-01-01 · transaction · verified/}));await screen.findByText(/Verifier/);expect(screen.getByText(/Checked fictional statement evidence/)).toBeVisible();expect(screen.getByRole('button',{name:'Unmatch this evidence group'})).toBeDisabled();expect(screen.getByRole('checkbox',{name:'external reference'})).not.toBeChecked();expect(screen.getByText(/Synthetic review reason/)).toBeVisible();
 await waitFor(()=>expect(calls.some(c=>c.path.includes('/reports/'+snapshot))).toBe(true));
});
it('read_only cannot mount private reconciliation requests',async()=>{await start(['read_only']);await screen.findByText('Reconciliation access unavailable');expect(calls.some(c=>c.path.includes('/reconciliation'))).toBe(false);});

it('uploads a local CSV, publishes its selected mapping and preserves that version through preview and import',async()=>{
 enabled=true;const original=vi.mocked(fetch).getMockImplementation()!,mappingId=f.id(81),runId=f.id(82),profileId=f.id(83);let saved:Record<string,unknown>|null=null,committed=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  const route=new URL(path,'http://localhost').pathname.replace('/api/v1/reconciliation/',''),post=options.method==='POST';
  if(!['columns','mappings','imports','imports/'+runId,'imports/'+runId+'/commit'].includes(route))return original(path,options);
  calls.push({path,options});
  if(route==='columns')return f.json({headers:['Date','Amount','Ref','ID'],row_count:1});
  if(route==='mappings'&&post){saved=JSON.parse(options.body as string);return f.json({id:mappingId,profile_id:profileId,version:1});}
  if(route==='mappings')return f.json({items:saved?[{id:mappingId,profile_id:profileId,version:1,mapping:saved,actor_id:f.id(6),recorded_at:f.now}]:[],next_cursor:null});
  if(route==='imports'&&post)return f.json({id:runId});
  if(route==='imports')return f.json({items:[],next_cursor:null});
  if(post){committed=true;return f.json({id:runId});}
  return f.json({id:runId,account_id:account,account_revision_id:f.id(84),mapping_id:mappingId,period_from:'2099-01-01',period_to:'2099-01-01',file_sha256:'a'.repeat(64),rows:[{row:2,error:null,candidate:{business_date:'2099-01-01',direction:'credit',amount_paise:50000,currency:'INR',external_reference:'SYN-500',external_id:'SYN-ID'}}],outcomes:committed?[{row_number:2,version:1,state:'imported',transaction_id:transaction,reason:'Imported proven transaction identity'}]:[]});
 }));
 await start();await screen.findByRole('option',{name:'Synthetic bank'});fill('Receiving account',account);fireEvent.click(screen.getByRole('button',{name:'Statements and mappings'}));
 const csv='Date,Amount,Ref,ID\n2099-01-01,500,SYN-500,SYN-ID',file=new File([csv],'fictional.csv',{type:'text/csv'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(csv).buffer});
 fireEvent.change(screen.getByLabelText('Statement CSV'),{target:{files:[file]}});await screen.findByText('File is in this tab only. Inspect columns, then choose a mapping.');fireEvent.click(screen.getByRole('button',{name:'Inspect CSV columns'}));await screen.findByText('Columns: Date · Amount · Ref · ID');fireEvent.click(screen.getByText('Create a mapping'));
 fill('Mapping name','Synthetic selected columns');fill('Source identity namespace','SYNTHETIC');fill('Date column','Date');fill('Amount column','Amount');fill('External reference column','Ref');fill('Proven unique transaction ID column','ID');fireEvent.click(screen.getByRole('button',{name:'Save mapping version'}));
 await screen.findByRole('option',{name:'Synthetic selected columns · version 1'});expect(screen.getByLabelText('Mapping name')).toHaveValue('Synthetic selected columns');expect(screen.getByLabelText('Amount column',{exact:false})).toHaveValue('Amount');
 fill('Statement period from','2099-01-01');fill('Statement period to','2099-01-01');fireEvent.click(screen.getByRole('button',{name:'Validate and save preview'}));fireEvent.click(await screen.findByRole('button',{name:'Import next 1 rows'}));await screen.findByText('Imported proven transaction identity');
 const preview=calls.find(c=>c.options.method==='POST'&&new URL(c.path,'http://localhost').pathname.endsWith('/imports'))!;expect(JSON.parse(preview.options.body as string)).toMatchObject({account_id:account,mapping_id:mappingId,content_base64:btoa(csv)});expect(screen.getByRole('button',{name:'Validate and save preview'})).toBeDisabled();expect(localStorage.length).toBe(0);
});
