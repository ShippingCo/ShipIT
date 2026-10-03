import { createHash, randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withCarrierScope } from '../memberships/service.ts';
import { digest } from '../pricing/idempotency.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import { manualAdapter, manualCapabilities, localCapabilities } from './manual.ts';
import type { Installation, Observation } from './contract.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
import { manualHealth } from './health.ts';
type Operation='installation'|'mapping'|'reference'|'observation';
function manifest(row:r.InstallationRow):Installation {
  return {contractVersion:1,id:row.id,organizationId:row.organization_id,franchiseIds:[row.franchise_id],courierId:row.courier_id,
    revision:row.revision,capabilities:manualCapabilities(row.command_id,new Date(row.created_at).toISOString())};
}
export function createCarrierService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
  const cursors=ewayCursorCodec(createHash('sha256').update('carrier:v1').update(key).digest(),clock);
  async function mutate(operation:Operation,session:string,parentInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    const parent=operation==='installation'?null:v.uuid(parentInput,'$'),q=v.selection(query),keyHash=v.keyDigest(v.idempotencyKey(keyInput));
    const input=operation==='installation'?v.installation(body):operation==='mapping'?v.mapping(body):operation==='reference'?v.reference(body):v.observation(body);
    const fingerprint=digest({operation,parent,body:input});
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.write',correlation,async({access:s})=>{
      // Membership's organization lock serializes commands and receipt decisions, including empty-key races.
      const installed=operation==='mapping'?await r.installation(s,parent!):null;
      const parcel=operation==='reference'||operation==='observation'?await r.parcel(s,parent!):null;
      const selected='installation_id' in input?await r.installation(s,input.installation_id):null;
      const reference='reference_id' in input?await r.reference(s,input.reference_id,parent!):null;
      const previous=await r.replay(s,operation,keyHash,fingerprint);if(previous)return previous;
      const command=randomUUID(),id=randomUUID(),now=clock();let version=1,reason='manual_setup';
      if(operation==='installation'&&'label' in input){
        if(input.courier_id)await r.courier(s,input.courier_id);
        await r.addInstallation(s,id,input.courier_id??randomUUID(),input.label,command,now,input.file_import??true);
      }
      if(operation==='mapping'&&'kind' in input){
        const before=await r.latestMapping(s,installed!.id,input.kind,input.source_code);
        if((before?.version??0)!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
        version=input.expected_version+1;reason=input.reason_code;
        if((version===1)!==(reason==='initial_mapping'))throw new HttpError('VALIDATION_FAILED');
        if(input.normalized_id)await r.normalizedTarget(s,installed!.id,input.kind,input.normalized_id);
        await r.addMapping(s,id,installed!.id,input.kind,input.source_code,input.normalized_id??randomUUID(),version,command);
      }
      if(operation==='reference'&&'external_docket' in input){
        const before=await r.currentReference(s,selected!.id,parent!);
        if((before?.version??0)!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
        version=input.expected_version+1;reason=input.reason_code;
        if((version===1)!==(reason==='initial_mapping'))throw new HttpError('VALIDATION_FAILED');
        const dimensions={courierId:selected!.courier_id,
          service:await r.dimension(s,selected!.id,'service',input.service_code),
          origin:await r.dimension(s,selected!.id,'location',input.origin_code),
          destination:await r.dimension(s,selected!.id,'location',input.destination_code)};
        await r.addReference(s,id,selected!.id,parent!,input.external_docket,version,dimensions,command);
      }
      if(operation==='observation'&&'status_code' in input){
        const installation=await r.installation(s,reference!.installation_id);
        const latest=await r.currentReference(s,installation.id,parent!);
        if(latest?.id!==reference!.id||parcel!.version!==input.expected_parcel_version)throw new HttpError('VERSION_CONFLICT');
        reason='manual_observation';
        const evidence:Observation={contractVersion:1,reference:{organizationId:q.organizationId,franchiseId:q.franchiseId,
          installationId:installation.id,externalDocket:reference!.external_docket},dimensions:reference!.dimensions,
          status:input.status===null?{state:'unmapped',sourceCode:input.status_code}:{state:'mapped',status:input.status,mappingVersionId:id},
          occurredAt:input.occurred_at,receivedAt:now.toISOString(),provenance:{mode:'manual',actorId:s.context.actor.id,commandId:command},sourceRecordId:id};
        const result=await manualAdapter(manifest(installation)).observe({reference:evidence.reference,operationId:command,
          requestFingerprint:fingerprint,installationRevision:installation.revision,deadlineAt:now.toISOString(),signal:new AbortController().signal},
        {mode:'manual',observation:evidence});
        if(!result.ok)throw new HttpError('VALIDATION_FAILED');
        await r.ingest(s,id,parent!,reference!.id,parcel!.version,result.value[0]!,command,now,input.status_code);
      }
      const result={id,version};await r.receipt(s,command,operation,keyHash,fingerprint,result,reason,now);return result;
    });
  }
  async function list(kind:'installations'|'mappings'|'references'|'observations',session:string,parentInput:unknown,query:unknown,correlation:string) {
    const parent=kind==='installations'?null:v.uuid(parentInput,'$'),q=v.selection(query,true);
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.read',correlation,async({access:s,agentOnly,revision})=>{
      if(kind==='installations'||kind==='mappings'){
        if(agentOnly)throw new HttpError('ACTION_FORBIDDEN');
        if(parent)await r.installation(s,parent);
      }else await r.parcel(s,parent!,agentOnly);
      const binding=digest({kind,parent,organization:q.organizationId,franchise:q.franchiseId,actor:s.context.actor.id,revision,limit:q.limit});
      const after=q.cursor?cursors.decode(q.cursor,binding):null;
      const rows=await r.list(s,kind,parent,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
      return {items:kind==='installations'?items.map(item=>{
        const row=item as Pick<r.InstallationRow,'id'|'command_id'|'created_at'|'file_import'>;
        return {...item,mode:'manual',capabilities:(row.file_import?localCapabilities:manualCapabilities)(row.command_id,new Date(row.created_at).toISOString())};
      }):items,page:{has_more:more,next_cursor:more?cursors.encode(binding,items.at(-1)!.id):null}};
    });
  }
  async function health(session:string,idInput:unknown,query:unknown,correlation:string) {
    const id=v.uuid(idInput,'$'),q=v.selection(query);
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.read',correlation,async({access:s,agentOnly})=>{
      if(agentOnly)throw new HttpError('ACTION_FORBIDDEN');
      const row=await r.installation(s,id);
      return {installation_id:id,mode:'manual',capability_version:row.revision,
        capabilities:(row.file_import?localCapabilities:manualCapabilities)(row.command_id,new Date(row.created_at).toISOString()),
        api:{state:'not_applicable',reason:'live_api_not_selected'},manual:await manualHealth(s,id,clock())};
    });
  }
  return {mutate,list,health};
}
