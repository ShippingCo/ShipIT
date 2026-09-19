import { isIP } from 'node:net';
import { ConfigurationError, type RuntimeEnvironment } from '../../env.ts';
import { createS3Store, type S3Configuration } from './s3.ts';
import { createClamdScanner, type ScannerConfiguration } from './scanner.ts';
import type { AttachmentDependencies } from './types.ts';
export interface AttachmentConfiguration { storage: S3Configuration; scanner: ScannerConfiguration; signingKey: string }
export function parseAttachmentConfiguration(raw:string,environment:RuntimeEnvironment):AttachmentConfiguration {
  const fail=():never=>{throw new ConfigurationError([{field:'STORAGE_CREDENTIAL_REF',code:'INVALID_FORMAT'}]);};
  try {
    const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return fail();
    const c=value as Record<string,unknown>;
    if(Object.keys(c).sort().join(',')!=='scanner,signingKey,storage')return fail();
    const storage=c.storage as S3Configuration,scanner=c.scanner as ScannerConfiguration;
    if(!storage||!scanner||Object.keys(storage).sort().join(',')!=='accessKeyId,bucket,endpoint,region,secretAccessKey'||Object.keys(scanner).sort().join(',')!=='host,port,tls')return fail();
    if(Object.values(storage).some(v=>typeof v!=='string'||!v||v.length>2048))return fail();
    const endpoint=new URL(storage.endpoint),local=['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname);
    if(endpoint.origin!==storage.endpoint||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['http:','https:'].includes(endpoint.protocol))return fail();
    if(environment!=='developer'&&(endpoint.protocol!=='https:'||local))return fail();
    if(endpoint.protocol==='http:'&&(!local||environment!=='developer'))return fail();
    if(!new RegExp('^shipit-'+environment+'-[a-z0-9-]{1,40}$').test(storage.bucket)||!/^[a-z0-9-]{1,40}$/.test(storage.region))return fail();
    if(!/^[A-Za-z0-9_-]{8,128}$/.test(storage.accessKeyId)||storage.secretAccessKey.length<16)return fail();
    if(typeof scanner.host!=='string'||(!isIP(scanner.host)&&!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(scanner.host))||!Number.isInteger(scanner.port)||scanner.port<1||scanner.port>65535||typeof scanner.tls!=='boolean')return fail();
    if(!scanner.tls&&(environment!=='developer'||!['localhost','127.0.0.1','::1'].includes(scanner.host)))return fail();
    if(typeof c.signingKey!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(c.signingKey))return fail();
    return {storage:Object.freeze({...storage}),scanner:Object.freeze({...scanner}),signingKey:c.signingKey};
  }catch{return fail();}
}
export function attachmentAdapters(config:AttachmentConfiguration):AttachmentDependencies {
  return {store:createS3Store(config.storage),scanner:createClamdScanner(config.scanner),signingKey:config.signingKey};
}
