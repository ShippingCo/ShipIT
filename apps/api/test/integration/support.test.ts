import { describe,it,expect } from 'vitest';
import { availability,hoursInput,commandInput } from '../../src/modules/support/rules.ts';
import { routeMessage } from '../../src/modules/conversations/router.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
const hours={franchise_id:'00000000-0000-4000-8000-000000000001',timezone:'Asia/Kolkata',weekdays:[1,2,3,4,5],start_minute:540,end_minute:1020,staffed:true};
describe('human support rules',()=>{
 it('uses configured local hours, inclusive start and exclusive end without an SLA',()=>{
  expect(availability(hoursInput(hours),new Date('2026-10-02T03:30:00Z'))).toMatch(/^This is within/);
  expect(availability(hours,new Date('2026-10-02T11:30:00Z'))).toMatch(/^This is outside/);
  expect(availability(hours,new Date('2026-10-03T05:00:00Z'))).toMatch(/^This is outside/);
  expect(availability({...hours,staffed:false},new Date())).toContain('currently unavailable');
  expect(availability(undefined,new Date())).toContain('cannot be promised');
  expect(()=>hoursInput({...hours,timezone:'invalid'})).toThrow();
  expect(()=>hoursInput({...hours,end_minute:540})).toThrow();
  expect(()=>hoursInput({...hours,weekdays:[1,1]})).toThrow();
 });
 it('requires explicit transitions, reasons and separate private text',()=>{
  expect(commandInput({action:'respond',expected_version:1,text:'Please describe the issue.'}).text).toContain('describe');
  for(const body of [{action:'resolve',expected_version:1},{action:'claim',expected_version:0},{action:'claim',expected_version:1,text:'secret'},
   {action:'respond',expected_version:1,text:'OTP 123456'},{action:'assign',expected_version:1,assigned_staff_id:'bad'},
   {action:'reopen',expected_version:1,reason:'arbitrary secret'},{action:'note',expected_version:1,text:'Bearer confidential'}])expect(()=>commandInput(body)).toThrow();
 });
 it('routes HELP to a person and preserves STOP priority',()=>{
  expect(routeMessage('HELP').intent).toBe('human');expect(routeMessage('STOP human').intent).toBe('stop');
 });
 it('rejects enabling handoff without conversations and foreign hours',()=>{
  expect(()=>parseWhatsappConfiguration(JSON.stringify({graph_version:'v24.0',bindings:[],support_enabled:true}),'developer')).toThrow();
  expect(()=>parseWhatsappConfiguration(JSON.stringify({graph_version:'v24.0',bindings:[],support_hours:[hours]}),'developer')).toThrow();
 });
});
