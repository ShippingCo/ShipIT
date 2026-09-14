import React from 'react';
import { afterEach,expect,it,vi } from 'vitest';
import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import type { BulkParcelItem,BulkParcelRequest,BulkParcelResult } from '@shippingco/shared';
import { createParcelBulkSource,parcelBulkResult } from '../data-access/parcel-bulk';
import { createParcelBulkController } from '../data-access/parcel-bulk-controller';
import { ApiFailure } from '../data-access/errors';
import { createScopeController } from '../operator/scope';
import { BulkParcelPanel } from '../parcels/BulkParcelPanel';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const items:BulkParcelItem[]=[1,2,3].map(n=>({parcel_id:id(n),idempotency_key:`item-${n}`,command:{expected_version:1,evidence_ref:id(10),location_ref:id(11)}}));
const request:BulkParcelRequest={action:'check_in',items};
const success=(item:BulkParcelItem)=>({parcel_id:item.parcel_id,outcome:'succeeded' as const,result:{id:item.parcel_id,booking_id:id(8),docket:'SYN-1',
  version:item.command.expected_version+1,status:'checked_in' as const,custody:'franchise_office' as const,attempts_started:0,failed_attempt_count:0,event_id:id(9),transitioned_at:'2099-01-01T00:00:00Z'}});
const mixed:BulkParcelResult={action:'check_in',items:[success(items[0]),{parcel_id:id(2),outcome:'failed',error:{code:'VERSION_CONFLICT'}},
  {parcel_id:id(3),outcome:'failed',error:{code:'RESOURCE_NOT_FOUND'}}],summary:{succeeded:1,failed:2}};
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function setup(send:(body:BulkParcelRequest)=>Promise<Response>) {
  const calls:{path:string;options:RequestInit}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit)=>{
    if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
    calls.push({path,options});return send(JSON.parse(String(options.body)) as BulkParcelRequest);
  }));
  const scope=createScopeController();scope.runtime.bind({userId:id(5),organizationId:id(6),franchiseId:id(7),permissions:'operator'});
  const controller=createParcelBulkController(scope);
  return {scope,controller,calls};
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
it('retains only unsuccessful selection, refreshes before retry, sends B/C only and preserves A success',async()=>{
  let count=0;const s=setup(async body=>json(++count===1?mixed:{action:'check_in',items:body.items.map(success),summary:{succeeded:2,failed:0}}));
  s.controller.select(items);await s.controller.submit('check_in');
  expect(s.controller.snapshot().selected.map(item=>item.parcel_id)).toEqual([id(2),id(3)]);
  const refresh=vi.fn(async failed=>failed.map(item=>({...item,command:{...item.command,expected_version:2}})));
  await s.controller.retryFailed(refresh);
  expect(refresh).toHaveBeenCalledTimes(1);const retry=JSON.parse(String(s.calls[1].options.body)) as BulkParcelRequest;
  expect(retry.items.map(item=>item.parcel_id)).toEqual([id(2),id(3)]);expect(retry.items[0].idempotency_key).not.toBe(items[1].idempotency_key);
  expect(s.controller.snapshot().result?.summary).toEqual({succeeded:3,failed:0});expect(s.controller.snapshot().selected).toEqual([]);
});
it('network loss preserves exact immutable body, outer/item keys, versions and acting scope',async()=>{
  let first=true;const s=setup(async()=>{if(first){first=false;throw new TypeError('private network detail');}return json(mixed);});
  const mutable=structuredClone(items);s.controller.select(mutable);await s.controller.submit('check_in');
  expect(s.controller.snapshot().phase).toBe('uncertain');mutable[0].command.expected_version=99;
  s.controller.select([]);await s.controller.retryUncertain();
  expect(s.calls[1]).toEqual(s.calls[0]);expect(s.controller.snapshot().phase).toBe('confirmed');
  expect(JSON.stringify(s.controller.snapshot())).not.toContain('private network detail');
});
it('scope switch aborts/discards late results and purges selection/private results, including repeated scope generations',async()=>{
  let finish!:(r:Response)=>void;const s=setup(()=>new Promise(r=>{finish=r;}));
  s.controller.select(items);const pending=s.controller.submit('check_in');await waitFor(()=>expect(s.calls).toHaveLength(1));
  s.scope.clear();s.scope.runtime.bind({userId:id(5),organizationId:id(6),franchiseId:id(12),permissions:'operator'});
  expect(s.calls[0].options.signal?.aborted).toBe(true);finish(json(mixed));await pending;
  expect(s.controller.snapshot()).toMatchObject({phase:'idle',result:null,selected:[]});
  s.controller.select(items);s.scope.clear();expect(s.controller.snapshot().selected).toEqual([]);
});
it('keyboard-reachable selection/action/retry, disabled pending state and live textual partial results',async()=>{
  let finish!:(r:Response)=>void;const s=setup(()=>new Promise(r=>{finish=r;}));
  const refresh=vi.fn(async failed=>failed);
  render(<BulkParcelPanel controller={s.controller} action="check_in" candidates={items.map((item,i)=>({label:`Parcel ${i+1}`,item}))} refreshFailed={refresh}/>);
  const boxes=screen.getAllByRole('checkbox');
  for(const box of boxes){box.focus();expect(document.activeElement).toBe(box);fireEvent.click(box);}
  const action=screen.getByRole('button',{name:'Check in at hub'});action.focus();fireEvent.click(action);
  await waitFor(()=>expect(action).toBeDisabled());expect(boxes[0]).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('Processing');
  await act(async()=>{finish(json(mixed));});
  expect(document.activeElement).toBe(screen.getByRole('status'));
  expect(screen.getByRole('status')).toHaveTextContent('2 selected · 1 completed · 2 need attention');
  expect(boxes[0]).not.toBeChecked();expect(boxes[1]).toBeChecked();expect(screen.getByText('Version changed. Refresh before retry.')).toBeVisible();
  const retry=screen.getByRole('button',{name:'Retry failed'});retry.focus();expect(document.activeElement).toBe(retry);expect(retry).toBeEnabled();
  fireEvent.click(retry);await waitFor(()=>expect(s.calls).toHaveLength(2));
  expect((JSON.parse(String(s.calls[1].options.body)) as BulkParcelRequest).items.map(item=>item.parcel_id)).toEqual([id(2),id(3)]);
  await act(async()=>{finish(json({action:'check_in',items:mixed.items.slice(1),summary:{succeeded:0,failed:2}}));});
});
it('malformed/partial/foreign success DTO cannot fabricate completion or expose extra fields',()=>{
  for(const value of [{...mixed,items:mixed.items.slice(1)},{...mixed,summary:{succeeded:3,failed:0}},
    {...mixed,items:[success({...items[0],parcel_id:id(99)}),...mixed.items.slice(1)]},
    {...mixed,items:[{...mixed.items[0],result:{...success(items[0]).result,version:999}},...mixed.items.slice(1)]}])expect(()=>parcelBulkResult(value,request)).toThrow();
  const extra={...mixed,items:[{...mixed.items[0],result:{...success(items[0]).result,secret:'private'}},...mixed.items.slice(1)]};
  expect(JSON.stringify(parcelBulkResult(extra,request))).not.toContain('private');
});
it('refresher cannot reinsert successful A and unavailable failures remain represented when omitted',async()=>{
  let count=0;const s=setup(async body=>json(++count===1?mixed:{action:'check_in',items:body.items.map(success),summary:{succeeded:1,failed:0}}));
  s.controller.select(items);await s.controller.submit('check_in');
  await s.controller.retryFailed(async()=>items);expect(s.calls).toHaveLength(1);expect(s.controller.snapshot().error?.code).toBe('VALIDATION_FAILED');
  await s.controller.retryFailed(async failed=>[{...failed[0],command:{...failed[0].command,expected_version:2}}]);
  expect(s.controller.snapshot().selected.map(item=>item.parcel_id)).toEqual([id(3)]);
  expect(s.controller.snapshot().result?.summary).toEqual({succeeded:2,failed:1});
});
it('refresh authentication denial purges the prior private selection and result',async()=>{
  const s=setup(async()=>json(mixed));s.controller.select(items);await s.controller.submit('check_in');
  await s.controller.retryFailed(async()=>{throw new ApiFailure('UNAUTHENTICATED',{status:401});});
  expect(s.controller.snapshot()).toMatchObject({phase:'idle',selected:[],result:null});
});
it('explicit demo composition refuses the production bulk adapter without contacting any endpoint',async()=>{
  vi.resetModules();vi.stubEnv('VITE_DATA_MODE','demo');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const {createParcelBulkSource:demoSource}=await import('../data-access/parcel-bulk');
  const scope=createScopeController();scope.runtime.bind({userId:id(5),organizationId:id(6),franchiseId:id(7),permissions:'operator'});
  expect(()=>demoSource().intent(request,scope.runtime.ticket())).toThrow('ACTION_FORBIDDEN');expect(fetcher).not.toHaveBeenCalled();
});
it('same outer adapter intent is a frozen snapshot and 503 retains command identity',async()=>{
  const s=setup(async()=>new Response('{}',{status:503})),source=createParcelBulkSource(),input=structuredClone(request);
  const intent=source.intent(input,s.scope.runtime.ticket());input.items[0].command.expected_version=9;
  await expect(source.execute(intent,s.scope.runtime.ticket)).rejects.toMatchObject({dispatched:true,status:503});
  expect(JSON.parse(intent.bodyJson).items[0].command.expected_version).toBe(1);
});
