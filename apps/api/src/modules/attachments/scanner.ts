import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { attachmentLimits } from '@shippingco/shared';
import type { AttachmentScanner } from './types.ts';
export interface ScannerConfiguration { host: string; port: number; tls: boolean; timeoutMs?: number }
/** clamd INSTREAM: NUL command, unsigned big-endian lengths, zero terminator. */
export function createClamdScanner(config: ScannerConfiguration): AttachmentScanner {
  return { scan(bytes, signal) {
    if (!bytes.length || bytes.length > attachmentLimits.fileBytes || signal?.aborted) return Promise.resolve('error');
    return new Promise(resolve => {
      const socket = config.tls ? tlsConnect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true }) : tcpConnect({ host: config.host, port: config.port });
      let response = Buffer.alloc(0), finished = false;
      const finish = (result: 'clean'|'infected'|'error') => {
        if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); resolve(result);
      };
      const abort = () => finish('error');
      const timer = setTimeout(abort, config.timeoutMs ?? 10000);
      signal?.addEventListener('abort',abort,{once:true});
      socket.on('error',abort); socket.on('end',abort);
      socket.on('data',chunk=>{
        if (response.length + chunk.length > 1024) { finish('error'); return; }
        response = Buffer.concat([response,chunk]);
        const end = response.indexOf(0);
        if (end < 0) return;
        if (end !== response.length - 1) { finish('error'); return; }
        const value = response.subarray(0,end).toString('utf8');
        finish(value === 'stream: OK' ? 'clean' : /^stream: [A-Za-z0-9._: -]{1,240} FOUND$/.test(value) ? 'infected' : 'error');
      });
      socket.once(config.tls?'secureConnect':'connect',()=>{
        socket.write('zINSTREAM\0');
        let offset = 0;
        const write = () => {
          while (offset < bytes.length && !finished) {
            const end = Math.min(offset+65536,bytes.length), size=Buffer.alloc(4);size.writeUInt32BE(end-offset);
            socket.write(size);const accepted=socket.write(bytes.subarray(offset,end));offset=end;
            if (!accepted) {socket.once('drain',write);return;}
          }
          if (!finished) socket.write(Buffer.alloc(4));
        };
        write();
      });
    });
  } };
}
