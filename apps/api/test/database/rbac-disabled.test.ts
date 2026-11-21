import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTenantIsolationFixture } from '@shippingco/testkit';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { seedTenancy } from '../tenancy-support.ts';
import { digest } from '../../src/modules/auth/crypto.ts';
import { configureRoleChecks } from '../../src/modules/memberships/role-checks.ts';
import { withReportScope, withStaffTenantScope } from '../../src/modules/memberships/service.ts';
import { HttpError } from '../../src/plugins/errors.ts';

const f=createTenantIsolationFixture();
const a=f.franchises.alpha1,b=f.franchises.alpha2,c=f.franchises.beta1;
const denied=(code:string)=>(error:unknown)=>error instanceof HttpError&&error.code===code;
async function setup(t:TestContext) {
  const db=await provisionDatabase(t);await db.prepareMemberships();
  const owner=db.ownerPool();await seedTenancy(owner);
  const tokens=new Map<string,string>();
  const session=async(id:string)=>{const token=randomBytes(32).toString('base64url');tokens.set(id,token);
    await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[id]);
    await owner.query(`INSERT INTO shipit.auth_sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at)
      VALUES($1,$2,$3,1,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '12 hours')`,[randomUUID(),id,digest(token)]);};
  for(const actor of Object.values(f.actors)) {
    await session(actor.id);
    await owner.query('INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,$4)',[actor.membership_id,actor.id,actor.organization_id,actor.role]);
    if(actor.franchise_id)await owner.query('INSERT INTO shipit.membership_franchise_scopes(membership_id,organization_id,franchise_id) VALUES($1,$2,$3)',[actor.membership_id,actor.organization_id,actor.franchise_id]);
  }
  const outsider=randomUUID();await session(outsider);
  const memberships=async()=>(await owner.query<{n:string}>('SELECT count(*) n FROM shipit.memberships')).rows[0]!.n;
  const pool=db.runtimePool({maxConnections:1});
  return {pool,owner,memberships,token:(id:string)=>tokens.get(id)!,outsider};
}
const report=(pool:Parameters<typeof withReportScope>[0],token:string,organizationId:string,franchiseId:string)=>
  withReportScope(pool,token,organizationId,franchiseId,false,randomUUID(),async scope=>[...scope.context.permittedFranchiseIds]);

await test('RBAC_ENABLED=false gives members every role inside their own organization only',{timeout:30000},async t=>{
  const {pool,owner,memberships,token,outsider}=await setup(t);
  t.after(async()=>{configureRoleChecks(true);await owner.close();});
  const readOnly=token(f.actors.alpha1ReadOnly.id),before=await memberships();
  // Role checks on: a read-only member cannot open the unpaid-balance report or export.
  await assert.rejects(report(pool,readOnly,a.organization_id,a.id),denied('ACTION_FORBIDDEN'));
  await assert.rejects(withStaffTenantScope(pool,readOnly,a.organization_id,'operations.export',async()=>null),denied('ACTION_FORBIDDEN'));

  configureRoleChecks(false);
  for(const actor of ['alpha1ReadOnly','alpha1Operator','alpha1Dispatcher','alpha1DeliveryAgent','alpha1Accountant','alpha1FranchiseAdmin','alphaOrgAdmin'] as const) {
    assert.deepEqual(await report(pool,token(f.actors[actor].id),a.organization_id,a.id),[a.id],actor);
    assert.deepEqual(await report(pool,token(f.actors[actor].id),b.organization_id,b.id),[b.id],actor);
    // Another organization stays invisible, whatever the role.
    await assert.rejects(report(pool,token(f.actors[actor].id),c.organization_id,c.id),denied('RESOURCE_NOT_FOUND'),actor);
  }
  await withStaffTenantScope(pool,readOnly,a.organization_id,'operations.export',async scope=>{
    assert.equal(scope.context.organizationId,a.organization_id);
  });
  // Signed in without any membership: still nothing.
  await assert.rejects(report(pool,token(outsider),a.organization_id,a.id),denied('RESOURCE_NOT_FOUND'));
  // Nothing is written: the extra roles exist only for the request.
  assert.equal(await memberships(),before);

  configureRoleChecks(true);
  await assert.rejects(report(pool,readOnly,a.organization_id,a.id),denied('ACTION_FORBIDDEN'));
});
