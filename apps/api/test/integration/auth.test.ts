import { randomBytes, createHmac } from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
import { browserToken,validBrowser,csrf,checkCsrf,seal,unseal,otp,parseKeys } from '../../src/modules/auth/crypto.ts';
import { createSender } from '../../src/modules/auth/delivery.ts';
import { parseAuthConfig } from '../../src/modules/auth/config.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { fakeDatabase,syntheticEnv } from '../support.ts';

const keys={version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)};
describe('authentication boundary',()=>{
  it('binds encrypted OTPs and browser state; rejects substitution and expiry',()=>{
    const code=otp(),payload=seal(keys,'one',code);
    expect(unseal(keys,'one',payload)).toBe(code);
    expect(()=>unseal(keys,'two',payload)).toThrow();
    const b=browserToken(keys,1000);
    expect(validBrowser(keys,b,1001)).toBe(true);
    expect(validBrowser(keys,b,601000)).toBe(false);
    expect(validBrowser(keys,b+'x',1001)).toBe(false);
    expect(()=>checkCsrf(keys,b,csrf(keys,browserToken(keys)))).toThrow();
    expect(()=>parseKeys(JSON.stringify({version:'one',verifier:'a'.repeat(64),encryption:'a'.repeat(64),browser:'a'.repeat(64)}))).toThrow('AUTH_KEYS_INVALID');
  });
  it('requires provider configuration outside development and explicit test recipients',()=>{
    const raw=JSON.stringify({keys:{version:'one',verifier:'a'.repeat(64),encryption:'b'.repeat(64),browser:'c'.repeat(64)},testRecipients:[]});
    expect(parseAuthConfig(raw,true).delivery.recipients).toEqual([]);
    expect(()=>parseAuthConfig(raw,false)).toThrow('AUTH_CONFIGURATION_INVALID');
  });
  it('uses authentication copy-code payload and never retries ambiguous sends',async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({messages:[{id:'synthetic'}]})));
    const sender=createSender({whatsapp:{token:'SYNTHETIC_ONLY',phoneNumberId:'123456',apiVersion:'v25.0',template:'synthetic_login',language:'en_US'},recipients:['+15555550101']},transport);
    expect(await sender({channel:'whatsapp',address:'+15555550101',code:'12345678',id:'one'})).toEqual({state:'accepted',reference:'synthetic'});
    const payload=JSON.parse(String(transport.mock.calls[0]![1]!.body));
    expect(payload.template.components[1]).toEqual({type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'12345678'}]});
    transport.mockRejectedValue(new Error('SYN_PROVIDER_SECRET'));
    expect(await sender({channel:'whatsapp',address:'+15555550101',code:'12345678',id:'two'})).toEqual({state:'uncertain'});
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await sender({channel:'whatsapp',address:'+15555550102',code:'12345678',id:'three'})).toEqual({state:'failed'});
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('adds email idempotency and keeps provider failure details private',async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response('SYN_PRIVATE',{status:401}));
    const sender=createSender({email:{apiKey:'SYNTHETIC',from:'login@example.test'}},transport);
    expect(await sender({channel:'email',address:'operator@example.test',code:'12345678',id:'job-one'})).toEqual({state:'failed'});
    expect(transport.mock.calls[0]![1]!.headers).toHaveProperty('Idempotency-Key','job-one');
  });
  it('rejects CSRF before database access, uses secure cookies and verifies raw webhook signatures',async()=>{
    const database=fakeDatabase(),logs:string[]=[];
    const app=buildServer({config:{...parseEnvironment(syntheticEnv),environment:'staging',allowedOrigins:['https://app.example.test']},database,
      logSink:{write:s=>{logs.push(s);}},auth:{keys,delivery:{},webhook:{verifyToken:'SYN_VERIFY_TOKEN',appSecret:'SYN_APP_SECRET'}}});
    try {
      const bootstrap=await app.inject('/auth/bootstrap');
      expect(bootstrap.headers['cache-control']).toBe('no-store');
      expect(bootstrap.headers['set-cookie']).toContain('__Host-shipit_browser=');
      expect(bootstrap.headers['set-cookie']).toContain('Secure');
      expect(bootstrap.headers['set-cookie']).toContain('HttpOnly');
      expect(bootstrap.headers['set-cookie']).toContain('SameSite=Strict');
      const reject=await app.inject({method:'POST',url:'/auth/logout',payload:{},headers:{origin:'https://evil.example.test'}});
      expect(reject.statusCode).toBe(403); expect(database.connect).not.toHaveBeenCalled();
      expect((await app.inject('/auth/session')).statusCode).toBe(401);
      const raw='{"object":"whatsapp_business_account"}',signature='sha256='+createHmac('sha256','SYN_APP_SECRET').update(raw).digest('hex');
      expect((await app.inject({method:'POST',url:'/auth/whatsapp/webhook',payload:raw,headers:{'content-type':'application/json','x-hub-signature-256':signature}})).statusCode).toBe(200);
      expect((await app.inject({method:'POST',url:'/auth/whatsapp/webhook',payload:raw+' ',headers:{'content-type':'application/json','x-hub-signature-256':signature}})).statusCode).toBe(403);
      expect((await app.inject('/auth/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=SYN_VERIFY_TOKEN&hub.challenge=123')).body).toBe('123');
      expect(logs.join('')).not.toMatch(/SYN_VERIFY_TOKEN|SYN_APP_SECRET|whatsapp_business_account/);
    } finally { await app.close(); }
  });
});
