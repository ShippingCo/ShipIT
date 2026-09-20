import { createHmac } from 'node:crypto';
import type { BusinessWebhookConfig } from '../src/modules/whatsapp/webhook-payload.ts';
export const webhookConfig:BusinessWebhookConfig={app_secret:'synthetic_app_secret_'.padEnd(40,'a'),verify_token:'synthetic_verify_token_'.padEnd(40,'b'),
  encryption_key:'ab'.repeat(32),fingerprint_key:'cd'.repeat(32),key_version:'synthetic_v1',waba_ids:['100001','200001','300001']};
export function callback(items:unknown[],options:{waba?:string;phone?:string;kind?:'messages'|'statuses'}={}) {
  return {object:'whatsapp_business_account',entry:[{id:options.waba??'100001',changes:[{field:'messages',value:{messaging_product:'whatsapp',
    metadata:{phone_number_id:options.phone??'100002',display_phone_number:'15550000000'},[options.kind??'statuses']:items}}]}]};
}
export const status=(state='read',id='wamid.synthetic_37')=>({id,status:state,timestamp:'1789905600',recipient_id:'15550000001'});
export const inbound=(id='wamid.inbound_37',text='STOP')=>({id,type:'text',timestamp:'1789905600',from:'15550000001',text:{body:text}});
export const signed=(body:string|Buffer,secret=webhookConfig.app_secret)=>({'content-type':'application/json; charset=utf-8',
  'x-hub-signature-256':`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`});
