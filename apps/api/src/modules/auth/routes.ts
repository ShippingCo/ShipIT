import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from './service.ts';
import { browserToken, validBrowser, csrf, checkCsrf, type AuthKeys } from './crypto.ts';
import { object, identifier } from './validation.ts';
import { HttpError } from '../../plugins/errors.ts';

export function registerAuth(app: FastifyInstance, service: AuthService, keys: AuthKeys,
  origins: readonly string[], secure: boolean) {
  const sessionName = secure ? '__Host-shipit_session' : 'shipit_session';
  const browserName = secure ? '__Host-shipit_browser' : 'shipit_browser';
  const options = { path: '/', httpOnly: true, secure, sameSite: 'strict' as const };
  const token = (r: FastifyRequest) => r.cookies[sessionName] ?? '';
  const binding = (r: FastifyRequest) => {
    const value = r.cookies[browserName];
    if (!value || !validBrowser(keys,value)) throw new HttpError('ACTION_FORBIDDEN');
    return value;
  };
  app.addHook('onRequest', async (r,reply) => {
    reply.header('Cache-Control','no-store').header('Pragma','no-cache');
    if (r.method === 'GET' || r.method === 'HEAD') return;
    if (!r.headers.origin || !origins.includes(r.headers.origin) || r.headers['sec-fetch-site']==='cross-site') throw new HttpError('ACTION_FORBIDDEN');
    const header=r.headers['x-csrf-token'];
    checkCsrf(keys,binding(r),typeof header === 'string' ? header : undefined);
  });
  app.get('/auth/bootstrap', async (r,reply) => {
    const existing=r.cookies[browserName];
    const value=existing && validBrowser(keys,existing) ? existing : browserToken(keys);
    reply.setCookie(browserName,value,{...options,maxAge:600});
    return { csrf_token:csrf(keys,value) };
  });
  app.post('/auth/challenges', async r => {
    const body=object(r.body,['channel','address']);
    const contact=identifier(body.channel,body.address);
    return service.withCorrelation(r.id).start(contact.channel,contact.address,binding(r),r.ip);
  });
  app.post('/auth/challenges/resend', async r => {
    const body=object(r.body,['challenge_id']);
    return service.withCorrelation(r.id).resend(String(body.challenge_id ?? ''),binding(r),r.ip);
  });
  app.post('/auth/challenges/verify', async (r,reply) => {
    const body=object(r.body,['challenge_id','code']);
    if (typeof body.code !== 'string') throw new HttpError('VALIDATION_FAILED');
    const result=await service.withCorrelation(r.id).verify(String(body.challenge_id ?? ''),body.code,binding(r),r.ip,token(r),token(r));
    if (!result.linked) reply.setCookie(sessionName,result.token,{...options,maxAge:43200});
    return { authenticated:true };
  });
  app.get('/auth/session', async r => {
    const s=await service.withCorrelation(r.id).current(token(r));
    return { user_id:s.user_id,expires_at:s.expires_at,idle_expires_at:s.idle_expires_at };
  });
  app.post('/auth/activity', async r => { object(r.body,[]); await service.withCorrelation(r.id).activity(token(r)); return { ok:true }; });
  app.post('/auth/logout', async (r,reply) => {
    object(r.body,[]); await service.withCorrelation(r.id).logout(token(r)); reply.clearCookie(sessionName,options); return { ok:true };
  });
  app.post('/auth/logout-all', async (r,reply) => {
    object(r.body,[]); await service.withCorrelation(r.id).logoutAll(token(r)); reply.clearCookie(sessionName,options); return { ok:true };
  });
  app.get('/auth/contacts', async r => ({ contacts:await service.withCorrelation(r.id).contacts(token(r)) }));
  app.post('/auth/contacts', async r => {
    const body=object(r.body,['channel','address']),contact=identifier(body.channel,body.address);
    await service.withCorrelation(r.id).current(token(r));
    return service.withCorrelation(r.id).start(contact.channel,contact.address,binding(r),r.ip,token(r));
  });
  app.post('/auth/contacts/remove', async (r,reply) => {
    const body=object(r.body,['id']); await service.withCorrelation(r.id).unlink(token(r),String(body.id ?? ''));
    reply.clearCookie(sessionName,options); return { ok:true };
  });
}
