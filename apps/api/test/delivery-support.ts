import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDeliveryService } from '../src/modules/deliveries/service.ts';
import type { DeliveryProofConfiguration } from '../src/modules/deliveries/types.ts';
import { openDeliveryCode } from '../src/modules/deliveries/crypto.ts';
import { finalizedManifest } from './route-support.ts';
import { org,A } from './audit-support.ts';
import type { bookingSetup } from './booking-support.ts';
import type { WhatsappDependencies } from '../src/modules/whatsapp/types.ts';

type DeliveryTestContext=Pick<Awaited<ReturnType<typeof bookingSetup>>,
 'db'|'pool'|'keys'|'operator'|'grant'|'app'|'headers'|'cookies'|'clock'>;

export const deliveryProofConfiguration:DeliveryProofConfiguration={keys:{version:'test-v1',verifier:Buffer.alloc(32,41),encryption:Buffer.alloc(32,73)},template_name:'shipit_delivery_code',template_language:'en',meta_send_qualified:true};

export async function startTestDelivery(s:DeliveryTestContext,parcelId:string,agent:{id:string;token:string},dispatcher?:{id:string;token:string},whatsapp?:WhatsappDependencies){
 await s.db.prepareRoutes();
 const assignedDispatcher=dispatcher??await s.grant('dispatcher',[A]);
 const post=(path:string,payload:unknown,actor:{token:string})=>s.app.inject({method:'POST',url:`/api/v1/parcels/${parcelId}/${path}?`+new URLSearchParams({organization_id:org,franchise_id:A}),
  headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(actor.token),payload:JSON.stringify(payload)});
 let response=await post('check-in',{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()},s.operator);assert.equal(response.statusCode,200,response.body);
 const manifest=await finalizedManifest(s.pool,s.keys.browser,s.operator.token,[parcelId]);
 response=await post('dispatch',{expected_version:2,evidence_ref:randomUUID(),manifest_id:manifest},s.operator);assert.equal(response.statusCode,200,response.body);
 response=await post('transit',{expected_version:3,evidence_ref:randomUUID(),route_id:randomUUID()},assignedDispatcher);assert.equal(response.statusCode,200,response.body);
 await s.db.prepareDeliveries();const service=createDeliveryService(s.pool,deliveryProofConfiguration,whatsapp,s.clock),key=randomUUID();
 const state=await service.start(assignedDispatcher.token,parcelId,{organization_id:org,franchise_id:A},key,['idempotency-key',key],
  {expected_version:4,agent_id:agent.id,handover_evidence_ref:randomUUID()},false,randomUUID());
 return {service,state,dispatcher:assignedDispatcher};
}

export async function testDeliveryCode(s:DeliveryTestContext,parcelId:string){
 const row=(await s.db.adminQuery(`SELECT a.organization_id,a.franchise_id,a.parcel_id,a.id AS attempt_id,a.assignment_id,a.recipient_ref,a.recipient_contact_version,c.id AS challenge_id,c.challenge_version,c.encrypted_secret,c.key_version
  FROM shipit.delivery_attempts a JOIN shipit.delivery_challenges c ON c.attempt_id=a.id AND c.superseded_at IS NULL WHERE a.parcel_id=$1 ORDER BY a.attempt_number DESC LIMIT 1`,[parcelId])).rows[0]!;
 const parts=[row.organization_id,row.franchise_id,row.parcel_id,row.attempt_id,row.assignment_id,row.recipient_ref,row.recipient_contact_version,String(row.challenge_version),row.challenge_id];
 return openDeliveryCode(deliveryProofConfiguration.keys,parts,row.encrypted_secret,row.key_version);
}
