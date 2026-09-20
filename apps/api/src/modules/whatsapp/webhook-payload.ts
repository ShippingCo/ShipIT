import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { parseStrictJson } from '../../plugins/json.ts';

export interface BusinessWebhookConfig {
  readonly app_secret:string; readonly verify_token:string; readonly waba_ids:readonly string[];
  readonly encryption_key:string; readonly fingerprint_key:string; readonly key_version:string;
}
export interface InboxInput {
  waba_id:string; phone_number_id:string; event_key:string; digest:string; kind:'inbound'|'status'|'unsupported';
  message_id:string; status:string|null; occurred_at:string; sealed_payload:string; key_version:string;
}
const fail=():never=>{throw new HttpError('MALFORMED_REQUEST');};
const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const string=(v:unknown,max:number,pattern?:RegExp):string=>typeof v==='string'&&v.length>0&&v.length<=max&&(!pattern||pattern.test(v))?v:fail();
const list=(v:unknown,max:number):unknown[]=>Array.isArray(v)&&v.length>0&&v.length<=max?v:fail();
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export function verifyBusinessSignature(body:Buffer,signature:unknown,secret:string) {
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))throw new HttpError('ACTION_FORBIDDEN');
  const expected=createHmac('sha256',secret).update(body).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw new HttpError('ACTION_FORBIDDEN');
}
export function webhookTokenMatches(value:unknown,expected:string) {
  return typeof value==='string'&&value.length<=256&&timingSafeEqual(Buffer.from(hash(value),'hex'),Buffer.from(hash(expected),'hex'));
}
function seal(config:BusinessWebhookConfig,aad:string,payload:unknown) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(config.encryption_key,'hex'),iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
/** Trusted downstream service only; caller must first acquire this inbox's tenant scope. */
export function openInboxPayload(config:BusinessWebhookConfig,input:Pick<InboxInput,'waba_id'|'phone_number_id'|'event_key'|'sealed_payload'|'key_version'>):unknown {
  if(input.key_version!==config.key_version)throw new Error('WHATSAPP_INBOX_KEY_UNAVAILABLE');
  const bytes=Buffer.from(input.sealed_payload,'base64url');
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(config.encryption_key,'hex'),bytes.subarray(0,12));
  cipher.setAuthTag(bytes.subarray(12,28));
  cipher.setAAD(Buffer.from(JSON.stringify([input.key_version,input.waba_id,input.phone_number_id,input.event_key])));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
}
/** No raw body, contact display name, media URL, error description or billing data survives normalization. */
export function normalizeBusinessWebhook(body:Buffer,config:BusinessWebhookConfig):InboxInput[] {
  let parsed:unknown;
  try {parsed=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return fail();}
  const root=record(parsed);if(root.object!=='whatsapp_business_account')return fail();
  const result:InboxInput[]=[];
  for(const entryValue of list(root.entry,20)) {
    const entry=record(entryValue),waba=string(entry.id,32,/^[1-9][0-9]*$/);
    for(const changeValue of list(entry.changes,20)) {
      const change=record(changeValue);if(change.field!=='messages')return fail();
      const value=record(change.value);if(value.messaging_product!=='whatsapp')return fail();
      const phone=string(record(value.metadata).phone_number_id,32,/^[1-9][0-9]*$/);
      if(value.messages===undefined&&value.statuses===undefined)return fail();
      for(const kind of ['inbound','status'] as const) {
        const values=kind==='inbound'?value.messages:value.statuses;if(values===undefined)continue;
        for(const item of list(values,100)) {
          if(result.length>=100)return fail();
          const event=record(item),id=string(event.id,200,/^[A-Za-z0-9._:=-]+$/);
          const timestamp=string(event.timestamp,12,/^[0-9]+$/),seconds=Number(timestamp);
          if(seconds<1||seconds>253402300799)return fail();
          const occurred=new Date(seconds*1000).toISOString();
          const contact=string(kind==='inbound'?event.from:event.recipient_id,15,/^[1-9][0-9]{5,14}$/);
          let status:string|null=null,type:InboxInput['kind']=kind,content:Record<string,unknown>;
          if(kind==='status') {
            status=string(event.status,32,/^[a-z_]+$/);
            if(!['sent','delivered','read','failed'].includes(status))type='unsupported';
            content={recipient_id:contact};
            if(event.errors!==undefined)content.error_codes=list(event.errors,10).map(e=>{
              const code=record(e).code;if(!Number.isSafeInteger(code)||Number(code)<0||Number(code)>2147483647)return fail();return code;
            });
          } else {
            const messageType=string(event.type,32,/^[a-z_]+$/);
            content={from:contact,type:messageType};
            if(messageType==='text')content.text=string(record(event.text).body,4096);
            else if(messageType==='button')content.text=string(record(event.button).text,4096);
            else if(messageType==='interactive') {
              const interactive=record(event.interactive),replyType=interactive.type;
              if(replyType==='button_reply'||replyType==='list_reply') {
                const reply=record(interactive[replyType]);content.reply_id=string(reply.id,256);content.text=string(reply.title,4096);
              }else type='unsupported';
            }else type='unsupported';
            if(event.context!==undefined)content.context_id=string(record(event.context).id,200,/^[A-Za-z0-9._:=-]+$/);
          }
          const eventKey=kind==='inbound'?`inbound:${id}`:`status:${id}:${status}`;
          // A plain hash would permit offline guesses of short text (including codes).
          // Keep this dedicated key stable across signing/encryption key rotations.
          const digest=createHmac('sha256',Buffer.from(config.fingerprint_key,'hex'))
            .update(JSON.stringify([waba,phone,eventKey,occurred,type,content])).digest('hex');
          result.push({waba_id:waba,phone_number_id:phone,event_key:eventKey,digest,kind:type,message_id:id,status,
            occurred_at:occurred,key_version:config.key_version,
            sealed_payload:seal(config,JSON.stringify([config.key_version,waba,phone,eventKey]),content)});
        }
      }
    }
  }
  return result;
}
