import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as v from '../../src/modules/carriers/validation.ts';
import { manualAdapter,manualCapabilities } from '../../src/modules/carriers/manual.ts';
import { installation,context,observation } from '../carrier-fixtures.ts';
describe('manual carrier boundary',()=>{
  it.each(['','X\n','https://secret.test','x?token=1','a@b.test','x'.repeat(129),'a b',null,42])('rejects unsafe code %j',value=>expect(()=>v.code(value)).toThrow());
  it('preserves exact codes, explicit unknown time and rejects caller authority',()=>{
    expect(v.code('a/B.01')).toBe('a/B.01');
    const body={reference_id:randomUUID(),expected_parcel_version:1,status_code:'UNKNOWN',status:null,occurred_at:{state:'unknown',reason:'missing'}};
    expect(v.observation(body).occurred_at).toEqual({state:'unknown',reason:'missing'});
    for(const key of ['actor_id','organization_id','received_at','delivered','paid','provenance'])expect(()=>v.observation({...body,[key]:'x'})).toThrow();
    for(const status of ['delivered','paid',{},undefined])expect(()=>v.observation({...body,status})).toThrow();
    expect(()=>v.observation({...body,occurred_at:{state:'known',at:'2026-02-30T00:00:00Z'}})).toThrow();
    expect(v.observation({...body,occurred_at:{state:'known',at:'2026-10-03T05:30:00+05:30'}}).occurred_at).toEqual({state:'known',at:'2026-10-03T00:00:00Z'});
  });
  it('manual adapter declares no network capabilities and cannot book or price',async()=>{
    const manifest={...installation(['manual_observations']),capabilities:manualCapabilities('reviewed-manual',context.deadlineAt)};
    const adapter=manualAdapter(manifest);
    expect(Object.entries(manifest.capabilities).filter(([,v])=>v.enabled).map(([k])=>k)).toEqual(['manual_observations']);
    expect(await adapter.health()).toEqual({state:'not_applicable',mode:'manual'});
    expect(await adapter.submitBooking(context,{bookingSnapshotId:'snapshot',dimensions:observation('manual').dimensions})).toEqual({ok:false,error:{kind:'unsupported',capability:'booking_api'}});
    expect(await adapter.rates(context,{purpose:'customer_selling',source:{mode:'file',privateImportId:'x'}})).toEqual({ok:false,error:{kind:'unsupported',capability:'selling_rate_import'}});
    const evidence={...observation('manual'),provenance:{mode:'manual' as const,commandId:context.operationId,actorId:'actor'}};
    expect(await adapter.observe(context,{mode:'manual',observation:evidence})).toEqual({ok:true,value:[evidence]});
    expect((await adapter.observe({...context,installationRevision:2},{mode:'manual',observation:evidence})).ok).toBe(false);
    expect((await adapter.observe(context,{mode:'manual',observation:{...evidence,reference:{...evidence.reference,franchiseId:'foreign'}}})).ok).toBe(false);
    expect((await adapter.observe(context,{mode:'file',privateImportId:'x'})).ok).toBe(false);
  });
});
