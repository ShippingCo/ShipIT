import { afterEach,describe,it,expect,vi } from 'vitest';
import type { DatabasePool } from '@shippingco/db';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
import { normalizeBusinessWebhook,openInboxPayload } from '../../src/modules/whatsapp/webhook-payload.ts';
import { fakeDatabase,syntheticEnv } from '../support.ts';
import { callback,inbound,signed,status,webhookConfig } from '../webhook-fixture.ts';
const apps:ReturnType<typeof buildServer>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(a=>a.close()));});
function setup() {
  const database={...fakeDatabase(),connect:vi.fn<DatabasePool['connect']>(async()=>{throw new Error('unused');})},logs:string[]=[];
  const app=buildServer({database,config:parseEnvironment(syntheticEnv),logSink:{write:s=>logs.push(s)},whatsapp:{configuration:{graph_version:'v24.0',bindings:[],webhook:webhookConfig},
    provider:{validate:vi.fn(),template:vi.fn(),send:vi.fn()}}});apps.push(app);return {app,database,logs};
}
describe('signed business webhook boundary',()=>{
  it('validates independent server configuration and preserves disabled-by-default compatibility',()=>{
    const config={graph_version:'v24.0',bindings:[],webhook:webhookConfig};
    expect(parseWhatsappConfiguration(JSON.stringify(config),'developer').webhook).toEqual(webhookConfig);
    for(const webhook of [{...webhookConfig,app_secret:'short'},{...webhookConfig,verify_token:webhookConfig.app_secret},
      {...webhookConfig,waba_ids:[]},{...webhookConfig,waba_ids:['100001','100001']},{...webhookConfig,encryption_key:'bad'},
      {...webhookConfig,fingerprint_key:webhookConfig.encryption_key},{...webhookConfig,verify_token:webhookConfig.fingerprint_key},
      {...webhookConfig,tenant:'foreign'}]) {
      expect(()=>parseWhatsappConfiguration(JSON.stringify({...config,webhook}),'developer')).toThrow();
    }
    expect(parseWhatsappConfiguration(JSON.stringify({graph_version:'v24.0',bindings:[]}),'developer').webhook).toBeUndefined();
  });
  it('handshake proves only webhook ownership, never creates an operator session',async()=>{
    const {app,database,logs}=setup();
    const url='/webhooks/whatsapp?'+new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':webhookConfig.verify_token,'hub.challenge':'12345'});
    const response=await app.inject(url);expect(response.statusCode).toBe(200);expect(response.body).toBe('12345');
    expect(response.headers['set-cookie']).toBeUndefined();expect(response.headers['cache-control']).toBe('no-store');
    expect(database.connect).not.toHaveBeenCalled();
    expect((await app.inject(url+'&hub.verify_token=wrong')).statusCode).toBe(403);
    expect((await app.inject(url.replace(webhookConfig.verify_token,'wrong'))).statusCode).toBe(403);
    expect(logs.join('')).not.toContain(webhookConfig.verify_token);
  });
  it('rejects tampering, missing/wrong signatures before parsing or database work',async()=>{
    const {app,database}=setup(),body=JSON.stringify(callback([status()]));
    for(const [payload,headers] of [[body+' ',signed(body)],[body,signed(body,'wrong')],['invalid',signed(body)],[body,{'content-type':'application/json'}]] as const) {
      expect((await app.inject({method:'POST',url:'/webhooks/whatsapp',payload,headers})).statusCode).toBe(403);
    }
    expect(database.connect).not.toHaveBeenCalled();
  });
  it('validates original UTF-8 and escaped provider encoding; only encrypted normalized content reaches storage',async()=>{
    const {app,database,logs}=setup(),queries:unknown[]=[];
    database.connect.mockImplementation(async()=>({query:async(sql:string,params?:readonly unknown[])=>{
      queries.push({sql,params});return {command:sql==='COMMIT'?'COMMIT':'SELECT',rows:[],rowCount:0,fields:[],oid:0};},release:()=>{}}));
    const body=JSON.stringify(callback([inbound('wamid.unicode','नमस्ते 🚚 12345678')],{kind:'messages'})).replace('न','\\u0928');
    const response=await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:signed(body)});
    expect(response.statusCode).toBe(200);expect(queries.at(-1)).toEqual({sql:'COMMIT',params:undefined});
    const normalized=normalizeBusinessWebhook(Buffer.from(body),webhookConfig)[0]!;
    expect(openInboxPayload(webhookConfig,normalized)).toEqual({from:'15550000001',type:'text',text:'नमस्ते 🚚 12345678'});
    for(const privateValue of ['12345678','15550000001','15550000000',webhookConfig.app_secret,webhookConfig.encryption_key,webhookConfig.fingerprint_key])expect(JSON.stringify(queries)+logs.join('')+response.body).not.toContain(privateValue);
    const rotated=normalizeBusinessWebhook(Buffer.from(body),{...webhookConfig,app_secret:'different_signing_secret',encryption_key:'ef'.repeat(32),key_version:'v2'})[0]!;
    expect(rotated.digest).toBe(normalized.digest);expect(rotated.sealed_payload).not.toBe(normalized.sealed_payload);
    expect(normalizeBusinessWebhook(Buffer.from(body),{...webhookConfig,fingerprint_key:'ee'.repeat(32)})[0]!.digest).not.toBe(normalized.digest);
    expect(()=>openInboxPayload(webhookConfig,{...normalized,phone_number_id:'200002'})).toThrow();
    expect(()=>openInboxPayload({...webhookConfig,key_version:'new'},normalized)).toThrow();
  });
  it('never acknowledges a database outage and returns only a safe retryable error',async()=>{
    const {app,logs}=setup(),body=JSON.stringify(callback([status()]));
    const response=await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:signed(body)});
    expect(response.statusCode).toBe(503);expect(response.headers['retry-after']).toBe('5');
    expect(response.body).not.toContain('unused');expect(logs.join('')).not.toContain('recipient_id');
  });
  it('bounds size, batch length, depth, duplicate keys, UTF-8, encoding and malformed events',async()=>{
    const {app,database}=setup();
    const invalid=['{','{"object":"whatsapp_business_account","object":"x"}',JSON.stringify(callback([status()])).replace('1789905600','not-time'),
      JSON.stringify(callback(Array.from({length:101},()=>status()))),JSON.stringify(callback([status()])).replace('15550000001','bad-phone'),
      '{"nested":'+'['.repeat(65)+'0'+']'.repeat(65)+'}'];
    for(const body of invalid)expect((await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:signed(body)})).statusCode).toBe(400);
    const large=' '.repeat(262145);expect((await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:large,headers:signed(large)})).statusCode).toBe(413);
    const utf8=Buffer.from([0xff]);expect((await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:utf8,headers:signed(utf8)})).statusCode).toBe(400);
    const body=JSON.stringify(callback([status()]));expect((await app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:{...signed(body),'content-encoding':'gzip'}})).statusCode).toBe(415);
    expect(database.connect).not.toHaveBeenCalled();
  });
  it('uses logical item identity across reordered batches and quarantines unsupported types without their payload',()=>{
    const first=normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([status('read'),status('delivered')]))),webhookConfig);
    const second=normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([status('delivered'),status('read')]))),webhookConfig);
    expect(first.map(e=>[e.event_key,e.digest]).sort()).toEqual(second.map(e=>[e.event_key,e.digest]).sort());
    const unknown=normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([{...inbound(),type:'image',image:{url:'https://sensitive.invalid'}}],{kind:'messages'}))),webhookConfig)[0]!;
    expect(unknown.kind).toBe('unsupported');expect(openInboxPayload(webhookConfig,unknown)).toEqual({from:'15550000001',type:'image'});
  });
});
