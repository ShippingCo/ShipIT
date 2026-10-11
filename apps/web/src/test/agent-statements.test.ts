import {statementExportColumns} from '@shippingco/shared';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {agentStatements} from '../data-access/agent-statements';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now='2026-10-11T06:00:00.150Z',org=id(1),fr=id(2),user=id(3),agent=id(4),capture=id(5),submission=id(6);
const header={id:submission,capture_id:capture,agent_id:agent,day:'2026-10-11',revision:1,previous_submission_id:null,actor_id:user,reason:'Count reviewed',recorded_at:now};
const decision={id:id(7),submission_id:submission,kind:'approve',expected_version:1,actor_id:user,reason:'Sources checked',recorded_at:now};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function setup(){const c=createScopeController();c.runtime.bind({userId:user,organizationId:org,franchiseId:fr,permissions:'franchise_admin'});return {c,source:agentStatements(scopedApi(c))};}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('private immutable agent statement metadata transport',()=>{
 it('projects paged private headers and rejects impossible cutoffs, duplicate IDs and broken revision links',async()=>{
  const {source}=setup();let response:unknown={items:[{...header,status:'pending',customer_phone:'PRIVATE',source_snapshot:{secret:'PRIVATE'}}],as_of:now,next_cursor:'opaque_cursor'};
  const paths:string[]=[];const fetcher=vi.fn(async(path:string)=>{paths.push(path);return json(response);});vi.stubGlobal('fetch',fetcher);
  const page=await source.list('opaque_cursor');expect(page.items).toEqual([{...header,status:'pending'}]);
  const url=new URL(paths[0]!,'https://example.test');expect(url.searchParams.get('organization_id')).toBe(org);expect(url.searchParams.get('franchise_id')).toBe(fr);expect(url.searchParams.get('cursor')).toBe('opaque_cursor');
  for(const items of [[{...header,status:'pending',recorded_at:'2026-10-11T06:00:01.000Z'}],[{...header,status:'pending'},{...header,status:'pending'}],[{...header,status:'pending',revision:2}],[{...header,status:'pending',day:'2026-02-31'}]]){
   response={items,as_of:now,next_cursor:null};await expect(source.list()).rejects.toMatchObject({code:'TEMPORARILY_UNAVAILABLE',kind:'protocol'});
  }
 });
 it('retains exact immutable intent and key after a lost response and refuses a new derived revision or actor',async()=>{
  const {c,source}=setup(),writes:{path:string;body:unknown;key:string}[]=[];let lose=true,response:unknown=header;
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
   if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
   writes.push({path,body:JSON.parse(String(options.body)),key:(options.headers as Record<string,string>)['Idempotency-Key']});
   if(lose){lose=false;throw new TypeError('Synthetic lost committed response');}return json(response);
  }));
  const input={capture_id:capture,previous_submission_id:null,expected_version:0,reason:' Count reviewed '},intent=source.submit(input);input.reason='Changed form';
  await expect(source.executeSubmission(intent)).rejects.toMatchObject({dispatched:true});expect(await source.executeSubmission(intent)).toEqual(header);
  expect(writes[0]).toEqual(writes[1]);expect(writes[1]?.body).toEqual({capture_id:capture,previous_submission_id:null,expected_version:0,reason:'Count reviewed'});
  for(const invalid of [{...header,revision:2,previous_submission_id:id(10)},{...header,actor_id:id(11)},{...header,capture_id:id(12)}]){response=invalid;await expect(source.executeSubmission(intent)).rejects.toMatchObject({kind:'protocol'});}
  const count=writes.length;c.clear();await expect(source.executeSubmission(intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(writes).toHaveLength(count);
  expect(()=>source.submit({...input,previous_submission_id:id(13)})).toThrow();
 });
 it('binds review outcome to the exact selected submission, reviewer, version and saved reason',async()=>{
  const {source}=setup();let response:unknown=decision;vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?json({csrf_token:'synthetic_csrf'}):json(response)));
  const intent=source.decide(submission,{kind:'approve',expected_version:1,reason:'Sources checked'});expect(await source.executeDecision(intent)).toEqual(decision);
  for(const invalid of [{...decision,submission_id:id(9)},{...decision,actor_id:id(10)},{...decision,expected_version:2},{...decision,kind:'reject'},{...decision,reason:'Unrelated approval'}]){response=invalid;await expect(source.executeDecision(intent)).rejects.toMatchObject({kind:'protocol'});}
  expect(()=>source.decide(submission,{kind:'approve',expected_version:0,reason:'Sources checked'})).toThrow();
 });
});

const exportMetadata={id:id(80),definition:'agent_statement_v1',schema_version:1,organization_id:org,franchise_id:fr,timezone:'Asia/Kolkata',currency:'INR',as_of:now,expires_at:'2026-10-12T06:00:00.150Z',count:125,source_count:125,statement_id:submission,agent_id:agent,day:'2026-10-11',revision:1,status:'pending',counted_at:now,source_as_of:now};
it('recovers captured export with the exact original key and projects only owned immutable metadata',async()=>{
 const {c,source}=setup(),writes:unknown[]=[];let lose=true,response:unknown={...exportMetadata,summaries:[{phone:'PRIVATE'}],private_contact:'PRIVATE'};
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});writes.push({path,body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});if(lose){lose=false;throw new TypeError('Synthetic lost capture response');}return json(response);}));
 const intent=source.captureExport(submission);await expect(source.executeExport(intent)).rejects.toMatchObject({dispatched:true});expect(await source.executeExport(intent)).toEqual(exportMetadata);expect(writes[0]).toEqual(writes[1]);
 for(const invalid of [{...exportMetadata,statement_id:id(81)},{...exportMetadata,organization_id:id(82)},{...exportMetadata,franchise_id:id(83)},{...exportMetadata,count:5001,source_count:5001},{...exportMetadata,expires_at:now},{...exportMetadata,source_as_of:'2026-10-11T06:00:01.150Z'}]){response=invalid;await expect(source.executeExport(intent)).rejects.toMatchObject({kind:'protocol'});}
 c.clear();await expect(source.executeExport(intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
});
it('downloads the captured CSV schema and refuses mismatched private scope, columns and byte bounds',async()=>{
 const {source}=setup(),csv=statementExportColumns.map(c=>'"'+c+'"').join(',')+'\r\n"synthetic immutable row"\r\n';let response:unknown={snapshot:exportMetadata,columns:statementExportColumns,csv};
 vi.stubGlobal('fetch',vi.fn(async()=>json(response)));expect((await source.downloadExport(exportMetadata.id)).csv).toBe(csv);
 for(const invalid of [{snapshot:{...exportMetadata,id:id(84)},columns:statementExportColumns,csv},{snapshot:exportMetadata,columns:[...statementExportColumns,'private_phone'],csv},{snapshot:exportMetadata,columns:statementExportColumns,csv:csv.replace('snapshot_id','private_phone')},{snapshot:exportMetadata,columns:statementExportColumns,csv:csv+'x'.repeat(8*1024*1024)}]){response=invalid;await expect(source.downloadExport(exportMetadata.id)).rejects.toMatchObject({kind:'protocol'});}
 response={error:{code:'RESOURCE_NOT_FOUND'}};vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(response),{status:404,headers:{'Content-Type':'application/json'}})));await expect(source.downloadExport(exportMetadata.id)).rejects.toMatchObject({code:'RESOURCE_NOT_FOUND'});
});
