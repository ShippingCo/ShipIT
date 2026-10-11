import {afterEach,describe,it,expect,vi} from 'vitest';
import {custody,custodyManifest,custodyReport,custodySnapshot,custodyWorklist} from '../data-access/custody';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const time='2026-10-11T00:00:00.000Z';
const held={item_id:id(1),parcel_id:id(2),outcome:'held',origin_receipt_id:id(3),current_receipt_id:id(3),proof_id:null,failure_ids:[]};
const report=()=>({manifest_id:id(4),agent_id:id(5),as_of:time,totals:{total:1,delivered:0,returned:0,held:1,reassigned:0,pending:0,failed:0},failure_count:0,items:[held]});
describe('custody source validation before UI state',()=>{
 it('projects only source fields and rejects invented proof, wrong control totals and missing custody',()=>{
  const source=report();expect(custodyReport({...source,phone:'SYN_PRIVATE',items:[{...held,otp:'SYN_PRIVATE'}]})).toEqual(source);
  for(const bad of [{...source,totals:{...source.totals,delivered:1}},{...source,items:[{...held,outcome:'delivered'}]},
   {...source,items:[{...held,current_receipt_id:null}]},{...source,failure_count:1},
   {...source,items:[{...held,outcome:'pending'}]}])expect(()=>custodyReport(bad)).toThrow();
 });
 it('rejects duplicate parcels and reused delivery or failure evidence across a full cohort',()=>{
  const delivered={...held,outcome:'delivered',proof_id:id(6)},totals={...report().totals,total:2,held:0,delivered:2};
  expect(()=>custodyReport({...report(),totals,items:[delivered,{...delivered,item_id:id(7)}]})).toThrow();
  expect(()=>custodyReport({...report(),totals,items:[delivered,{...delivered,item_id:id(7),parcel_id:id(8),origin_receipt_id:id(9),current_receipt_id:id(10)}]})).toThrow();
  expect(()=>custodyReport({...report(),totals:{...report().totals,total:2,held:2,failed:2},failure_count:1,
   items:[{...held,failure_ids:[id(11)]},{...held,item_id:id(7),parcel_id:id(8),origin_receipt_id:id(9),current_receipt_id:id(10),failure_ids:[id(11)]}]})).toThrow();
 });
 it('requires immutable snapshot count, same cutoff and exact expiry while dropping unknown private fields',()=>{
  const r=report(),{items,...summary}=r,s={id:id(12),definition:'custody_manifest_v1',organization_id:id(13),franchise_id:id(14),as_of:time,expires_at:'2026-10-12T00:00:00.000Z',count:1,report:summary,items};
  expect(custodySnapshot({...s,raw_customer:'SYN_PRIVATE'})).toEqual(s);
  for(const bad of [{...s,count:2},{...s,as_of:'2026-10-11T00:00:01.000Z'},{...s,expires_at:time},{...s,definition:'booking_cohort_v1'}])
   expect(()=>custodySnapshot(bad)).toThrow();
 });
 it('does not accept partial acknowledgement or a proof masquerading as unknown physical custody',()=>{
  const m={id:id(4),agent_id:id(5),recorded_at:time,state:'acknowledged',version:2,items:[{id:id(1),parcel_id:id(2),expected_parcel_version:5,previous_receipt_id:null,receipt_id:null}]};
  expect(()=>custodyManifest(m)).toThrow();expect(custodyManifest({...m,state:'prepared',version:1})).toMatchObject({state:'prepared'});
  const w={as_of:time,next_cursor:null,items:[{parcel_id:id(2),docket:'SYN-1',parcel_version:5,status:'out_for_delivery',assigned_agent_id:id(5),attempt_id:id(15),receipt_id:null,physical_custody:'unknown',proof_id:null}]};
  expect(custodyWorklist(w)).toEqual(w);expect(()=>custodyWorklist({...w,items:[{...w.items[0],proof_id:id(6)}]})).toThrow();
  expect(()=>custodyWorklist({...w,next_cursor:id(2)})).toThrow();
 });
});

afterEach(()=>vi.unstubAllGlobals());
describe('custody request and scope binding',()=>{
 const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 function source(){const controller=createScopeController();controller.runtime.bind({userId:id(20),organizationId:id(13),franchiseId:id(14),permissions:'franchise_admin'});return {controller,source:custody(scopedApi(controller))};}
 function snapshot(){const {items,...summary}=report();return {id:id(12),definition:'custody_manifest_v1',organization_id:id(13),franchise_id:id(14),as_of:time,expires_at:'2026-10-12T00:00:00.000Z',count:1,report:summary,items};}
 it('rejects mismatched capture manifest, export identity and sibling snapshot before display',async()=>{
  let response:unknown=snapshot();vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?json({csrf_token:'synthetic_csrf'}):json(response)));
  const {source:api}=source();await expect(api.executeCapture(api.capture(id(4)))).resolves.toMatchObject({id:id(12)});
  response={...snapshot(),report:{...snapshot().report,manifest_id:id(40)}};await expect(api.executeCapture(api.capture(id(4)))).rejects.toMatchObject({kind:'protocol'});
  response={...snapshot(),franchise_id:id(30)};await expect(api.snapshot(id(12))).rejects.toMatchObject({kind:'protocol'});
  response={snapshot:{...snapshot(),id:id(40)},csv:'synthetic csv'};await expect(api.export(id(12))).rejects.toMatchObject({kind:'protocol'});
 });
 it('never confirms another manifest or approval and rejects receipt claims from proposal-only actions',async()=>{
  let response={command_id:id(21),resource_id:id(40),receipt_ids:[id(3)],recorded_at:time};vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?json({csrf_token:'synthetic_csrf'}):json(response)));
  const {source:api}=source();const ack=api.intent({kind:'acknowledge',id:id(4),body:{expected_version:1}});
  await expect(api.execute(ack)).rejects.toMatchObject({kind:'protocol',dispatched:true});response={...response,resource_id:id(4)};await expect(api.execute(ack)).resolves.toMatchObject({resource_id:id(4)});
  response={...response,resource_id:id(40),receipt_ids:[]};await expect(api.execute(api.intent({kind:'cancel',id:id(4),body:{expected_version:1}}))).rejects.toMatchObject({kind:'protocol'});
  await expect(api.execute(api.intent({kind:'revoke_grant',id:id(4),body:{expected_version:1}}))).rejects.toMatchObject({kind:'protocol'});
  response={...response,receipt_ids:[id(3)]};await expect(api.execute(api.intent({kind:'authorize',body:{parcel_id:id(2),agent_id:id(5),expected_parcel_version:5}}))).rejects.toMatchObject({kind:'protocol'});
 });
 it('discards an in-flight captured snapshot and its retry intent when scope changes',async()=>{
  let deliver!:(value:Response)=>void;const pending=new Promise<Response>(resolve=>{deliver=resolve;});let started!:(value:void)=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;});
  const fetch=vi.fn(async(path:string)=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});started();return pending;});vi.stubGlobal('fetch',fetch);
  const {source:api,controller}=source(),intent=api.capture(id(4)),result=api.executeCapture(intent);const rejected=expect(result).rejects.toMatchObject({code:'TEMPORARILY_UNAVAILABLE',kind:'aborted',dispatched:true});await dispatched;
  controller.runtime.bind({userId:id(20),organizationId:id(13),franchiseId:id(30),permissions:'franchise_admin'});deliver(json(snapshot()));await rejected;
  const requests=fetch.mock.calls.length;await expect(api.executeCapture(intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(fetch).toHaveBeenCalledTimes(requests);
 });
});
