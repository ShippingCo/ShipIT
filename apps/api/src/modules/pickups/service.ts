import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { scopedQuery } from '../security/scope.ts';
import { uuid,integer,object,idempotencyKey } from '../pricing/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { windowInput,transition } from './rules.ts';
import { enqueueDecision } from './notifications.ts';
import * as repository from './repository.ts';

export function createPickupService(database:DatabasePool,deps:WhatsappDependencies) {
 const selection=(value:unknown)=>{const b=object(value,['organization_id','franchise_id','after']);return {org:uuid(b.organization_id),franchise:uuid(b.franchise_id),after:b.after===undefined?null:uuid(b.after)};};
 return {
  async list(token:string,query:unknown,correlation:string) {
   const q=selection(query);
   return withWhatsappScope(database,token,q.org,q.franchise,'pickups.read',correlation,async scope=>{
    const rows=(await scopedQuery<repository.Pickup>(scope,['pickups.read'],`SELECT p.* FROM shipit.pickup_requests p
     WHERE {{franchise:p.organization_id:p.franchise_id}} AND ($1::uuid IS NULL OR p.id>$1) ORDER BY p.id LIMIT 51`,[q.after])).rows;
    return {items:rows.slice(0,50).map(repository.summary),next:rows.length>50?rows[49]!.id:null};
   });
  },
  async detail(token:string,id:string,query:unknown,correlation:string) {
   uuid(id);const q=selection(query);
   return withWhatsappScope(database,token,q.org,q.franchise,'pickups.read',correlation,async scope=>{
    const p=await repository.get(scope,id);if(!p)throw new HttpError('RESOURCE_NOT_FOUND');
    const shipment=(await scopedQuery(scope,['pickups.read'],`SELECT q.input FROM shipit.customer_quotes q WHERE {{franchise:q.organization_id:q.franchise_id}} AND q.id=$1`,[p.quote_id])).rows[0];
    const source=(await scopedQuery<{event_key:string;sealed_payload:string;key_version:string;waba_id:string;phone_number_id:string}>(scope,['pickups.read'],`SELECT j.event_key,j.sealed_payload,j.key_version,i.waba_id,i.phone_number_id
     FROM shipit.whatsapp_inbox j JOIN shipit.whatsapp_installations i ON i.organization_id=j.organization_id AND i.franchise_id=j.franchise_id AND i.id=j.installation_id
     WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1 AND j.installation_id=$2`,[p.inbox_id,p.installation_id])).rows[0];
    let contact:string|null=null;
    try {
     const config=deps.configuration.webhook;
     if(source&&config) {
      const payload=openInboxPayload(config,source) as {from?:unknown};
      if(typeof payload.from==='string'&&/^[1-9][0-9]{7,14}$/.test(payload.from)&&consentContactKey(config,p.installation_id,'+'+payload.from)===p.contact_key)contact='+'+payload.from;
     }
    }catch{/* Missing/rotated private source is reported without exposing provider data. */}
    return {...repository.summary(p),address:p.address,contact,shipment:shipment?.input,assigned_staff_id:p.assigned_staff_id,notification:await repository.notification(scope,id)};
   });
  },
  async decide(token:string,id:string,query:unknown,key:unknown,input:unknown,correlation:string) {
   uuid(id);const q=selection(query),b=object(input,['expected_version','decision','agreed_start','agreed_end','capacity_checked','manual_reviewed']);
   const expected=integer(b.expected_version,'$',1,2147483646),decision=b.decision;
   if(!['accepted','declined'].includes(String(decision))||b.capacity_checked!==undefined&&typeof b.capacity_checked!=='boolean'||b.manual_reviewed!==undefined&&typeof b.manual_reviewed!=='boolean')throw new HttpError('VALIDATION_FAILED');
   if(decision==='declined'&&(b.agreed_start!==undefined||b.agreed_end!==undefined))throw new HttpError('VALIDATION_FAILED');
   const hash=keyDigest(idempotencyKey(key)),fingerprint=digest({id,...b});
   return withWhatsappScope(database,token,q.org,q.franchise,'pickups.decide',correlation,async scope=>{
    if(!deps.configuration.pickup_enabled||!deps.configuration.webhook)throw new HttpError('TEMPORARILY_UNAVAILABLE');
    const active=(await scopedQuery(scope,['pickups.decide'],`SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} AND f.lifecycle='active'`,[])).rows[0];
    if(!active)throw new HttpError('ACTION_FORBIDDEN');
    // Root -> installation -> request matches inbound and dispatch lock order.
    await scopedQuery(scope,['pickups.decide'],`SELECT i.id FROM shipit.whatsapp_installations i WHERE {{franchise:i.organization_id:i.franchise_id}} FOR UPDATE`);
    const p=await repository.get(scope,id,true);if(!p)throw new HttpError('RESOURCE_NOT_FOUND');
    const prior=(await scopedQuery<{fingerprint:string;result:ReturnType<typeof repository.summary>}>(scope,['pickups.decide'],`SELECT r.fingerprint,r.result FROM shipit.pickup_commands r
     WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_digest=$2`,[scope.context.actor.id,hash])).rows[0];
    if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
    transition(p.state,String(decision),p.version,expected);
    let agreed:{window_start:string;window_end:string}|null=null;
    if(decision==='accepted') {
     if(b.capacity_checked!==true||p.review_reason&&b.manual_reviewed!==true)throw new HttpError('VALIDATION_FAILED');
     agreed=windowInput(b.agreed_start,b.agreed_end,new Date());
    }
    const changed=await repository.change(scope,p,String(decision),scope.context.actor.id,agreed?.window_start??null,agreed?.window_end??null);
    const event=await repository.event(scope,changed,'pickup.'+decision);await enqueueDecision(scope,deps,changed,event);
    const result=repository.summary(changed),c=scope.context;
    await scopedQuery(scope,['pickups.decide'],`INSERT INTO shipit.pickup_commands(organization_id,franchise_id,actor_id,key_digest,fingerprint,pickup_id,result)
     SELECT {{organization}},$1,$2,$3,$4,$5,$6 WHERE {{franchise:$7:$1}}`,[q.franchise,c.actor.id,hash,fingerprint,id,result,q.org]);
    return result;
   });
  },
 };
}
