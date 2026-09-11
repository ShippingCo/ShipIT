import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseError, withTransaction, type DatabasePool } from '@shippingco/db';
import { createTenancyService } from '../../src/modules/tenancy/service.ts';
import { createAuditService } from '../../src/modules/audit/service.ts';
import { createMembershipService } from '../../src/modules/memberships/service.ts';
import { createDeliveryWorker } from '../../src/modules/auth/worker.ts';
import { issueTenantAccess, scopedQuery } from '../../src/modules/security/scope.ts';
import { appendTenancy } from '../../src/modules/audit/repository.ts';
import { approvedAuthority } from '../tenancy-support.ts';
import { auditSetup,org,A,B,C,otherOrg } from '../audit-support.ts';
const missing='00000000-0000-4000-8000-000000009999';
const disable={lifecycle:'disabled',reason_code:'administrative_disable',expected_version:1};
const count=async (db:Awaited<ReturnType<typeof auditSetup>>['db'],table:string)=>
  (await db.adminQuery<{count:string}>(`SELECT count(*) FROM shipit.${table}`)).rows[0]!.count;

await test('R28 scope and equal-time keysets exclude sibling/foreign rows, boundaries and counts',{timeout:30000},async t=>{
  const s=await auditSetup(t),reader=await s.grant('franchise_admin',[A]);
  const time='2026-09-11T01:00:00.123456Z';
  // Fixed time and random IDs force the unique tie-breaker, including micros pg Date would truncate.
  for(const [organization,franchise,n] of [[org,A,5],[org,B,30],[otherOrg,C,7]] as const) {
    for(let i=0;i<n;i++)await s.db.adminQuery(`SELECT shipit.append_tenancy_audit($1,$2,'service','synthetic','franchise.profile.update',
      'franchise',$2,'profile_correction',$3,$4,'active','active',2)`,[organization,franchise,randomUUID(),time]);
  }
  const filters={resource_type:'franchise',from:'2026-09-11T01:00:00Z',to:'2026-09-11T01:00:01Z',limit:'2'};
  const seen:string[]=[];let cursor:string|null=null;let pages=0;
  do {
    const response=await s.list(reader.token,{...filters,...(cursor?{cursor}:{})});assert.equal(response.statusCode,200);
    const body=response.json();assert.deepEqual(Object.keys(body).sort(),['items','page']);
    assert.ok(body.items.every((r:{franchise_ids:string[]})=>r.franchise_ids.length===1&&r.franchise_ids[0]===A));
    seen.push(...body.items.map((r:{id:string})=>r.id));cursor=body.page.next_cursor;pages++;
    assert.equal(body.page.has_more,!!cursor);
  }while(cursor&&pages<10);
  assert.equal(pages,3);assert.equal(seen.length,5);assert.equal(new Set(seen).size,5);
  assert.deepEqual(seen,[...seen].sort().reverse());
  const orgPage=(await s.list(s.admin.token,{...filters,limit:'100'})).json();assert.equal(orgPage.items.length,35);
  assert.equal(orgPage.page.has_more,false);assert.ok(!JSON.stringify(orgPage).includes(C));
  const first=(await s.list(reader.token,filters)).json();
  for(const changed of [{limit:'3'},{resource_type:'organization'},{from:'2026-09-11T00:00:00Z'}]) {
    const response=await s.list(reader.token,{...filters,...changed,cursor:first.page.next_cursor});
    assert.equal(response.statusCode,422);assert.equal(response.json().error.code,'CURSOR_INVALID');
  }
  assert.equal((await s.list(s.admin.token,{...filters,cursor:first.page.next_cursor})).json().error.code,'CURSOR_INVALID');
  const other=await s.user();await s.memberships.bootstrapAdministrator(other.id,otherOrg);
  assert.equal((await s.list(other.token,{...filters,organization_id:otherOrg,cursor:first.page.next_cursor})).json().error.code,'CURSOR_INVALID');
  assert.equal((await s.list(other.token)).statusCode,403);
  const ownForeign=(await s.list(reader.token,{resource_type:'franchise',resource_id:B})).json().error;
  for(const id of [C,missing])assert.equal((await s.list(reader.token,{resource_type:'franchise',resource_id:id})).json().error.code,ownForeign.code);
  assert.equal(ownForeign.code,'RESOURCE_NOT_FOUND');
  for(const id of [B,C,missing])assert.equal((await s.list(reader.token,{franchise_id:id})).json().error.code,'RESOURCE_NOT_FOUND');
});

await test('R28 denies general roles and accountant administrative history, reauthorizes every page',{timeout:30000},async t=>{
  const s=await auditSetup(t);
  for(const role of ['operator','dispatcher','delivery_agent','read_only','accountant']) {
    const actor=await s.grant(role,[A]);assert.equal((await s.list(actor.token)).statusCode,403);
  }
  const reader=await s.grant('franchise_admin',[A]),first=await s.list(reader.token,{limit:'1'});
  assert.equal(first.statusCode,200);const cursor=first.json().page.next_cursor;assert.ok(cursor);
  await s.memberships.updateMembership(s.admin.token,reader.member.id,{role:'franchise_admin',franchise_ids:[A,B],expected_version:1});
  assert.equal((await s.list(reader.token,{limit:'1',cursor})).json().error.code,'CURSOR_INVALID');
  await s.memberships.revokeMembership(s.admin.token,reader.member.id,{expected_version:2});
  assert.equal((await s.list(reader.token,{limit:'1',cursor})).statusCode,403);
  const multi=await s.grant('operator',[A,B]);const local=await s.grant('franchise_admin',[A]);
  const page=(await s.list(local.token)).json();assert.ok(!JSON.stringify(page).includes(multi.member.id));assert.ok(!JSON.stringify(page).includes(B));
  assert.equal((await s.app.inject('/api/v1/audit?organization_id='+org)).statusCode,401);
});

await test('tenancy audit is mandatory in transaction: after-insert failure rolls back; prior failure has no fact',{timeout:30000},async t=>{
  const s=await auditSetup(t),before=await count(s.db,'audit_records');let inserted=false;
  const faulty:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {
    release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]) {
      const result=await client.query<Row>(sql,params);
      if(sql.includes('append_tenancy_audit')){inserted=true;throw new DatabaseError('DB_QUERY_FAILED');}
      return result;
    }};}};
  const service=createTenancyService({database:faulty,authorizer:approvedAuthority()});
  await assert.rejects(service.changeFranchiseLifecycle(A,disable),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal(inserted,true);assert.equal(await count(s.db,'audit_records'),before);
  assert.equal((await s.db.adminQuery<{lifecycle:string}>('SELECT lifecycle FROM shipit.franchises WHERE id=$1',[A])).rows[0]?.lifecycle,'active');
  const normal=createTenancyService({database:s.pool,authorizer:approvedAuthority()});
  await assert.rejects(normal.changeFranchiseLifecycle(A,{...disable,expected_version:9}),{code:'VERSION_CONFLICT'});
  assert.equal(await count(s.db,'audit_records'),before);
  await normal.changeFranchiseLifecycle(A,disable);await normal.changeFranchiseLifecycle(A,{...disable,expected_version:2});
  assert.equal(await count(s.db,'audit_records'),String(Number(before)+1));
  const audit=(await s.list(s.admin.token,{resource_type:'franchise',resource_id:A})).json();assert.equal(audit.items.length,1);
  assert.equal(audit.items[0].action,'franchise.lifecycle.manage');assert.equal(audit.items[0].changes.committed_version,2);
});

await test('membership compatibility seam commits exactly one logical fact and rolls back both stores on failure',{timeout:30000},async t=>{
  const s=await auditSetup(t),target=await s.user(),before=await count(s.db,'membership_audit_events');let inserted=false;
  const faulty:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {
    release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]) {
      const result=await client.query<Row>(sql,params);
      if(sql.includes('INSERT INTO shipit.membership_audit_events')){inserted=true;throw new DatabaseError('DB_QUERY_FAILED');}
      return result;
    }};}};
  const input={organization_id:org,invitee_user_id:target.id,role:'operator',franchise_ids:[A]};
  await assert.rejects(createMembershipService(faulty).createInvitation(s.admin.token,input),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal(inserted,true);assert.equal(await count(s.db,'membership_invitations'),'0');assert.equal(await count(s.db,'membership_audit_events'),before);
  const invitation=await s.memberships.createInvitation(s.admin.token,input);
  const member=await s.memberships.acceptInvitation(target.token,{token:invitation.acceptance_token});
  await s.memberships.updateMembership(s.admin.token,member.id,{role:'dispatcher',franchise_ids:[A],expected_version:1});
  await s.memberships.revokeMembership(s.admin.token,member.id,{expected_version:2});
  const second=await s.memberships.createInvitation(s.admin.token,{...input,role:'read_only'});
  await s.memberships.revokeInvitation(s.admin.token,second.id,{expected_version:1});
  const history=(await s.list(s.admin.token)).json().items;
  assert.equal(history.length,7);assert.equal(new Set(history.map((x:{id:string})=>x.id)).size,7);
  for(const action of ['invitation_created','invitation_accepted','membership_updated','membership_revoked','invitation_revoked'])assert.ok(history.some((x:{action:string})=>x.action===action));
  assert.equal(await count(s.db,'audit_records'),'0');assert.equal(await count(s.db,'membership_audit_events'),'7');
});

await test('denied guessed targets are durable identity-only categories with trusted correlation and safe counters',{timeout:30000},async t=>{
  const s=await auditSetup(t),local=await s.grant('franchise_admin',[A]);
  const foreign=await s.grant('operator',[B]),other=await s.user();await s.memberships.bootstrapAdministrator(other.id,otherOrg);
  const boot=await s.app.inject('/auth/bootstrap'),cookie=boot.cookies[0]!;
  for(const id of [foreign.member.id,missing]) {
    const response=await s.app.inject({method:'POST',url:`/api/v1/memberships/${id}/revoke`,payload:{expected_version:1},
      headers:{origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'x-request-id':'SYN_SECRET_HEADER'},
      cookies:{shipit_session:local.token,[cookie.name]:cookie.value}});
    assert.equal(response.statusCode,404);const correlation=response.json().error.correlation_id;
    assert.notEqual(correlation,'SYN_SECRET_HEADER');
    const row=(await s.db.adminQuery('SELECT * FROM shipit.audit_records WHERE correlation_id=$1',[correlation])).rows[0]!;
    assert.equal(row.result,'denied');assert.equal(row.reason_code,'RESOURCE_NOT_FOUND');assert.equal(row.action,'membership.manage');
    assert.equal(row.actor_id,local.id);assert.equal(row.organization_id,null);assert.equal(row.franchise_id,null);assert.equal(row.resource_id,null);
    assert.equal(row.previous_lifecycle,null);assert.ok(!JSON.stringify(row).includes(id));assert.ok(!JSON.stringify(row).includes(B));
  }
  assert.equal(s.telemetry.snapshot().counters[0]?.count,2);
  assert.ok(!JSON.stringify(s.telemetry.snapshot()).includes(local.id));assert.ok(!s.logs.join('').includes('SYN_SECRET_HEADER'));
  // A failed denial append still cannot execute the forbidden command or grant access.
  const owner=s.db.ownerPool();await owner.query(`REVOKE EXECUTE ON FUNCTION shipit.append_security_denial(text,text,text,text,text,uuid) FROM "${s.db.runtimeRole}"`);
  const response=await s.list(other.token);assert.equal(response.statusCode,403);assert.equal(s.telemetry.snapshot().recording_failures,1);
  assert.ok(s.logs.join('').includes('security_audit_unavailable'));
  assert.equal((await s.db.adminQuery<{lifecycle:string}>('SELECT lifecycle FROM shipit.memberships WHERE id=$1',[foreign.member.id])).rows[0]?.lifecycle,'active');
});

await test('audit filter failures and outage use controlled codes and cannot expose SQL or private input',{timeout:30000},async t=>{
  const s=await auditSetup(t);
  for(const extra of [{limit:'101'},{cursor:''},{cursor:'invalid'}, {resource_type:"franchise' OR 1=1--"},{from:'2026-02-30T00:00:00Z'},{sort:'DROP TABLE'}] as Record<string,string>[]) {
    const response=await s.list(s.admin.token,extra);assert.equal(response.statusCode,422);
    assert.ok(['VALIDATION_FAILED','CURSOR_INVALID'].includes(response.json().error.code));assert.doesNotMatch(response.body,/SELECT|TABLE|franchise'|2026-02/);
  }
  await s.db.setAvailable(false);
  try {const response=await s.list(s.admin.token);assert.equal(response.statusCode,503);assert.equal(response.json().error.code,'TEMPORARILY_UNAVAILABLE');}
  finally {await s.db.setAvailable(true);}
  assert.equal((await s.list(s.admin.token)).statusCode,200);
  assert.doesNotMatch(s.logs.join(''),/OR 1=1|DROP TABLE|postgresql:|password/i);
});

await test('redaction preserves identity behavior and excludes code/verifier/session/invitation/provider/address values',{timeout:30000},async t=>{
  const s=await auditSetup(t);const email='synthetic-login@example.test',binding='synthetic-browser';await s.auth.provision('email',email);
  const start=await s.auth.start('email',email,binding,'synthetic-ip');let code='';
  const worker=createDeliveryWorker(s.pool,s.keys,async m=>{code=m.code;return {state:'accepted',reference:'SYN_PROVIDER_SECRET'};});await worker.tick();
  const verifier=(await s.db.adminQuery<{verifier:string}>('SELECT verifier FROM shipit.auth_challenges WHERE id=$1',[start.challenge_id])).rows[0]!.verifier;
  const login=await s.auth.verify(start.challenge_id,code,binding,'synthetic-ip');assert.ok(!login.linked);
  const target=await s.user(),invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:target.id,role:'operator',franchise_ids:[A]});
  const address='99 Synthetic Full Address, Test City';
  await createTenancyService({database:s.pool,authorizer:approvedAuthority()}).updateFranchiseProfile(A,{display_name:address,expected_version:1});
  const dto=await s.list(s.admin.token),stored=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.audit_history')).rows);
  const surfaces=stored+s.logs.join('')+dto.body;
  for(const value of [code,verifier,login.token,invite.acceptance_token,'SYN_PROVIDER_SECRET',address,email,binding])assert.ok(!surfaces.includes(value));
  const identities=(await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE resource_type=$1',['identity'])).rows;
  assert.ok(identities.length>0);assert.ok(identities.every(r=>r.organization_id===null&&r.franchise_ids.length===0));
  assert.ok(dto.json().items.every((r:{resource:{type:string}})=>r.resource.type!=='identity'));
  await s.auth.logout(login.token);await assert.rejects(s.auth.current(login.token),{code:'UNAUTHENTICATED'});
});

await test('committed audit and opaque cursor survive pool/service restart without duplicates',{timeout:30000},async t=>{
  const s=await auditSetup(t);await s.grant('operator',[A]);
  const first=await s.audit.list(s.admin.token,{organization_id:org,limit:'1'},randomUUID());assert.ok(first.page.next_cursor);
  await s.pool.close();const replacement=s.db.runtimePool(),restarted=createAuditService(replacement,s.keys.browser);
  const again=await restarted.list(s.admin.token,{organization_id:org,limit:'1'},randomUUID());assert.deepEqual(again.items,first.items);
  const second=await restarted.list(s.admin.token,{organization_id:org,limit:'1',cursor:first.page.next_cursor},randomUUID());
  assert.equal(second.items.length,1);assert.notEqual(second.items[0]!.id,first.items[0]!.id);
});

await test('audit append refuses read capability and expired transaction even with structurally valid data',{timeout:30000},async t=>{
  const s=await auditSetup(t);let captured:Parameters<typeof appendTenancy>[0]|undefined;
  const fact={actor:{type:'service' as const,id:'synthetic'},action:'franchise.profile.update' as const,organization_id:org,franchise_id:A,
    previous_lifecycle:'active' as const,new_lifecycle:'active' as const,expected_version:1,committed_version:2,
    correlation_id:randomUUID(),reason_code:'profile_correction' as const,occurred_at:'2026-09-11T00:00:00Z'};
  await withTransaction(s.pool,async tx=>{
    captured=issueTenantAccess(tx,{action:'audit.read',actor:{type:'user',id:s.admin.id},organizationId:org,permittedFranchiseIds:[A],organizationWide:false,
      correlationId:randomUUID(),provenance:'membership'});
    await assert.rejects(appendTenancy(captured,fact),{code:'ACTION_FORBIDDEN'});
    assert.throws(()=>scopedQuery(captured!,['audit.read'],
      `SELECT shipit.append_security_denial('anonymous','anonymous','audit.read','audit','ACTION_FORBIDDEN',$1) WHERE {{organization:$2}}`,
      [randomUUID(),org]),{code:'ACTION_FORBIDDEN'});
  });
  await assert.rejects(appendTenancy(captured!,fact),{code:'ACTION_FORBIDDEN'});assert.equal(await count(s.db,'audit_records'),'0');
});

await test('HTTP success facts use server request correlation for auth and membership without tenantizing identity',{timeout:30000},async t=>{
  const s=await auditSetup(t),target=await s.user(),boot=await s.app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'x-request-id':'SYN_UNTRUSTED_CORRELATION'};
  const response=await s.app.inject({method:'POST',url:'/api/v1/membership-invitations',headers,
    cookies:{shipit_session:s.admin.token,[browser.name]:browser.value},payload:{organization_id:org,invitee_user_id:target.id,role:'operator',franchise_ids:[A]}});
  assert.equal(response.statusCode,201);
  const requestId=response.headers['x-request-id'];assert.notEqual(requestId,headers['x-request-id']);
  const fact=(await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE resource_id=$1',[response.json().id])).rows;
  assert.equal(fact.length,1);assert.equal(fact[0]!.correlation_id,requestId);
  const email='synthetic-http-correlation@example.test';await s.auth.provision('email',email);
  const start=await s.auth.start('email',email,browser.value,'synthetic-correlation-ip');let code='';
  await createDeliveryWorker(s.pool,s.keys,async m=>{code=m.code;return {state:'accepted',reference:'synthetic'};}).tick();
  const login=await s.app.inject({method:'POST',url:'/auth/challenges/verify',headers,cookies:{[browser.name]:browser.value},
    payload:{challenge_id:start.challenge_id,code}});
  assert.equal(login.statusCode,200);
  const loginFacts=(await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE correlation_id=$1',[login.headers['x-request-id']])).rows;
  assert.equal(loginFacts.length,1);assert.equal(loginFacts[0]!.action,'login');assert.equal(loginFacts[0]!.organization_id,null);
});
