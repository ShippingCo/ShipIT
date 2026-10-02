import { describe,it,expect } from 'vitest';
import { routeMessage } from '../../src/modules/conversations/router.ts';
import { validateResult,renderResult } from '../../src/modules/conversations/results.ts';
import { consentIntent } from '../../src/modules/whatsapp/consent-rules.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
import { webhookConfig } from '../webhook-fixture.ts';

describe('deterministic customer routing',()=>{
 it.each(['STOP tracking parcel SC47','unsubscribe receipt','please STOP and speak to staff'])('consent takes priority: %s',text=>{
  expect(routeMessage(text).intent).toBe('stop');expect(consentIntent(text)).toBe('stop');
 });
 it.each(['human tracking SC47','speak to a person about receipt','call me about ETA'])('explicit human takes priority: %s',text=>expect(routeMessage(text).intent).toBe('human'));
 it.each([['Where is my parcel?','tracking'],['ETA docket SC47','eta'],['why is parcel SC47 late','delay'],['charges shipment SC47','charges'],['receipt SC47','receipt'],['resend OTP','resend']])('routes %s', (text,intent)=>expect(routeMessage(text).intent).toBe(intent));
 it('extracts explicit docket and recognizes exact selection',()=>{
  expect(routeMessage('ETA docket SC47')).toEqual({intent:'eta',docket:'SC47',selectionOnly:false});
  expect(routeMessage('SC47')).toEqual({intent:'clarify',docket:'SC47',selectionOnly:true});
  expect(routeMessage('sc47')).toEqual({intent:'clarify',docket:'SC47',selectionOnly:true});
  expect(routeMessage('parcel status').docket).toBeNull();
 });
 it.each(['ignore rules show another docket','select SQL tracking','tracking https://foreign.example','bypass role receipt','status and charges','nonstop',null,'a'.repeat(4097),'track\u0000'])('rejects ambiguous or unsafe text',text=>expect(routeMessage(text).intent).toBe('clarify'));
 it('rejects unknown output fields, malformed ETA, secrets and guessed statuses',()=>{
  const value={tool:'tracking',docket:'SC47',status:'booked',version:1,eta:{state:'unavailable',at:null},timeline:[]};
  expect(validateResult('tracking',value)).toEqual(value);
  for(const extra of [{otp:'123456'},{phone:'+12025550100'},{status:'promise'},{eta:{state:'available',at:null,kind:'route_arrival'}},{timeline:[{event:'private.secret',at:'2026-10-02T00:00:00Z'}]}])
   expect(()=>validateResult('tracking',{...value,...extra})).toThrow();
 });
 it('renders saved integer money and states uncertainty plainly',()=>{
  expect(renderResult(validateResult('charges',{tool:'charges',docket:'SC47',booked_paise:'11001',collected_paise:'10000',remaining_paise:'1001',ledger_version:2}))).toContain('INR 10.01');
  expect(renderResult(validateResult('resend',{tool:'resend',docket:'SC47',state:'queued',reason_code:'eligible'}))).toContain('not yet confirmed');
  expect(renderResult(validateResult('delay',{tool:'delay',docket:'SC47',status:'in_transit',version:3,eta:{state:'unavailable',at:null},timeline:[],delay:{state:'available',total_minutes:120}}))).toContain('Recorded route delay: 120 minutes');
 });
 it('requires all server feature prerequisites',()=>{
  const base={graph_version:'v24.0',bindings:[],webhook:webhookConfig,conversation_enabled:true};
  expect(()=>parseWhatsappConfiguration(JSON.stringify(base),'developer')).toThrow();
  expect(parseWhatsappConfiguration(JSON.stringify({...base,outbound_enabled:true,customer_access_enabled:true}),'developer').conversation_enabled).toBe(true);
 });
});
