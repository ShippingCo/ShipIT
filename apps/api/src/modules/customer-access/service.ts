import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { withCustomerTrackingScope } from '../security/jobs.ts';
import { assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { object, integer, uuid } from '../pricing/validation.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { digest, keyDigest } from '../pricing/idempotency.ts';
import { openInboxPayload, type BusinessWebhookConfig } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { accessToken, tokenDigest } from './crypto.ts';
import * as repository from './repository.ts';

function channel(config:BusinessWebhookConfig,row:NonNullable<Awaited<ReturnType<typeof repository.source>>>) {
  try {
    const payload=openInboxPayload(config,row) as {from?:unknown};
    if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from))throw new Error('INVALID_CHANNEL');
    return {phone:'+'+payload.from,contact:consentContactKey(config,row.installation_id,'+'+payload.from)};
  } catch { throw new HttpError('TEMPORARILY_UNAVAILABLE'); }
}

/** No caller-provided sender/phone supplies customer authority. */
export function createCustomerAccessService(database:DatabasePool,config:BusinessWebhookConfig,key:Buffer) {
  return {
    async revoke(token:string,parcelInput:unknown,query:unknown,keyInput:unknown,body:unknown,correlation:string) {
      const q=object(query,['organization_id','franchise_id']),org=uuid(q.organization_id,'$'),franchise=uuid(q.franchise_id,'$');
      const parcel=uuid(parcelInput,'$'),b=object(body,['relation','evidence_ref','expected_version']);
      if(b.relation!=='sender'&&b.relation!=='recipient')throw new HttpError('VALIDATION_FAILED');
      const relation=b.relation,evidence=uuid(b.evidence_ref,'$'),expected=integer(b.expected_version,'$',1,2147483646);
      const commandKey=keyDigest(idempotencyKey(keyInput)),fingerprint=digest({operation:'revoke',parcel,body:b});
      return withWhatsappScope(database,token,org,franchise,'customer.access.manage',correlation,async scope=>{
        if(!await repository.parcel(scope,parcel))throw new HttpError('RESOURCE_NOT_FOUND');
        const prior=await repository.replay(scope,commandKey);
        if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
        const previous=await repository.binding(scope,parcel,relation);if(!previous)throw new HttpError('RESOURCE_NOT_FOUND');
        if(previous.version!==expected)throw new HttpError('VERSION_CONFLICT');
        const revoked=await repository.revoke(scope,previous.id,evidence);
        const result={id:revoked.id,version:revoked.version,expires_at:revoked.expires_at.toISOString()};
        await repository.record(scope,revoked.id,commandKey,fingerprint,result,evidence,previous.inbox_id,relation);return result;
      });
    },
    async bind(token:string,parcelInput:unknown,query:unknown,keyInput:unknown,body:unknown,correlation:string) {
      const q=object(query,['organization_id','franchise_id']),org=uuid(q.organization_id,'$'),franchise=uuid(q.franchise_id,'$');
      const parcel=uuid(parcelInput,'$'),b=object(body,['relation','inbox_id','evidence_ref','expected_version','recipient_rebind']);
      if(b.relation!=='sender'&&b.relation!=='recipient')throw new HttpError('VALIDATION_FAILED');
      if(b.recipient_rebind!==undefined&&b.recipient_rebind!==true)throw new HttpError('VALIDATION_FAILED');
      const relation=b.relation,inbox=uuid(b.inbox_id,'$'),evidence=uuid(b.evidence_ref,'$'),expected=integer(b.expected_version,'$',0,2147483646);
      if(b.recipient_rebind&&relation!=='recipient')throw new HttpError('VALIDATION_FAILED');
      const commandKey=keyDigest(idempotencyKey(keyInput)),fingerprint=digest({parcel,body:b});
      return withWhatsappScope(database,token,org,franchise,'customer.access.manage',correlation,async scope=>{
        const shipment=await repository.parcel(scope,parcel);if(!shipment)throw new HttpError('RESOURCE_NOT_FOUND');
        const prior=await repository.replay(scope,commandKey);
        if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
        const previous=await repository.binding(scope,parcel,relation);
        if((previous?.version??0)!==expected)throw new HttpError('VERSION_CONFLICT');
        if(b.recipient_rebind&&!previous)throw new HttpError('VALIDATION_FAILED');
        const source=await repository.source(scope,inbox);if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
        const identity=channel(config,source);
        // The independent evidence is an administrator attestation, not phone matching.
        // Matching only guards accidental binding to the wrong recorded relationship.
        if(relation==='sender'&&identity.phone!==shipment.phone_normalized)throw new HttpError('RESOURCE_NOT_FOUND');
        if(relation==='recipient'&&!b.recipient_rebind&&identity.phone!==shipment.recipient_phone)throw new HttpError('RESOURCE_NOT_FOUND');
        const binding=await repository.bind(scope,{id:previous?.id??randomUUID(),parcel_id:parcel,installation_id:source.installation_id,inbox_id:inbox,
          relation,contact_key:identity.contact,customer_id:relation==='sender'?shipment.customer_id:null,
          contact_version:relation==='sender'?shipment.contact_version:null,version:expected+1,expires_at:new Date()},evidence,inbox);
        const result={id:binding.id,version:binding.version,expires_at:binding.expires_at.toISOString()};
        await repository.record(scope,binding.id,commandKey,fingerprint,result,evidence,inbox,relation);return result;
      });
    },
    /** #47 calls this inside the trusted signed-inbox transaction, never from browser input. */
    async select(scope:TenantAccess,inboxInput:unknown,docket:string|null=null) {
      assertTenantAccess(scope,['whatsapp.inbox.work']);const inbox=uuid(inboxInput,'$');
      if(docket!==null&&!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(docket))throw new HttpError('VALIDATION_FAILED');
      const source=await repository.source(scope,inbox);if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
      const identity=channel(config,source),bindings=await repository.selection(scope,source.installation_id,identity.contact,docket);
      const items=[];
      for(const binding of bindings.slice(0,10)) {
        const id=randomUUID(),stored=await repository.grant(scope,binding,inbox,id,tokenDigest(accessToken(key,id)));
        if(stored.expires_at<=new Date())continue;
        const grant=accessToken(key,stored.id);
        if(tokenDigest(grant)!==stored.token_digest)throw new HttpError('TEMPORARILY_UNAVAILABLE');
        items.push({docket:binding.docket,grant,expires_at:stored.expires_at.toISOString()});
      }
      return {items,selection_required:items.length>1,has_more:bindings.length>10};
    },
    async track(grant:unknown,docketInput:unknown=null) {
      const hash=tokenDigest(grant);
      if(docketInput!==null&&(typeof docketInput!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(docketInput)))throw new HttpError('VALIDATION_FAILED');
      const docket=docketInput as string|null;
      return withCustomerTrackingScope(database,hash,async scope=>{
        const parcel=await repository.tracking(scope,hash,docket);if(!parcel)throw new HttpError('RESOURCE_NOT_FOUND');
        const events=await repository.timeline(scope,parcel.id),eta=await repository.eta(scope,parcel.id);
        // Route arrival is relevant only while travelling on a route. Never
        // carry it into last-mile delivery, failed/held work or terminal states.
        const available=eta!==null&&['dispatched','in_transit'].includes(parcel.status);
        return {docket:parcel.docket,status:parcel.status,version:parcel.version,
          eta:available?{state:'available' as const,at:eta.toISOString(),kind:'route_arrival' as const}:{state:'unavailable' as const,at:null},
          timeline:events.reverse().map(e=>({event:e.event_type,at:e.occurred_at.toISOString()}))};
      });
    },
  };
}
