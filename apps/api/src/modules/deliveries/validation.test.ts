import { describe,expect,it } from 'vitest';
import { exceptionRequest,proof,replace,start } from './validation.ts';
import { sendReservationPending } from './messaging.ts';

const id='10000000-0000-4000-8000-000000000001';
describe('delivery command validation',()=>{
 it('keeps queued, retrying and uncertain provider work on one logical send identity',()=>{for(const state of ['queued','dispatching','retry_wait','uncertain'])expect(sendReservationPending(state)).toBe(true);for(const state of ['failed','suppressed','accepted','delivered','read'])expect(sendReservationPending(state)).toBe(false);});
 it('accepts only the documented six-digit recipient proof and rejects unknown fields',()=>{expect(proof({expected_version:1,challenge_ref:id,challenge_version:1,proof:'000042'}).proof).toBe('000042');for(const input of [{expected_version:1,challenge_ref:id,challenge_version:1,proof:'42'},{expected_version:1,challenge_ref:id,challenge_version:1,proof:'000042',verified:true}])expect(()=>proof(input)).toThrow();});
 it('strictly validates assignment, replacement reasons and exceptional presence',()=>{expect(start({expected_version:1,agent_id:id,handover_evidence_ref:id}).agent_id).toBe(id);expect(()=>replace({expected_version:1,challenge_ref:id,reason_code:'reset'})).toThrow();expect(()=>exceptionRequest({expected_version:1,reason_code:'customer_unavailable',evidence_id:id,recipient_present:true})).toThrow();expect(()=>exceptionRequest({expected_version:1,reason_code:'recipient_channel_unavailable',evidence_id:id,recipient_present:false})).toThrow();});
});
