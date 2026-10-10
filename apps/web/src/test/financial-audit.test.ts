import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {FinancialAuditView} from '../operations/FinancialAudit';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {createScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {financialAudit} from '../data-access/financial-audit';
import type {FinancialAuditPage} from '@shippingco/shared';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),user=id(3),snapshotId=id(4),requestId=id(5);
const page:FinancialAuditPage={snapshot:{id:snapshotId,schema_version:1,definition:'financial_audit_v1',organization_id:org,franchise_id:franchise,timezone:'Asia/Kolkata',as_of:'2026-10-01T12:00:00.000Z',expires_at:'2026-10-02T12:00:00.000Z',filter:{from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_desc',kind:null,status:null,actor_id:null,booking_id:null},count:1,counts:{discount:1}},rows:[{id:'request:'+requestId,kind:'discount',change_kind:'discount',status:'pending',source_type:'financial_request',source_id:requestId,booking_id:id(6),receipt_id:null,actor_id:user,recorded_at:'2026-10-01T11:00:00.000Z',reason:'customer_agreement',version:0,correction_of:null,policy_id:null,approval_threshold_paise:null,additional_review_required:null,approval_basis:'unconfigured_policy',approved_actor_id:null,amount_basis:'charge_gross',before_paise:'50000',proposed_paise:'49900',decisions:[],document_links:[]}],next_offset:null};
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(response:unknown=page){
 const controller=createScopeController();controller.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:'franchise_admin'});
 const fetcher=vi.fn<(path:string,options?:RequestInit)=>Promise<Response>>(async path=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});return json(response);});vi.stubGlobal('fetch',fetcher);
 return {controller,source:financialAudit(scopedApi(controller)),fetcher};
}
describe('financial audit production adapter',()=>{
 it('preserves exact uncertain capture intent and stops replay after scope changes',async()=>{
  const {source,controller,fetcher}=setup(),filter=structuredClone(page.snapshot.filter),intent=source.intent(filter);filter.kind='refund';
  let failed=false;const sends:{path:string;body:unknown;key:unknown}[]=[];
  fetcher.mockImplementation(async(path,options={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});sends.push({path,body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});if(!failed){failed=true;throw new TypeError('Synthetic uncertain transport');}return json(page);});
  await expect(source.execute(intent)).rejects.toMatchObject({kind:'network',dispatched:true});expect(await source.execute(intent)).toEqual(page);
  expect(sends).toHaveLength(2);expect(sends[0]).toEqual(sends[1]);expect(JSON.parse(String(sends[0]!.body)).kind).toBeNull();expect(sends[0]!.path).toContain('organization_id='+org);expect(sends[0]!.path).toContain('franchise_id='+franchise);
  controller.runtime.invalidate();controller.runtime.bind({userId:user,organizationId:org,franchiseId:id(20),permissions:'franchise_admin'});
  await expect(source.execute(intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(sends).toHaveLength(2);
 });
 it('projects only safe fields and rejects foreign scope, false control counts and broken source lineage',async()=>{
  const extra={...page,private_bank_reference:'DO_NOT_RENDER',rows:[{...page.rows[0],beneficiary:'DO_NOT_RENDER',fingerprint:'DO_NOT_RENDER'}]};
  const safe=setup(extra);expect(await safe.source.page(snapshotId)).toEqual(page);
  const invalids=[{...page,snapshot:{...page.snapshot,franchise_id:id(9)}},{...page,snapshot:{...page.snapshot,count:2}},{...page,rows:[{...page.rows[0],source_id:id(10)}]},{...page,rows:[{...page.rows[0],before_paise:'-1'}]},{...page,rows:[{...page.rows[0],document_links:[{kind:'issued_receipt',receipt_id:null,external_ref:null,qualification:'issued_source'}]}]}];
  for(const invalid of invalids){const {source}=setup(invalid);await expect(source.page(snapshotId)).rejects.toMatchObject({kind:'protocol'});}
 });
 it('binds saved detail and export to the requested snapshot and source row',async()=>{
  const {source,fetcher}=setup();fetcher.mockImplementation(async path=>path.includes('/rows/')?json({snapshot:page.snapshot,row:page.rows[0]}):json({snapshot:page.snapshot,columns:['source_id'],csv:'"source_id"\r\n"'+requestId+'"\r\n'}));
  expect((await source.detail(snapshotId,page.rows[0]!.id)).row).toEqual(page.rows[0]);expect(fetcher.mock.calls[0]![0]).toContain('/rows/request%3A'+requestId);
  expect((await source.export(snapshotId)).snapshot.id).toBe(snapshotId);
  fetcher.mockImplementation(async()=>json({snapshot:{...page.snapshot,id:id(11)},row:page.rows[0]}));await expect(source.detail(snapshotId,page.rows[0]!.id)).rejects.toMatchObject({kind:'protocol'});
 });
});

describe('production financial audit screen',()=>{
 it('retains capture uncertainty and uses the saved snapshot for focused detail and matching CSV',async()=>{
  const {source,fetcher}=setup(),openRequest=vi.fn(),writes:{body:unknown;key:unknown}[]=[],create=vi.fn(()=> 'blob:synthetic-audit'),revoke=vi.fn();let lost=false;
  const NativeURL=URL;vi.stubGlobal('URL',class extends NativeURL {static override createObjectURL=create;static override revokeObjectURL=revoke;});
  fetcher.mockImplementation(async(path,options={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
   if(options.method==='POST'){writes.push({body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});if(!lost){lost=true;throw new TypeError('Synthetic lost capture response');}return json(page);}
   if(path.includes('/rows/'))return json({snapshot:page.snapshot,row:page.rows[0]});if(path.includes('/export'))return json({snapshot:page.snapshot,columns:['source_id'],csv:'source_id\r\n'+requestId+'\r\n'});return json(page);
  });
  render(React.createElement(MemoryRouter,null,React.createElement(FinancialAuditView,{source,canExport:true,openRequest})));
  fireEvent.change(screen.getByLabelText('From recorded day'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('Through recorded day'),{target:{value:'2026-10-01'}});fireEvent.submit(screen.getByRole('form',{name:'Financial audit filters'}));await screen.findByText(/The outcome is uncertain/);expect(screen.getByLabelText('From recorded day')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByRole('heading',{name:'1 captured actions'});expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  const detailButton=screen.getByRole('button',{name:'View discount evidence '+requestId.slice(-8)});detailButton.focus();fireEvent.click(detailButton);const heading=await screen.findByRole('heading',{name:'Captured discount evidence'});await waitFor(()=>expect(heading).toHaveFocus());expect(screen.getByText('Unknown or not configured')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Open live financial request'}));expect(openRequest).toHaveBeenCalledWith(requestId);fireEvent.click(screen.getByRole('button',{name:'Close captured evidence'}));expect(detailButton).toHaveFocus();
  const downloads:{href:string;name:string}[]=[];vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){downloads.push({href:this.href,name:this.download});});
  fireEvent.click(screen.getByRole('button',{name:'Download matching financial CSV'}));await screen.findByText('Matching audit CSV ready. Check your downloads.');expect(create).toHaveBeenCalledOnce();expect(downloads).toEqual([{href:'blob:synthetic-audit',name:'financial-audit-'+snapshotId+'.csv'}]);expect(fetcher.mock.calls.some(([path])=>path.includes('/audit/'+snapshotId+'/export'))).toBe(true);
  expect(screen.getByText('Discount · pending')).toBeVisible();
 });
 it('refuses a capture response for filters other than the retained command',async()=>{
  const {source}=setup(),intent=source.intent({...page.snapshot.filter,kind:'refund'});await expect(source.execute(intent)).rejects.toMatchObject({kind:'protocol'});
 });
});
