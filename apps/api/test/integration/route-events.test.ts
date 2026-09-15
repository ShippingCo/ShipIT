import { describe,it,expect } from 'vitest';
import { eventCommand } from '../../src/modules/routes/event-validation.ts';
const body={kind:'departure',expected_version:4,manifest_id:'00000000-0000-4000-8000-000000000001',manifest_version:4,
  evidence_ref:'00000000-0000-4000-8000-000000000002',effective_at:'2099-01-01T09:00:00+05:30',base_eta_at:null};
describe('typed route event contract',()=>{
  it('normalizes explicit instants without fabricating a missing ETA',()=>{
    expect(eventCommand(body)).toEqual({...body,effective_at:'2099-01-01T03:30:00Z'});
  });
  it.each([
    {...body,title:'Delivered'}, {...body,kind:'delivered'}, {...body,expected_version:0},
    {...body,effective_at:'2099-01-01'}, {...body,base_eta_at:undefined},
    {...body,base_eta_at:'2098-01-01T00:00:00Z'}, {...body,total_delay_minutes:1},
    {...body,kind:'arrival'}, {...body,kind:'delay',total_delay_minutes:43201},
  ])('rejects malformed, ambiguous or mass-assigned intent %#',input=>expect(()=>eventCommand(input)).toThrow());
  it('accepts an absolute bounded delay with no title/status controls',()=>{
    const {base_eta_at: base,...rest}=body;expect(base).toBeNull();
    expect(eventCommand({...rest,kind:'delay',total_delay_minutes:120}).total_delay_minutes).toBe(120);
  });
});
