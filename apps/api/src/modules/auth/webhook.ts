import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { equal } from './crypto.ts';
import { HttpError } from '../../plugins/errors.ts';
import { parseStrictJson } from '../../plugins/json.ts';

export function registerWebhook(app: FastifyInstance, config: {verifyToken:string;appSecret:string}) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:65536},(_request,body,done)=>done(null,body));
  app.get('/auth/whatsapp/webhook',async (r,reply)=>{
    reply.header('Cache-Control','no-store');
    const q=r.query as Record<string,unknown>;
    if (q['hub.mode']!=='subscribe' || typeof q['hub.verify_token']!=='string' || !equal(q['hub.verify_token'],config.verifyToken) ||
      typeof q['hub.challenge']!=='string' || !/^[0-9]{1,64}$/.test(q['hub.challenge'])) throw new HttpError('ACTION_FORBIDDEN');
    return reply.type('text/plain').send(q['hub.challenge']);
  });
  app.post('/auth/whatsapp/webhook',async (r,reply)=>{
    const signature=r.headers['x-hub-signature-256'];
    if (!Buffer.isBuffer(r.body) || typeof signature!=='string' || !equal(signature,`sha256=${createHmac('sha256',config.appSecret).update(r.body).digest('hex')}`)) throw new HttpError('ACTION_FORBIDDEN');
    parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(r.body));
    // Receipt is acknowledged only. Delivery callbacks never authenticate a user.
    // No inbound business messages or provider payloads are persisted in #13.
    return reply.code(200).send({received:true});
  });
}
