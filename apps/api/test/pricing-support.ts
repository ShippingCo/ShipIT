import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PricingDraftInput, PricingQuoteInput } from '@shippingco/shared';
import { auditSetup, org, A, otherOrg, C } from './audit-support.ts';
import { createPricingService } from '../src/modules/pricing/service.ts';
export const start='2099-01-01T00:00:00Z',end='2099-01-02T00:00:00Z';
export const draft:PricingDraftInput={effective_from:start,effective_to:end,quote_validity_seconds:600,
  override_tolerance_paise:500,approval_ref:'SYN_APPROVAL_1',source_ref:'SYN_SOURCE_1',rules:[
    {destination_key:'SYN_DEST',service:'standard',min_weight_grams:1,max_weight_grams:1000,freight_paise:12551,packing_paise:249},
    {destination_key:'SYN_DEST',service:'standard',min_weight_grams:1000,max_weight_grams:2000,freight_paise:20001,packing_paise:249},
    {destination_key:'SYN_DEST',service:'standard',min_weight_grams:3000,max_weight_grams:null,freight_paise:30001,packing_paise:249},
  ]};
export const input:PricingQuoteInput={destination_key:'SYN_DEST',service:'standard',weight_grams:999};
export const pricingPath=(franchise=A,organization=org)=>`/api/v1/organizations/${organization}/franchises/${franchise}/pricing/versions`;
export async function pricingSetup(t:TestContext) {
  let now=new Date('2098-12-31T23:00:00Z');const clock=()=>new Date(now);
  const s=await auditSetup(t,clock);await s.db.preparePricing();
  const pricing=createPricingService(s.pool,clock),local=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]);
  const boot=await s.app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const headers={'content-type':'application/json',origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token};
  const cookies=(token:string)=>({shipit_session:token,[browser.name]:browser.value});
  const create=(body:unknown=draft,token=local.token,key:string=randomUUID(),franchise=A,organization=org)=>s.app.inject({
    method:'POST',url:pricingPath(franchise,organization),headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  const publish=(id:string,body:unknown={expected_version:1},token=local.token,key:string=randomUUID(),franchise=A,organization=org)=>s.app.inject({
    method:'POST',url:pricingPath(franchise,organization)+'/'+id+'/publish',headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  const replace=(id:string,body:unknown={...draft,expected_version:1},key:string=randomUUID(),token=local.token)=>s.app.inject({
    method:'PUT',url:pricingPath()+'/'+id,headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  const quote=(body:unknown=input,token=operator.token,key:string=randomUUID(),franchise=A,organization=org)=>s.app.inject({
    method:'POST',url:'/api/v1/pricing/quote?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  async function published(body:PricingDraftInput=draft) {
    const d=await create(body);if(d.statusCode!==201)throw new Error('SYN_DRAFT_FAILED_'+d.body);
    const p=await publish(d.json().id);if(p.statusCode!==200)throw new Error('SYN_PUBLISH_FAILED_'+p.body);return p.json();
  }
  async function beta(role='operator') {
    const admin=await s.user();await s.memberships.bootstrapAdministrator(admin.id,otherOrg);
    const actor=await s.user(),invite=await s.memberships.createInvitation(admin.token,{organization_id:otherOrg,invitee_user_id:actor.id,role,franchise_ids:[C]});
    await s.memberships.acceptInvitation(actor.token,{token:invite.acceptance_token});return actor;
  }
  return {...s,pricing,local,operator,headers,cookies,create,publish,replace,quote,published,beta,clock,setNow:(value:string)=>{now=new Date(value);}};
}
