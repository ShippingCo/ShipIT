import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { auditSetup,org,A,B,otherOrg,C } from './audit-support.ts';
import { createWhatsappService } from '../src/modules/whatsapp/service.ts';
import { createMetaProvider } from '../src/modules/whatsapp/provider.ts';
import { parseEnvironment } from '../src/env.ts';
import { buildServer } from '../src/server.ts';
import type { Binding } from '../src/modules/whatsapp/types.ts';
export async function whatsappSetup(t:TestContext,database?:import('../../../packages/db/test/support.ts').DisposableDatabase) {
  const s=await auditSetup(t,undefined,database);await s.db.prepareWhatsapp();
  const local=await s.grant('franchise_admin',[A]),sibling=await s.grant('franchise_admin',[B]);
  const foreign=await s.user(),foreignAdmin=await s.user();await s.memberships.bootstrapAdministrator(foreignAdmin.id,otherOrg);
  const invitation=await s.memberships.createInvitation(foreignAdmin.token,{organization_id:otherOrg,invitee_user_id:foreign.id,role:'franchise_admin',franchise_ids:[C]});
  await s.memberships.acceptInvitation(foreign.token,{token:invitation.acceptance_token});
  const bindings:Binding[]=[{key:'alpha_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:alpha/v1'},
    {key:'alpha_v2',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:alpha/v2'},
    {key:'beta_v1',organization_id:org,franchise_id:B,waba_id:'200001',phone_number_id:'200002',credential_ref:'whatsapp:beta/v1'},
    {key:'gamma_v1',organization_id:otherOrg,franchise_id:C,waba_id:'300001',phone_number_id:'300002',credential_ref:'whatsapp:gamma/v1'}];
  const configuration={graph_version:'v24.0',bindings};
  let now=new Date('2026-09-20T12:00:00Z'),status='APPROVED',language='en_US',httpStatus=200,identityValid=true,hook:undefined|(()=>Promise<void>);
  const calls:{url:string;authorization:string}[]=[];
  const provider=createMetaProvider({configuration,secrets:{kind:'managed',resolve:async ref=>'synthetic_token_'+ref.replace(/[^a-z0-9]/gi,'_')},transport:async(url,options)=>{
    calls.push({url:String(url),authorization:(options!.headers as Record<string,string>).authorization!});
    await hook?.();
    const binding=bindings.find(b=>String(url).includes('/'+b.waba_id+'/'))!;
    const body=String(url).includes('/phone_numbers')?{data:[{id:identityValid?binding.phone_number_id:'999',code_verification_status:'VERIFIED',platform_type:'CLOUD_API'}]}:
      {data:[{id:'100003',name:'parcel_update',language,status,category:'UTILITY',components:[{type:'BODY',text:'Parcel {{1}}'}]}]};
    return new Response(JSON.stringify(body),{status:httpStatus});
  }});
  const dependencies={configuration,provider,clock:()=>now},service=createWhatsappService(s.pool,dependencies),logs:string[]=[];
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp:dependencies,logSink:{write:x=>logs.push(x)}});t.after(()=>app.close());
  const bootstrap=await app.inject('/auth/bootstrap'),browser=bootstrap.cookies[0]!;
  const headers={'content-type':'application/json',origin:'http://localhost:5173','x-csrf-token':bootstrap.json().csrf_token};
  const cookies=(token:string)=>({shipit_session:token,[browser.name]:browser.value});
  const request=(path:string,body?:unknown,token=local.token,franchise=A,organization=org,key=randomUUID())=>app.inject({method:body===undefined?'GET':'POST',
    url:'/api/v1/whatsapp/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),cookies:cookies(token),headers:{...headers,'idempotency-key':key},...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const connect=(key=randomUUID())=>request('installations',{binding_key:'alpha_v1',expected_version:0},local.token,A,org,key);
  const counts=async()=>(await s.db.adminQuery('SELECT (SELECT count(*)::int FROM shipit.whatsapp_installations) installations,(SELECT count(*)::int FROM shipit.whatsapp_commands) commands,(SELECT count(*)::int FROM shipit.whatsapp_templates) templates')).rows[0];
  return {...s,app,logs,service,dependencies,local,sibling,foreign,request,connect,calls,counts,cookies,headers,
    setStatus:(v:string)=>{status=v;},setLanguage:(v:string)=>{language=v;},setHttp:(v:number)=>{httpStatus=v;},setIdentity:(v:boolean)=>{identityValid=v;},
    setHook:(v:typeof hook)=>{hook=v;},advance:()=>{now=new Date(now.getTime()+900001);}};
}
