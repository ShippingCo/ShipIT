import { ConfigurationError, type RuntimeEnvironment } from '../../env.ts';
import { parseStrictJson } from '../../plugins/json.ts';
import { object,uuid } from '../pricing/validation.ts';
import { languagePattern,namePattern } from './rules.ts';
import type { AutomationPolicyBinding,Binding,WhatsappConfiguration } from './types.ts';

export const aliasPattern=/^[a-z][a-z0-9_-]{0,63}$/;
export const providerIdPattern=/^[1-9][0-9]{0,31}$/;
export function parseWhatsappConfiguration(raw:string,environment:RuntimeEnvironment):WhatsappConfiguration {
  try {
    if(raw.length>262144||environment==='demo')throw new Error();
    const input=object(parseStrictJson(raw),['graph_version','bindings','webhook','outbound_enabled','automation']);
    if(input.outbound_enabled!==undefined&&(typeof input.outbound_enabled!=='boolean'||(input.outbound_enabled&&!input.webhook)))throw new Error();
    // Explicit deployment pin; never silently adopt Meta's latest version.
    if(typeof input.graph_version!=='string'||!/^v[1-9][0-9]\.0$/.test(input.graph_version)||!Array.isArray(input.bindings)||input.bindings.length>1000)throw new Error();
    const keys=new Set<string>(),owners=new Map<string,string>();
    const bindings=input.bindings.map((value):Binding=>{
      const b=object(value,['key','organization_id','franchise_id','waba_id','phone_number_id','credential_ref']);
      if(typeof b.key!=='string'||!aliasPattern.test(b.key)||keys.has(b.key)||
        typeof b.waba_id!=='string'||!providerIdPattern.test(b.waba_id)||typeof b.phone_number_id!=='string'||!providerIdPattern.test(b.phone_number_id)||
        typeof b.credential_ref!=='string'||!/^whatsapp:[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$/.test(b.credential_ref)||b.credential_ref.includes('://'))throw new Error();
      const org=uuid(b.organization_id,'organization_id'),franchise=uuid(b.franchise_id,'franchise_id');
      const identity=`${org}:${franchise}:${b.waba_id}`;
      if(owners.has(b.phone_number_id)&&owners.get(b.phone_number_id)!==identity)throw new Error();
      owners.set(b.phone_number_id,identity);keys.add(b.key);
      return Object.freeze({key:b.key,organization_id:org,franchise_id:franchise,waba_id:b.waba_id,phone_number_id:b.phone_number_id,credential_ref:b.credential_ref});
    });
    let webhook:WhatsappConfiguration['webhook'];
    if(input.webhook!==undefined) {
      const w=object(input.webhook,['app_secret','verify_token','waba_ids','encryption_key','fingerprint_key','key_version']);
      if(typeof w.app_secret!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(w.app_secret)||
        typeof w.verify_token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(w.verify_token)||w.verify_token===w.app_secret||
        typeof w.encryption_key!=='string'||!/^[a-f0-9]{64}$/.test(w.encryption_key)||w.encryption_key===w.app_secret||
        typeof w.fingerprint_key!=='string'||!/^[a-f0-9]{64}$/.test(w.fingerprint_key)||w.fingerprint_key===w.encryption_key||w.fingerprint_key===w.app_secret||
        new Set([w.app_secret,w.verify_token,w.encryption_key,w.fingerprint_key]).size!==4||
        typeof w.key_version!=='string'||!/^[a-z0-9_-]{1,32}$/.test(w.key_version)||
        !Array.isArray(w.waba_ids)||w.waba_ids.length<1||w.waba_ids.length>1000||new Set(w.waba_ids).size!==w.waba_ids.length||
        w.waba_ids.some(id=>typeof id!=='string'||!providerIdPattern.test(id)))throw new Error();
      webhook=Object.freeze({app_secret:w.app_secret,verify_token:w.verify_token,encryption_key:w.encryption_key,fingerprint_key:w.fingerprint_key,key_version:w.key_version,waba_ids:Object.freeze(w.waba_ids as string[])});
    }
    let automation:WhatsappConfiguration['automation'];
    if(input.automation!==undefined) {
      const a=object(input.automation,['policies']);
      if(!Array.isArray(a.policies)||a.policies.length<1||a.policies.length>32)throw new Error();
      const identities=new Set<string>();
      const policies=a.policies.map((value):AutomationPolicyBinding=>{
        const p=object(value,['policy_id','policy_version','template_name','template_language','variables']);
        if(typeof p.policy_id!=='string'||!aliasPattern.test(p.policy_id)||!Number.isSafeInteger(p.policy_version)||Number(p.policy_version)<1||
          typeof p.template_name!=='string'||!namePattern.test(p.template_name)||typeof p.template_language!=='string'||!languagePattern.test(p.template_language)||
          !Array.isArray(p.variables)||p.variables.length>20||p.variables.some(v=>typeof v!=='string'||!aliasPattern.test(v)))throw new Error();
        const identity=`${p.policy_id}:${p.policy_version}`;if(identities.has(identity))throw new Error();identities.add(identity);
        return Object.freeze({policy_id:p.policy_id,policy_version:Number(p.policy_version),template_name:p.template_name,
          template_language:p.template_language,variables:Object.freeze(p.variables as string[])});
      });
      automation=Object.freeze({policies:Object.freeze(policies)});
    }
    return Object.freeze({graph_version:input.graph_version,bindings:Object.freeze(bindings),...(webhook?{webhook}:{}),...(input.outbound_enabled!==undefined?{outbound_enabled:input.outbound_enabled as boolean}:{}),...(automation?{automation}:{})});
  }catch{throw new ConfigurationError([{field:'WHATSAPP_CONFIG_REF',code:'INVALID_FORMAT'}]);}
}
