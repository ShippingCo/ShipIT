import { HttpError } from '../../plugins/errors.ts';
import { normalizeTemplate,namePattern,languagePattern,templateReason,validVariables } from './rules.ts';
import type { AdapterOptions,Binding,Provider,SendOutcome } from './types.ts';

type Json=Record<string,unknown>;
const record=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
class ProviderFailure extends Error {
  readonly status:number;
  constructor(status:number){super('WHATSAPP_PROVIDER_FAILURE');this.status=status;}
}

export function createMetaProvider({configuration,secrets,transport=fetch}:AdapterOptions):Provider {
  async function request(binding:Binding,path:string,params:Record<string,string>={},body?:unknown):Promise<Json> {
    const registered=configuration.bindings.find(b=>b.key===binding.key);
    if(!registered||Object.keys(registered).some(k=>registered[k as keyof Binding]!==binding[k as keyof Binding]))throw new ProviderFailure(401);
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([(async()=>{
        let token:string;
        try{token=await secrets.resolve(binding.credential_ref,controller.signal);}catch{throw new ProviderFailure(401);}
        if(!/^[A-Za-z0-9._|-]{16,4096}$/.test(token))throw new ProviderFailure(401);
        const url=new URL(`https://graph.facebook.com/${configuration.graph_version}/${path}`);
        for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
        const response=await transport(url,{method:body===undefined?'GET':'POST',redirect:'error',signal:controller.signal,
          headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        if(!response.ok){await response.body?.cancel();throw new ProviderFailure(response.status);}
        if(!response.body)throw new ProviderFailure(0);
        const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
        try {while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>262144)throw new ProviderFailure(0);chunks.push(next.value);}}
        finally {await reader.cancel();}
        const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!record(value)||value.error)throw new ProviderFailure(0);return value;
      })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProviderFailure(0));},5000);})]);
    }catch(error){if(error instanceof ProviderFailure)throw error;throw new ProviderFailure(0);}
    finally{clearTimeout(timer);controller.abort();}
  }
  async function collection(binding:Binding,path:string,params:Record<string,string>,matches:(v:Json)=>boolean):Promise<Json[]> {
    const found:Json[]=[];let after:string|undefined;
    const seen=new Set<string>();
    for(let page=0;page<5;page++) {
      const value=await request(binding,path,{...params,limit:'100',...(after?{after}:{})});
      if(!Array.isArray(value.data)||value.data.length>100||value.data.some(v=>!record(v)))throw new ProviderFailure(0);
      found.push(...(value.data as Json[]).filter(matches));
      const paging=record(value.paging)?value.paging:null;
      if(!paging?.next)return found;
      const cursors=record(paging.cursors)?paging.cursors:null;
      if(typeof cursors?.after!=='string'||!cursors.after.length||cursors.after.length>2048||seen.has(cursors.after))throw new ProviderFailure(0);
      after=cursors.after;seen.add(after);
      // Never follow provider-supplied next URLs or send tokens to another origin.
    }
    throw new ProviderFailure(0);
  }
  const safe=(error:unknown):never=>{throw new HttpError(error instanceof ProviderFailure&&[401,403].includes(error.status)?'WHATSAPP_CREDENTIAL_INVALID':'WHATSAPP_PROVIDER_UNAVAILABLE');};
  return {
    async validate(binding) {
      try {
        const phones=await collection(binding,`${binding.waba_id}/phone_numbers`,{fields:'id,code_verification_status,platform_type'},v=>v.id===binding.phone_number_id);
        if(phones.length!==1||phones[0]!.code_verification_status!=='VERIFIED'||phones[0]!.platform_type!=='CLOUD_API')throw new HttpError('WHATSAPP_IDENTITY_MISMATCH');
      }catch(error){if(error instanceof HttpError)throw error;safe(error);}
    },
    async template(binding,name,language) {
      if(!namePattern.test(name)||!languagePattern.test(language))throw new HttpError('VALIDATION_FAILED');
      try {
        const rows=await collection(binding,`${binding.waba_id}/message_templates`,{name,fields:'id,name,language,status,category,components,parameter_format'},v=>v.name===name&&v.language===language);
        if(rows.length===0)throw new HttpError('WHATSAPP_TEMPLATE_MISSING');
        if(rows.length!==1)throw new ProviderFailure(0);
        return normalizeTemplate(rows[0]);
      }catch(error){if(error instanceof HttpError)throw error;return safe(error);}
    },
    async send(binding,template,recipient,variables):Promise<SendOutcome> {
      const reason=templateReason(template);
      if(reason)return {kind:'unavailable',reason};
      if(!validVariables(template,variables)||!/^\+[1-9][0-9]{7,14}$/.test(recipient))return {kind:'permanent_failure',reason:'invalid_message_parameters'};
      try {
        const value=await request(binding,`${binding.phone_number_id}/messages`,{}, {messaging_product:'whatsapp',to:recipient.slice(1),type:'template',
          template:{name:template.name,language:{code:template.language},components:variables.length?[{type:'body',parameters:variables.map(text=>({type:'text',text}))}]:[]}});
        const messages=value.messages;
        if(!Array.isArray(messages)||messages.length!==1||!record(messages[0])||typeof messages[0].id!=='string'||!/^wamid\.[A-Za-z0-9_+=/-]{1,240}$/.test(messages[0].id))return {kind:'uncertain',reason:'acceptance_unknown'};
        return {kind:'accepted',provider_message_id:messages[0].id};
      }catch(error){
        const status=error instanceof ProviderFailure?error.status:0;
        if([401,403].includes(status))return {kind:'configuration_failure',reason:'credential_rejected'};
        if(status===429)return {kind:'retryable_not_accepted',reason:'rate_limited'};
        if(status>=400&&status<500&&status!==408)return {kind:'permanent_failure',reason:'request_rejected'};
        return {kind:'uncertain',reason:'acceptance_unknown'};
      }
    },
  };
}
