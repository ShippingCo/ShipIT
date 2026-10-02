import { randomUUID } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { scopedQuery,assertTenantAccess,type TenantAccess } from '../security/scope.ts';
import { source,selection } from '../customer-access/repository.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { openDeliveryCode } from './crypto.ts';
import { assertResendPolicy } from './resend-policy.ts';
import { reserveChallengeSend } from './messaging.ts';
import * as repository from './repository.ts';
import type { DeliveryProofConfiguration } from './types.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';

/** Only a fresh signed, parcel-verified actual recipient may request this side effect. */
export async function requestCustomerResend(scope:TenantAccess,inbox:string,docket:string,configuration:DeliveryProofConfiguration,whatsapp:WhatsappDependencies) {
 const c=assertTenantAccess(scope,['whatsapp.inbox.work']),config=whatsapp.configuration.webhook;
 if(!config)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 const row=await source(scope,inbox);if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 const payload=openInboxPayload(config,row) as {from?:unknown};
 if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from))throw new HttpError('RESOURCE_NOT_FOUND');
 const phone='+'+payload.from,contact=consentContactKey(config,row.installation_id,phone);
 const binding=(await selection(scope,row.installation_id,contact,docket))[0];if(!binding)throw new HttpError('RESOURCE_NOT_FOUND');
 const a=await repository.lockAttempt(scope,binding.parcel_id,false);
 const recipient=(await scopedQuery(scope,['whatsapp.inbox.work'],`SELECT r.id FROM shipit.delivery_recipients r
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1 AND r.parcel_id=$2 AND r.phone_normalized=$3 AND r.contact_version=$4`,
 [a.recipient_ref,a.parcel_id,phone,a.recipient_contact_version])).rows[0];
 if(!recipient)throw new HttpError('ACTION_FORBIDDEN');
 const prior=(await scopedQuery<{result:{state:'queued'|'failed';reason_code:string}}>(scope,['whatsapp.inbox.work'],`SELECT d.result FROM shipit.delivery_commands d
  WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.customer_inbox_id=$1 AND d.parcel_id=$2 AND d.state='committed'`,[inbox,a.parcel_id])).rows[0];
 if(prior)return prior.result;
 const time=await repository.now(scope,whatsapp.clock?.()),latest=await repository.latestSend(scope,a.id);assertResendPolicy(a,time,latest);
 if(!a.encrypted_secret)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
 const command=randomUUID(),input={expected_version:a.parcel_version,challenge_ref:a.challenge_id},key=keyDigest(inbox),fingerprint=digest(input);
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.delivery_commands(id,principal_id,customer_inbox_id,organization_id,franchise_id,parcel_id,attempt_id,operation_id,key_digest,fingerprint,expected_version,input,correlation_id)
  SELECT $1,NULL,$2,{{organization}},$3,$4,$5,'api.v1.deliveries.resend',$6,$7,$8,$9,$10 WHERE {{franchise:$11:$3}}`,
 [command,inbox,c.permittedFranchiseIds[0],a.parcel_id,a.id,key,fingerprint,a.parcel_version,input,c.correlationId,c.organizationId]);
 const advanced=await repository.advanceResend(scope,a.id);if(!advanced)throw new HttpError('DELIVERY_RESEND_LIMIT');
 const code=openDeliveryCode(configuration.keys,[a.organization_id,a.franchise_id,a.parcel_id,a.id,a.assignment_id,a.recipient_ref,a.recipient_contact_version,String(a.challenge_version),a.challenge_id],a.encrypted_secret,a.key_version);
 const result=await reserveChallengeSend(scope,whatsapp,configuration,{attempt:a.id,challenge:a.challenge_id,parcel:a.parcel_id,recipient:a.recipient_ref,contactVersion:a.recipient_contact_version,
  code,expires:a.expires_at,command,kind:'resend',ordinal:advanced.resend_count,time});
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.delivery_commands d SET state='committed',http_status=200,result=$2,committed_at=$3,retain_until=$3::timestamptz+interval '24 hours'
  WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.id=$1 AND d.state='reserved'`,[command,result,time]);
 return result as {state:'queued'|'failed';reason_code:string};
}
