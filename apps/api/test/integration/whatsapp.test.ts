import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseWhatsappConfiguration } from '../../src/modules/whatsapp/config.ts';
import { createMetaProvider } from '../../src/modules/whatsapp/provider.ts';
import { normalizeTemplate,templateReason,validVariables } from '../../src/modules/whatsapp/rules.ts';
import { parseEnvironment } from '../../src/env.ts';
import { developerSecretResolver } from '../../src/secrets.ts';
import { syntheticEnv } from '../support.ts';

const binding={key:'synthetic',organization_id:randomUUID(),franchise_id:randomUUID(),waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:synthetic/v1'};
const configuration={graph_version:'v24.0',bindings:[binding]};
const rawTemplate={id:'100003',name:'parcel_update',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Parcel {{1}} is {{2}}'}]};
const template=normalizeTemplate(rawTemplate);
const rawAuthentication={id:'100004',name:'shipit_delivery_code',language:'en',status:'APPROVED',category:'AUTHENTICATION',components:[
  {type:'BODY',text:'{{1}} is your delivery code'},{type:'FOOTER',text:'This code expires in 10 minutes'},
  {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]},
]};
const authentication=normalizeTemplate(rawAuthentication);
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const setup=(respond:typeof fetch)=>{
  const resolve=vi.fn(async()=> 'synthetic_token_not_a_real_credential');
  const transport=vi.fn(respond);
  return {transport,resolve,provider:createMetaProvider({configuration,secrets:{kind:'managed',resolve},transport})};
};
describe('WhatsApp provider boundary',()=>{
  it('requires server authentication and separates demo/hosted/local configuration',async()=>{
    expect(()=>parseEnvironment({...syntheticEnv,WHATSAPP_CONFIG_REF:'local:whatsapp'})).toThrow();
    const config=parseEnvironment({...syntheticEnv,AUTH_SECRET_REF:'local:auth',WHATSAPP_CONFIG_REF:'local:whatsapp'});
    expect(config.whatsappConfigRef).toBe('local:whatsapp');
    const local=developerSecretResolver(config,'postgres://db_developer:synthetic@127.0.0.1/shipit_developer',undefined,undefined,
      JSON.stringify({configuration,credentials:{[binding.credential_ref]:'synthetic_token'}}));
    expect(JSON.parse(await local.resolve('local:whatsapp',new AbortController().signal))).toEqual(configuration);
    expect(await local.resolve(binding.credential_ref,new AbortController().signal)).toBe('synthetic_token');
    await expect(local.resolve('whatsapp:foreign',new AbortController().signal)).rejects.toThrow('SECRET_UNAVAILABLE');
    expect(()=>parseEnvironment({...syntheticEnv,NODE_ENV:'demo',AUTH_SECRET_REF:'managed:auth',WHATSAPP_CONFIG_REF:'managed:whatsapp'})).toThrow();
    expect(()=>parseEnvironment({...syntheticEnv,LOCAL_WHATSAPP_JSON:'private'})).toThrow();
  });
  it('accepts only server-owned, unambiguous identity bindings and credential references',()=>{
    expect(parseWhatsappConfiguration(JSON.stringify(configuration),'developer')).toEqual(configuration);
    for(const value of [{...configuration,bindings:[binding,binding]}, {...configuration,bindings:[binding,{...binding,key:'foreign',franchise_id:randomUUID()}]},
      {...configuration,graph_version:'latest'}, {...configuration,bindings:[{...binding,credential_ref:'https://secret.test'}]}, {...configuration,token:'secret'}])
      expect(()=>parseWhatsappConfiguration(JSON.stringify(value),'production')).toThrow('CONFIGURATION_INVALID');
    expect(()=>parseWhatsappConfiguration(JSON.stringify(configuration),'demo')).toThrow();
    expect(parseWhatsappConfiguration(JSON.stringify({...configuration,bindings:[binding,{...binding,key:'rotation',credential_ref:'whatsapp:synthetic/v2'}]}),'production').bindings).toHaveLength(2);
  });
  it('pins exact automation policy, template, language and positional data bindings',()=>{
    const automation={policies:[{policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']}]};
    expect(parseWhatsappConfiguration(JSON.stringify({...configuration,automation}),'production').automation).toEqual(automation);
    for(const policy of [{...automation.policies[0],policy_version:0},{...automation.policies[0],template_language:'latest'},
      {...automation.policies[0],variables:['booking id']},{...automation.policies[0],secret:'private'}])
      expect(()=>parseWhatsappConfiguration(JSON.stringify({...configuration,automation:{policies:[policy]}}),'production')).toThrow('CONFIGURATION_INVALID');
    expect(()=>parseWhatsappConfiguration(JSON.stringify({...configuration,automation:{policies:[automation.policies[0],automation.policies[0]]}}),'production')).toThrow('CONFIGURATION_INVALID');
  });
  it('checks the exact WABA phone membership, verification and platform',async()=>{
    const s=setup(async()=>reply({data:[{id:binding.phone_number_id,code_verification_status:'VERIFIED',platform_type:'CLOUD_API'}]}));
    await s.provider.validate(binding);expect(s.resolve).toHaveBeenCalledWith(binding.credential_ref,expect.any(AbortSignal));
    expect(String(s.transport.mock.calls[0]![0])).toContain('/100001/phone_numbers?');
    for(const phone of [{id:'200002',code_verification_status:'VERIFIED',platform_type:'CLOUD_API'}, {id:binding.phone_number_id,code_verification_status:'NOT_VERIFIED',platform_type:'CLOUD_API'},
      {id:binding.phone_number_id,code_verification_status:'VERIFIED',platform_type:'ON_PREMISE'}]) {
      await expect(setup(async()=>reply({data:[phone]})).provider.validate(binding)).rejects.toThrow('WHATSAPP_IDENTITY_MISMATCH');
    }
    await expect(s.provider.validate({...binding,franchise_id:randomUUID()})).rejects.toThrow('WHATSAPP_CREDENTIAL_INVALID');
    expect(s.transport).toHaveBeenCalledTimes(1);
  });
  it('normalizes exact-language provider metadata without retaining content or examples',async()=>{
    const s=setup(async()=>reply({data:[{...rawTemplate,language:'hi'},rawTemplate]}));
    const t=await s.provider.template(binding,'parcel_update','en_US');expect(t).toEqual(template);
    expect(JSON.stringify(t)).not.toContain('Parcel');
    await expect(s.provider.template(binding,'parcel_update','fr')).rejects.toThrow('WHATSAPP_TEMPLATE_MISSING');
    expect(templateReason({...t,status:'PAUSED'})).toBe('template_not_approved');
    expect(templateReason({...t,category:'MARKETING'})).toBe('template_category_unavailable');
    expect(normalizeTemplate({...rawTemplate,status:'NEW_STATUS'}).status).toBe('UNKNOWN');
  });
  it('fails closed for unsupported components and malformed positional shapes',()=>{
    for(const components of [[{type:'BODY',text:'Hello {{2}}'}],[{type:'BODY',text:'Hello {{name}}'}],[{type:'BODY',text:'Hi'}, {type:'HEADER',format:'DOCUMENT'}],
      [{type:'BODY',text:'Hi'}, {type:'BUTTONS',buttons:[]}], [{type:'BODY',text:'Hi'},{type:'BODY',text:'again'}]])
      expect(normalizeTemplate({...rawTemplate,components}).supported).toBe(false);
    expect(normalizeTemplate({...rawTemplate,parameter_format:'NAMED'}).supported).toBe(false);
    expect(validVariables(template,['SYNTHETIC','ready'])).toBe(true);
    for(const v of [[],['one'],['one',2],['one',null],['one',''],['one','bad\nline']])expect(validVariables(template,v)).toBe(false);
  });
  it('admits only the reviewed one-code AUTHENTICATION copy-code shape for delivery_otp',async()=>{
    expect(authentication.supported).toBe(true);expect(templateReason(authentication)).toBe('template_category_unavailable');expect(templateReason(authentication,'delivery_otp')).toBe(null);
    for(const raw of [{...rawAuthentication,components:[rawAuthentication.components[0]]},{...rawAuthentication,components:[rawAuthentication.components[0],{type:'BUTTONS',buttons:[{type:'OTP',otp_type:'ONE_TAP'}]}]},
      {...rawAuthentication,components:[{type:'BODY',text:'{{1}} {{2}}'},rawAuthentication.components[2]]}])expect(normalizeTemplate(raw).supported).toBe(false);
    const s=setup(async()=>reply({messages:[{id:'wamid.synthetic'}]}));expect((await s.provider.send(binding,authentication,'+12025550100',['123456'],'delivery_otp')).kind).toBe('accepted');
    const payload=JSON.parse(s.transport.mock.calls[0]![1]!.body as string);expect(payload.template.components).toEqual([{type:'body',parameters:[{type:'text',text:'123456'}]}]);
  });
  it('rejects invalid parameters and unavailable templates before secrets or HTTP',async()=>{
    const s=setup(async()=>reply({messages:[{id:'wamid.synthetic'}]}));
    for(const v of [[],['one'],['one',2]])expect((await s.provider.send(binding,template,'+12025550100',v)).kind).toBe('permanent_failure');
    for(const t of [{...template,status:'REJECTED'},{...template,supported:false},{...template,category:'AUTHENTICATION'}])
      expect((await s.provider.send(binding,t,'+12025550100',['one','two'])).kind).toBe('unavailable');
    expect(s.transport).not.toHaveBeenCalled();expect(s.resolve).not.toHaveBeenCalled();
  });
  it('translates one accepted send without promising delivery or hidden retries',async()=>{
    const s=setup(async()=>reply({messages:[{id:'wamid.synthetic'}]}));
    expect(await s.provider.send(binding,template,'+12025550100',['one','two'])).toEqual({kind:'accepted',provider_message_id:'wamid.synthetic'});
    const [url,options]=s.transport.mock.calls[0]!;expect(String(url)).toBe('https://graph.facebook.com/v24.0/100002/messages');
    expect(options?.redirect).toBe('error');expect(JSON.parse(options!.body as string).template.components[0].parameters).toEqual([{type:'text',text:'one'},{type:'text',text:'two'}]);
    expect(s.transport).toHaveBeenCalledTimes(1);
  });
  it.each([[401,'configuration_failure'],[403,'configuration_failure'],[429,'retryable_not_accepted'],[400,'permanent_failure'],[408,'uncertain'],[500,'uncertain']])('normalizes HTTP %s without raw error leakage',async(status,kind)=>{
    const s=setup(async()=>reply({error:{message:'synthetic_secret_should_not_escape'}},status as number));
    const result=await s.provider.send(binding,template,'+12025550100',['one','two']);
    expect(result.kind).toBe(kind);expect(JSON.stringify(result)).not.toContain('synthetic_secret');expect(s.transport).toHaveBeenCalledTimes(1);
  });
  it('treats transport and malformed acceptance as uncertain',async()=>{
    for(const f of [async()=>{throw new Error('private');},async()=>reply({messages:[]}),async()=>reply({messages:[{id:'private@example.test'}]})]) {
      const s=setup(f);expect((await s.provider.send(binding,template,'+12025550100',['one','two'])).kind).toBe('uncertain');expect(s.transport).toHaveBeenCalledTimes(1);
    }
  });
  it('rebuilds pagination at the fixed origin and fails closed on truncation or malformed collections',async()=>{
    let count=0;
    const s=setup(async()=>reply(++count===1?{data:[],paging:{next:'https://attacker.test/token',cursors:{after:'next'}}}:{data:[rawTemplate]}));
    expect(await s.provider.template(binding,'parcel_update','en_US')).toEqual(template);
    expect(String(s.transport.mock.calls[1]![0])).toContain('https://graph.facebook.com/v24.0/100001/message_templates?');
    for(const value of [{data:[rawTemplate,rawTemplate]},{data:[],paging:{next:'x'}},{data:'wrong'},{data:[],paging:{next:'x',cursors:{after:'repeated'}}}]) {
      await expect(setup(async()=>reply(value)).provider.template(binding,'parcel_update','en_US')).rejects.toThrow('WHATSAPP_PROVIDER_UNAVAILABLE');
    }
  });
  it('bounds oversized responses and unresponsive secret resolvers',async()=>{
    await expect(setup(async()=>reply({data:'x'.repeat(262145)})).provider.validate(binding)).rejects.toThrow('WHATSAPP_PROVIDER_UNAVAILABLE');
    vi.useFakeTimers();
    try {
      const provider=createMetaProvider({configuration,secrets:{kind:'managed',resolve:()=>new Promise(()=>{})}});
      const pending=expect(provider.validate(binding)).rejects.toThrow('WHATSAPP_PROVIDER_UNAVAILABLE');
      await vi.advanceTimersByTimeAsync(5001);await pending;
    }finally{vi.useRealTimers();}
  });
});
