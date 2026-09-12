import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { CustomerCreateRequest } from '@shippingco/shared';
import { auditSetup, org, A, otherOrg, C } from './audit-support.ts';
import { createCustomerService } from '../src/modules/customers/service.ts';
export const contact: CustomerCreateRequest = { name:'Synthetic Contact',phone:'+1 202-555-0100',address:'19 Synthetic Lane' };
export const customerPath = (franchise=A,organization=org) => `/api/v1/organizations/${organization}/franchises/${franchise}/customers`;
export async function customerSetup(t: TestContext) {
  const s=await auditSetup(t);await s.db.prepareCustomers();
  const customer=createCustomerService(s.pool,s.keys.browser);
  const operator=await s.grant('operator',[A]);
  const boot=await s.app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const headers={'content-type':'application/json',origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token};
  const cookies=(token:string)=>({shipit_session:token,[browser.name]:browser.value});
  const create=(token=operator.token,body:unknown=contact,key:string=randomUUID(),franchise=A,organization=org)=>s.app.inject({
    method:'POST',url:customerPath(franchise,organization),headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  const update=(id:string,body:unknown={...contact,expected_version:1},key:string=randomUUID(),token=operator.token,franchise=A,organization=org)=>s.app.inject({
    method:'PATCH',url:customerPath(franchise,organization)+'/'+id,headers:{...headers,'idempotency-key':key},cookies:cookies(token),payload:JSON.stringify(body)});
  const read=(id:string,token=operator.token,franchise=A,organization=org)=>s.app.inject({url:customerPath(franchise,organization)+'/'+id,cookies:cookies(token)});
  const search=(extra:Record<string,string>={},token=operator.token,franchise=A,organization=org,remoteAddress='127.0.0.1')=>s.app.inject({
    url:customerPath(franchise,organization)+'?'+new URLSearchParams({search_by:'phone',q:contact.phone,...extra}),cookies:cookies(token),remoteAddress});
  async function beta() {
    const admin=await s.user();await s.memberships.bootstrapAdministrator(admin.id,otherOrg);
    const actor=await s.user(),invite=await s.memberships.createInvitation(admin.token,{organization_id:otherOrg,invitee_user_id:actor.id,role:'operator',franchise_ids:[C]});
    await s.memberships.acceptInvitation(actor.token,{token:invite.acceptance_token});return actor;
  }
  return {...s,customer,operator,headers,cookies,create,update,read,search,beta};
}
