import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { object,integer,uuid } from '../pricing/validation.ts';
import { idempotencyKey } from '../customers/validation.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { aliasPattern } from './config.ts';
import { languagePattern,namePattern,templateReason,validVariables } from './rules.ts';
import type { Binding,Installation,Template,WhatsappDependencies } from './types.ts';
import * as repository from './repository.ts';

function selection(input:unknown) {
  const q=object(input,['organization_id','franchise_id']);
  return {org:uuid(q.organization_id,'organization_id'),franchise:uuid(q.franchise_id,'franchise_id')};
}
function templateSelection(b:Record<string,unknown>) {
  if(typeof b.name!=='string'||!namePattern.test(b.name)||typeof b.language!=='string'||!languagePattern.test(b.language))throw new HttpError('VALIDATION_FAILED');
  return {name:b.name,language:b.language};
}
function safeInstallation(i:Installation) {
  return {id:i.id,version:i.version,state:i.state,provider:'meta_cloud',identity_hint:`••••${i.phone_number_id.slice(-4)}`,
    credential_configured:true,validated_at:i.validated_at.toISOString(),customer_sends_enabled:false};
}
function storedBinding(i:Installation):Binding {
  return {key:i.binding_key,organization_id:i.organization_id,franchise_id:i.franchise_id,waba_id:i.waba_id,phone_number_id:i.phone_number_id,credential_ref:i.credential_ref};
}
export function createWhatsappService(database:DatabasePool,dependencies:WhatsappDependencies) {
  const {configuration,provider,clock=()=>new Date()}=dependencies;
  const findBinding=(key:string,org:string,franchise:string)=>{
    const b=configuration.bindings.find(b=>b.key===key&&b.organization_id===org&&b.franchise_id===franchise);
    if(!b)throw new HttpError('RESOURCE_NOT_FOUND');return b;
  };
  const currentBinding=(i:Installation)=>{
    const b=findBinding(i.binding_key,i.organization_id,i.franchise_id);
    if(digest(b)!==digest(storedBinding(i)))throw new HttpError('WHATSAPP_CONFIGURATION_CHANGED');return b;
  };
  return {
    async read(token:string,query:unknown,correlation:string) {
      const q=selection(query);
      return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.read',correlation,async scope=>{
        const i=await repository.installation(scope);return {installation:i?safeInstallation(i):null};
      });
    },
    async capability(token:string,idInput:unknown,query:unknown,body:unknown,correlation:string) {
      const q=selection(query),id=uuid(idInput,'$'),b=object(body,['name','language','variables']),selected=templateSelection(b);
      return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.read',correlation,async scope=>{
        const i=await repository.installation(scope);if(!i||i.id!==id)throw new HttpError('RESOURCE_NOT_FOUND');
        const t=await repository.template(scope,id,selected.name,selected.language);
        let reason:string|null=i.state!=='validated'?'installation_disabled':!await repository.rootsActive(scope)?'owner_disabled':null;
        if(!reason){try{currentBinding(i);}catch{reason='installation_configuration_changed';}}
        reason??=templateReason(t);
        if(!reason&&t&&(t.credential_revision!==i.credential_revision||clock().getTime()-t.checked_at.getTime()>=900000||t.checked_at>clock()))reason='template_validation_stale';
        if(!reason&&t&&!validVariables(t,b.variables))reason='template_variables_invalid';
        return {available:reason===null,reason,template:t?{name:t.name,language:t.language,version:t.version,status:t.status,category:t.category,variables:t.variables,checked_at:t.checked_at.toISOString()}:null,
          customer_sends_enabled:false};
      });
    },
    async execute(token:string,idInput:unknown,operation:'connect'|'rotate'|'disable'|'sync',query:unknown,keyInput:unknown,body:unknown,correlation:string) {
      const q=selection(query),id=operation==='connect'?null:uuid(idInput,'$');
      const b=object(body,['expected_version',...(operation==='connect'||operation==='rotate'?['binding_key']:[]),...(operation==='sync'?['name','language']:[])]);
      const expected=integer(b.expected_version,'expected_version',operation==='connect'?0:1,2147483646);
      if(operation==='connect'&&expected!==0)throw new HttpError('VALIDATION_FAILED');
      let keyAlias:string|undefined;
      if(operation==='connect'||operation==='rotate'){
        if(typeof b.binding_key!=='string'||!aliasPattern.test(b.binding_key))throw new HttpError('VALIDATION_FAILED');keyAlias=b.binding_key;
      }
      const selected=operation==='sync'?templateSelection(b):null;
      const key=keyDigest(idempotencyKey(keyInput)),fingerprint=digest({operation,id,body:b});
      const phase=()=>withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.write',correlation,async scope=>{
        await repository.active(scope);
        const i=await repository.installation(scope);
        if(id&&(!i||i.id!==id))throw new HttpError('RESOURCE_NOT_FOUND');
        const prior=await repository.replay(scope,key,fingerprint);if(prior)return {prior,i,binding:null};
        if((i?.version??0)!==expected)throw new HttpError('VERSION_CONFLICT');
        const binding=keyAlias?findBinding(keyAlias,q.org,q.franchise):operation==='disable'?storedBinding(i!):currentBinding(i!);
        if(i&&(i.waba_id!==binding.waba_id||i.phone_number_id!==binding.phone_number_id))throw new HttpError('WHATSAPP_IDENTITY_MISMATCH');
        if(operation==='sync'&&i!.state!=='validated')throw new HttpError('WHATSAPP_INSTALLATION_DISABLED');
        return {prior:null,i,binding};
      });
      const prepared=await phase();if(prepared.prior)return prepared.prior;
      const binding=prepared.binding!;
      // Network reads never hold membership, franchise, or installation locks.
      let template:Template|undefined;
      if(operation==='connect'||operation==='rotate')await provider.validate(binding);
      if(selected){
        try{template=await provider.template(binding,selected.name,selected.language);}
        catch(error){
          if(!(error instanceof HttpError)||error.code!=='WHATSAPP_TEMPLATE_MISSING')throw error;
          // Persist absence too, invalidating any formerly approved revision.
          template={provider_id:null,...selected,status:'MISSING',category:'UNKNOWN',supported:false,variables:[],shape_hash:digest({missing:true})};
        }
      }
      return withWhatsappScope(database,token,q.org,q.franchise,'whatsapp.write',correlation,async scope=>{
        await repository.active(scope);
        const i=await repository.installation(scope);
        if(id&&(!i||i.id!==id))throw new HttpError('RESOURCE_NOT_FOUND');
        const prior=await repository.replay(scope,key,fingerprint);if(prior)return prior;
        if((i?.version??0)!==expected)throw new HttpError('VERSION_CONFLICT');
        const command=randomUUID(),installationId=i?.id??randomUUID(),version=expected+1;
        const credentialRevision=(i?.credential_revision??0)+(operation==='connect'||operation==='rotate'?1:0);
        const state=operation==='disable'?'disabled':operation==='rotate'||operation==='connect'?'validated':i!.state;
        const now=clock(),validatedAt=operation==='connect'||operation==='rotate'?now:i!.validated_at;
        await repository.save(scope,installationId,binding,version,credentialRevision,state,validatedAt,command);
        let result:Record<string,unknown>={id:installationId,version,state,customer_sends_enabled:false};
        if(template){
          const previous=await repository.template(scope,installationId,template.name,template.language),templateVersion=(previous?.version??0)+1;
          await repository.saveTemplate(scope,installationId,template,templateVersion,credentialRevision,now,command);
          result={...result,template:{name:template.name,language:template.language,version:templateVersion,status:template.status,category:template.category,variables:template.variables},reason:templateReason(template)};
        }
        await repository.command(scope,command,installationId,key,fingerprint,operation,version,result);
        return result;
      });
    },
  };
}
