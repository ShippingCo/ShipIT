import type { FastifyInstance } from 'fastify';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { persistBusinessWebhook } from '../security/jobs.ts';
import { normalizeBusinessWebhook, verifyBusinessSignature, webhookTokenMatches, type BusinessWebhookConfig } from './webhook-payload.ts';

export const BUSINESS_WEBHOOK_PATH='/webhooks/whatsapp';
export function registerBusinessWebhook(app:FastifyInstance,database:DatabasePool,config:BusinessWebhookConfig) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:262144},(_request,body,done)=>done(null,body));
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    if(request.headers['content-encoding']!==undefined)throw new HttpError('UNSUPPORTED_MEDIA_TYPE');
  });
  app.get(BUSINESS_WEBHOOK_PATH,{exposeHeadRoute:false},async(request,reply)=>{
    const params=new URLSearchParams((request.raw.url??'').split('?')[1]??'');
    if([...params.keys()].length!==3||params.getAll('hub.mode').length!==1||params.get('hub.mode')!=='subscribe'||
      params.getAll('hub.verify_token').length!==1||!webhookTokenMatches(params.get('hub.verify_token'),config.verify_token)||
      params.getAll('hub.challenge').length!==1||!/^\d{1,64}$/.test(params.get('hub.challenge')??''))throw new HttpError('ACTION_FORBIDDEN');
    return reply.type('text/plain').send(params.get('hub.challenge'));
  });
  app.post(BUSINESS_WEBHOOK_PATH,async(request,reply)=>{
    if(!Buffer.isBuffer(request.body))throw new HttpError('MALFORMED_REQUEST');
    if(request.raw.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-hub-signature-256').length!==1)throw new HttpError('ACTION_FORBIDDEN');
    verifyBusinessSignature(request.body,request.headers['x-hub-signature-256'],config.app_secret);
    const events=normalizeBusinessWebhook(request.body,config);
    try {
      const quarantined=await persistBusinessWebhook(database,events,config.waba_ids,request.id);
      if(quarantined)request.log.warn({event:'whatsapp_webhook_quarantined',code:'MANUAL_REVIEW_REQUIRED',count:quarantined},'Webhook identity or replay needs review');
    }
    catch {reply.header('Retry-After','5');throw new HttpError('TEMPORARILY_UNAVAILABLE');}
    return reply.send({received:true});
  });
}
