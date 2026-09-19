import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { attachmentLimits } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import type { createAttachmentService } from './service.ts';
type Params={booking_id:string;upload_id:string;attachment_id:string};
export function registerAttachments(app:FastifyInstance,service:ReturnType<typeof createAttachmentService>,secure:boolean) {
  const session=(request:FastifyRequest)=>request.cookies[secure?'__Host-shipit_session':'shipit_session']??'';
  const base='/api/v1/bookings/:booking_id/attachments';
  app.post<{Params:Params}>(base+'/uploads',async(request,reply)=>reply.code(201).send(await service.initiate(session(request),request.params.booking_id,request.headers['idempotency-key'],request.body,request.query,request.id)));
  app.post<{Params:Params}>(base+'/uploads/:upload_id/finalize',request=>service.finalize(session(request),request.params.booking_id,request.params.upload_id,request.headers['idempotency-key'],request.body,request.query,request.id));
  app.post<{Params:Params}>(base+'/uploads/:upload_id/cancel',request=>service.cancel(session(request),request.params.booking_id,request.params.upload_id,request.headers['idempotency-key'],request.body,request.query,request.id));
  app.get<{Params:Params}>(base,{exposeHeadRoute:false},request=>service.list(session(request),request.params.booking_id,request.query,request.id));
  app.post<{Params:Params}>(base+'/:attachment_id/download-grants',request=>service.grant(session(request),request.params.booking_id,request.params.attachment_id,request.headers['idempotency-key'],request.body,request.query,request.id));
  app.get<{Params:Params}>(base+'/:attachment_id/content',{exposeHeadRoute:false},async(request,reply)=>{
    const result=await service.download(session(request),request.params.booking_id,request.params.attachment_id,request.query,request.id);
    return reply.header('Cache-Control','no-store, private').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer')
      .header('Content-Disposition',`attachment; filename="${result.metadata.filename}"`).type(result.metadata.media_type).send(result.bytes);
  });
  app.register(async binary=>{
    binary.removeAllContentTypeParsers();
    binary.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
    binary.put<{Params:Params;Body:Readable}>(base+'/uploads/:upload_id/content',{bodyLimit:attachmentLimits.fileBytes},async(request,reply)=>{
      const controller=new AbortController(),abort=()=>controller.abort();request.raw.once('aborted',abort);
      try{
        const length=request.headers['content-length'];
        if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>attachmentLimits.fileBytes))throw new HttpError('ATTACHMENT_LIMIT_EXCEEDED');
        return await service.upload(session(request),request.params.booking_id,request.params.upload_id,request.body,request.query,request.id,controller.signal);
      }catch(error){reply.header('Connection','close');throw error;}
      finally{request.raw.removeListener('aborted',abort);}
    });
  });
}
