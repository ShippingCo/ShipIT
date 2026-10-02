import {afterEach,describe,it,expect} from 'vitest';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { fakeDatabase,syntheticEnv } from '../support.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { accessToken,tokenDigest } from '../../src/modules/customer-access/crypto.ts';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';

const apps:ReturnType<typeof buildServer>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(a=>a.close()));});
function setup() {
  const database=fakeDatabase(),logs:string[]=[],app=buildServer({database,config:parseEnvironment(syntheticEnv),
    auth:{keys:{version:'synthetic_v1',verifier:Buffer.alloc(32,1),encryption:Buffer.alloc(32,2),browser:Buffer.alloc(32,3)},delivery:{},webhook:undefined},
    whatsapp:{configuration:{customer_access_enabled:true,graph_version:'v24.0',bindings:[],webhook:webhookConfig},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable',reason:'synthetic'})}},
    logSink:{write:value=>logs.push(value)}});apps.push(app);return {app,database,logs};
}
describe('private customer tracking boundary',()=>{
  it('requires explicit activation and signed channel configuration',()=>{
    const catalog={graph_version:'v24.0',bindings:[],webhook:webhookConfig};
    expect(parseWhatsappConfiguration(JSON.stringify(catalog),'developer').customer_access_enabled).toBeUndefined();
    expect(parseWhatsappConfiguration(JSON.stringify({...catalog,customer_access_enabled:true}),'developer').customer_access_enabled).toBe(true);
    for(const enabled of ['yes',1,null])expect(()=>parseWhatsappConfiguration(JSON.stringify({...catalog,customer_access_enabled:enabled}),'developer')).toThrow();
    expect(()=>parseWhatsappConfiguration(JSON.stringify({graph_version:'v24.0',bindings:[],customer_access_enabled:true}),'developer')).toThrow();
  });
  it('rejects phone/docket authority, tokens in query and malformed bearer values',async()=>{
    const {app,database,logs}=setup();
    for(const url of ['/api/v1/customer-tracking','/api/v1/customer-tracking?docket=KNOWN46'])expect((await app.inject(url)).statusCode).toBe(404);
    for(const url of ['/api/v1/customer-tracking?phone=%2B12025550100','/api/v1/customer-tracking?grant='+'A'.repeat(43)])expect((await app.inject(url)).statusCode).toBe(422);
    expect((await app.inject({url:'/api/v1/customer-tracking',headers:{authorization:'Bearer malformed'}})).statusCode).toBe(404);
    expect(database.connect).not.toHaveBeenCalled();expect(JSON.stringify(logs)).not.toContain('12025550100');
  });
  it('limits failed enumeration and exposes a retry budget without grants in logs',async()=>{
    const {app,logs}=setup();
    for(let i=0;i<30;i++)expect((await app.inject('/api/v1/customer-tracking')).statusCode).toBe(404);
    const limited=await app.inject('/api/v1/customer-tracking');expect(limited.statusCode).toBe(429);expect(limited.headers['retry-after']).toBeDefined();
    expect(JSON.stringify(logs)).not.toContain('authorization');
  });
  it('database failure gives a safe retryable error instead of prototype tracking',async()=>{
    const {app,logs}=setup(),token='A'.repeat(43);
    const result=await app.inject({url:'/api/v1/customer-tracking',headers:{authorization:'Bearer '+token}});
    expect(result.statusCode).toBe(503);expect(result.json().error.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.body).not.toContain('unused');expect(JSON.stringify(logs)).not.toContain(token);
  });
  it('uses a separate grant purpose, stable restart keys and a one-way stored verifier',()=>{
    const key=Buffer.alloc(32,8),id='synthetic-grant',token=accessToken(key,id);
    expect(token).toHaveLength(43);expect(accessToken(key,id)).toBe(token);expect(accessToken(Buffer.alloc(32,9),id)).not.toBe(token);
    expect(tokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);expect(tokenDigest(token)).not.toContain(token);
    expect(()=>tokenDigest('KNOWN46')).toThrow();
  });
});
