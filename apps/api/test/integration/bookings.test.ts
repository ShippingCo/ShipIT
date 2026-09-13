import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { create, docket } from '../../src/modules/bookings/validation.ts';
import { fingerprint } from '../../src/modules/bookings/idempotency.ts';
import { obligation } from '../../src/modules/bookings/types.ts';
import { input } from '../pricing-support.ts';
import { taxFacts } from '../tax-support.ts';
import { idempotencyKey } from '../../src/modules/customers/validation.ts';
const body = {customer_id:randomUUID(),expected_customer_version:1,tax_calculation_id:randomUUID(),
  tax_intent:{quote_id:randomUUID(),pricing_input:input,facts:taxFacts},parcels:[{weight_grams:999,recipient:{name:'Synthetic Recipient',phone:'+1 202-555-0101'}}]};
it('strict booking schema expands only declared defaults and checks whole-booking gram sum',() => {
  const parsed=create(body); expect(parsed.parcels[0]!.docket).toBe(null); expect(parsed.parcels[0]!.recipient.address).toBe('');
  expect(fingerprint(parsed)).toBe(fingerprint(create({...body,parcels:[{...body.parcels[0]!,recipient:{...body.parcels[0]!.recipient,address:''}}]})));
  for(const weight of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,998]) expect(() => create({...body,parcels:[{...body.parcels[0]!,weight_grams:weight}]})).toThrow();
});
it('requires one through fifty ordered physical parcels',() => {
  for(const parcels of [[],Array(51).fill(body.parcels[0]),null,{}]) expect(() => create({...body,parcels})).toThrow();
  const parcels=Array.from({length:50},()=>({...body.parcels[0]!,weight_grams:1}));
  expect(create({...body,tax_intent:{...body.tax_intent,pricing_input:{...input,weight_grams:50}},parcels}).parcels).toHaveLength(50);
});
it.each(['lot_id','organization_id','franchise_id','status','state','version','tax','total_paise','paid','settled','payment_mode','collected_paise','event_id','audit','confirmed_at'])('rejects mass assignment %s',field => {
  expect(() => create({...body,[field]:randomUUID()})).toThrow();
});
it('rejects nested mass assignment and invalid shipment-party data',() => {
  for(const extra of [{status:'delivered'},{organization_id:randomUUID()},{lot_id:randomUUID()}]) expect(() => create({...body,parcels:[{...body.parcels[0],...extra}]})).toThrow();
  for(const name of ['','X'.repeat(121),'\ud800','line\nbreak']) expect(() => create({...body,parcels:[{...body.parcels[0],recipient:{...body.parcels[0]!.recipient,name}}]})).toThrow();
});
it('normalizes ASCII docket edges/case and preserves internal punctuation',() => {
  expect(docket(' \tab-c9\t ')).toBe('AB-C9'); expect(docket('A'.repeat(32))).toHaveLength(32);
  for(const value of ['', ' ', 'A'.repeat(33),'Ａ','é','A/B','A_B','A B','A\n','-A','A-','A\u200bB']) expect(() => docket(value)).toThrow();
});
it('canonical intent ignores object property order, preserves parcel order, and includes preconditions',() => {
  const p={...body,parcels:[{...body.parcels[0]!,weight_grams:400,docket:' a-1 '},{...body.parcels[0]!,weight_grams:599,docket:'B-2'}]};
  const reversed=Object.fromEntries(Object.entries(p).reverse()); expect(fingerprint(create(p))).toBe(fingerprint(create(reversed)));
  expect(fingerprint(create({...p,parcels:[...p.parcels].reverse()}))).not.toBe(fingerprint(create(p)));
  expect(fingerprint(create({...p,expected_customer_version:2}))).not.toBe(fingerprint(create(p)));
  expect(fingerprint(create({...p,parcels:p.parcels.map(x=>({...x,docket:x.docket.trim().toUpperCase()}))}))).toBe(fingerprint(create(p)));
});
it('requires one bounded case-sensitive key with no header joining',() => {
  expect(idempotencyKey('Aa_9-')).toBe('Aa_9-');
  for(const key of [undefined,'','a b','a,b','a\t','a'.repeat(256),['a','a'],'é']) expect(() => idempotencyKey(key)).toThrow();
  expect(() => idempotencyKey('a',['Idempotency-Key','a','idempotency-key','a'])).toThrow();
});
it('initial obligation preserves final integer paise including zero without collecting or rounding',() => {
  for(const total of [0,1,13400,Number.MAX_SAFE_INTEGER]) expect(obligation('id',total)).toEqual({id:'id',currency:'INR',total_paise:total,collected_paise:0,outstanding_paise:total,state:'uncollected'});
  for(const total of [-1,0.1,NaN,Infinity]) expect(() => obligation('id',total)).toThrow();
});
it('safe DTO projection drops private additions from receipts and nested pricing/tax/party evidence',async()=>{
  const {calculate:price}=await import('../../src/modules/pricing/calculation.ts');
  const {calculate:tax}=await import('../../src/modules/tax/calculation.ts');
  const {draft,start}=await import('../pricing-support.ts');
  const {taxPolicy}=await import('../tax-support.ts');
  const {charges,bookingDto}=await import('../../src/modules/bookings/types.ts');
  const quote=price({...draft,id:'version',card_id:'card',version:2,version_number:1,state:'published',created_at:start,published_at:start,published_by:'actor',rules:[{...draft.rules[0]!,id:'rule'}]},input,new Date(start),'quote','actor',false);
  const computed=tax({id:'policy',revision:2,version_number:1,state:'published',policy:taxPolicy},quote,taxFacts,{id:'tax',intentId:'intent',resolutionId:null,expiresAt:quote.expires_at},new Date(start));
  const snapshot={source_customer_id:'customer',source_customer_version:1,name:'Synthetic',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'',private_note:'MUST_NOT_LEAK'};
  const value={id:'booking',version:1 as const,state:'active' as const,organization_id:'org',franchise_id:'franchise',customer:snapshot,charges:charges(quote,computed,start),payment_obligation:obligation('obligation',13400),event_id:'event',
    parcels:[{id:'parcel',version:1 as const,status:'booked' as const,custody:'awaiting_intake' as const,docket:'SYN-1',weight_grams:999,sender:snapshot,recipient:{name:'Synthetic',phone_normalized:'+12025550101',phone_display:'+1 202-555-0101',address:'',secret:'MUST_NOT_LEAK'},event_id:'child-event'}],internal:'MUST_NOT_LEAK'};
  const mapped=bookingDto(value);expect(JSON.stringify(mapped)).not.toContain('MUST_NOT_LEAK');expect(JSON.stringify(mapped)).not.toContain('fingerprint');expect(mapped.charges.tax.final_payable_paise).toBe(13400);
});
