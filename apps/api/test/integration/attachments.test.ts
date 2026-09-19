import { expect,test } from 'vitest';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { attachmentLimits } from '@shippingco/shared';
import { intent as validateIntent,hash } from '../../src/modules/attachments/validation.ts';
import { detectedType,readBounded,boundedStream } from '../../src/modules/attachments/content.ts';
import { createClamdScanner } from '../../src/modules/attachments/scanner.ts';
import { parseAttachmentConfiguration } from '../../src/modules/attachments/config.ts';
import { grantToken,verifyGrant } from '../../src/modules/attachments/grants.ts';
import { photo,intent } from '../attachment-support.ts';
function wav(){const b=Buffer.alloc(46);b.write('RIFF');b.writeUInt32LE(38,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(2,40);return b;}
const mp4=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32000000086d646174','hex');
test('content detection accepts synthetic photo/audio/video and denies executable, empty, unsupported and MIME mismatch intent',async()=>{
 expect(await detectedType(photo)).toBe('image/png');expect(await detectedType(wav())).toBe('audio/wav');expect(await detectedType(mp4)).toBe('video/mp4');
 for(const bytes of [Buffer.alloc(0),Buffer.from('MZ executable'),Buffer.from('<svg>unsafe</svg>')])await expect(detectedType(bytes)).rejects.toMatchObject({code:'ATTACHMENT_TYPE_UNSUPPORTED'});
 expect(()=>validateIntent({...intent(),media_type:'application/pdf'})).toThrow();expect(()=>validateIntent({...intent(),kind:'video'})).toThrow();expect(()=>validateIntent({...intent(),size_bytes:0})).toThrow();
 expect(validateIntent({...intent(),size_bytes:attachmentLimits.fileBytes}).size_bytes).toBe(attachmentLimits.fileBytes);expect(()=>validateIntent({...intent(),size_bytes:attachmentLimits.fileBytes+1})).toThrow();
});
test('real stream hard bound allows exactly maximum, rejects one byte over and partial bodies',async()=>{
 const bytes=Buffer.alloc(attachmentLimits.fileBytes);expect((await readBounded(Readable.from(bytes),bytes.length)).length).toBe(bytes.length);
 await expect(readBounded(Readable.from([bytes,Buffer.from('!')]),bytes.length)).rejects.toMatchObject({code:'ATTACHMENT_CONTENT_MISMATCH'});
 const controller=new AbortController(),bounded=boundedStream(Readable.from([photo,Buffer.from('!')]),photo.length,controller);
 await expect(readBounded(bounded.stream,photo.length)).rejects.toThrow();expect(controller.signal.aborted).toBe(true);bounded.dispose();
 await expect(readBounded(Readable.from(photo.subarray(0,4)),photo.length)).rejects.toThrow();
});
for(const [name,response,expected] of [['clean','stream: OK\0','clean'],['infected','stream: Eicar-Test-Signature FOUND\0','infected'],['engine error','stream: scanner unavailable ERROR\0','error'],['bad protocol','OK\0','error'],['extra response','stream: OK\0extra','error'],['oversized response','x'.repeat(2048),'error'],['connection closed',null,'error'],['timeout','', 'error']] as const){
 test('clamd wire protocol '+name,async()=>{
  let received=Buffer.alloc(0),scanned=Buffer.alloc(0);const server=createServer(socket=>{socket.on('error',()=>{});socket.on('data',chunk=>{
    received=Buffer.concat([received,chunk]);if(received.length<10||received.subarray(0,10).toString()!=='zINSTREAM\0')return;
    let offset=10;const chunks:Buffer[]=[];while(offset+4<=received.length){const n=received.readUInt32BE(offset);offset+=4;if(n===0){scanned=Buffer.concat(chunks);if(response===null)socket.end();else if(response)socket.write(response);return;}if(offset+n>received.length)return;chunks.push(received.subarray(offset,offset+n));offset+=n;}
  });});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{const port=(server.address() as {port:number}).port;expect(await createClamdScanner({host:'127.0.0.1',port,tls:false,timeoutMs:100}).scan(photo)).toBe(expected);expect(scanned).toEqual(photo);}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
}
test('clamd connection failure and caller abort never report clean',async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
 expect(await createClamdScanner({host:'127.0.0.1',port,tls:false,timeoutMs:100}).scan(photo)).toBe('error');
 expect(await createClamdScanner({host:'127.0.0.1',port,tls:false}).scan(photo,AbortSignal.abort())).toBe('error');
});
test('grant signatures bind scope, session, resource and exact expiry',()=>{
 const receipt={id:'synthetic',version:1,expires_at:'2099-01-01T00:01:00.000Z'},key=hash('synthetic signing key'),token=grantToken(key,receipt,'org','branch','booking','session');
 expect(()=>verifyGrant(key,token,receipt,'org','branch','booking','session',new Date('2099-01-01T00:00:59.999Z'))).not.toThrow();
 for(const now of ['2099-01-01T00:01:00.000Z','2099-01-01T00:01:00.001Z'])expect(()=>verifyGrant(key,token,receipt,'org','branch','booking','session',new Date(now))).toThrow();
 expect(()=>verifyGrant(key,token,receipt,'org','branch','booking','other-session',new Date('2099-01-01T00:00:00Z'))).toThrow();
 expect(()=>verifyGrant(key,token.slice(0,-1)+'é',receipt,'org','branch','booking','session',new Date('2099-01-01T00:00:00Z'))).toThrow(expect.objectContaining({code:'RESOURCE_NOT_FOUND'}));
});
test('storage configuration is strict, server-only and hosted plaintext/local fallback fails closed',()=>{
 const config={storage:{endpoint:'http://127.0.0.1:9000',region:'us-east-1',bucket:'shipit-developer-test',accessKeyId:'SYN_TEST_ACCESS',secretAccessKey:'SYN_STORAGE_CREDENTIAL'},scanner:{host:'127.0.0.1',port:3310,tls:false},signingKey:'x'.repeat(43)};
 expect(parseAttachmentConfiguration(JSON.stringify(config),'developer').storage.bucket).toBe('shipit-developer-test');
 for(const mode of ['staging','production','demo'] as const)expect(()=>parseAttachmentConfiguration(JSON.stringify(config),mode)).toThrow();
 for(const value of [{...config,public:true},{...config,signingKey:'short'},{...config,storage:{...config.storage,endpoint:'https://user:secret@example.test'}}])expect(()=>parseAttachmentConfiguration(JSON.stringify(value),'developer')).toThrow();
});
