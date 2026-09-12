import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import type { AuditBoundary } from './types.ts';

// Separate cryptographic purpose from browser/CSRF signing. Opaque authenticated
// encryption keeps tenant, actor and resource references out of client cursors.
export function auditCursorCodec(key:Buffer,now=()=>Date.now()) {
  const derived=createHash('sha256').update('shipit:audit:cursor:v1\0').update(key).digest();
  return {
    encode(binding:string,boundary:AuditBoundary) {
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',derived,iv);
      cipher.setAAD(Buffer.from('audit:v1'));
      const value=Buffer.from(JSON.stringify({binding,boundary,expires:now()+900_000}));
      const encrypted=Buffer.concat([cipher.update(value),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
    },
    decode(token:string,binding:string):AuditBoundary {
      try {
        if(token.length>4096||!/^[A-Za-z0-9_-]+$/.test(token))throw new Error();
        const data=Buffer.from(token,'base64url');
        if(data.toString('base64url')!==token||data.length<29)throw new Error();
        const cipher=createDecipheriv('aes-256-gcm',derived,data.subarray(0,12));
        cipher.setAAD(Buffer.from('audit:v1'));cipher.setAuthTag(data.subarray(12,28));
        const value=JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));
        if(value.binding!==binding||!Number.isSafeInteger(value.expires)||value.expires<=now()||value.expires>now()+900_000||
          !/^(audit|membership|identity|customer|pricing):[0-9a-f-]{36}$/.test(value.boundary.id)||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.boundary.time))throw new Error();
        return {id:value.boundary.id,time:value.boundary.time};
      } catch {throw new HttpError('CURSOR_INVALID');}
    },
  };
}
