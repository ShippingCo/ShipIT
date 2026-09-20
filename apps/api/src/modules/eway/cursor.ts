import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
export function ewayCursorCodec(key:Buffer,clock:()=>Date) {
  const derived=createHash('sha256').update('shipit:eway:cursor:v1\0').update(key).digest();
  return {
    encode(binding:string,boundary:string) {
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(Buffer.from('eway:v1'));
      const encrypted=Buffer.concat([cipher.update(JSON.stringify({binding,boundary,expires:clock().getTime()+900000})),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
    },
    decode(token:string,binding:string):string {
      try {
        if(token.length>4096||/[^A-Za-z0-9_-]/.test(token))throw new Error();const bytes=Buffer.from(token,'base64url');
        if(bytes.toString('base64url')!==token||bytes.length<29)throw new Error();
        const cipher=createDecipheriv('aes-256-gcm',derived,bytes.subarray(0,12));cipher.setAAD(Buffer.from('eway:v1'));cipher.setAuthTag(bytes.subarray(12,28));
        const value=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
        if(value.binding!==binding||!Number.isSafeInteger(value.expires)||value.expires<=clock().getTime()||value.expires>clock().getTime()+900000||
          typeof value.boundary!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[1-9][0-9]{0,9})$/.test(value.boundary))throw new Error();
        return value.boundary;
      }catch{throw new HttpError('CURSOR_INVALID');}
    },
  };
}
