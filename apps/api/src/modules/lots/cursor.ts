import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import type { LotBoundary } from './types.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque, authenticated and purpose-separated. A cursor is continuation state, never authority. */
export function lotCursorCodec(key:Buffer,now=()=>Date.now()) {
  const derived=createHash('sha256').update('shipit:lot:cursor:v1\0').update(key).digest();
  return {
    encode(binding:string,boundary:LotBoundary) {
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',derived,iv);
      cipher.setAAD(Buffer.from('lot:v1'));
      const plaintext=Buffer.from(JSON.stringify({binding,boundary,expires:now()+900_000}));
      const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
    },
    decode(token:string,binding:string):LotBoundary {
      try {
        if(token.length>4096||!/^[A-Za-z0-9_-]+$/.test(token))throw new Error();
        const data=Buffer.from(token,'base64url');
        if(data.toString('base64url')!==token||data.length<29)throw new Error();
        const decipher=createDecipheriv('aes-256-gcm',derived,data.subarray(0,12));
        decipher.setAAD(Buffer.from('lot:v1'));decipher.setAuthTag(data.subarray(12,28));
        const value=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
        if(value.binding!==binding||!Number.isSafeInteger(value.expires)||value.expires<=now()||value.expires>now()+900_000||
          !value.boundary||typeof value.boundary.value!=='string'||value.boundary.value.length>64||!uuid.test(value.boundary.id))throw new Error();
        return {value:value.boundary.value,id:value.boundary.id};
      } catch {throw new HttpError('CURSOR_INVALID');}
    },
  };
}
