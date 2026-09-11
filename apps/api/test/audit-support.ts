import type { TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { provisionDatabase } from '../../../packages/db/test/support.ts';
import { AuthRepository } from '../src/modules/auth/repository.ts';
import { createAuthService } from '../src/modules/auth/service.ts';
import { digest, secret } from '../src/modules/auth/crypto.ts';
import { createMembershipService } from '../src/modules/memberships/service.ts';
import { createAuditService } from '../src/modules/audit/service.ts';
import { createSecurityCounters } from '../src/modules/audit/telemetry.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
import { seedTenancy, tenancyFixture } from './tenancy-support.ts';
export const f=tenancyFixture,org=f.organizations.alpha.id,A=f.franchises.alpha1.id,B=f.franchises.alpha2.id,
  otherOrg=f.organizations.beta.id,C=f.franchises.beta1.id;
export async function auditSetup(t:TestContext) {
  const db=await provisionDatabase(t);await db.prepareMemberships();const pool=db.runtimePool();await seedTenancy(pool);
  const keys={version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)};
  const auth=createAuthService(pool,keys),memberships=createMembershipService(pool),audit=createAuditService(pool,keys.browser);
  const logs:string[]=[],telemetry=createSecurityCounters();
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',
    TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:pool,auth:{keys,delivery:{},webhook:undefined},securityTelemetry:telemetry,logSink:{write:x=>logs.push(x)}});
  t.after(()=>app.close());
  async function user() {
    const id=await auth.provision('email',`${randomUUID()}@example.test`),token=secret();
    await withTransaction(pool,async tx=>{const repo=new AuthRepository(tx);await repo.newSession((await repo.user(id))!,digest(token));});
    return {id,token};
  }
  const admin=await user();await memberships.bootstrapAdministrator(admin.id,org);
  async function grant(role:string,ids:string[],organizationId=org) {
    const target=await user();
    const invite=await memberships.createInvitation(admin.token,{organization_id:organizationId,invitee_user_id:target.id,role,franchise_ids:ids});
    const member=await memberships.acceptInvitation(target.token,{token:invite.acceptance_token});
    return {...target,member,invite};
  }
  const list=(token:string,extra:Record<string,string>={})=>app.inject({url:'/api/v1/audit?'+new URLSearchParams({organization_id:org,...extra}),cookies:{shipit_session:token}});
  return {db,pool,keys,auth,memberships,audit,logs,telemetry,app,user,admin,grant,list};
}
