import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { S3Client, GetBucketVersioningCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { HttpError } from '../../plugins/errors.ts';
import type { AttachmentObjectStore, StoredIdentity } from './types.ts';
export interface S3Configuration { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }
export function createS3Store(config: S3Configuration): AttachmentObjectStore {
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { httpAgent: new HttpAgent({keepAlive:false}), httpsAgent: new HttpsAgent({keepAlive:false}), connectionTimeout: 2000, requestTimeout: 15000, throwOnRequestTimeout: true } });
  const params = (key: string) => {
    if (!/^evidence\/[a-f0-9-]{36}$/.test(key)) throw new HttpError('TEMPORARILY_UNAVAILABLE');
    return { Bucket: config.bucket, Key: key };
  };
  const identity = (size: number | undefined, metadata: Record<string,string> | undefined): StoredIdentity => {
    const uploadId = metadata?.['upload-id'], digest = metadata?.sha256;
    if (!uploadId || !/^[a-f0-9-]{36}$/.test(uploadId) || !digest || !/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || Number(metadata?.size) !== size) throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
    return { uploadId, size: size!, digest };
  };
  const unavailable = () => new HttpError('TEMPORARILY_UNAVAILABLE');
  // Delete markers would release quota while retaining private object versions.
  // Verify before every write/delete; #68 must prohibit enabling versioning here.
  const unversioned=async(signal:AbortSignal)=>{
    const state=await client.send(new GetBucketVersioningCommand({Bucket:config.bucket}),{abortSignal:signal});
    if(state.Status!==undefined||state.MFADelete==='Enabled')throw unavailable();
  };
  return {
    async head(key, signal = AbortSignal.timeout(15000)) {
      try { const r = await client.send(new HeadObjectCommand(params(key)), { abortSignal: signal }); return identity(r.ContentLength,r.Metadata); }
      catch (e) { if ((e as {$metadata?: {httpStatusCode?: number}}).$metadata?.httpStatusCode === 404) return null; if (e instanceof HttpError) throw e; throw unavailable(); }
    },
    async put(key, body, expected, signal) {
      try { await unversioned(signal); await client.send(new PutObjectCommand({ ...params(key), Body: body, ContentLength: expected.size, ContentType: 'application/octet-stream',
        IfNoneMatch: '*', ChecksumSHA256: Buffer.from(expected.digest,'hex').toString('base64'),
        Metadata: { 'upload-id': expected.uploadId, size: String(expected.size), sha256: expected.digest } }), { abortSignal: signal }); }
      catch { throw new HttpError('ATTACHMENT_UPLOAD_FAILED'); }
    },
    async get(key, signal = AbortSignal.timeout(15000)) {
      try {
        const r = await client.send(new GetObjectCommand(params(key)), { abortSignal: signal });
        try { if (!(r.Body instanceof Readable)) throw unavailable(); return { ...identity(r.ContentLength,r.Metadata), body: r.Body }; }
        catch (e) { if (r.Body instanceof Readable) r.Body.destroy(); throw e; }
      } catch (e) { if (e instanceof HttpError) throw e; throw unavailable(); }
    },
    async delete(key, signal = AbortSignal.timeout(2000)) {
      try { await unversioned(signal); await client.send(new DeleteObjectCommand(params(key)), { abortSignal: signal }); } catch { throw unavailable(); }
    },
    close() { client.destroy(); },
  };
}
