import { describe,it,expect } from 'vitest';
import { address,windowInput,transition } from '../../src/modules/pickups/rules.ts';
import { routeMessage } from '../../src/modules/conversations/router.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
describe('pickup boundaries',()=>{
 it('validates bounded Unicode addresses without control characters',()=>{
  expect(address('१२ काल्पनिक सड़क, अहमदाबाद 380001')).toContain('अहमदाबाद');
  for(const v of ['',null,'short','a'.repeat(501),'12 street\u0000 fictional city'])expect(()=>address(v)).toThrow();
 });
 it('requires ordered, future, timezone-qualified windows and bounds the horizon',()=>{
  const now=new Date('2026-10-02T00:00:00Z');
  expect(windowInput('2026-10-02T10:00:00+05:30','2026-10-02T12:00:00+05:30',now).window_start).toBe('2026-10-02T04:30:00Z');
  for(const [a,b] of [['2026-10-02T00:00:00Z','2026-10-02T01:00:00Z'],['2026-10-03T00:00:00','2026-10-03T01:00:00'],['2026-11-03T00:00:00Z','2026-11-03T01:00:00Z'],['2026-10-03T00:00:00Z','2026-10-04T00:00:01Z']])expect(()=>windowInput(a,b,now)).toThrow();
 });
 it('keeps terminal states and stale decisions closed',()=>{
  for(const action of ['accepted','declined','canceled'])expect(()=>transition('submitted',action,1,1)).not.toThrow();
  for(const state of ['accepted','declined','canceled'])expect(()=>transition(state,'accepted',2,2)).toThrow();
  expect(()=>transition('submitted','accepted',2,1)).toThrow();
 });
 it('preserves consent precedence and explicitly enables pickups',()=>{
  expect(routeMessage('PICKUPS').intent).toBe('pickup');expect(routeMessage('STOP PICKUP').intent).toBe('stop');
  for(const v of [true,'yes',1])expect(()=>parseWhatsappConfiguration(JSON.stringify({graph_version:'v24.0',bindings:[],pickup_enabled:v}),'developer')).toThrow();
 });
});
