import {describe,it,expect} from 'vitest';
import {counterEntryInput} from '../../src/modules/bookings/counter-entries.ts';
describe('optional confirmed counter input',()=>{
 it('accepts an empty booking and empty additional parcels',()=>{
  expect(counterEntryInput({})).toEqual({fields:{},additional_parcels:[]});
  expect(counterEntryInput({additional_parcels:[{}]})).toEqual({fields:{},additional_parcels:[{}]});
 });
 it('preserves blank and partial input without inventing normalized contact or money facts',()=>{
  const value={fields:{name:'Partial sender',phone:'',weight:'',override:'',packing:'3900'},additional_parcels:[{docket:'',recipientAddress:''}]};
  expect(counterEntryInput(value)).toEqual(value);
 });
 it('still enforces bounded payload types and rejects server-owned fields',()=>{
  for(const input of [{fields:{organization_id:'synthetic'}},{fields:{name:123}},{fields:{name:'x'.repeat(4097)}},{additional_parcels:Array.from({length:50},()=>({}))}])expect(()=>counterEntryInput(input)).toThrow();
 });
});
