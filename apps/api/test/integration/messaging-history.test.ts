import {describe,it,expect} from 'vitest';
import {historySelection} from '../../src/modules/whatsapp/history-service.ts';
import {redriveReason} from '../../src/modules/whatsapp/recovery.ts';
import {ewayCursorCodec} from '../../src/modules/eway/cursor.ts';
const query={organization_id:'00000000-0000-4000-8000-000000000001',franchise_id:'00000000-0000-4000-8000-000000000002'};
describe('history contract validation',()=>{
 it.each([{status:'delivered=true'},{kind:'arbitrary'},{limit:'101'},{correlation_id:'phone'},{source_id:'sql'},{body:'secret'},{customer_id:'arbitrary'}])('rejects unbounded/private filters %j',filter=>{expect(()=>historySelection({...query,...filter},'messages')).toThrow();});
 it('separates automation and transport status filters',()=>{expect(historySelection({...query,status:'accepted'},'messages').filter.status).toBe('accepted');expect(()=>historySelection({...query,status:'accepted'},'automation')).toThrow();expect(historySelection({...query,status:'blocked'},'automation').filter.status).toBe('blocked');});
 it('retains the old cursor grammar by default while authenticating specialized time/id boundaries',()=>{
  const now=()=>new Date('2026-09-29T00:00:00Z'),key=Buffer.alloc(32,3),old=ewayCursorCodec(key,now);
  expect(()=>old.decode(old.encode('a','2026-09-29T00:00:00.123456Z|'+query.franchise_id),'a')).toThrow();
  const codec=ewayCursorCodec(key,now,v=>v.includes('|')),token=codec.encode('binding','2026-09-29T00:00:00.123456Z|'+query.franchise_id);
  expect(codec.decode(token,'binding')).toContain('.123456Z|');expect(()=>codec.decode(token,'other')).toThrow();expect(()=>codec.decode(token.slice(1),'binding')).toThrow();
 });
 it('never offers recovery after expiry, purging, delivery evidence or non-retryable states',()=>{
  const now=new Date('2026-09-29'),future=new Date('2026-09-30');
  for(const state of ['accepted','delivered','read','suppressed','queued','retry_wait','dispatching'])expect(redriveReason(state,true,future,0,now)).toBeNull();
  expect(redriveReason('failed',true,future,0,now)).toBe('dependency_repaired');expect(redriveReason('uncertain',true,future,0,now)).toBe('retry_uncertain_confirmed');
  expect(redriveReason('failed',false,future,0,now)).toBeNull();expect(redriveReason('failed',true,now,0,now)).toBeNull();expect(redriveReason('uncertain',true,future,2,now)).toBeNull();
 });
});
