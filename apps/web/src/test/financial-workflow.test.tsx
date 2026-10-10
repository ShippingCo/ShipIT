import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {FinancialProposalContext,FinancialRequestDetail,FinancialRequestDto,OperatorRole} from '@shippingco/shared';
import Financials from '../operations/Financials';
import {createScopeController} from '../operator/scope';
import {financialWorkflow} from '../data-access/financial-workflow';
import {scopedApi} from '../data-access/scoped-api';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),user=id(3),booking=id(4),requestId=id(5),now='2026-10-01T12:00:00.000Z';
const zero={pre_tax:'0',taxable:'0',cgst:'0',sgst:'0',igst:'0',rounding:'0'};
const context:FinancialProposalContext={booking_id:booking,expected_version:0,payment_version:1,components:{...zero,pre_tax:'50000'},position:{gross:'50000',held:'50000',outstanding:'0',refundable_credit:'0'},refund_targets:[]};
const original:FinancialRequestDto={id:requestId,actor_id:user,recorded_at:now,policy_id:id(8),supersedes_id:null,refund_correction_of:null,booking_id:booking,expected_version:0,payment_version:1,kind:'discount',reason:'customer_agreement',...zero,pre_tax:'10000',refund:'0',version:0,outcome:'pending'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(initial=original){let request=structuredClone(initial),lose=false,lost=false,deny=false;const writes:{path:string;body:Record<string,unknown>;key:string}[]=[];
 const fetcher=vi.fn(async(path:string,options:RequestInit={})=>{const url=new URL(path,'https://fictional.example.test');if(url.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
  if(options.method==='POST'){const body=JSON.parse(String(options.body)),key=(options.headers as Record<string,string>)['Idempotency-Key'];writes.push({path:url.pathname,body,key});
   if(deny)return json({error:{code:'FINANCIAL_WORKFLOW_DISABLED'}},409);
   if(url.pathname==='/api/v1/finance/requests'){request={...original,...Object.fromEntries(Object.entries(body).filter(([key])=>key!=='document_links')),pre_tax:String(body.pre_tax),taxable:String(body.taxable),cgst:String(body.cgst),sgst:String(body.sgst),igst:String(body.igst),rounding:String(body.rounding),refund:String(body.refund)};}
   else if(url.pathname.endsWith('/decisions'))request={...request,outcome:body.outcome as 'approved'|'rejected',version:1};
   else if(url.pathname.endsWith('/apply'))request={...request,outcome:'applied',version:2};
   else if(url.pathname.endsWith('/amend'))request={...request,id:id(50),supersedes_id:requestId,outcome:'pending',version:0};
   else throw new Error('Unexpected mutation path');
   if(lose&&!lost){lost=true;throw new TypeError('Synthetic lost response after save');}return json({id:url.pathname.endsWith('/decisions')||url.pathname.endsWith('/apply')?id(40):request.id});
  }
  if(url.pathname==='/api/v1/finance/policy')return json({policy:null,writes_enabled:false});
  if(url.pathname.endsWith('/proposal'))return json({...context,private_beneficiary:'DO_NOT_RENDER'});
  if(url.pathname.includes('/finance/my-requests/'))return json({request,document_links:[],private_transfer_ref:'DO_NOT_RENDER'});
  if(url.pathname.includes('/finance/requests/')){const refund=request.kind==='refund',observed=refund?{...context,components:zero,position:{gross:'0',held:'50000',outstanding:'0',refundable_credit:'50000'}}:context;const detail:FinancialRequestDetail={request,document_links:[],decisions:request.version?[{id:id(40),actor_id:id(9),outcome:request.outcome as 'approved'|'rejected'|'applied',version:request.version,financial_change_id:request.outcome==='applied'?id(41):null,recorded_at:now}]:[],source:{booking_id:booking,financial_version:request.expected_version,payment_version:1,components:{...observed.components,gross:observed.position.gross,collections:'50000',refunds:'0'}},before:observed.position,proposed:refund?{gross:'0',held:'30000',outstanding:'0',refundable_credit:'30000'}:{gross:'40000',held:'50000',outstanding:'0',refundable_credit:'10000'}};return json(detail);}
  if(url.pathname==='/api/v1/receiving-accounts')return json({items:[{id:id(10),revision_id:id(11),version:3,name:'Synthetic refund source',methods:['cash'],other_method_name:null,active:true,recorded_at:now}],next_cursor:null});
  throw new Error('Unexpected read path');
 });vi.stubGlobal('fetch',fetcher);return {writes,fetcher,lose(){lose=true;},disable(){deny=true;}};
}
function view(roles:OperatorRole[]){const controller=createScopeController();controller.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:roles.join(',')});render(<MemoryRouter><a href="/business">Workspace link</a><select aria-label="Franchise"><option value={franchise}>First</option><option value={id(20)}>Second</option></select><Financials controller={controller} roles={roles}/></MemoryRouter>);return controller;}
async function load(){fireEvent.change(screen.getByLabelText('Proposal booking reference'),{target:{value:booking}});fireEvent.submit(screen.getByRole('form',{name:'Load proposal booking'}));await screen.findByRole('form',{name:'Submit financial proposal'});}
async function open(){fireEvent.change(screen.getByLabelText('Financial request reference'),{target:{value:requestId}});fireEvent.submit(screen.getByRole('form',{name:'Open financial request'}));await screen.findByRole('heading',{name:/Live .* request/});}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('production financial workflows with real scoped adapters and fictional transport',()=>{
 it('validates component reductions and retains an uncertain request across blocked navigation and same-key retry',async()=>{
  const f=fixture();f.lose();const controller=view(['operator']);await load();
  fireEvent.change(screen.getByLabelText(/^Pre-tax charge reduction/),{target:{value:'501'}});fireEvent.submit(screen.getByRole('form',{name:'Submit financial proposal'}));await screen.findByText('Reductions must fit the current component amounts and taxable base.');expect(f.writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(/^Pre-tax charge reduction/),{target:{value:'100'}});fireEvent.submit(screen.getByRole('form',{name:'Submit financial proposal'}));await screen.findByText(/The outcome is uncertain/);
  expect(screen.getByLabelText('Proposal booking reference')).toBeDisabled();expect(fireEvent.click(screen.getByText('Workspace link'))).toBe(false);expect(fireEvent.change(screen.getByLabelText('Franchise'),{target:{value:id(20)}})).toBe(true);await screen.findByText(/Reconcile the retained request/);expect(screen.getByLabelText('Franchise')).toHaveValue(franchise);
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByRole('heading',{name:'Live discount request · pending'});expect(f.writes).toHaveLength(2);expect(f.writes[1]).toEqual(f.writes[0]);expect(f.writes[0]!.body).toMatchObject({booking_id:booking,expected_version:0,payment_version:1,pre_tax:10000,refund:0,document_links:[]});
  expect(screen.queryByText('DO_NOT_RENDER')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Approve financial proposal'})).not.toBeInTheDocument();expect(screen.queryByRole('heading',{name:'Financial review audit'})).not.toBeInTheDocument();
  act(()=>controller.clear('signed_out'));expect(screen.queryByText(requestId)).not.toBeInTheDocument();expect(screen.getByText('Financial access unavailable')).toBeVisible();
 });
 it('reviews server preview and reloads the original request after decision and application IDs',async()=>{
  const f=fixture();view(['franchise_admin']);await open();await screen.findByText('Server preview from the saved source versions');
  fireEvent.click(screen.getByRole('button',{name:'Approve financial proposal'}));expect(await screen.findByRole('heading',{name:'Live discount request · approved'})).toHaveFocus();expect(f.writes[0]!.body).toEqual({expected_version:0,outcome:'approved'});
  fireEvent.click(screen.getByRole('button',{name:'Apply approved financial change'}));await screen.findByRole('heading',{name:'Live discount request · applied'});expect(f.writes[1]!.body).toEqual({expected_version:1});expect(f.fetcher.mock.calls.some(([path])=>new URL(path,'https://fictional.example.test').pathname==='/api/v1/finance/requests/'+id(40))).toBe(false);
 });
 it('records private actual refund evidence only for the approved refund and current source account revision',async()=>{
  const f=fixture({...original,kind:'refund',reason:'customer_refund',pre_tax:'0',refund:'20000',outcome:'approved',version:1});view(['franchise_admin']);await open();await screen.findByRole('option',{name:'Synthetic refund source'});
  fireEvent.change(screen.getByLabelText(/^Refund source account/),{target:{value:id(10)}});fireEvent.change(screen.getByLabelText('Actual refund time (Kolkata)'),{target:{value:'2026-10-01T17:30'}});fireEvent.change(screen.getByLabelText('Private beneficiary reference'),{target:{value:'SYNTHETIC_CUSTOMER'}});fireEvent.change(screen.getByLabelText('Private actual transfer reference'),{target:{value:'SYNTHETIC_RETURN'}});
  fireEvent.submit(screen.getByRole('form',{name:'Record approved actual refund'}));await screen.findByRole('heading',{name:'Live actual refund record request · applied'});expect(f.writes[0]!.body).toEqual({expected_version:1,refund_evidence:{account_id:id(10),expected_account_version:3,method:'cash',occurred_at:now,returned_to_ref:'SYNTHETIC_CUSTOMER',transfer_ref:'SYNTHETIC_RETURN'}});expect(screen.queryByLabelText('Private beneficiary reference')).not.toBeInTheDocument();
 });
 it('keeps org admins and accountants read-only and treats disabled writes as controlled conflicts',async()=>{
  const f=fixture();for(const role of ['accountant','org_admin'] as OperatorRole[]){view([role]);await open();expect(screen.queryByRole('form',{name:'Load proposal booking'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Approve financial proposal'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Amend my pending proposal'})).not.toBeInTheDocument();cleanup();}
  f.disable();view(['operator']);await load();fireEvent.change(screen.getByLabelText(/^Pre-tax charge reduction/),{target:{value:'100'}});fireEvent.submit(screen.getByRole('form',{name:'Submit financial proposal'}));await screen.findByText(/FINANCIAL_WORKFLOW_DISABLED/);expect(screen.queryByText(/The outcome is uncertain/)).not.toBeInTheDocument();expect(screen.getByLabelText('Proposal booking reference')).toBeEnabled();expect(f.writes).toHaveLength(1);
 });
 it('amends only the creator pending request with freshly loaded versions and retained source document links',async()=>{
  const f=fixture();const base=f.fetcher.getMockImplementation()!;f.fetcher.mockImplementation(async(path,options)=>{
   const response=await base(path,options);if(path.includes('/finance/my-requests/')){const value=await response.json() as {request:FinancialRequestDto};return json({...value,document_links:[{kind:'external_invoice',receipt_id:null,external_ref:'SYNTHETIC_INVOICE',qualification:'unverified_external_reference'}]});}return response;
  });view(['operator']);await open();fireEvent.click(screen.getByRole('button',{name:'Amend my pending proposal'}));await screen.findByRole('form',{name:'Submit financial proposal'});expect(screen.getByLabelText('Proposal booking reference')).toBeDisabled();expect(screen.getByLabelText('Document 1 reference')).toHaveValue('SYNTHETIC_INVOICE');
  fireEvent.change(screen.getByLabelText(/^Pre-tax charge reduction/),{target:{value:'50'}});fireEvent.submit(screen.getByRole('form',{name:'Submit financial proposal'}));await screen.findByRole('heading',{name:'Live discount request · pending'});expect(f.writes).toHaveLength(1);expect(f.writes[0]!.path).toBe('/api/v1/finance/requests/'+requestId+'/amend');expect(f.writes[0]!.body).toMatchObject({expected_request_version:0,proposal:{booking_id:booking,expected_version:0,payment_version:1,pre_tax:5000,document_links:[{kind:'external_invoice',receipt_id:null,external_ref:'SYNTHETIC_INVOICE'}]}});expect(screen.queryByRole('button',{name:'Approve financial proposal'})).not.toBeInTheDocument();
 });
 it('saves the explicit approved policy with exact uncertain replay without replacing the open financial request',async()=>{
  const f=fixture(),base=f.fetcher.getMockImplementation()!;let policy:unknown=null,lost=false;const commands:{body:unknown;key:unknown}[]=[];
  f.fetcher.mockImplementation(async(path,options={})=>{if(path.includes('/finance/policy/revisions')){const body=JSON.parse(String(options.body));commands.push({body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});policy={id:id(80),version:1,discount_review_threshold_paise:null,allow_self_approval:false,enabled:body.enabled};if(!lost){lost=true;throw new TypeError('Synthetic lost policy response');}return json(policy);}if(new URL(path,'https://fictional.example.test').pathname==='/api/v1/finance/policy')return json({policy,writes_enabled:false});return base(path,options);});
  view(['franchise_admin']);await open();fireEvent.submit(await screen.findByRole('form',{name:'Configure financial approval policy'}));await screen.findByText(/The outcome is uncertain/);expect(screen.getByRole('button',{name:'Approve financial proposal'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByText('Policy revision: 1 · workflow writes: Disabled by server rollout');expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(JSON.parse(String(commands[0]!.body))).toEqual({expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false});await screen.findByRole('heading',{name:'Live discount request · pending'});expect(f.fetcher.mock.calls.some(([path])=>new URL(path,'https://fictional.example.test').pathname==='/api/v1/finance/requests/'+id(80))).toBe(false);
 });
 it('rejects foreign booking context and another creators own request instead of painting their fields',async()=>{
  fixture();const controller=createScopeController();controller.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:'operator'});const source=financialWorkflow(scopedApi(controller));
  vi.stubGlobal('fetch',async()=>json({...context,booking_id:id(90)}));await expect(source.context(booking)).rejects.toMatchObject({kind:'protocol'});
  vi.stubGlobal('fetch',async()=>json({request:{...original,actor_id:id(90)},document_links:[]}));await expect(source.own(requestId)).rejects.toMatchObject({kind:'protocol'});
  vi.stubGlobal('fetch',async()=>json({...context,refund_targets:[{id:id(99),original_paise:'0',remaining_paise:'0'}]}));await expect(source.context(booking)).rejects.toMatchObject({kind:'protocol'});
  vi.stubGlobal('fetch',async()=>json({request:original,document_links:[{kind:'external_invoice',receipt_id:null,external_ref:'SYNTHETIC_INVOICE',qualification:'issued_source'}]}));await expect(source.own(requestId)).rejects.toMatchObject({kind:'protocol'});
 });
});
