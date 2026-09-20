import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eventEnvelope,registry,disposition,retryDelay } from '../../src/modules/outbox/rules.ts';
import { redriveInput,selection } from '../../src/modules/outbox/service.ts';
import { issueTenantAccess,scopedQuery } from '../../src/modules/security/scope.ts';
import type { Job,Consumer } from '../../src/modules/outbox/types.ts';
import { runOutboxLoop } from '../../src/outbox-runtime.ts';
import type { DatabasePool } from '@shippingco/db';

const job:Job={id:randomUUID(),organization_id:randomUUID(),franchise_id:randomUUID(),event_id:randomUUID(),consumer_id:'synthetic',
  state:'leased',version:2,attempts:1,cycle_attempts:1,available_at:new Date(),created_at:new Date(),lease_token:randomUUID(),lease_until:new Date(),reason_code:null};
const event={event_id:job.event_id,organization_id:job.organization_id,franchise_id:job.franchise_id,event_type:'booking.created',schema_version:1,
  aggregate_type:'booking',aggregate_id:randomUUID(),aggregate_version:1,occurred_at:'2026-09-20T00:00:00Z',actor:{type:'user',id:randomUUID()},
  correlation_id:randomUUID(),causation_id:randomUUID(),command_id:randomUUID(),payload:{parcel_set_ref:randomUUID()}};
const consumer:Consumer={id:'synthetic',subscriptions:{'booking.created':[1]},ordering:'H',validate:()=>true,apply:async()=>{}};
describe('outbox closed contracts',()=>{
  it('binds every envelope to trusted persisted ownership and event identity',()=>{
    expect(eventEnvelope(event,job)).toEqual(event);
    for(const patch of [{organization_id:randomUUID()},{franchise_id:randomUUID()},{event_id:randomUUID()},
      {aggregate_version:0},{aggregate_version:1.1},{schema_version:0},{aggregate_type:'invented'},
      {occurred_at:'tomorrow'},{payload:null},{actor:{type:'user',id:'secret@example.test'}},{raw:'secret'}]) {
      expect(eventEnvelope({...event,...patch},job)).toBeNull();
    }
    expect(eventEnvelope({...event,schema_version:99},job)?.schema_version).toBe(99);
  });
  it('bounds and freezes code registration without accepting duplicate consumer identities',()=>{
    expect(Object.isFrozen(registry([consumer])[0]!.subscriptions)).toBe(true);
    for(const input of [[consumer,consumer],[{...consumer,id:'../untrusted'}],[{...consumer,subscriptions:{}}],
      [{...consumer,subscriptions:{'booking.created':[0]}}],Array.from({length:33},(_,n)=>({...consumer,id:'consumer'+n}))]) {
      expect(()=>registry(input)).toThrow('OUTBOX_REGISTRY_INVALID');
    }
  });
  it('keeps stale side effects distinct from history and uses bounded retry jitter',()=>{
    expect(disposition('M',6,7)).toBe('skipped_stale');expect(disposition('P',6,7)).toBe('skipped_stale');
    expect(disposition('H',6,7)).toBe('historical');expect(disposition('R',6,7)).toBe('historical');
    expect(disposition('H',8,7)).toBe('applied');
    for(const n of [0,1,5,100])for(const random of [0,0.5,1])expect(retryDelay(n,()=>random)).toBeGreaterThanOrEqual(1000);
    expect(retryDelay(100,()=>1)).toBe(30000);
  });
  it('rejects arbitrary redrive reasons, ownership overrides and unbounded operational queries',()=>{
    expect(redriveInput({expected_version:3,reason_code:'consumer_upgraded'})).toEqual({version:3,reason:'consumer_upgraded'});
    for(const b of [{},{expected_version:0,reason_code:'consumer_upgraded'},{expected_version:3,reason_code:'free text'},
      {expected_version:3,reason_code:'consumer_upgraded',event_id:randomUUID()}])expect(()=>redriveInput(b)).toThrow();
    const q={organization_id:job.organization_id,franchise_id:job.franchise_id};
    expect(selection(q).limit).toBe(50);
    for(const patch of [{limit:'101'},{limit:'0'},{limit:1},{cursor:''},{tenant:randomUUID()}])expect(()=>selection({...q,...patch},true)).toThrow();
  });
  it('cannot forge or widen worker capabilities and read scopes cannot call mutation functions',()=>{
    const executor={query:async()=>{throw new Error('MUST_NOT_QUERY');}};
    const base={action:'outbox.work' as const,actor:{type:'service' as const,id:'outbox-worker'},organizationId:job.organization_id,
      permittedFranchiseIds:[job.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event' as const};
    for(const patch of [{actor:{type:'service' as const,id:'unregistered'}},{organizationWide:true},{permittedFranchiseIds:[]},
      {provenance:'membership' as const},{action:'bookings.create' as const}])expect(()=>issueTenantAccess(executor,{...base,...patch},false)).toThrow();
    const read=issueTenantAccess(executor,{...base,action:'outbox.read',actor:{type:'user',id:randomUUID()},provenance:'membership'},false);
    expect(()=>scopedQuery(read,['outbox.read'],'SELECT shipit.outbox_redrive($1) WHERE {{franchise:$2:$3}}',[])).toThrow();
    expect(()=>scopedQuery({} as never,['outbox.work'],'SELECT 1 WHERE {{organization:$1}}',[])).toThrow();
  });
  it('stops the idle worker without waiting for a polling interval or connecting to providers',async()=>{
    const controller=new AbortController(),messages:unknown[]=[];
    const done=runOutboxLoop({} as DatabasePool,[],controller.signal,{emit:(...args)=>messages.push(args)});
    controller.abort();await done;expect(messages).toEqual([]);
  });
});
