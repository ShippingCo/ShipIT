import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../../src/modules/auth/repository.ts';
import { DatabaseError, withTransaction, type DatabasePool } from '@shippingco/db';
import { auditSetup, org, A, B, C } from '../audit-support.ts';
import { createMembershipService } from '../../src/modules/memberships/service.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
const body = { display_name: 'Synthetic independent shop', franchise: { display_name: 'Synthetic Pune counter', franchise_code: 'MAIN' } };
const unknown = '00000000-0000-4000-8000-999999999999';

await test('bootstrap commits ownership, admin, three audit facts and replay evidence; survives API/pool restart', { timeout: 30000 }, async t => {
  const s = await auditSetup(t), user = await s.user();
  assert.equal((await s.memberships.operatorContext(user.token)).state, 'onboarding_required');
  const result = await s.memberships.onboard(user.token, 'synthetic_request', body);
  assert.equal(result.role, 'org_admin');
  const rows = (await s.db.adminQuery(`SELECT f.organization_id,m.role,m.user_id,m.lifecycle,c.result,c.retain_until>=c.committed_at+interval '24 hours' AS retained
    FROM shipit.onboarding_commands c JOIN shipit.franchises f ON f.id=c.franchise_id
    JOIN shipit.memberships m ON m.id=c.membership_id WHERE c.user_id=$1`, [user.id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.organization_id, result.organization.id);
  assert.equal(rows[0]!.role, 'org_admin'); assert.equal(rows[0]!.user_id, user.id); assert.equal(rows[0]!.retained, true);
  const audits = (await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE organization_id=$1', [result.organization.id])).rows;
  assert.equal(audits.length, 3); assert.deepEqual(new Set(audits.map(row => row.resource_type)), new Set(['organization', 'franchise', 'membership']));
  assert.ok(audits.every(row => row.result === 'success' && row.correlation_id));
  assert.ok(audits.some(row => row.actor_id === user.id));
  assert.doesNotMatch(JSON.stringify(audits), /Synthetic independent|Pune counter/);
  assert.deepEqual(await s.memberships.onboard(user.token, 'synthetic_request', body), result);
  await assert.rejects(s.memberships.onboard(user.token, 'synthetic_request', { ...body, display_name: 'Other' }), { code: 'IDEMPOTENCY_CONFLICT' });
  const replacement = s.db.runtimePool(), restored = createMembershipService(replacement);
  const context = await restored.operatorContext(user.token);
  assert.equal(context.active_franchise_id, result.franchise.id); assert.equal(context.franchises[0]?.organization.id, result.organization.id);
  assert.deepEqual(await restored.onboard(user.token, 'synthetic_request', body), result);
  assert.equal((await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE organization_id=$1', [result.organization.id])).rows.length, 3);
  for (const sql of ['DELETE FROM shipit.onboarding_commands', 'UPDATE shipit.onboarding_commands SET request_key=\'new\'', 'TRUNCATE shipit.onboarding_commands']) await assert.rejects(replacement.query(sql));
  await s.app.close();
  const config = parseEnvironment({ NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable' });
  const app = buildServer({config,database:replacement,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
  const response = await app.inject({url:'/api/v1/operator-context',cookies:{shipit_session:user.token}});
  assert.deepEqual(response.json(), context);
});

await test('concurrent same-key requests replay one workspace; different-key races cannot duplicate an owner', { timeout: 30000 }, async t => {
  const s = await auditSetup(t), first = await s.user();
  const results = await Promise.all(Array.from({length:4},()=>s.memberships.onboard(first.token,'concurrent',body)));
  assert.ok(results.every(result => result.organization.id === results[0]!.organization.id));
  const second = await s.user();
  const race = await Promise.allSettled(['one','two'].map(key=>s.memberships.onboard(second.token,key,body)));
  assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await s.db.adminQuery('SELECT * FROM shipit.onboarding_commands WHERE user_id=$1',[second.id])).rows.length,1);
  assert.equal((await s.db.adminQuery('SELECT * FROM shipit.memberships WHERE user_id=$1',[second.id])).rows.length,1);
  // Direct runtime SQL proves the primary key, independently of the application lock.
  await assert.rejects(s.pool.query(`INSERT INTO shipit.onboarding_commands SELECT user_id,$2,operation_id,$3,fingerprint,normalization_version,
    organization_id,franchise_id,membership_id,result,committed_at,retain_until FROM shipit.onboarding_commands WHERE user_id=$1`,[second.id,randomUUID(),'another']), e=>e instanceof DatabaseError&&e.sqlState==='23505');
});

await test('failure after each real bootstrap write rolls back every business, membership, audit and replay row', { timeout: 30000 }, async t => {
  const s = await auditSetup(t), user = await s.user();
  const tables = ['organizations','franchises','memberships','membership_audit_events','audit_records','onboarding_commands'];
  const counts = async () => Promise.all(tables.map(async table=>(await s.db.adminQuery<{count:string}>(`SELECT count(*) FROM shipit.${table}`)).rows[0]!.count));
  const before = await counts();
  for (const match of ['INSERT INTO shipit.organizations','INSERT INTO shipit.franchises','shipit.append_tenancy_audit(',
    'INSERT INTO shipit.memberships','INSERT INTO shipit.membership_audit_events','INSERT INTO shipit.onboarding_commands']) {
    let failed = false;
    const faulty: DatabasePool = { ...s.pool, async connect() { const client = await s.pool.connect(); return { ...client,
      async query<Row extends object>(sql:string,params:readonly unknown[]=[]) {
        const result = await client.query<Row>(sql,params);
        if (sql.includes(match)) { failed=true;throw new DatabaseError('DB_QUERY_FAILED'); }
        return result;
      } }; } };
    await assert.rejects(createMembershipService(faulty).onboard(user.token,'rollback',body),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.equal(failed,true,match);assert.deepEqual(await counts(),before,match);
  }
  await s.memberships.onboard(user.token,'rollback',body);
});

await test('lost COMMIT acknowledgement replays the persisted original result without new audit effects', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),user=await s.user();let lost=false;
  const faulty:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {...client,
    async query<Row extends object>(sql:string,params:readonly unknown[]=[]){const result=await client.query<Row>(sql,params);
      if(sql==='COMMIT'&&!lost){lost=true;throw new DatabaseError('DB_QUERY_FAILED');}return result;}};}};
  await assert.rejects(createMembershipService(faulty).onboard(user.token,'lost-response',body),{code:'TEMPORARILY_UNAVAILABLE'});
  const saved=(await s.db.adminQuery('SELECT result FROM shipit.onboarding_commands WHERE user_id=$1',[user.id])).rows[0]!.result;
  assert.deepEqual(await s.memberships.onboard(user.token,'lost-response',body),saved);
  assert.equal((await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE organization_id=$1',[saved.organization.id])).rows.length,3);
});

await test('HTTP contexts expose only granted active scopes and reject sibling/foreign IDs, ownership fields and read-only bootstrap', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),operator=await s.grant('operator',[A]),readOnly=await s.grant('read_only',[A]);
  const get=(token:string,id?:string)=>s.app.inject({url:'/api/v1/operator-context'+(id?`/franchises/${id}`:''),cookies:{shipit_session:token}});
  assert.deepEqual((await get(s.admin.token)).json().franchises.map((f:{id:string})=>f.id).sort(),[A,B].sort());
  assert.deepEqual((await get(operator.token)).json().franchises.map((f:{id:string})=>f.id),[A]);
  assert.equal((await get(operator.token,A)).statusCode,200);
  for(const token of [operator.token,readOnly.token]) for(const id of [B,C,unknown]) {
    const response=await get(token,id);assert.equal(response.statusCode,404);assert.equal(response.json().error.code,'RESOURCE_NOT_FOUND');
    assert.ok(!response.body.includes(id));
  }
  assert.equal((await get(s.admin.token,C)).statusCode,404);
  assert.equal((await get('')).statusCode,401);
  const boot=await s.app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'idempotency-key':'http-request'};
  const post=(token:string,payload:Record<string,unknown>,h=headers)=>s.app.inject({method:'POST',url:'/api/v1/onboarding',payload,headers:h,cookies:{shipit_session:token,[browser.name]:browser.value}});
  assert.equal((await post(readOnly.token,body)).statusCode,403);
  const eligible=await s.user();
  for(const extra of [{organization_id:org},{franchise_id:B},{role:'org_admin'},{membership_id:readOnly.member.id}]) assert.equal((await post(eligible.token,{...body,...extra})).statusCode,422);
  assert.equal((await s.app.inject({url:`/api/v1/operator-context?franchise_id=${C}`,cookies:{shipit_session:operator.token}})).statusCode,422);
  assert.equal((await post(eligible.token,body,{...headers,'idempotency-key':'bad,duplicate'})).statusCode,422);
  assert.equal((await post(eligible.token,body,{...headers,'x-csrf-token':'bad'})).statusCode,403);
  const created=await post(eligible.token,body);assert.equal(created.statusCode,201);
  assert.deepEqual((await post(eligible.token,body)).json(),created.json());
  const wire=JSON.stringify((await get(eligible.token)).json());assert.doesNotMatch(wire,/token|session|address|phone|membership_id|created_at|audit|fingerprint/);
  assert.ok(!s.logs.join('').includes(eligible.token));assert.ok(!s.logs.join('').includes(headers['x-csrf-token']));
});

await test('live revocation, disabled roots and disabled accounts invalidate context and replay without rebootstrap', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),operator=await s.grant('operator',[A]);
  await s.memberships.revokeMembership(s.admin.token,operator.member.id,{expected_version:1});
  assert.deepEqual((await s.memberships.operatorContext(operator.token)).franchises,[]);
  assert.equal((await s.memberships.operatorContext(operator.token)).state,'scope_unavailable');
  await assert.rejects(s.memberships.operatorContext(operator.token,A),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(s.memberships.onboard(operator.token,'revoked',body),{code:'ACTION_FORBIDDEN'});
  const user=await s.user(),result=await s.memberships.onboard(user.token,'disabled',body);
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled' WHERE id=$1",[result.franchise.id]);
  assert.equal((await s.memberships.operatorContext(user.token)).state,'scope_unavailable');
  await assert.rejects(s.memberships.onboard(user.token,'disabled',body),{code:'RESOURCE_NOT_FOUND'});
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='active' WHERE id=$1",[result.franchise.id]);
  await s.db.adminQuery("UPDATE shipit.organizations SET lifecycle='disabled' WHERE id=$1",[result.organization.id]);
  assert.equal((await s.memberships.operatorContext(user.token)).state,'scope_unavailable');
  await s.auth.changeAccount(user.id,'disabled');
  await assert.rejects(s.memberships.operatorContext(user.token),{code:'UNAUTHENTICATED'});
});

await test('existing invitation acceptance leads to scope; wrong identity, expiry, reuse and revocation remain rejected and secret-free', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),user=await s.user(),wrong=await s.user();
  const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:user.id,role:'operator',franchise_ids:[A]});
  await assert.rejects(s.memberships.acceptInvitation(wrong.token,{token:invite.acceptance_token}),{code:'ACTION_FORBIDDEN'});
  const member=await s.memberships.acceptInvitation(user.token,{token:invite.acceptance_token});
  assert.equal((await s.memberships.operatorContext(user.token)).active_franchise_id,A);
  await assert.rejects(s.memberships.acceptInvitation(user.token,{token:invite.acceptance_token}),{code:'ACTION_FORBIDDEN'});
  await s.memberships.revokeMembership(s.admin.token,member.id,{expected_version:1});
  await assert.rejects(s.memberships.acceptInvitation(user.token,{token:invite.acceptance_token}),{code:'ACTION_FORBIDDEN'});
  assert.equal((await s.memberships.operatorContext(user.token)).state,'scope_unavailable');
  const expired=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:wrong.id,role:'operator',franchise_ids:[A]});
  await s.db.adminQuery("UPDATE shipit.membership_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);
  await assert.rejects(s.memberships.acceptInvitation(wrong.token,{token:expired.acceptance_token}),{code:'ACTION_FORBIDDEN'});
  const evidence=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.audit_history')).rows)+s.logs.join('');
  assert.ok(!evidence.includes(invite.acceptance_token));assert.ok(!evidence.includes(expired.acceptance_token));assert.ok(!evidence.includes(user.token));
});

await test('bounded identity-lock contention returns in-progress and same-key retry succeeds', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),user=await s.user();
  let unlock!:()=>void,locked!:()=>void;
  const held=new Promise<void>(resolve=>{locked=resolve;}),release=new Promise<void>(resolve=>{unlock=resolve;});
  const blocker=withTransaction(s.pool,async tx=>{await new AuthRepository(tx).user(user.id,true);locked();await release;});
  await held;
  try {
    const limited=s.db.runtimePool({statementTimeoutMs:100,queryTimeoutMs:1000});
    await assert.rejects(createMembershipService(limited).onboard(user.token,'waiting',body),{code:'IDEMPOTENCY_IN_PROGRESS'});
    assert.equal((await s.db.adminQuery('SELECT * FROM shipit.onboarding_commands WHERE user_id=$1',[user.id])).rows.length,0);
  } finally {unlock();await blocker;}
  const result=await s.memberships.onboard(user.token,'waiting',body);
  assert.equal(result.role,'org_admin');
});

await test('context and bootstrap dependency outage expose only controlled errors and recover without partial ownership', { timeout: 30000 }, async t => {
  const s=await auditSetup(t),user=await s.user();
  await s.db.setAvailable(false);
  try {
    const response=await s.app.inject({url:'/api/v1/operator-context',cookies:{shipit_session:user.token}});
    assert.equal(response.statusCode,503);assert.equal(response.json().error.code,'TEMPORARILY_UNAVAILABLE');
    assert.doesNotMatch(response.body,/SELECT|postgres|password|token|example\.test/);
    await assert.rejects(s.memberships.onboard(user.token,'outage',body),{code:'TEMPORARILY_UNAVAILABLE'});
  } finally {await s.db.setAvailable(true);}
  assert.equal((await s.memberships.operatorContext(user.token)).state,'onboarding_required');
  assert.equal((await s.db.adminQuery('SELECT * FROM shipit.onboarding_commands WHERE user_id=$1',[user.id])).rows.length,0);
  await s.memberships.onboard(user.token,'outage',body);
});
