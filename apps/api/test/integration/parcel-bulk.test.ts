import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MAX_BULK_PARCELS } from '@shippingco/shared';
import { bulkCommand } from '../../src/modules/parcels/bulk-validation.ts';
import { createParcelBulkService } from '../../src/modules/parcels/bulk-service.ts';
import type { DatabasePool } from '@shippingco/db';
const item=()=>({parcel_id:randomUUID(),idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()}});
const body=()=>({action:'check_in',items:[item()]});
it.each([1,MAX_BULK_PARCELS])('validates %s entries and canonicalizes a set',n=>{
  const input={...body(),items:Array.from({length:n},item)};
  expect(bulkCommand(input).items).toHaveLength(n);
  expect(bulkCommand(input)).toEqual(bulkCommand({...input,items:[...input.items].reverse()}));
});
it('collapses only identical duplicates including property-order equivalence',()=>{
  const one=item();expect(bulkCommand({action:'check_in',items:[one,structuredClone(one)]}).items).toHaveLength(1);
  expect(()=>bulkCommand({action:'check_in',items:[one,{...one,idempotency_key:randomUUID()}]})).toThrow();
  expect(()=>bulkCommand({action:'check_in',items:[one,{...one,command:{...one.command,expected_version:2}}]})).toThrow();
  expect(()=>bulkCommand({action:'check_in',items:[one,{...one,command:{...one.command,evidence_ref:randomUUID()}}]})).toThrow();
  expect(()=>bulkCommand({action:'check_in',items:[one,{...item(),idempotency_key:one.idempotency_key}]})).toThrow();
});
const invalid=[null,[],{}, {...body(),items:[]},{...body(),items:Array.from({length:MAX_BULK_PARCELS+1},item)},
  ...['transit','delivered','set_status','rto','failed_attempt','otp_verify','otp_resend','payment','move_to_lot',1,null].map(action=>({...body(),action})),
  {...body(),organization_id:randomUUID()}, {...body(),items:[{...item(),franchise_id:randomUUID()}]},
  {...body(),items:[{...item(),parcel_id:'no'}]}, {...body(),items:[{...item(),idempotency_key:undefined}]},
  ...['','bad key','x'.repeat(256),1].map(idempotency_key=>({...body(),items:[{...item(),idempotency_key}]})),
  ...[0,-1,1.5,'1',2147483647,undefined].map(expected_version=>({...body(),items:[{...item(),command:{...item().command,expected_version}}]})),
  {...body(),items:[{...item(),command:{expected_version:1,evidence_ref:randomUUID()}}]},
  {...body(),items:[{...item(),command:{...item().command,status:'delivered'}}]}];
it.each(invalid.map((value,index)=>({value,index})))('rejects invalid envelope $index before any DB work',async({value})=>{
  const connect=vi.fn(), execute=vi.fn();const service=createParcelBulkService({connect} as unknown as DatabasePool,{execute});
  await expect(service.execute('session',{organization_id:randomUUID(),franchise_id:randomUUID()},'key',['Idempotency-Key','key'],value,randomUUID())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect(connect).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
});
it.each([undefined,'','bad key','a,b','x'.repeat(256)])('rejects outer key before DB work',async key=>{
  const connect=vi.fn();const service=createParcelBulkService({connect} as unknown as DatabasePool);
  await expect(service.execute('s',{organization_id:randomUUID(),franchise_id:randomUUID()},key,['Idempotency-Key',key??''],body(),randomUUID())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect(connect).not.toHaveBeenCalled();
});
it('duplicate outer headers, invalid selectors and late malformed items never reach persistence',async()=>{
  const connect=vi.fn(),service=createParcelBulkService({connect} as unknown as DatabasePool),selected={organization_id:randomUUID(),franchise_id:randomUUID()};
  for(const [query,headers,value] of [[selected,['Idempotency-Key','key','idempotency-key','key'],body()],
    [{...selected,role:'operator'},['Idempotency-Key','key'],body()],
    [{...selected,franchise_id:[selected.franchise_id]},['Idempotency-Key','key'],body()],
    [selected,['Idempotency-Key','key'],{...body(),items:[item(),{...item(),command:{expected_version:1}}]}]] as const)
    await expect(service.execute('s',query,'key',headers,value,randomUUID())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect(connect).not.toHaveBeenCalled();
});
