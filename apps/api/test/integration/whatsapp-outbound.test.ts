import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { outboundInput,openOutbound,sealOutbound,sendDecision,retryDelay } from '../../src/modules/whatsapp/outbound-rules.ts';
import { createMetaProvider,parseRetryAfter } from '../../src/modules/whatsapp/provider.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';

test('dispatch defaults off and requires explicit boolean enablement with signed callbacks',()=>{
 const base={graph_version:'v24.0',bindings:[]};
 assert.equal(parseWhatsappConfiguration(JSON.stringify(base),'developer').outbound_enabled,undefined);
 assert.throws(()=>parseWhatsappConfiguration(JSON.stringify({...base,outbound_enabled:true}),'developer'));
 assert.throws(()=>parseWhatsappConfiguration(JSON.stringify({...base,webhook:webhookConfig,outbound_enabled:'true'}),'developer'));
 assert.equal(parseWhatsappConfiguration(JSON.stringify({...base,webhook:webhookConfig,outbound_enabled:true}),'developer').outbound_enabled,true);
});
test('outbound validation closes purpose, body, source and sensitive rendering boundaries',()=>{
 const input={source_kind:'inbox',source_id:randomUUID(),customer_id:randomUUID(),purpose:'requested_assistance',format:'text',text:'Synthetic reply'};
 const normalized=outboundInput(input);assert.deepEqual(normalized,{...input,affected_entity_id:input.source_id});
 for(const change of [{purpose:'marketing'},{source_kind:'event'},{text:''},{text:'a'.repeat(4097)},{phone:'+15550000001'},{text:'\u0000'},{variables:['private']}])assert.throws(()=>outboundInput({...input,...change}));
 const id=randomUUID(),sealed=sealOutbound(webhookConfig,id,normalized);
 assert.ok(!sealed.includes(input.text));assert.deepEqual(openOutbound(webhookConfig,id,webhookConfig.key_version,sealed),normalized);
 assert.throws(()=>openOutbound(webhookConfig,randomUUID(),webhookConfig.key_version,sealed));assert.throws(()=>openOutbound(webhookConfig,id,'v99',sealed));
});
test('bounded rejection retry honors seconds/date Retry-After; uncertainty never retries',()=>{
 assert.equal(parseRetryAfter('120'),120);assert.equal(parseRetryAfter('Sun, 20 Sep 2026 12:02:00 GMT',Date.parse('2026-09-20T12:00:00Z')),120);
 assert.equal(parseRetryAfter('invalid'),undefined);assert.equal(retryDelay(1,120,()=>0),120);assert.equal(retryDelay(1,90000),null);
 assert.equal(sendDecision({kind:'retryable_not_accepted',reason:'private',retry_after_seconds:120},1).delay,120);
 assert.equal(sendDecision({kind:'retryable_not_accepted',reason:'x'},5).state,'failed');
 for(const kind of ['configuration_failure','permanent_failure','unavailable'] as const)assert.equal(sendDecision({kind,reason:'private'},1).state,'failed');
 assert.equal(sendDecision({kind:'uncertain',reason:'private'},1).state,'uncertain');
});
test('Meta text transport has no hidden retry and returns controlled 429/acceptance/timeout outcomes',async()=>{
 const binding={key:'alpha',organization_id:randomUUID(),franchise_id:randomUUID(),phone_number_id:'100002',waba_id:'100001',credential_ref:'whatsapp:alpha/v1'};
 let count=0,status=429,body:unknown={};
 const provider=createMetaProvider({configuration:{graph_version:'v24.0',bindings:[binding]},secrets:{kind:'managed',resolve:async()=> 'synthetic_token_123456789'},transport:async(url,options)=>{
  count++;assert.ok(String(url).startsWith('https://graph.facebook.com/'));assert.equal(options?.redirect,'error');
  assert.equal(JSON.parse(options!.body as string).text.preview_url,false);
  if(status===0)throw new Error('private network detail');return new Response(JSON.stringify(body),{status,headers:{'retry-after':'120'}});
 }});
 assert.deepEqual(await provider.sendText!(binding,'+15550000001','Synthetic'),{kind:'retryable_not_accepted',reason:'rate_limited',retry_after_seconds:120});assert.equal(count,1);
 status=200;body={messages:[{id:'wamid.synthetic'}]};assert.equal((await provider.sendText!(binding,'+15550000001','Synthetic')).kind,'accepted');
 status=0;assert.deepEqual(await provider.sendText!(binding,'+15550000001','Synthetic'),{kind:'uncertain',reason:'acceptance_unknown'});assert.equal(count,3);
});
