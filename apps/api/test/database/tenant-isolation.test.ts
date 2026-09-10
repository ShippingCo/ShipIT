import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixtureId, createTenantIsolationFixture } from '@shippingco/testkit';
import { withTransaction } from '@shippingco/db';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { seedTenancy } from '../tenancy-support.ts';
import { digest } from '../../src/modules/auth/crypto.ts';
import { createMembershipService, withStaffTenantScope } from '../../src/modules/memberships/service.ts';
import { scopedQuery, issueTenantAccess, type TenantAccess } from '../../src/modules/security/scope.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { HttpError } from '../../src/plugins/errors.ts';

const f=createTenantIsolationFixture();
const a=f.franchises.alpha1,b=f.franchises.alpha2,c=f.franchises.beta1;
const denied=(code:string)=>(error:unknown)=>error instanceof HttpError && error.code===code;
async function setup(t:TestContext) {
  const db=await provisionDatabase(t);await db.prepareMemberships();
  const owner=db.ownerPool();await seedTenancy(owner);
  const tokens=new Map<string,string>();
  for(const actor of Object.values(f.actors)) {
    const token=randomBytes(32).toString('base64url');tokens.set(actor.id,token);
    await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[actor.id]);
    await owner.query(`INSERT INTO shipit.auth_sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at)
      VALUES($1,$2,$3,1,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '12 hours')`,[randomUUID(),actor.id,digest(token)]);
    await owner.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[actor.membership_id,actor.id,actor.organization_id,actor.role]);
    if(actor.franchise_id) await owner.query('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)',[actor.membership_id,actor.organization_id,actor.franchise_id]);
  }
  // Disposable projection only: no business tables or product search/export routes.
  await owner.query(`CREATE SCHEMA synthetic;
    CREATE TABLE synthetic.private_records(id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
      label text NOT NULL,version integer NOT NULL DEFAULT 1,
      FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id));`);
  assert.match(db.runtimeRole,/^shipit_[a-f0-9]+_runtime_test_1$/);
  await owner.query(`GRANT USAGE ON SCHEMA synthetic TO "${db.runtimeRole}"`);
  await owner.query(`GRANT SELECT,INSERT,UPDATE(label,version) ON synthetic.private_records TO "${db.runtimeRole}"`);
  for(const [franchise,count,start] of [[a,3,15001],[b,50,15101],[c,7,15201]] as const) {
    for(let i=0;i<count;i++) await owner.query('INSERT INTO synthetic.private_records(id,organization_id,franchise_id,label) VALUES($1,$2,$3,$4)',
      [fixtureId(start+i),franchise.organization_id,franchise.id,`Synthetic-${franchise.id}-${i}`]);
  }
  await owner.close();
  const pool=db.runtimePool({maxConnections:1});
  const token=(name:keyof typeof f.actors)=>tokens.get(f.actors[name].id)!;
  return {db,pool,token};
}
function list(scope:TenantAccess,after:string|null=null,term='%') {
  return scopedQuery<{id:string;label:string}>(scope,['franchise.profile.read'],`SELECT r.id,r.label FROM synthetic.private_records r
    JOIN shipit.franchises f ON f.organization_id=r.organization_id AND f.id=r.franchise_id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.label ILIKE $1 AND ($2::uuid IS NULL OR r.id>$2)
    ORDER BY r.id LIMIT 3`,[term,after]);
}
function count(scope:TenantAccess,term='%') {
  return scopedQuery<{count:string}>(scope,['franchise.profile.read'],`SELECT count(*) FROM synthetic.private_records r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND label ILIKE $1`,[term]);
}
function detail(scope:TenantAccess,id:string) {
  return scopedQuery(scope,['franchise.profile.read'],`SELECT id,label FROM synthetic.private_records
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id]);
}
function update(scope:TenantAccess,id:string) {
  return scopedQuery(scope,['franchise.profile.update'],`UPDATE synthetic.private_records SET label=$2,version=version+1
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 RETURNING id`,[id,'Synthetic changed']);
}
function exportProjection(scope:TenantAccess,id?:string) {
  return scopedQuery(scope,['operations.export'],`SELECT id,label FROM synthetic.private_records
    WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id=$1) ORDER BY id`,[id??null]);
}

await test('A/B/C SQL matrix isolates details, joins, counts, keysets, exact searches, mutations and exports',{timeout:30000},async t=>{
  const {pool,token}=await setup(t);
  const read=<T>(work:(scope:TenantAccess)=>Promise<T>)=>withStaffTenantScope(pool,token('alpha1Operator'),a.organization_id,'franchise.profile.read',work);
  assert.equal((await read(scope=>detail(scope,fixtureId(15001)))).rows.length,1);
  for(const id of [fixtureId(15101),fixtureId(15201),fixtureId(15999)]) {
    assert.deepEqual((await read(scope=>detail(scope,id))).rows,[]);
    assert.deepEqual((await withStaffTenantScope(pool,token('alpha1FranchiseAdmin'),a.organization_id,'franchise.profile.update',scope=>update(scope,id))).rows,[]);
    assert.deepEqual((await withStaffTenantScope(pool,token('alpha1FranchiseAdmin'),a.organization_id,'operations.export',scope=>exportProjection(scope,id))).rows,[]);
  }
  for(const foreign of [b,c]) {
    const exact=`Synthetic-${foreign.id}-0`;
    assert.deepEqual((await read(scope=>list(scope,null,exact))).rows,[]);
    assert.equal((await read(scope=>count(scope,exact))).rows[0]?.count,'0');
  }
  const first=await read(scope=>list(scope));assert.equal(first.rows.length,3);
  assert.equal((await read(scope=>count(scope))).rows[0]?.count,'3');
  // Page size 2, limit+1=3; the final page has no foreign has_more or cursor.
  const second=await read(scope=>list(scope,first.rows[1]!.id));assert.equal(second.rows.length,1);
  const exported=await withStaffTenantScope(pool,token('alpha1FranchiseAdmin'),a.organization_id,'operations.export',scope=>exportProjection(scope));
  assert.equal(exported.rows.length,3);assert.deepEqual(Object.keys(exported.rows[0]!).sort(),['id','label']);
  for(const role of ['alphaOrgAdmin','alpha1ReadOnly','alpha1Operator','alpha1Dispatcher','alpha1DeliveryAgent','alpha1Accountant'] as const) {
    await assert.rejects(withStaffTenantScope(pool,token(role),a.organization_id,'operations.export',scope=>exportProjection(scope)),denied('ACTION_FORBIDDEN'));
  }
  await assert.rejects(withStaffTenantScope(pool,token('alpha1ReadOnly'),a.organization_id,'franchise.profile.update',scope=>update(scope,fixtureId(15001))),denied('ACTION_FORBIDDEN'));
  await assert.rejects(withStaffTenantScope(pool,token('alphaOrgAdmin'),c.organization_id,'franchise.profile.read',scope=>list(scope)),denied('ACTION_FORBIDDEN'));
  assert.equal((await withStaffTenantScope(pool,token('alphaOrgAdmin'),a.organization_id,'franchise.profile.read',scope=>count(scope))).rows[0]?.count,'53');
  assert.deepEqual((await withStaffTenantScope(pool,token('alpha2Operator'),b.organization_id,'franchise.profile.read',scope=>detail(scope,fixtureId(15001)))).rows,[]);
});

await test('same physical runtime connection alternates A/C/A after commit and rollback, rejects missing/expired scope, and persists across pool restart',{timeout:30000},async t=>{
  const {db,pool,token}=await setup(t);
  const identity=await pool.query<{pid:number;role:string}>('SELECT pg_backend_pid() AS pid,current_user AS role');
  assert.equal(identity.rows[0]?.role,db.runtimeRole);
  let expired:TenantAccess|undefined;
  for(const [actor,org,total] of [['alpha1Operator',a.organization_id,'3'],['beta1Operator',c.organization_id,'7'],['alpha1Operator',a.organization_id,'3']] as const) {
    await withStaffTenantScope(pool,token(actor),org,'franchise.profile.read',async scope=>{expired=scope;assert.equal((await count(scope)).rows[0]?.count,total);});
    assert.equal((await pool.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid,identity.rows[0]?.pid);
  }
  assert.throws(()=>count(expired!));assert.throws(()=>count(undefined as unknown as TenantAccess),/ACTION_FORBIDDEN/);
  await assert.rejects(withStaffTenantScope(pool,token('alpha1FranchiseAdmin'),a.organization_id,'franchise.profile.update',async scope=>{
    await update(scope,fixtureId(15001));throw new HttpError('ACTION_FORBIDDEN');
  }),denied('ACTION_FORBIDDEN'));
  assert.equal((await withStaffTenantScope(pool,token('alpha1Operator'),a.organization_id,'franchise.profile.read',scope=>list(scope))).rows[0]?.label,`Synthetic-${a.id}-0`);
  await withStaffTenantScope(pool,token('alpha1FranchiseAdmin'),a.organization_id,'franchise.profile.update',scope=>update(scope,fixtureId(15001)));
  await pool.close();
  const restarted=db.runtimePool({maxConnections:1});
  const saved=await withStaffTenantScope(restarted,token('alpha1Operator'),a.organization_id,'franchise.profile.read',scope=>detail(scope,fixtureId(15001)));
  assert.equal(saved.rows[0]?.label,'Synthetic changed');
  for(const sql of ['CREATE SCHEMA forbidden','DROP SCHEMA synthetic CASCADE',"UPDATE synthetic.private_records SET organization_id='00000000-0000-4000-8000-000000000002'",'ALTER TABLE synthetic.private_records OWNER TO CURRENT_USER']) await assert.rejects(restarted.query(sql));
  const flags=await restarted.query<{rolsuper:boolean;rolbypassrls:boolean}>('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert.deepEqual(flags.rows,[{rolsuper:false,rolbypassrls:false}]);
});

await test('membership SQL projection hides sibling scopes and crafted nested references leave no partial writes',{timeout:30000},async t=>{
  const {db,pool,token}=await setup(t),service=createMembershipService(pool);
  await db.adminQuery('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)',[f.actors.alpha1Operator.membership_id,a.organization_id,b.id]);
  const roster=await service.listMemberships(token('alpha1FranchiseAdmin'),a.organization_id);
  assert.ok(roster.items.every(item=>item.franchise_ids.every(id=>id===a.id)));
  assert.ok(!roster.items.some(item=>item.id===f.actors.alpha2Operator.membership_id));
  for(const id of [f.actors.alpha1Operator.membership_id,f.actors.alpha2Operator.membership_id,f.actors.beta1Operator.membership_id,fixtureId(15999)]) {
    await assert.rejects(service.updateMembership(token('alpha1FranchiseAdmin'),id,{role:'dispatcher',franchise_ids:[a.id],expected_version:1}),denied('RESOURCE_NOT_FOUND'));
  }
  for(const foreign of [b,c]) await assert.rejects(service.createInvitation(token('alpha1FranchiseAdmin'),{
    organization_id:a.organization_id,invitee_user_id:f.actors.alpha1ReadOnly.id,role:'operator',franchise_ids:[foreign.id]}),denied('RESOURCE_NOT_FOUND'));
  await assert.rejects(service.updateMembership(token('alpha1FranchiseAdmin'),f.actors.alpha1ReadOnly.membership_id,{
    role:'operator',franchise_ids:[a.id],organization_id:c.organization_id,expected_version:1}),denied('VALIDATION_FAILED'));
  assert.equal((await db.adminQuery<{count:string}>('SELECT count(*) FROM shipit.membership_invitations')).rows[0]?.count,'0');
  assert.equal((await db.adminQuery<{version:number}>('SELECT version FROM shipit.memberships WHERE id=$1',[f.actors.alpha1Operator.membership_id])).rows[0]?.version,1);
  // Composite ownership also protects audit references at the actual runtime role.
  await assert.rejects(pool.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,affected_user_id,membership_id,action,role)
    VALUES($1,$2,'service',$3,$4,'bootstrap_admin','org_admin')`,[randomUUID(),a.organization_id,f.actors.beta1Operator.id,f.actors.beta1Operator.membership_id]));
  await assert.rejects(withTransaction(pool,async tx=>{
    const scope=issueTenantAccess(tx,{action:'franchise.profile.update',actor:{type:'service',id:'fixture'},organizationId:a.organization_id,
      permittedFranchiseIds:[a.id],organizationWide:false,provenance:'internal-service',correlationId:'fixture'});
    await update(scope,fixtureId(15001));
    await tx.query('INSERT INTO synthetic.private_records(id,organization_id,franchise_id,label) VALUES($1,$2,$3,$4)',[randomUUID(),a.organization_id,c.id,'Synthetic invalid']);
  }));
  assert.equal((await withStaffTenantScope(pool,token('alpha1Operator'),a.organization_id,'franchise.profile.read',scope=>detail(scope,fixtureId(15001)))).rows[0]?.label,`Synthetic-${a.id}-0`);
});

await test('HTTP foreign/unknown envelopes, read-only crafted writes, stale state and privacy remain controlled',{timeout:30000},async t=>{
  const {db,pool,token}=await setup(t),logs:string[]=[];
  const app=buildServer({database:pool,config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',
    LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),
    auth:{keys:{version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)},delivery:{},webhook:undefined},
    logSink:{write:line=>logs.push(line)}});t.after(()=>app.close());
  const boot=await app.inject('/auth/bootstrap'),browser=boot.cookies[0]!;
  const headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token as string};
  const cookies=(actor:keyof typeof f.actors)=>({[browser.name]:browser.value,shipit_session:token(actor)});
  const errors:unknown[]=[];
  for(const id of [f.actors.alpha2Operator.membership_id,f.actors.beta1Operator.membership_id,fixtureId(15999)]) {
    const response=await app.inject({method:'PATCH',url:`/api/v1/memberships/${id}`,headers,cookies:cookies('alpha1FranchiseAdmin'),
      payload:{role:'dispatcher',franchise_ids:[a.id],expected_version:1}});
    assert.equal(response.statusCode,404);errors.push(response.json().error.code);
    assert.doesNotMatch(response.body,/organization_id|franchise_id|SQL|stack|token/);
  }
  assert.deepEqual(errors,['RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND']);
  const readOnly=await app.inject({method:'POST',url:`/api/v1/memberships/${f.actors.alpha1Operator.membership_id}/revoke`,headers,
    cookies:cookies('alpha1ReadOnly'),payload:{expected_version:1}});assert.equal(readOnly.statusCode,404);
  const orgDenied=await app.inject({url:`/api/v1/organizations/${c.organization_id}/memberships`,cookies:cookies('alphaOrgAdmin')});
  assert.equal(orgDenied.statusCode,403);
  for(const ownership of [{organization_id:c.organization_id},{franchise_id:c.id}]) {
    const response=await app.inject({method:'PATCH',url:`/api/v1/memberships/${f.actors.alpha1Operator.membership_id}`,headers,
      cookies:cookies('alpha1FranchiseAdmin'),payload:{role:'dispatcher',franchise_ids:[a.id],expected_version:1,...ownership}});
    assert.equal(response.statusCode,422);
  }
  const changed=await app.inject({method:'PATCH',url:`/api/v1/memberships/${f.actors.alpha1Operator.membership_id}`,headers,
    cookies:cookies('alpha1FranchiseAdmin'),payload:{role:'dispatcher',franchise_ids:[a.id],expected_version:1}});assert.equal(changed.statusCode,200);
  const stale=await app.inject({method:'POST',url:`/api/v1/memberships/${f.actors.alpha1Operator.membership_id}/revoke`,headers,
    cookies:cookies('alpha1FranchiseAdmin'),payload:{expected_version:1}});assert.equal(stale.statusCode,409);
  const persisted=await db.adminQuery<{version:number;lifecycle:string}>('SELECT version,lifecycle FROM shipit.memberships WHERE id=$1',[f.actors.alpha1Operator.membership_id]);
  assert.deepEqual(persisted.rows,[{version:2,lifecycle:'active'}]);
  const audit=JSON.stringify((await db.adminQuery('SELECT * FROM shipit.membership_audit_events')).rows);
  for(const name of Object.keys(f.actors) as (keyof typeof f.actors)[]) assert.ok(!logs.join('').includes(token(name)) && !audit.includes(token(name)));
  await pool.close();
  const unavailable=await app.inject({url:`/api/v1/organizations/${a.organization_id}/memberships`,cookies:cookies('alpha1FranchiseAdmin')});
  assert.equal(unavailable.statusCode,503);assert.doesNotMatch(unavailable.body,/SQL|stack|postgres|password|token_hash/);
});
