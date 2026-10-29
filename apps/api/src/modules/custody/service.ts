import {canAdminister} from '@shippingco/shared';
import {acknowledgeReassignment} from '../deliveries/reassignment.ts';
import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {withCustodyScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {selection,uuid,object,integer,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {HttpError} from '../../plugins/errors.ts';
import {handoverInput,acknowledgementInput,returnInput,grantInput,releaseInput} from './validation.ts';
import * as repo from './repository.ts';
import {custodyActions} from './types.ts';
const actions=[...custodyActions];
function intent(operation:string,input:unknown,keyInput:unknown,headers:readonly string[]){
 return {key:keyDigest(idempotencyKey(keyInput,headers)),fingerprint:digest({operation,input})};
}
function enabled(value:boolean){if(!value)throw new HttpError('CUSTODY_DISABLED');}
async function transferGrant(scope:TenantAccess,id:string,source:repo.ReceiptRow,target:string|null){
 const g=await repo.grant(scope,id);
 if(g.source_receipt_id!==source.id||g.parcel_id!==source.parcel_id||g.agent_id!==source.agent_id||g.revoked||
  (target===null?g.destination_kind!=='office':g.destination_kind!=='agent'||g.destination_agent_id!==target))throw new HttpError('CUSTODY_CONFLICT');
 if(!await repo.eligibleStaff(scope,g.agent_id,'delivery_agent'))throw new HttpError('RESOURCE_NOT_FOUND');
 return g;
}
async function checkInstruction(scope:TenantAccess,id:string,p:repo.ParcelRow,target:string){
 const i=await repo.instruction(scope,id);
 if(i.parcel_id!==p.id||i.attempt_id!==p.attempt_id||i.assignment_id!==p.assignment_id||i.from_agent_id!==p.attempt_agent_id||i.to_agent_id!==target||i.expected_parcel_version!==p.version)throw new HttpError('VERSION_CONFLICT');
 if(!await repo.eligibleStaff(scope,i.actor_id,'dispatcher'))throw new HttpError('RESOURCE_NOT_FOUND');
 return i;
}
export function createParcelCustodyService(database:DatabasePool,writesEnabled=false){
 return {
  async read(token:string,idInput:unknown,query:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$');return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,
    async s=>{const m=await repo.manifest(s.access,id,s.agentOnly);await repo.accessAudit(s.audit,'custody.read',id);return repo.manifestDto(m);});
  },
  async worklist(token:string,query:unknown,cursorInput:unknown,correlation:string){
   const q=selection(query),cursor=cursorInput===undefined||cursorInput===null?null:uuid(cursorInput,'$');
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,
    async s=>{const result=await repo.worklist(s.access,s.agentOnly,cursor,await repo.cutoff(s.access));await repo.accessAudit(s.audit,'custody.worklist');return result;});
  },
  async manifests(token:string,query:unknown,cursorInput:unknown,correlation:string){
   const q=selection(query),cursor=cursorInput===undefined||cursorInput===null?null:uuid(cursorInput,'$');
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,async s=>{
    const result=await repo.manifests(s.access,s.agentOnly,cursor);await repo.accessAudit(s.audit,'custody.worklist');return result;
   });
  },
  async agents(token:string,query:unknown,correlation:string,cursorInput:unknown=undefined){
   const q=selection(query),cursor=cursorInput===undefined||cursorInput===null?null:uuid(cursorInput,'$');return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,async s=>{
    const result=await repo.agents(s.access,s.agentOnly,cursor);await repo.accessAudit(s.audit,'custody.worklist');return result;
   });
  },
  async transfers(token:string,query:unknown,cursorInput:unknown,correlation:string){
   const q=selection(query),cursor=cursorInput===undefined||cursorInput===null?null:uuid(cursorInput,'$');
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,async s=>{
    const result=await repo.transfers(s.access,s.agentOnly,cursor);await repo.accessAudit(s.audit,'custody.worklist');return result;
   });
  },
  async outgoingManifests(token:string,idInput:unknown,query:unknown,cursorInput:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$'),cursor=cursorInput===undefined||cursorInput===null?null:uuid(cursorInput,'$');
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,async s=>{
    if(!(await repo.transfers(s.access,s.agentOnly,null,id)).items.length)throw new HttpError('RESOURCE_NOT_FOUND');
    const result=await repo.outgoingManifests(s.access,await repo.grant(s.access,id),cursor);await repo.accessAudit(s.audit,'custody.worklist');return result;
   });
  },
  async report(token:string,idInput:unknown,query:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$');return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.read',correlation,
    async s=>{const m=await repo.manifest(s.access,id,s.agentOnly);const result=await repo.manifestReport(s.access,m,await repo.cutoff(s.access));await repo.accessAudit(s.audit,'custody.read',id);return result;});
  },
  async authorize(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),b=object(body,['parcel_id','agent_id','expected_parcel_version']),input={parcel_id:uuid(b.parcel_id,'$'),agent_id:uuid(b.agent_id,'$'),expected_parcel_version:integer(b.expected_parcel_version,'expected_version',1,2147483646)},identity=intent('authorize',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.authorize',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),p=await repo.parcel(scope,input.parcel_id);
    const saved=await repo.replay(scope,'authorize',identity.key,identity.fingerprint);if(saved)return saved;enabled(writesEnabled);
    await repo.eligibleAgent(scope,input.agent_id);
    if(p.version!==input.expected_parcel_version)throw new HttpError('VERSION_CONFLICT');
    if(p.status!=='out_for_delivery'||p.attempt_state!=='active'||p.active_attempt_id!==p.attempt_id||!p.assignment_id||!p.assigned_agent_id||p.assigned_agent_id===input.agent_id)throw new HttpError('CUSTODY_CONFLICT');
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_assignment_instructions(id,organization_id,franchise_id,booking_id,parcel_id,attempt_id,assignment_id,from_agent_id,to_agent_id,expected_parcel_version,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,[id,c.permittedFranchiseIds[0],p.booking_id,p.id,p.attempt_id,p.assignment_id,p.assigned_agent_id,input.agent_id,p.version,command,c.organizationId]);
    return repo.command(scope,command,'authorize',identity.key,identity.fingerprint,input,id,[]);
   });
  },
  async prepare(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),input=handoverInput(body),identity=intent('prepare',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.prepare',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),facts:{p:repo.ParcelRow;source:repo.ReceiptRow|null;item:typeof input.items[number]}[]=[];
    for(const item of input.items){
     const p=await repo.parcel(scope,item.parcel_id),source=await repo.latest(scope,p.id);
     if(s.agentOnly){
      if(!source||source.kind!=='agent_received'||source.agent_id!==c.actor.id||!item.grant_id)throw new HttpError('RESOURCE_NOT_FOUND');
      await transferGrant(scope,item.grant_id,source,input.agent_id);
     }
     facts.push({p,source,item});
    }
    const saved=await repo.replay(scope,'prepare',identity.key,identity.fingerprint);if(saved)return saved;enabled(writesEnabled);
    await repo.eligibleAgent(scope,input.agent_id);
    for(const {p,source,item} of facts){
     if(p.version!==item.expected_parcel_version||(source?.id??null)!==item.previous_receipt_id)throw new HttpError('VERSION_CONFLICT');
     if(p.status!=='out_for_delivery'||p.attempt_state!=='active'||p.active_attempt_id!==p.attempt_id||source?.kind==='recipient_received'||source?.agent_id===input.agent_id)throw new HttpError('CUSTODY_CONFLICT');
     if(source?.kind==='agent_received'){
      if(!item.grant_id)throw new HttpError('CUSTODY_CONFLICT');await transferGrant(scope,item.grant_id,source,input.agent_id);
     }else if(item.grant_id!==null)throw new HttpError('CUSTODY_CONFLICT');
     if(p.assigned_agent_id!==input.agent_id){
      if(!item.instruction_id)throw new HttpError('CUSTODY_ASSIGNMENT_REQUIRED');await checkInstruction(scope,item.instruction_id,p,input.agent_id);
     }else if(item.instruction_id!==null)throw new HttpError('CUSTODY_CONFLICT');
    }
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_manifests(id,organization_id,franchise_id,agent_id,command_id,item_count)
     SELECT $1,{{organization}},$2,$3,$4,$5 WHERE {{franchise:$6:$2}}`,[id,c.permittedFranchiseIds[0],input.agent_id,command,facts.length,c.organizationId]);
    for(const {p,item} of facts)await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_manifest_items(id,organization_id,franchise_id,manifest_id,booking_id,parcel_id,attempt_id,assignment_id,agent_id,expected_parcel_version,previous_receipt_id,instruction_id,grant_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],id,p.booking_id,p.id,p.attempt_id,p.assignment_id,input.agent_id,p.version,item.previous_receipt_id,item.instruction_id,item.grant_id,c.organizationId]);
    return repo.command(scope,command,'prepare',identity.key,identity.fingerprint,input,id,[]);
   });
  },
  async acknowledge(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$'),input={manifest_id:id,...acknowledgementInput(body)},identity=intent('acknowledge',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.acknowledge',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),m=await repo.manifest(scope,id,true);
    const facts:{p:repo.ParcelRow;source:repo.ReceiptRow|null;item:repo.ItemRow}[]=[];
    for(const item of m.items)facts.push({p:await repo.parcel(scope,item.parcel_id),source:await repo.latest(scope,item.parcel_id),item});
    const saved=await repo.replay(scope,'acknowledge',identity.key,identity.fingerprint);
    if(saved){if(facts.some(f=>f.p.attempt_agent_id!==c.actor.id))throw new HttpError('RESOURCE_NOT_FOUND');return saved;}
    enabled(writesEnabled);
    if(m.row.cancelled||m.items.some(i=>i.receipt_id!==null))throw new HttpError('CUSTODY_CONFLICT');
    const admin=await repo.eligibleStaff(scope,m.row.actor_id,'franchise_admin');
    for(const {p,source,item} of facts){
     if(p.version!==item.expected_parcel_version||(source?.id??null)!==item.previous_receipt_id||p.attempt_id!==item.attempt_id||p.assignment_id!==item.assignment_id)throw new HttpError('VERSION_CONFLICT');
     if(!admin){
      if(!source||source.agent_id!==m.row.actor_id||!item.grant_id)throw new HttpError('RESOURCE_NOT_FOUND');
      await transferGrant(scope,item.grant_id,source,m.row.agent_id);
     }
     if(source?.kind==='agent_received'){
      if(!item.grant_id)throw new HttpError('CUSTODY_CONFLICT');
      const g=await transferGrant(scope,item.grant_id,source,m.row.agent_id),release=await repo.release(scope,source.id,m.row.id);
      if(!release||release.grant_id!==g.id)throw new HttpError('CUSTODY_CONFLICT');
     }
     if(item.instruction_id!==null)await checkInstruction(scope,item.instruction_id,p,m.row.agent_id);
     if(p.status!=='out_for_delivery'||p.attempt_state!=='active'||(p.assigned_agent_id!==c.actor.id&&item.instruction_id===null)||p.active_attempt_id!==item.attempt_id)throw new HttpError('CUSTODY_CONFLICT');
    }
    const command=randomUUID(),receipts:string[]=[];
    for(const {p,source,item} of facts){
     if(item.instruction_id!==null)await acknowledgeReassignment(scope,p,item,command);
     receipts.push(await repo.receive(scope,p,source,item,command,'agent_received','none'));
    }
    return repo.command(scope,command,'acknowledge',identity.key,identity.fingerprint,input,id,receipts);
   });
  },
  async receiveReturn(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),input=returnInput(body),identity=intent('return',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.return',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),p=await repo.parcel(scope,input.parcel_id),saved=await repo.replay(scope,'return',identity.key,identity.fingerprint);
    if(saved)return saved;enabled(writesEnabled);const source=await repo.latest(scope,p.id);
    if(p.version!==input.expected_parcel_version)throw new HttpError('VERSION_CONFLICT');
    if(!source||source.id!==input.source_receipt_id||source.kind!=='agent_received')throw new HttpError('CUSTODY_CONFLICT');
    const command=randomUUID(),receipts:string[]=[],id=randomUUID();
    if(input.discrepancy!=='none')await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_discrepancies(id,organization_id,franchise_id,parcel_id,source_receipt_id,reason,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[id,c.permittedFranchiseIds[0],p.id,source.id,input.discrepancy,command,c.organizationId]);
    if(input.discrepancy!=='missing')receipts.push(await repo.receive(scope,p,source,null,command,'office_received',input.discrepancy));
    return repo.command(scope,command,'return',identity.key,identity.fingerprint,input,input.discrepancy==='none'?receipts[0]!:id,receipts);
   });
  },
  async grant(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),input=grantInput(body),identity=intent('grant',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.grant',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),p=await repo.parcel(scope,input.parcel_id),saved=await repo.replay(scope,'grant',identity.key,identity.fingerprint);
    if(saved)return saved;enabled(writesEnabled);const source=await repo.latest(scope,p.id);
    if(!source||source.id!==input.source_receipt_id||source.kind!=='agent_received'||source.agent_id===input.destination_agent_id)throw new HttpError('CUSTODY_CONFLICT');
    await repo.eligibleAgent(scope,source.agent_id!);if(input.destination_agent_id)await repo.eligibleAgent(scope,input.destination_agent_id);
    const command=randomUUID(),id=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_transfer_grants(id,organization_id,franchise_id,parcel_id,source_receipt_id,agent_id,destination_kind,destination_agent_id,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],p.id,source.id,source.agent_id,input.destination_kind,input.destination_agent_id,command,c.organizationId]);
    return repo.command(scope,command,'grant',identity.key,identity.fingerprint,input,id,[]);
   });
  },
  async revokeGrant(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$'),input={grant_id:id,...acknowledgementInput(body)},identity=intent('revoke_grant',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.grant',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),g=await repo.grant(scope,id),saved=await repo.replay(scope,'revoke_grant',identity.key,identity.fingerprint);
    if(saved)return saved;enabled(writesEnabled);if(g.revoked)throw new HttpError('VERSION_CONFLICT');const command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_grant_revocations(grant_id,organization_id,franchise_id,parcel_id,command_id)
     SELECT $1,{{organization}},$2,$3,$4 WHERE {{franchise:$5:$2}}`,[id,c.permittedFranchiseIds[0],g.parcel_id,command,c.organizationId]);
    return repo.command(scope,command,'revoke_grant',identity.key,identity.fingerprint,input,id,[]);
   });
  },
  async release(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),input=releaseInput(body),identity=intent('release',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.release',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,actions),p=await repo.parcel(scope,input.parcel_id),source=await repo.latest(scope,p.id);
    if(!source||source.id!==input.source_receipt_id||source.agent_id!==c.actor.id)throw new HttpError('RESOURCE_NOT_FOUND');
    const g=await transferGrant(scope,input.grant_id,source,input.manifest_id?(await repo.manifest(scope,input.manifest_id,false)).row.agent_id:null);
    if(input.manifest_id){
     const m=await repo.manifest(scope,input.manifest_id,false),item=m.items.find(i=>i.parcel_id===p.id);
     if(m.row.cancelled||!item||item.grant_id!==g.id||item.previous_receipt_id!==source.id)throw new HttpError('CUSTODY_CONFLICT');
     await repo.eligibleAgent(scope,m.row.agent_id);
    }
    const saved=await repo.replay(scope,'release',identity.key,identity.fingerprint);if(saved)return saved;enabled(writesEnabled);
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_releases(id,organization_id,franchise_id,parcel_id,source_receipt_id,grant_id,manifest_id,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,[id,c.permittedFranchiseIds[0],p.id,source.id,g.id,input.manifest_id,command,c.organizationId]);
    return repo.command(scope,command,'release',identity.key,identity.fingerprint,input,id,[]);
   });
  },
  async cancel(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),id=uuid(idInput,'$'),input={manifest_id:id,...acknowledgementInput(body)},identity=intent('cancel',input,keyInput,headers);
   return withCustodyScope(database,token,q.organizationId,q.franchiseId,'custody.prepare',correlation,async s=>{
    if(!canAdminister(s.roles,'custody.prepare'))throw new HttpError('ACTION_FORBIDDEN');
    const scope=s.access,c=assertTenantAccess(scope,actions),m=await repo.manifest(scope,id,false),saved=await repo.replay(scope,'cancel',identity.key,identity.fingerprint);
    if(saved)return saved;enabled(writesEnabled);if(m.row.cancelled||m.items.some(i=>i.receipt_id))throw new HttpError('VERSION_CONFLICT');const command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.custody_manifest_cancellations(manifest_id,organization_id,franchise_id,command_id)
     SELECT $1,{{organization}},$2,$3 WHERE {{franchise:$4:$2}}`,[id,c.permittedFranchiseIds[0],command,c.organizationId]);
    return repo.command(scope,command,'cancel',identity.key,identity.fingerprint,input,id,[]);
   });
  }
 };
}
