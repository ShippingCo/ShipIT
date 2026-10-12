import {statementExportColumns} from '@shippingco/shared';
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import AgentSettlements from '../operations/AgentSettlements';
import {statementEvidence} from '../data-access/agent-statement-evidence';
import {statementCapture,statementDetail} from '../data-access/agent-statements';
import {statementRupees} from '../operations/AgentStatementEvidence';
import {createScopeController} from '../operator/scope';
import {sid,statementFixture,statementNow,statementOrg,statementFr,statementAgent,statementOperator,statementAdmin} from './agent-statement-fixture';
import type {OperatorRole} from '@shippingco/shared';
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function controller(user:string,role:OperatorRole){const c=createScopeController();c.runtime.bind({userId:user,organizationId:statementOrg,franchiseId:statementFr,permissions:role});return c;}
function transport(actor=statementOperator,lose=false,eligible=true){
 const f=statementFixture(),writes:{path:string;body:Record<string,unknown>;key:string}[]=[];let saved=false,lost=false,reviewed=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  const u=new URL(path,'https://example.test');if(u.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
  if(options.method==='POST'){
   const b=JSON.parse(String(options.body));writes.push({path:u.pathname,body:b,key:(options.headers as Record<string,string>)['Idempotency-Key']});
   if(u.pathname.endsWith('/cash-captures'))return json({...f.capture,actor_id:actor,reason:b.reason});
   if(u.pathname.endsWith('/decisions')){reviewed=true;return json({id:sid(10),submission_id:f.header.id,kind:b.kind,expected_version:b.expected_version,actor_id:actor,reason:b.reason,recorded_at:statementNow});}
   saved=true;if(lose&&!lost){lost=true;throw new TypeError('Synthetic committed response lost');}return json({...f.header,actor_id:actor});
  }
  if(u.pathname.endsWith('/eligible-agents'))return json({agents:eligible?[{id:statementAgent}]:[],next_cursor:null});
  if(u.pathname.endsWith('/submissions'))return json({items:saved||actor===statementAdmin?[{...f.header,actor_id:saved?actor:f.header.actor_id,status:reviewed?'approved':'pending'}]:[],as_of:statementNow,next_cursor:null});
  if(u.pathname.endsWith('/'+f.header.id))return json({...f.detail,actor_id:saved?actor:f.detail.actor_id,...(reviewed?{status:'approved',decision:{id:sid(10),submission_id:f.header.id,kind:'approve',expected_version:1,actor_id:actor,reason:'Independent sources checked',recorded_at:statementNow}}:{})});
  throw new Error('Unexpected private path '+u.pathname);
 }));return {writes,f};
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('source-backed agent settlement workspace',()=>{
 it('keeps source-owned cash, seller liability and fees separate and rejects mismatched source frames or totals',()=>{
  const f=statementFixture();expect(statementCapture(f.capture).source_snapshot.totals.expected_paise).toBe('1000');expect(statementDetail(f.detail).source_snapshot.finance.totals.origin_receipt_seller_liability_paise).toBe('200000');
  const paid=structuredClone(f.source_snapshot),fee=paid.finance.fee_positions[0]!;Object.assign(fee,{expense_paise:'4000',direct_paid_paise:'3000',cash_paid_paise:'0',noncash_paid_paise:'3000',advance_applied_paise:'1000',remaining_paise:'0'});paid.finance.advance_positions.push({origin_request_id:sid(50),head_request_id:sid(50),payment_method:'cash',paid_paise:'1000',applied_paise:'1000',unapplied_paise:'0'} as never);paid.finance.source_count++;
  Object.assign(paid.finance.totals,{fee_expense_paise:'4000',fee_direct_paid_paise:'3000',fee_noncash_paid_paise:'3000',fee_advance_applied_paise:'1000',remaining_fee_paise:'0',advance_paid_paise:'1000',unapplied_advance_paise:'0'});
  expect(statementEvidence(paid).finance.totals.fee_cash_paid_paise).toBe('0');expect(statementEvidence(paid).finance.totals.remaining_fee_paise).toBe('0');
  const missingAdvance=structuredClone(paid);missingAdvance.finance.advance_positions=[];missingAdvance.finance.source_count--;missingAdvance.finance.totals.advance_paid_paise='0';expect(()=>statementEvidence(missingAdvance)).toThrow();
  const unmatchedApplication=structuredClone(paid);Object.assign(unmatchedApplication.finance.advance_positions[0]!,{applied_paise:'500',unapplied_paise:'500'});unmatchedApplication.finance.totals.unapplied_advance_paise='500';expect(()=>statementEvidence(unmatchedApplication)).toThrow();
  for(const change of [(r:typeof f.source_snapshot)=>{r.totals.expected_paise='4000';},(r:typeof f.source_snapshot)=>{r.finance.as_of='2026-10-11T06:00:01.150Z';},(r:typeof f.source_snapshot)=>{r.finance.source_count=3;},(r:typeof f.source_snapshot)=>{r.parcels.totals.returned_to_office=1;},(r:typeof f.source_snapshot)=>{r.finance.receipt_positions[0]!.receipt_id=sid(99);},(r:typeof f.source_snapshot)=>{r.finance.seller_liability_is_agent_debt=true;}]){const r=structuredClone(f.source_snapshot);change(r);expect(()=>statementEvidence(r)).toThrow();}
  const incoming=structuredClone(f.source_snapshot);incoming.finance.handover_attributions.push({command_id:sid(60),ordinal:1,source_kind:'receipt',source_id:sid(61),origin_location_id:sid(62),component_kind:'cod',component_id:sid(63),receipt_id:sid(61),cod_allocation_id:sid(63),booking_id:null,amount_paise:'1000'} as never);incoming.finance.source_count++;expect(statementEvidence(incoming).finance.handover_attributions[0]?.receipt_id).toBe(sid(61));expect(statementEvidence(incoming).finance.totals.origin_receipt_seller_liability_paise).toBe('200000');
  const agreed=structuredClone(f.source_snapshot);Object.assign(agreed.finance.fee_positions[0]!,{basis:'agreed_period',proof_id:null,parcel_id:null,covered_from:'2026-10-01T00:00:00.000Z',covered_until:'2026-10-31T00:00:00.000Z'});expect(statementEvidence(agreed).finance.fee_positions[0]?.basis).toBe('agreed_period');
  const privateExtra={...f.source_snapshot,private_phone:'PRIVATE',cash:{...f.source_snapshot.cash,receipts:f.source_snapshot.cash.receipts.map(x=>({...x,phone:'PRIVATE',otp:'PRIVATE'}))}};expect(JSON.stringify(statementEvidence(privateExtra))).not.toContain('PRIVATE');
  expect(statementRupees('18014398509481982')).toBe('₹18,01,43,98,50,94,819.82');
  expect(()=>statementDetail({...f.detail,status:'approved',decision:{id:sid(70),submission_id:f.header.id,kind:'approve',expected_version:1,actor_id:f.header.actor_id,reason:'Self approval',recorded_at:statementNow}})).toThrow();
 });
 it('captures first, separately submits exact evidence and recovers a lost submission without a new key',async()=>{
  const {writes}=transport(statementOperator,true),c=controller(statementOperator,'operator');render(<><a href="/business">Leave workspace</a><AgentSettlements controller={c} roles={['operator']}/></>);
  await waitFor(()=>expect(screen.getByRole('option',{name:'Agent '+statementAgent.slice(-8)})).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Agent reference'),{target:{value:statementAgent}});fireEvent.change(screen.getByLabelText('Kolkata statement day'),{target:{value:'2026-10-11'}});fireEvent.change(screen.getByLabelText('Cash count time in Kolkata'),{target:{value:'2026-10-11T11:30:00.150'}});fireEvent.change(screen.getByLabelText('Physical cash counted (₹)'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('Count or correction reason'),{target:{value:'Count reviewed'}});fireEvent.submit(screen.getByRole('form',{name:'Capture daily agent count'}));
  const submit=await screen.findByRole('button',{name:'Submit captured statement'});expect(writes).toHaveLength(1);expect(writes[0]?.body).toMatchObject({agent_id:statementAgent,counted_paise:1000,counted_at:statementNow});
  const evidence=screen.getByRole('region',{name:'Captured statement evidence'});expect(within(evidence).getByText('Remaining origin-receipt seller liability').nextElementSibling).toHaveTextContent('₹2,000.00');expect(within(evidence).getByText('Fees still owed').nextElementSibling).toHaveTextContent('₹40.00');expect(screen.queryByRole('button',{name:'Approve statement'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Capture statement CSV'})).not.toBeInTheDocument();
  fireEvent.click(submit);const retry=await screen.findByRole('button',{name:'Retry same request'});expect(fireEvent.click(screen.getByRole('link',{name:'Leave workspace'}))).toBe(false);expect(screen.getByLabelText('Physical cash counted (₹)')).toBeDisabled();fireEvent.click(retry);await screen.findByText('Statement submitted for a different administrator to review.');
  expect(writes).toHaveLength(3);expect(writes[1]).toEqual(writes[2]);expect(writes[1]?.body).toEqual({capture_id:sid(5),previous_submission_id:null,expected_version:0,reason:'Count reviewed'});
 });
 it('shows immutable sources before different-admin review and records only an explicit decision',async()=>{
  const {writes}=transport(statementAdmin),c=controller(statementAdmin,'franchise_admin');render(<AgentSettlements controller={c} roles={['franchise_admin']}/>);fireEvent.click(await screen.findByRole('button',{name:/revision 1 \u00b7 pending/}));await screen.findByRole('form',{name:'Review agent settlement'});
  expect(screen.getByText('Remaining origin-receipt seller liability')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('Independent review reason'),{target:{value:'Independent sources checked'}});fireEvent.click(screen.getByRole('button',{name:'Approve statement'}));await screen.findByText('Statement review recorded. Cash handover and fee payment remain separate.');
  expect(writes).toHaveLength(1);expect(writes[0]?.path).toBe('/api/v1/agent-settlements/submissions/'+sid(6)+'/decisions');expect(writes[0]?.body).toEqual({kind:'approve',expected_version:1,reason:'Independent sources checked'});
 });
 it('preserves departed-agent correction identity and clears private evidence on scope loss',async()=>{
  const {writes}=transport(statementAdmin,false,false),c=controller(statementAdmin,'franchise_admin');render(<AgentSettlements controller={c} roles={['franchise_admin']}/>);fireEvent.click(await screen.findByRole('button',{name:/revision 1 \u00b7 pending/}));fireEvent.click(await screen.findByRole('button',{name:'Prepare linked correction'}));expect(screen.getByRole('option',{name:'Historical agent '+statementAgent.slice(-8)})).toBeInTheDocument();expect(screen.getByLabelText('Agent reference')).toBeDisabled();expect(screen.getByLabelText('Kolkata statement day')).toBeDisabled();expect(screen.getByLabelText('Agent reference')).toHaveValue(statementAgent);
  act(()=>c.clear());await screen.findByText('Settlement access unavailable');expect(screen.queryByText('Seller COD collected')).not.toBeInTheDocument();expect(writes).toHaveLength(0);
 });
 it('keeps accountant evidence read-only and prevents a submitting administrator from approving their revision',async()=>{
  transport(statementAdmin);const c=controller(statementAdmin,'accountant');const view=render(<AgentSettlements controller={c} roles={['accountant']}/>);fireEvent.click(await screen.findByRole('button',{name:/revision 1 \u00b7 pending/}));await screen.findByText('Cash count and carry');expect(screen.queryByRole('form',{name:'Capture daily agent count'})).not.toBeInTheDocument();expect(screen.queryByRole('form',{name:'Review agent settlement'})).not.toBeInTheDocument();view.unmount();
  const f=statementFixture();vi.stubGlobal('fetch',vi.fn(async(path:string)=>new URL(path,'https://example.test').pathname.endsWith('/eligible-agents')?json({agents:[{id:statementAgent}],next_cursor:null}):new URL(path,'https://example.test').pathname.endsWith('/submissions')?json({items:[{...f.header,actor_id:statementAdmin,status:'pending'}],as_of:statementNow,next_cursor:null}):json({...f.detail,actor_id:statementAdmin})));
  const admin=controller(statementAdmin,'franchise_admin');render(<AgentSettlements controller={admin} roles={['franchise_admin']}/>);fireEvent.click(await screen.findByRole('button',{name:/revision 1 \u00b7 pending/}));await screen.findByText(/You submitted this revision/);expect(screen.queryByRole('button',{name:'Approve statement'})).not.toBeInTheDocument();
 });
});

it('captures and downloads a fixed accountant statement export, retaining the exact uncertain request and clearing it on scope loss',async()=>{
 const f=statementFixture(),snapshot={id:sid(80),definition:'agent_statement_v1',schema_version:1,organization_id:statementOrg,franchise_id:statementFr,timezone:'Asia/Kolkata',currency:'INR',as_of:statementNow,expires_at:'2026-10-12T06:00:00.150Z',count:125,source_count:125,statement_id:f.header.id,agent_id:statementAgent,day:'2026-10-11',revision:1,status:'pending',counted_at:statementNow,source_as_of:statementNow},csv=statementExportColumns.map(c=>'"'+c+'"').join(',')+'\r\n"immutable captured source"\r\n',writes:unknown[]=[];let lose=true;
 const create=vi.fn((blob:Blob)=>{expect(blob.type).toBe('text/csv;charset=utf-8');return 'blob:synthetic-statement';}),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static override createObjectURL=create;static override revokeObjectURL=revoke;});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{const u=new URL(path,'https://example.test');if(u.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});if(u.pathname.endsWith('/exports')){writes.push({path,body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});if(lose){lose=false;throw new TypeError('Synthetic lost export response');}return json(snapshot);}if(u.pathname.endsWith('/download'))return json({snapshot,columns:statementExportColumns,csv});if(u.pathname.endsWith('/submissions'))return json({items:[{...f.header,status:'pending'}],as_of:statementNow,next_cursor:null});return json(f.detail);}));
 const c=controller(statementAdmin,'accountant');render(<AgentSettlements controller={c} roles={['accountant']}/>);fireEvent.click(await screen.findByRole('button',{name:/revision 1 \u00b7 pending/}));fireEvent.click(await screen.findByRole('button',{name:'Capture statement CSV'}));fireEvent.click(await screen.findByRole('button',{name:'Retry same request'}));await screen.findByRole('heading',{name:'Captured statement CSV'});expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);expect(screen.getByText(/125 source rows plus four summaries/)).toBeInTheDocument();expect(screen.queryByRole('form',{name:'Capture daily agent count'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Download captured statement CSV'}));await screen.findByText('Captured statement CSV ready. Check your downloads.');expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
 act(()=>c.clear());await screen.findByText('Settlement access unavailable');expect(screen.queryByText(snapshot.id)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Download captured statement CSV'})).not.toBeInTheDocument();
});
