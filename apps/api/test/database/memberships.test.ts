import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { createAuthService } from '../../src/modules/auth/service.ts';
import { createDeliveryWorker } from '../../src/modules/auth/worker.ts';
import type { Delivery } from '../../src/modules/auth/delivery.ts';
import { createMembershipService, createMembershipTenancyAuthorizer, type MembershipService } from '../../src/modules/memberships/service.ts';
import { HttpError } from '../../src/plugins/errors.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';

const keys={version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)};
const organizationA='00000000-0000-4000-8000-000000001401';
const franchiseA1='00000000-0000-4000-8000-000000001411';
const franchiseA2='00000000-0000-4000-8000-000000001412';
const organizationB='00000000-0000-4000-8000-000000001402';
const franchiseB1='00000000-0000-4000-8000-000000001421';
const hasCode=(code:string)=>(error:unknown)=>error instanceof HttpError && error.code===code;

async function setup(t:TestContext) {
  const db=await provisionDatabase(t);await db.prepareMemberships();
  const owner=db.ownerPool();
  try {
    await owner.query(`INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Organization A'),($2,'Organization B')`,[organizationA,organizationB]);
    await owner.query(`INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES
      ($1,$2,'A1','Franchise A1'),($3,$2,'A2','Franchise A2'),($4,$5,'B1','Franchise B1')`,
    [franchiseA1,organizationA,franchiseA2,franchiseB1,organizationB]);
  } finally {await owner.close();}
  const pool=db.runtimePool(),auth=createAuthService(pool,keys),memberships=createMembershipService(pool),sent:Delivery[]=[];
  const worker=createDeliveryWorker(pool,keys,async message=>{sent.push(message);return {state:'accepted',reference:'synthetic'};});
  let sequence=0;
  async function user(label:string) {
    const address=`${label}@example.test`,id=await auth.provision('email',address);
    const challenge=await auth.start('email',address,`browser-${label}`,`ip-${++sequence}`);await worker.tick();
    const message=sent.at(-1)!;assert.equal(message.address,address);
    const login=await auth.verify(challenge.challenge_id,message.code,`browser-${label}`,`ip-${sequence}`);
    assert.ok(!login.linked);return {id,token:login.token};
  }
  return {db,pool,auth,memberships,user};
}
async function inviteAndAccept(service:MembershipService,adminToken:string,invitee:{id:string;token:string},role:string,franchiseIds:string[]) {
  const invitation=await service.createInvitation(adminToken,{organization_id:organizationA,invitee_user_id:invitee.id,role,franchise_ids:franchiseIds});
  return service.acceptInvitation(invitee.token,{token:invitation.acceptance_token});
}

await test('organization and franchise administrators grant only bounded roles and scopes',{timeout:30000},async t=>{
  const {db,memberships,user}=await setup(t),admin=await user('admin-a'),adminB=await user('admin-b'),localAdmin=await user('local-admin'),operator=await user('operator');
  await memberships.bootstrapAdministrator(admin.id,organizationA);
  await memberships.bootstrapAdministrator(adminB.id,organizationB);
  await inviteAndAccept(memberships,admin.token,localAdmin,'franchise_admin',[franchiseA1]);
  await assert.rejects(memberships.createInvitation(localAdmin.token,{organization_id:organizationA,invitee_user_id:operator.id,role:'org_admin',franchise_ids:[]}),hasCode('RESOURCE_NOT_FOUND'));
  await assert.rejects(memberships.createInvitation(localAdmin.token,{organization_id:organizationA,invitee_user_id:operator.id,role:'operator',franchise_ids:[franchiseA2]}),hasCode('RESOURCE_NOT_FOUND'));
  await assert.rejects(memberships.listMemberships(adminB.token,organizationA),hasCode('ACTION_FORBIDDEN'));
  const accepted=await inviteAndAccept(memberships,localAdmin.token,operator,'operator',[franchiseA1]);
  assert.deepEqual(accepted.franchise_ids,[franchiseA1]);
  const localRoster=await memberships.listMemberships(localAdmin.token,organizationA);
  assert.ok(localRoster.items.some(item=>item.user_id===operator.id));
  assert.ok(!localRoster.items.some(item=>item.user_id===admin.id));
  await assert.rejects(memberships.updateMembership(operator.token,accepted.id,{role:'org_admin',franchise_ids:[],expected_version:1}),hasCode('RESOURCE_NOT_FOUND'));
  const unknown='00000000-0000-4000-8000-000000009999';
  await assert.rejects(memberships.updateMembership(adminB.token,accepted.id,{role:'dispatcher',franchise_ids:[franchiseA1],expected_version:1}),hasCode('RESOURCE_NOT_FOUND'));
  await assert.rejects(memberships.updateMembership(adminB.token,unknown,{role:'dispatcher',franchise_ids:[franchiseA1],expected_version:1}),hasCode('RESOURCE_NOT_FOUND'));
  await assert.rejects(memberships.updateMembership(admin.token,(await memberships.listMemberships(admin.token,organizationA)).items.find(item=>item.user_id===admin.id)!.id,
    {role:'org_admin',franchise_ids:[franchiseA1],expected_version:1}),hasCode('ACTION_FORBIDDEN'));
  const persisted=createMembershipService(db.runtimePool());
  assert.ok((await persisted.listMemberships(admin.token,organizationA)).items.some(item=>item.user_id===operator.id));
  await assert.rejects(db.runtimePool().query('DELETE FROM shipit.memberships'));
  await assert.rejects(db.runtimePool().query('DELETE FROM shipit.membership_audit_events'));
});

await test('invitations bind identity, expire, are single-use and accept concurrently only once',{timeout:30000},async t=>{
  const {db,memberships,user}=await setup(t),admin=await user('admin'),operator=await user('operator'),other=await user('other');
  await memberships.bootstrapAdministrator(admin.id,organizationA);
  const invitation=await memberships.createInvitation(admin.token,{organization_id:organizationA,invitee_user_id:operator.id,role:'operator',franchise_ids:[franchiseA1]});
  assert.equal(invitation.state,'pending');assert.match(invitation.acceptance_token,/^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(memberships.acceptInvitation(other.token,{token:invitation.acceptance_token}),hasCode('ACTION_FORBIDDEN'));
  const race=await Promise.allSettled([memberships.acceptInvitation(operator.token,{token:invitation.acceptance_token}),memberships.acceptInvitation(operator.token,{token:invitation.acceptance_token})]);
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await db.adminQuery<{count:string}>('SELECT count(*) AS count FROM shipit.memberships WHERE user_id=$1 AND organization_id=$2',[operator.id,organizationA])).rows[0]?.count,'1');
  await assert.rejects(memberships.acceptInvitation(operator.token,{token:invitation.acceptance_token}),hasCode('ACTION_FORBIDDEN'));
  const expired=await memberships.createInvitation(admin.token,{organization_id:organizationA,invitee_user_id:other.id,role:'dispatcher',franchise_ids:[franchiseA1]});
  await db.adminQuery("UPDATE shipit.membership_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);
  await assert.rejects(memberships.acceptInvitation(other.token,{token:expired.acceptance_token}),hasCode('ACTION_FORBIDDEN'));
  const replacement=await memberships.createInvitation(admin.token,{organization_id:organizationA,invitee_user_id:other.id,role:'dispatcher',franchise_ids:[franchiseA1]});
  assert.notEqual(replacement.id,expired.id);
  assert.equal((await db.adminQuery<{action:string}>('SELECT action FROM shipit.membership_audit_events WHERE invitation_id=$1',[expired.id])).rows.at(-1)?.action,'invitation_expired');
  const stored=JSON.stringify((await db.adminQuery('SELECT * FROM shipit.membership_invitations')).rows);
  assert.ok(!stored.includes(invitation.acceptance_token));assert.ok(!stored.includes(expired.acceptance_token));assert.ok(!stored.includes(replacement.acceptance_token));
});

await test('revocation is live on the next request and concurrent admin removals cannot orphan an organization',{timeout:30000},async t=>{
  const {pool,memberships,user}=await setup(t),admin1=await user('admin-one'),admin2=await user('admin-two'),operator=await user('operator');
  await memberships.bootstrapAdministrator(admin1.id,organizationA);
  const second=await inviteAndAccept(memberships,admin1.token,admin2,'org_admin',[]);
  const member=await inviteAndAccept(memberships,admin1.token,operator,'operator',[franchiseA1]);
  const before=createMembershipTenancyAuthorizer(pool,operator.token,organizationA,'synthetic');
  assert.deepEqual((await before.authorize('franchise.profile.read')).permittedFranchiseIds,[franchiseA1]);
  const roster=await memberships.listMemberships(admin1.token,organizationA);
  const first=roster.items.find(item=>item.user_id===admin1.id)!;
  const removals=await Promise.allSettled([
    memberships.revokeMembership(admin1.token,second.id,{expected_version:1}),
    memberships.revokeMembership(admin2.token,first.id,{expected_version:1}),
  ]);
  assert.equal(removals.filter(result=>result.status==='fulfilled').length,1);
  const remaining=(await memberships.listMemberships(removals[0]!.status==='fulfilled'?admin1.token:admin2.token,organizationA)).items.filter(item=>item.role==='org_admin'&&item.lifecycle==='active');
  assert.equal(remaining.length,1);
  const survivorToken=removals[0]!.status==='fulfilled'?admin1.token:admin2.token;
  await memberships.revokeMembership(survivorToken,member.id,{expected_version:1});
  await assert.rejects(createMembershipTenancyAuthorizer(pool,operator.token,organizationA,'next').authorize('franchise.profile.read'),hasCode('ACTION_FORBIDDEN'));
});

await test('all membership HTTP APIs enforce session, CSRF, versions and redacted logging',{timeout:30000},async t=>{
  const {db,pool,memberships,user}=await setup(t),admin=await user('http-admin'),operator=await user('http-operator'),spare=await user('http-spare');
  await memberships.bootstrapAdministrator(admin.id,organizationA);
  const logs:string[]=[];
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:pool,auth:{keys,delivery:{},webhook:undefined},logSink:{write:value=>logs.push(value)}});t.after(()=>app.close());
  const boot=await app.inject('/auth/bootstrap'),browser=boot.cookies[0]!,headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token};
  const cookies=(token:string)=>({[browser.name]:browser.value,shipit_session:token});
  const unauthenticated=await app.inject({url:`/api/v1/organizations/${organizationA}/memberships`,cookies:{[browser.name]:browser.value}});
  assert.equal(unauthenticated.statusCode,401);
  const denied=await app.inject({method:'POST',url:'/api/v1/membership-invitations',payload:{},cookies:cookies(admin.token),headers:{origin:'http://evil.example'}});
  assert.equal(denied.statusCode,403);
  const created=await app.inject({method:'POST',url:'/api/v1/membership-invitations',headers,cookies:cookies(admin.token),payload:{organization_id:organizationA,invitee_user_id:operator.id,role:'operator',franchise_ids:[franchiseA1]}});
  assert.equal(created.statusCode,201);const invite=created.json();
  const invalidRole=await app.inject({method:'POST',url:'/api/v1/membership-invitations',headers,cookies:cookies(admin.token),payload:{organization_id:organizationA,invitee_user_id:spare.id,role:'super_admin',franchise_ids:[franchiseA1]}});
  assert.equal(invalidRole.statusCode,422);assert.equal(invalidRole.json().error.code,'VALIDATION_FAILED');
  const accepted=await app.inject({method:'POST',url:'/api/v1/membership-invitations/accept',headers,cookies:cookies(operator.token),payload:{token:invite.acceptance_token}});
  assert.equal(accepted.statusCode,201);const member=accepted.json();
  assert.equal((await app.inject({url:`/api/v1/organizations/${organizationA}/memberships`,cookies:cookies(admin.token)})).statusCode,200);
  assert.equal((await app.inject({url:`/api/v1/organizations/${organizationA}/invitations`,cookies:cookies(admin.token)})).statusCode,200);
  const changed=await app.inject({method:'PATCH',url:`/api/v1/memberships/${member.id}`,headers,cookies:cookies(admin.token),payload:{role:'dispatcher',franchise_ids:[franchiseA1],expected_version:1}});
  assert.equal(changed.statusCode,200);assert.equal(changed.json().version,2);
  const stale=await app.inject({method:'POST',url:`/api/v1/memberships/${member.id}/revoke`,headers,cookies:cookies(admin.token),payload:{expected_version:1}});
  assert.equal(stale.statusCode,409);assert.equal(stale.json().error.code,'VERSION_CONFLICT');
  const revoked=await app.inject({method:'POST',url:`/api/v1/memberships/${member.id}/revoke`,headers,cookies:cookies(admin.token),payload:{expected_version:2}});
  assert.equal(revoked.statusCode,200);
  const pending=await app.inject({method:'POST',url:'/api/v1/membership-invitations',headers,cookies:cookies(admin.token),payload:{organization_id:organizationA,invitee_user_id:spare.id,role:'read_only',franchise_ids:[franchiseA1]}});
  const pendingBody=pending.json();
  const invitationRevoked=await app.inject({method:'POST',url:`/api/v1/membership-invitations/${pendingBody.id}/revoke`,headers,cookies:cookies(admin.token),payload:{expected_version:1}});
  assert.equal(invitationRevoked.statusCode,200);
  assert.doesNotMatch(logs.join(''),new RegExp(`${invite.acceptance_token}|${pendingBody.acceptance_token}|example\\.test|postgres|SQL`));
  const audit=JSON.stringify((await db.adminQuery('SELECT * FROM shipit.membership_audit_events ORDER BY occurred_at,id')).rows);
  assert.doesNotMatch(audit,new RegExp(`${invite.acceptance_token}|${pendingBody.acceptance_token}|example\\.test`));
});
