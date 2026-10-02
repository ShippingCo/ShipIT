import { describe,it,expect } from 'vitest';
import { dialogue,policyInput,referral,validatedInput } from '../../src/modules/customer-quotes/rules.ts';
import { routeMessage } from '../../src/modules/conversations/router.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
import { webhookConfig } from '../webhook-fixture.ts';
const policy={enabled:true,origin_key:'ORIGIN',rate_version_id:'00000000-0000-4000-8000-000000000048',heavy_weight_grams:2000,large_dimension_mm:1000,manual_review:false,
 lanes:[{destination_key:'DEST',service:'standard' as const,weight_only:true}],expected_version:0};
const input={origin_key:'ORIGIN',destination_key:'DEST',weight_grams:1999,dimensions_mm:[100,200,300],service:'standard'};
describe('customer quote boundaries',()=>{
 it('requires conversation prerequisites and defaults to disabled',()=>{
  const base={graph_version:'v24.0',bindings:[]};
  expect(parseWhatsappConfiguration(JSON.stringify(base),'developer').customer_quotes_enabled).toBeUndefined();
  expect(()=>parseWhatsappConfiguration(JSON.stringify({...base,customer_quotes_enabled:true}),'developer')).toThrow();
  expect(parseWhatsappConfiguration(JSON.stringify({...base,customer_quotes_enabled:true,conversation_enabled:true,customer_access_enabled:true,outbound_enabled:true,webhook:webhookConfig}),'developer').customer_quotes_enabled).toBe(true);
 });
 it('requires all explicit policy values and rejects rate/tenant injection',()=>{
  expect(policyInput(policy).heavy_weight_grams).toBe(2000);
  for(const bad of [{...policy,heavy_weight_grams:0},{...policy,enabled:'yes'},{...policy,organization_id:'foreign'},{...policy,lanes:[...policy.lanes,...policy.lanes]}])expect(()=>policyInput(bad)).toThrow();
 });
 it('treats exact heavy and large boundaries as staff review',()=>{
  const p=policyInput(policy),i=validatedInput(input);
  expect(referral(p,i)).toBeNull();
  for(const weight of [2000,2001])expect(referral(p,{...i,weight_grams:weight})).toBe('heavy');
  for(const length of [1000,1001])expect(referral(p,{...i,dimensions_mm:[length,1,1]})).toBe('large');
  expect(referral({...p,manual_review:true},i)).toBe('manual_review');
  expect(referral({...p,lanes:[{...p.lanes[0]!,weight_only:false}]},i)).toBe('dimensional_review');
  expect(referral(p,{...i,origin_key:'OTHER'})).toBe('unsupported_origin');
  expect(referral(p,{...i,service:'express'})).toBe('unsupported_lane');
 });
 it('does not invent dimensions or accept negative/fractional/ambiguous measurements',()=>{
  for(const bad of [{...input,dimensions_mm:undefined},{...input,weight_grams:-1},{...input,weight_grams:1.5},{...input,override:{freight_paise:0}}])expect(()=>validatedInput(bad)).toThrow();
  const start=dialogue({},'origin'),dest=dialogue(start.draft,'dest'),weight=dialogue(dest.draft,'1999');
  expect(weight.prompt).toContain('Dimensions are required');expect(weight.complete).toBeNull();
  expect(dialogue(dest.draft,'-1').draft).toEqual(dest.draft);
  expect(dialogue(weight.draft,'unknown').draft).toEqual(weight.draft);
  const dimensions=dialogue(weight.draft,'100 x 200 x 300 mm');expect(dialogue(dimensions.draft,'standard').complete).toEqual(input);
 });
 it('keeps consent and human priority above quote and confirmation commands',()=>{
  expect(routeMessage('QUOTE').intent).toBe('quote');expect(routeMessage('STOP quote').intent).toBe('stop');expect(routeMessage('human quote').intent).toBe('human');
  expect(routeMessage('CONFIRM QUOTE '+policy.rate_version_id).intent).toBe('quote');
 });
});
