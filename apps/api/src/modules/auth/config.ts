import { parseKeys } from './crypto.ts';
import type { DeliveryConfig } from './delivery.ts';
import { identifier } from './validation.ts';

// One secret-manager document; never serialize it into diagnostics or browser configuration.
export function parseAuthConfig(raw: string, developer: boolean) {
  try {
    const data=JSON.parse(raw);
    const keys=parseKeys(JSON.stringify(data.keys));
    const delivery: DeliveryConfig={};
    if (developer) {
      if (!Array.isArray(data.testRecipients) || data.testRecipients.length>10) throw new Error();
      delivery.recipients=data.testRecipients.map((s: unknown)=>identifier(typeof s==='string' && s.startsWith('+') ? 'whatsapp':'email',s).address);
    }
    if (data.whatsapp) {
      const w=data.whatsapp;
      if (typeof w.token!=='string' || w.token.length<20 || w.token.length>4096 || !/^\d{5,30}$/.test(w.phoneNumberId) ||
        !/^v\d{2}\.0$/.test(w.apiVersion) || !/^[a-z0-9_]{1,512}$/.test(w.template) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(w.language)) throw new Error();
      delivery.whatsapp={token:w.token,phoneNumberId:w.phoneNumberId,apiVersion:w.apiVersion,template:w.template,language:w.language};
    }
    if (data.email) {
      if (typeof data.email.apiKey!=='string' || data.email.apiKey.length<20 || data.email.apiKey.length>4096) throw new Error();
      delivery.email={apiKey:data.email.apiKey,from:identifier('email',data.email.from).address};
    }
    if (!developer && (!delivery.email || !delivery.whatsapp)) throw new Error();
    let webhook: {verifyToken:string;appSecret:string} | undefined;
    if (data.webhook) {
      if (typeof data.webhook.verifyToken!=='string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.webhook.verifyToken) ||
        typeof data.webhook.appSecret!=='string' || !/^[a-f0-9]{32}$/.test(data.webhook.appSecret)) throw new Error();
      webhook={verifyToken:data.webhook.verifyToken,appSecret:data.webhook.appSecret};
    }
    return {keys,delivery,webhook};
  } catch { throw new Error('AUTH_CONFIGURATION_INVALID'); }
}
export type AuthConfiguration=ReturnType<typeof parseAuthConfig>;
