import { ConfigurationError, type RuntimeEnvironment } from '../../env.ts';
import { parseStrictJson } from '../../plugins/json.ts';
import { object,uuid } from '../pricing/validation.ts';
import type { Binding,WhatsappConfiguration } from './types.ts';

export const aliasPattern=/^[a-z][a-z0-9_-]{0,63}$/;
export const providerIdPattern=/^[1-9][0-9]{0,31}$/;
export function parseWhatsappConfiguration(raw:string,environment:RuntimeEnvironment):WhatsappConfiguration {
  try {
    if(raw.length>262144||environment==='demo')throw new Error();
    const input=object(parseStrictJson(raw),['graph_version','bindings']);
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
    return Object.freeze({graph_version:input.graph_version,bindings:Object.freeze(bindings)});
  }catch{throw new ConfigurationError([{field:'WHATSAPP_CONFIG_REF',code:'INVALID_FORMAT'}]);}
}
