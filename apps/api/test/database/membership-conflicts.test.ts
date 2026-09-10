import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTenantIsolationFixture } from '@shippingco/testkit';
import { DatabaseError, withTransaction, type DatabaseClient, type TransactionExecutor } from '@shippingco/db';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { seedTenancy } from '../tenancy-support.ts';
import { digest } from '../../src/modules/auth/crypto.ts';
import { createMembershipService } from '../../src/modules/memberships/service.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { activeRoleExists, pendingInvitationExists } from '../../src/modules/memberships/authority.ts';
import { issueTenantAccess, type TenantAccess } from '../../src/modules/security/scope.ts';

const f=createTenantIsolationFixture(),a=f.franchises.alpha1,b=f.franchises.alpha2,c=f.franchises.beta1;
const keys={version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)};
async function setup(t:TestContext) {
  const db=await provisionDatabase(t);await db.prepareMemberships();
  const owner=db.ownerPool(),tokens=new Map<string,string>();
  try {
    await seedTenancy(owner);
    for(const actor of Object.values(f.actors)) {
      const token=randomBytes(32).toString('base64url');tokens.set(actor.id,token);
      await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[actor.id]);
      await owner.query(`INSERT INTO shipit.auth_sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at)
        VALUES($1,$2,$3,1,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '12 hours')`,[randomUUID(),actor.id,digest(token)]);
      await owner.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[actor.membership_id,actor.id,actor.organization_id,actor.role]);
      if(actor.franchise_id) await owner.query('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)',[actor.membership_id,actor.organization_id,actor.franchise_id]);
    }
  } finally {await owner.close();}
  const runtime=db.runtimePool({maxConnections:1}),errors:unknown[]=[],facts:unknown[]=[];
  assert.equal((await runtime.query<{role:string}>('SELECT current_user AS role')).rows[0]?.role,db.runtimeRole);
  let injection:{prefix:string;run:(client:DatabaseClient)=>Promise<void>}|undefined;
  const pool={...runtime,async connect() {
    const client=await runtime.connect();
    return {...client,async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]) {
      if(injection && sql.startsWith(injection.prefix)) {
        const current=injection;injection=undefined;await current.run(client);
      }
      try {
        const result=await client.query<Row>(sql,params);
        if(sql.startsWith('SELECT EXISTS')) facts.push(result.rows);
        return result;
      } catch(error) {errors.push(error);throw error;}
    }};
  }};
  const logs:string[]=[],service=createMembershipService(pool);
  const app=buildServer({database:pool,auth:{keys,delivery:{},webhook:undefined},
    config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),
    logSink:{write:value=>logs.push(value)}});t.after(()=>app.close());
  const boot=await app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const token=(name:keyof typeof f.actors)=>tokens.get(f.actors[name].id)!;
  const request=(name:keyof typeof f.actors,url:string,payload:object,method:'POST'|'PATCH'='POST')=>app.inject({method,url,payload,
    headers:{origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token},cookies:{[browser.name]:browser.value,shipit_session:token(name)}});
  const user=f.actors.alpha1ReadOnly;
  const input=(franchise=b,role='operator')=>({organization_id:franchise.organization_id,invitee_user_id:user.id,role,franchise_ids:[franchise.id]});
  const create=()=>request('alpha1FranchiseAdmin','/api/v1/membership-invitations',input(a));
  const invite=()=>service.createInvitation(token('alphaOrgAdmin'),input());
  async function member(franchise=b,role='operator',executor:Pick<DatabaseClient,'query'>=runtime) {
    const id=randomUUID();
    await executor.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[id,user.id,franchise.organization_id,role]);
    await executor.query('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)',[id,franchise.organization_id,franchise.id]);
    return id;
  }
  async function state() {
    // Test-only owner assertions cover every domain row and scope, including audit.
    return {
      members:(await db.adminQuery('SELECT * FROM shipit.memberships ORDER BY id')).rows,
      scopes:(await db.adminQuery('SELECT * FROM shipit.membership_franchise_scopes ORDER BY membership_id,franchise_id')).rows,
      invitations:(await db.adminQuery('SELECT * FROM shipit.membership_invitations ORDER BY id')).rows,
      invitationScopes:(await db.adminQuery('SELECT * FROM shipit.invitation_franchise_scopes ORDER BY invitation_id,franchise_id')).rows,
      audit:(await db.adminQuery('SELECT * FROM shipit.membership_audit_events ORDER BY id')).rows,
    };
  }
  function conflict(response:{statusCode:number;body:string;json():{error:{code:string}}},code:string,privateValues:string[]=[]) {
    assert.equal(response.statusCode,409);assert.equal(response.json().error.code,code);
    assert.deepEqual(Object.keys(response.json()),['error']);
    assert.deepEqual(Object.keys(response.json().error).sort(),['code','correlation_id','message']);
    for(const value of [b.id,c.id,...privateValues]) {
      assert.ok(!response.body.includes(value));assert.ok(!logs.join('').includes(value));
    }
    for(const rows of facts) {
      assert.ok(Array.isArray(rows));assert.equal(rows.length,1);
      assert.deepEqual(Object.keys(rows[0]),['occupied']);assert.equal(typeof rows[0].occupied,'boolean');
    }
  }
  return {db,pool,service,token,request,user,input,create,invite,member,state,conflict,errors,facts,
    arm:(prefix:string,run:(client:DatabaseClient)=>Promise<void>)=>{injection={prefix,run};},
    assertInjected:()=>assert.equal(injection,undefined)};
}

await test('sibling active role returns HTTP 409 without creating an invitation or exposing the grant',{timeout:30000},async t=>{
  const x=await setup(t),id=await x.member(),before=await x.state();
  x.conflict(await x.create(),'MEMBERSHIP_CONFLICT',[id]);
  assert.deepEqual(await x.state(),before);assert.equal(x.errors.length,0);
  assert.deepEqual(x.facts,[[{occupied:true}]]);
});

await test('sibling pending invitation returns HTTP 409 without duplicate or private details',{timeout:30000},async t=>{
  const x=await setup(t),invite=await x.invite(),before=await x.state();
  x.conflict(await x.create(),'INVITATION_CONFLICT',[invite.id,invite.acceptance_token]);
  assert.deepEqual(await x.state(),before);assert.equal(x.errors.length,0);
});

await test('expired sibling still occupies pending slot; bounded admin conflicts and organization admin can replace',{timeout:30000},async t=>{
  const x=await setup(t),invite=await x.invite();
  await x.db.adminQuery("UPDATE shipit.membership_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[invite.id]);
  const before=await x.state();
  x.conflict(await x.create(),'INVITATION_CONFLICT',[invite.id,invite.acceptance_token]);
  assert.deepEqual(await x.state(),before);assert.equal(x.errors.length,0);
  const replacement=await x.request('alphaOrgAdmin','/api/v1/membership-invitations',x.input(a));
  assert.equal(replacement.statusCode,201);assert.notEqual(replacement.json().id,invite.id);
  const after=await x.state();
  assert.equal(after.invitations.find(row=>row.id===invite.id)?.state,'revoked');
  assert.equal(after.invitations.filter(row=>row.state==='pending').length,1);
  assert.equal(after.audit.filter(row=>row.invitation_id===invite.id && row.action==='invitation_expired').length,1);
  assert.deepEqual(after.members,before.members);assert.deepEqual(after.scopes,before.scopes);
});

await test('sibling role gained before acceptance returns HTTP 409 and leaves invitation pending with all state intact',{timeout:30000},async t=>{
  const x=await setup(t),created=await x.create();assert.equal(created.statusCode,201);
  const invite=created.json(),id=await x.member(),before=await x.state();
  x.conflict(await x.request('alpha1ReadOnly','/api/v1/membership-invitations/accept',{token:invite.acceptance_token}),
    'MEMBERSHIP_CONFLICT',[id,invite.acceptance_token]);
  assert.deepEqual(await x.state(),before);assert.equal(x.errors.length,0);
  assert.equal(before.invitations.find(row=>row.id===invite.id)?.state,'pending');
  assert.equal(before.members.filter(row=>row.user_id===x.user.id && row.role==='operator').length,1);
});

await test('role updates honor sibling occupancy and exclude only the managed membership',{timeout:30000},async t=>{
  const x=await setup(t),id=await x.member(),before=await x.state();
  x.conflict(await x.request('alpha1FranchiseAdmin',`/api/v1/memberships/${x.user.membership_id}`,
    {role:'operator',franchise_ids:[a.id],expected_version:1},'PATCH'),'MEMBERSHIP_CONFLICT',[id]);
  assert.deepEqual(await x.state(),before);
  const unchangedRole=await x.request('alpha1FranchiseAdmin',`/api/v1/memberships/${x.user.membership_id}`,
    {role:'read_only',franchise_ids:[a.id],expected_version:1},'PATCH');
  assert.equal(unchangedRole.statusCode,200);assert.equal(unchangedRole.json().version,2);
});

await test('occupancy is restricted to authorized organization and exact user and role',{timeout:30000},async t=>{
  const x=await setup(t);await x.member(c);await x.member(b,'dispatcher');
  const foreignInvite=randomUUID();
  await x.pool.query(`INSERT INTO shipit.membership_invitations(id,invitee_user_id,organization_id,role,token_hash,expires_at,created_by_user_id)
    VALUES($1,$2,$3,'operator',$4,clock_timestamp()+interval '7 days',$2)`,[foreignInvite,x.user.id,c.organization_id,digest(randomUUID())]);
  const created=await x.create();assert.equal(created.statusCode,201);
  assert.equal(created.json().organization_id,a.organization_id);
  const before=await x.state();
  const denied=await x.request('alpha1FranchiseAdmin','/api/v1/membership-invitations',x.input(c));
  assert.equal(denied.statusCode,403);assert.equal(denied.json().error.code,'ACTION_FORBIDDEN');
  assert.deepEqual(await x.state(),before);
});

await test('occupancy rejects missing, forged, cloned, expired, read-only and wrong-invitee capabilities before SQL',{timeout:30000},async t=>{
  const x=await setup(t);let expired:TenantAccess|undefined,ended:TransactionExecutor|undefined;
  await withTransaction(x.pool,async tx=>{
    const context={action:'memberships.manage' as const,actor:{type:'user' as const,id:f.actors.alpha1FranchiseAdmin.id},
      organizationId:a.organization_id,permittedFranchiseIds:[a.id],organizationWide:false,correlationId:'synthetic',provenance:'membership' as const};
    const scope=issueTenantAccess(tx,context);expired=scope;ended=tx;
    for(const invalid of [undefined,null,{context},{...scope}]) {
      await assert.rejects(activeRoleExists(tx,invalid as TenantAccess,x.user.id,'operator'),/ACTION_FORBIDDEN/);
      await assert.rejects(pendingInvitationExists(tx,invalid as TenantAccess,x.user.id,'operator'),/ACTION_FORBIDDEN/);
    }
    const read=issueTenantAccess(tx,{...context,action:'memberships.read'});
    await assert.rejects(activeRoleExists(tx,read,x.user.id,'operator'),/ACTION_FORBIDDEN/);
    await assert.rejects(pendingInvitationExists(tx,read,x.user.id,'operator'),/ACTION_FORBIDDEN/);
    const accept=issueTenantAccess(tx,{...context,action:'invitations.accept',provenance:'invitation',invitationId:randomUUID()});
    await assert.rejects(activeRoleExists(tx,accept,x.user.id,'operator'),/ACTION_FORBIDDEN/);
    await assert.rejects(activeRoleExists(tx,accept,context.actor.id,'operator',randomUUID()),/ACTION_FORBIDDEN/);
    await assert.rejects(pendingInvitationExists(tx,accept,context.actor.id,'operator'),/ACTION_FORBIDDEN/);
  });
  await assert.rejects(activeRoleExists(ended!,expired!,x.user.id,'operator'),/ACTION_FORBIDDEN/);
  await assert.rejects(pendingInvitationExists(ended!,expired!,x.user.id,'operator'),/ACTION_FORBIDDEN/);
  assert.deepEqual(x.facts,[]);
});

// The service serializes ordinary same-organization requests on the organization
// lock. Inject a real SQL write on its leased runtime connection immediately before
// the attempted write: the real EXISTS returned false, then the real unique index
// rejects the attempt. No mocked query results, sleeps or scheduling races. The
// injected fixture is in the same transaction and must roll back too.
await test('real pending-index violation after a clear occupancy check becomes HTTP 409 and rolls back',{timeout:30000},async t=>{
  const x=await setup(t),before=await x.state(),injected=randomUUID();
  x.arm('INSERT INTO shipit.membership_invitations',async client=>{
    await client.query(`INSERT INTO shipit.membership_invitations(id,invitee_user_id,organization_id,role,token_hash,expires_at,created_by_user_id)
      VALUES($1,$2,$3,'operator',$4,clock_timestamp()+interval '7 days',$5)`,[injected,x.user.id,a.organization_id,digest(randomUUID()),f.actors.alphaOrgAdmin.id]);
    await client.query('INSERT INTO shipit.invitation_franchise_scopes(invitation_id,organization_id,franchise_id) VALUES($1,$2,$3)',[injected,a.organization_id,b.id]);
  });
  x.conflict(await x.create(),'INVITATION_CONFLICT',[injected]);x.assertInjected();
  assert.deepEqual(x.facts,[[{occupied:false}],[{occupied:false}]]);
  assert.ok(x.errors[0] instanceof DatabaseError);assert.equal(x.errors[0].sqlState,'23505');
  assert.equal(x.errors[0].constraint,'invitations_one_pending_role_idx');
  assert.deepEqual(await x.state(),before);
});

await test('real active-index violation during acceptance becomes HTTP 409 and rolls back invitation and membership',{timeout:30000},async t=>{
  const x=await setup(t),created=await x.create();assert.equal(created.statusCode,201);
  const invite=created.json(),before=await x.state();x.facts.length=0;
  x.arm('INSERT INTO shipit.memberships',async client=>{await x.member(b,'operator',client);});
  x.conflict(await x.request('alpha1ReadOnly','/api/v1/membership-invitations/accept',{token:invite.acceptance_token}),
    'MEMBERSHIP_CONFLICT',[invite.acceptance_token]);x.assertInjected();
  assert.deepEqual(x.facts,[[{occupied:false}]]);
  assert.ok(x.errors[0] instanceof DatabaseError);assert.equal(x.errors[0].sqlState,'23505');
  assert.equal(x.errors[0].constraint,'memberships_one_active_role_idx');
  assert.deepEqual(await x.state(),before);
});

await test('unrelated unique violation stays HTTP 503 and rolls back already-written invitation state',{timeout:30000},async t=>{
  const x=await setup(t),before=await x.state();
  // Synthetic audit trigger creates a distinct unique failure *after* invitation
  // and scope inserts, proving both narrow mapping and atomic rollback.
  await x.db.adminQuery(`CREATE TABLE shipit.synthetic_conflict(value integer PRIMARY KEY);
    INSERT INTO shipit.synthetic_conflict VALUES(1);
    CREATE FUNCTION shipit.synthetic_audit_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path=pg_catalog AS $$ BEGIN INSERT INTO shipit.synthetic_conflict VALUES(1); RETURN NEW; END $$;
    CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON shipit.membership_audit_events
    FOR EACH ROW EXECUTE FUNCTION shipit.synthetic_audit_failure();`);
  const response=await x.create();
  assert.equal(response.statusCode,503);assert.equal(response.json().error.code,'TEMPORARILY_UNAVAILABLE');
  assert.ok(x.errors[0] instanceof DatabaseError);assert.equal(x.errors[0].sqlState,'23505');
  assert.equal(x.errors[0].constraint,undefined);
  assert.doesNotMatch(response.body,/synthetic_conflict|23505|postgres|SQL/);
  assert.deepEqual(await x.state(),before);
});
