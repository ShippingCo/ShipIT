import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client,CreateBucketCommand,GetBucketPolicyCommand,PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { createS3Store } from '../../src/modules/attachments/s3.ts';
import { hash } from '../../src/modules/attachments/validation.ts';
import { photo } from '../attachment-support.ts';
import { readBounded } from '../../src/modules/attachments/content.ts';
const endpoint=process.env.ATTACHMENT_TEST_ENDPOINT,accessKeyId=process.env.ATTACHMENT_TEST_ACCESS_KEY,secretAccessKey=process.env.ATTACHMENT_TEST_SECRET;
if(!endpoint||!accessKeyId||!secretAccessKey||!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))throw new Error('ATTACHMENT_CONTRACT_CONFIGURATION_REQUIRED');
const bucket='shipit-developer-contract-'+randomUUID(),config={endpoint,accessKeyId,secretAccessKey,bucket,region:'us-east-1'},store=createS3Store(config);
const setup=new S3Client({endpoint,region:config.region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},maxAttempts:1});
beforeAll(async()=>{await setup.send(new CreateBucketCommand({Bucket:bucket}));});afterAll(()=>{store.close?.();setup.destroy();});
test('actual S3 private conditional Put, checksum, identity, bounded Get and idempotent Delete',async()=>{
 const key='evidence/'+randomUUID(),identity={uploadId:randomUUID(),size:photo.length,digest:hash(photo)};
 expect(await store.head(key)).toBeNull();await store.put(key,Readable.from(photo),identity,AbortSignal.timeout(5000));expect(await store.head(key)).toEqual(identity);
 const response=await fetch(`${endpoint}/${bucket}/${key}`);expect(response.status).toBe(403);
 await expect(setup.send(new GetBucketPolicyCommand({Bucket:bucket}))).rejects.toThrow();
 await expect(store.put(key,Readable.from(photo),identity,AbortSignal.timeout(5000))).rejects.toMatchObject({code:'ATTACHMENT_UPLOAD_FAILED'});
 const saved=await store.get(key);expect(saved.uploadId).toBe(identity.uploadId);expect(await readBounded(saved.body,photo.length)).toEqual(photo);
 await store.delete(key);await store.delete(key);expect(await store.head(key)).toBeNull();
});
test('actual S3 rejects wrong checksum, truncated stream and aborted uploads without a readable object',async()=>{
 for(const mode of ['checksum','short','abort']){
  const key='evidence/'+randomUUID(),controller=new AbortController(),identity={uploadId:randomUUID(),size:photo.length,digest:mode==='checksum'?'0'.repeat(64):hash(photo)};
  if(mode==='abort')controller.abort();
  await expect(store.put(key,Readable.from(mode==='short'?photo.subarray(0,4):photo),identity,controller.signal)).rejects.toMatchObject({code:'ATTACHMENT_UPLOAD_FAILED'});
  expect(await store.head(key)).toBeNull();
 }
});

test('versioned buckets fail closed so cleanup cannot mistake a delete marker for removed bytes',async()=>{
 const versioned='shipit-developer-versions-'+randomUUID();await setup.send(new CreateBucketCommand({Bucket:versioned}));
 await setup.send(new PutBucketVersioningCommand({Bucket:versioned,VersioningConfiguration:{Status:'Enabled'}}));
 const guarded=createS3Store({...config,bucket:versioned}),key='evidence/'+randomUUID();
 try{await expect(guarded.put(key,Readable.from(photo),{uploadId:randomUUID(),size:photo.length,digest:hash(photo)},AbortSignal.timeout(5000))).rejects.toMatchObject({code:'ATTACHMENT_UPLOAD_FAILED'});
 await expect(guarded.delete(key)).rejects.toMatchObject({code:'TEMPORARILY_UNAVAILABLE'});expect(await guarded.head(key)).toBeNull();}finally{guarded.close?.();}
});
