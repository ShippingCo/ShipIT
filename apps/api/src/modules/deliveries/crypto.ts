import { createCipheriv,createDecipheriv,createHmac,randomBytes,randomInt,timingSafeEqual } from 'node:crypto';
import type { DeliveryProofKeys } from './types.ts';

export function parseDeliveryProofKeys(value:unknown):DeliveryProofKeys {
  try {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    const data=value as Record<string,unknown>;
    if(typeof data.version!=='string'||!/^[a-z0-9_-]{1,32}$/.test(data.version))throw new Error();
    const key=(name:string)=>{const raw=data[name];if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw new Error();return Buffer.from(raw,'hex');};
    const keys={version:data.version,verifier:key('verifier'),encryption:key('encryption')};
    if(keys.verifier.equals(keys.encryption))throw new Error();
    return keys;
  } catch {throw new Error('DELIVERY_PROOF_KEYS_INVALID');}
}
export function parseDeliveryProofConfiguration(raw:string):import('./types.ts').DeliveryProofConfiguration {
  try {
    const data=JSON.parse(raw) as Record<string,unknown>,template=data.template as Record<string,unknown>;
    const keys=parseDeliveryProofKeys(data.keys);
    if(!template||typeof template.name!=='string'||!/^[a-z][a-z0-9_]{0,511}$/.test(template.name)||
      typeof template.language!=='string'||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language))throw new Error();
    if(template.meta_send_qualified!==undefined&&typeof template.meta_send_qualified!=='boolean')throw new Error();
    return {keys,template_name:template.name,template_language:template.language,meta_send_qualified:template.meta_send_qualified===true};
  } catch {throw new Error('DELIVERY_PROOF_CONFIGURATION_INVALID');}
}

/** Six decimal digits provide ~20 bits; the ratified five-try/ten-minute online budget is the security boundary. */
export const generateDeliveryCode=()=>randomInt(1_000_000).toString().padStart(6,'0');
const identity=(parts:readonly string[])=>JSON.stringify(['shipit','delivery-proof','v1',...parts]);
export function deliveryVerifier(keys:DeliveryProofKeys,parts:readonly string[],code:string) {
  return createHmac('sha256',keys.verifier).update(identity([...parts,keys.version])).update('\0').update(code).digest('hex');
}
/** Makes idempotency proof-sensitive without leaving an offline-guessable OTP digest in command records. */
export function deliveryProofIntent(keys:DeliveryProofKeys,parts:readonly string[],code:string) {
  return createHmac('sha256',keys.verifier).update(JSON.stringify(['shipit','delivery-command-proof','v1',...parts,keys.version])).update('\0').update(code).digest('hex');
}
export function verifyDeliveryCode(keys:DeliveryProofKeys,parts:readonly string[],code:string,expected:string) {
  const actual=Buffer.from(deliveryVerifier(keys,parts,code),'hex'),stored=Buffer.from(expected,'hex');
  return actual.length===stored.length&&timingSafeEqual(actual,stored);
}
export function sealDeliveryCode(keys:DeliveryProofKeys,parts:readonly string[],code:string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keys.encryption,iv);
  cipher.setAAD(Buffer.from(identity([...parts,keys.version])));
  const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openDeliveryCode(keys:DeliveryProofKeys,parts:readonly string[],sealed:string,keyVersion:string) {
  if(keyVersion!==keys.version)throw new Error('DELIVERY_PROOF_KEY_UNAVAILABLE');
  const raw=Buffer.from(sealed,'base64url');if(raw.length<29)throw new Error('DELIVERY_PROOF_INVALID');
  const decipher=createDecipheriv('aes-256-gcm',keys.encryption,raw.subarray(0,12));
  decipher.setAAD(Buffer.from(identity([...parts,keyVersion])));decipher.setAuthTag(raw.subarray(12,28));
  return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8');
}
