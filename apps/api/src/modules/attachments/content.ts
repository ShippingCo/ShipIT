import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { attachmentLimits, attachmentMedia } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
/** Bounds actual bytes, including when Content-Length is missing or false. */
export function boundedStream(source: Readable, expected: number, controller: AbortController) {
  let count = 0;
  const digest = createHash('sha256');
  const stream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    count += chunk.length;
    if (count > expected || count > attachmentLimits.fileBytes) { const error = new HttpError('ATTACHMENT_LIMIT_EXCEEDED'); controller.abort(error); callback(error); return; }
    digest.update(chunk); callback(null, chunk);
  }, flush(callback) { callback(count === expected ? undefined : new HttpError('ATTACHMENT_CONTENT_MISMATCH')); } });
  source.on('error', error => stream.destroy(error));
  // Always consume errors even if a provider rejects before attaching its reader.
  stream.on('error', () => {});
  const abort = () => { source.unpipe(stream); source.pause(); stream.destroy(new HttpError('ATTACHMENT_UPLOAD_FAILED')); };
  controller.signal.addEventListener('abort', abort, { once: true });
  source.pipe(stream);
  return { stream, digest: () => digest.digest('hex'), dispose: () => { controller.signal.removeEventListener('abort', abort); source.unpipe(stream); stream.destroy(); } };
}
export async function readBounded(source: Readable, expected: number, signal?: AbortSignal) {
  const chunks: Buffer[] = []; let count = 0;
  const abort = () => source.destroy(new HttpError('TEMPORARILY_UNAVAILABLE'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new HttpError('TEMPORARILY_UNAVAILABLE');
    for await (const value of source) {
      const chunk = Buffer.from(value); count += chunk.length;
      if (count > expected || count > attachmentLimits.fileBytes) throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
      chunks.push(chunk);
    }
    if (count !== expected || count === 0) throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
    return Buffer.concat(chunks, count);
  } finally { signal?.removeEventListener('abort', abort); source.destroy(); }
}
export async function detectedType(bytes: Buffer) {
  try {
    const result = await fileTypeFromBuffer(bytes);
    if (!result || !Object.hasOwn(attachmentMedia, result.mime)) throw new HttpError('ATTACHMENT_TYPE_UNSUPPORTED');
    return result.mime;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError('ATTACHMENT_TYPE_UNSUPPORTED'); }
}
