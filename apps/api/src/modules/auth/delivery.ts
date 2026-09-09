import type { Channel } from './validation.ts';

export interface DeliveryConfig {
  whatsapp?: { token: string; phoneNumberId: string; apiVersion: string; template: string; language: string };
  email?: { apiKey: string; from: string };
  // Developer sends are constrained to explicitly configured test recipients.
  recipients?: readonly string[];
}
export interface Delivery { channel: Channel; address: string; code: string; id: string }
export type DeliveryResult = { state: 'accepted' | 'failed' | 'uncertain'; reference?: string };
export type SendCode = (delivery: Delivery) => Promise<DeliveryResult>;
export function createSender(config: DeliveryConfig, transport: typeof fetch = fetch): SendCode {
  return async delivery => {
    if (!/^[0-9]{8}$/.test(delivery.code) || (config.recipients && !config.recipients.includes(delivery.address))) return { state:'failed' };
    const wa=config.whatsapp, email=config.email;
    let url: string, headers: Record<string,string>, body: unknown;
    if (delivery.channel==='whatsapp' && wa) {
      url=`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}/messages`;
      headers={ Authorization:`Bearer ${wa.token}`,'Content-Type':'application/json' };
      body={ messaging_product:'whatsapp',to:delivery.address.slice(1),type:'template',template:{
        name:wa.template,language:{code:wa.language},components:[
          {type:'body',parameters:[{type:'text',text:delivery.code}]},
          {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:delivery.code}]},
        ],
      } };
    } else if (delivery.channel==='email' && email) {
      url='https://api.resend.com/emails';
      headers={Authorization:`Bearer ${email.apiKey}`,'Content-Type':'application/json','Idempotency-Key':delivery.id};
      body={from:email.from,to:[delivery.address],subject:'Your ShipIT sign-in code',
        text:`Your ShipIT code is ${delivery.code}. It expires 10 minutes after you requested it. Do not share it. If you did not request this code, ignore this email.`};
    } else return {state:'failed'};
    try {
      const response=await transport(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10_000),redirect:'error'});
      // No blind retry: a timeout/5xx can occur after the provider accepted a send.
      if (!response.ok) { await response.body?.cancel(); return {state:response.status>=500 ? 'uncertain':'failed'}; }
      const reader=response.body?.getReader();
      if (!reader) return {state:'uncertain'};
      const chunks: Uint8Array[]=[];let size=0;
      while (true) {
        const part=await reader.read();if (part.done) break;
        size+=part.value.byteLength;
        if (size>16384) {await reader.cancel();return {state:'uncertain'};}
        chunks.push(part.value);
      }
      const text=Buffer.concat(chunks).toString('utf8');
      const result=JSON.parse(text) as {id?:unknown;messages?:{id?:unknown}[]};
      const reference=delivery.channel==='email' ? result.id : result.messages?.[0]?.id;
      return typeof reference==='string' && reference.length<=256 ? {state:'accepted',reference} : {state:'uncertain'};
    } catch { return {state:'uncertain'}; }
  };
}
