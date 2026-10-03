import { randomUUID } from 'node:crypto';
import type { TenantAccess } from '../security/scope.ts';
import { assertTenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { integer } from '../pricing/validation.ts';
import { digest } from '../pricing/idempotency.ts';
import type { Observation } from './contract.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
import * as rr from './reconciliation-repository.ts';

/** Internal port, never an HTTP route. The caller authenticates the adapter/receipt,
 * resolves installation credentials and holds an authorized transaction. No network I/O here.
 * A page and its checkpoint commit together; failure retains the previous cursor.
 */
export async function ingestTrackingPage(s:TenantAccess,value:unknown,now=new Date()) {
  const c=assertTenantAccess(s,['carriers.write']);
  const b=v.object(value,['id','installation_id','expected_version','cursor','state','channel','observations']);
  const id=v.uuid(b.id,'$'),installationId=v.uuid(b.installation_id,'$'),expected=integer(b.expected_version,'expected_version',0,2147483646);
  if(!['success','unavailable','auth_failed'].includes(String(b.state))||!['poll','webhook'].includes(String(b.channel))||
    (b.cursor!==null&&(typeof b.cursor!=='string'||! /^[A-Za-z0-9._:/=-]{1,256}$/.test(b.cursor)))||
    !Array.isArray(b.observations)||b.observations.length>20||(b.state!=='success'&&b.observations.length))throw new HttpError('VALIDATION_FAILED');
  const installation=await r.installation(s,installationId),fingerprint=digest(b),prior=await rr.checkpointById(s,id);
  if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id,version:prior.version};}
  const checkpoint=await rr.checkpoint(s,installationId);
  if((checkpoint?.version??0)!==expected)throw new HttpError('VERSION_CONFLICT');
  for(const raw of b.observations){
    const item=v.object(raw,['parcel_id','reference_id','external_docket','source_id','status_code','status','occurred_at']);
    const parcelId=v.uuid(item.parcel_id,'$'),referenceId=v.uuid(item.reference_id,'$');
    const parcel=await r.parcel(s,parcelId),reference=await r.reference(s,referenceId,parcelId);
    if(reference.installation_id!==installation.id)throw new HttpError('RESOURCE_NOT_FOUND');
    const normalized=v.observation({reference_id:referenceId,expected_parcel_version:parcel.version,status_code:item.status_code,status:item.status,occurred_at:item.occurred_at});
    const source=v.code(item.source_id),external=v.code(item.external_docket);
    const evidence:Observation={contractVersion:1,reference:{organizationId:c.organizationId!,franchiseId:c.permittedFranchiseIds[0]!,installationId,externalDocket:external},
      dimensions:reference.dimensions,status:normalized.status?{state:'mapped',status:normalized.status,mappingVersionId:id}:{state:'unmapped',sourceCode:normalized.status_code},
      occurredAt:normalized.occurred_at,receivedAt:now.toISOString(),sourceRecordId:source,
      provenance:{mode:'live_api',channel:b.channel as 'poll'|'webhook',receiptId:id,providerEventId:source}};
    await rr.record(s,randomUUID(),parcelId,referenceId,evidence,normalized.status_code,null);
  }
  await rr.saveCheckpoint(s,id,installationId,expected+1,b.state==='success'&&b.channel==='poll'?b.cursor as string|null:checkpoint?.cursor_value??null,String(b.state),fingerprint,now);
  return {id,version:expected+1};
}
