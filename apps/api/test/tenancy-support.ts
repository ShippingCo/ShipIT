import { createTenantIsolationFixture, fixtureId, fixtureInstant } from '@shippingco/testkit';
import type { DatabasePool } from '@shippingco/db';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
import { createTenancyService } from '../src/modules/tenancy/service.ts';
import { toHttpError } from '../src/modules/tenancy/http.ts';
import type { TenancyAuthorizer, TenancyAuditPort } from '../src/modules/tenancy/types.ts';

export const tenancyFixture = createTenantIsolationFixture();
export const unknownTenantId = fixtureId(9999);
const config = parseEnvironment({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000', LOG_LEVEL: 'info',
  ALLOWED_ORIGINS: 'http://localhost:5173', TRUSTED_PROXY_HOPS: '0', DATABASE_SECRET_REF: 'local:database', DATABASE_TLS_MODE: 'disable' });

// This is an explicitly trusted test composition. It does not derive grants from
// headers, request bodies, role names or current production HTTP registration.
export function approvedAuthority(organizationId: string | null = tenancyFixture.organizations.alpha.id,
  permittedFranchiseIds: readonly string[] = [tenancyFixture.franchises.alpha1.id],
  actorType: 'user' | 'service' = 'user'): TenancyAuthorizer {
  return { authorize: async action => ({ action, organizationId, permittedFranchiseIds,
    actor: { type: actorType, id: fixtureId(8001) }, correlationId: fixtureId(8002) }) };
}

export function testTenancyServer(database: DatabasePool, authorizer: TenancyAuthorizer, audit: TenancyAuditPort) {
  const logs: string[] = [];
  const service = createTenancyService({ database, authorizer, audit });
  const app = buildServer({ config, database, logSink: { write: message => { logs.push(message); } } });
  const invoke = async <T>(work: () => Promise<T>) => {
    try { return await work(); } catch (error) { throw toHttpError(error); }
  };
  app.register(async instance => {
    instance.post('/test/tenancy/bootstrap', async request => invoke(() => service.bootstrap(request.body)));
    instance.post('/test/tenancy/franchises', async request => invoke(() => service.createFranchise(request.body)));
    instance.post('/test/tenancy/franchises/list', async request => invoke(() => service.listFranchises(request.body)));
    instance.get('/test/tenancy/organization', async () => invoke(() => service.readOrganization()));
    instance.patch('/test/tenancy/organization', async request => invoke(() => service.updateOrganizationProfile(request.body)));
    instance.post('/test/tenancy/organization/lifecycle', async request => invoke(() => service.changeOrganizationLifecycle(request.body)));
    instance.get<{ Params: { franchiseId: string } }>('/test/tenancy/franchises/:franchiseId', async request =>
      invoke(() => service.readFranchise(request.params.franchiseId)));
    instance.patch<{ Params: { franchiseId: string } }>('/test/tenancy/franchises/:franchiseId', async request =>
      invoke(() => service.updateFranchiseProfile(request.params.franchiseId, request.body)));
    instance.post<{ Params: { franchiseId: string } }>('/test/tenancy/franchises/:franchiseId/lifecycle', async request =>
      invoke(() => service.changeFranchiseLifecycle(request.params.franchiseId, request.body)));
  });
  return { app, service, logs };
}

export async function seedTenancy(database: DatabasePool) {
  for (const organization of Object.values(tenancyFixture.organizations)) {
    await database.query(`INSERT INTO shipit.organizations (id,display_name,created_at,updated_at)
      VALUES ($1,$2,$3,$3)`, [organization.id, organization.name, fixtureInstant]);
  }
  for (const franchise of Object.values(tenancyFixture.franchises)) {
    const code = franchise.id === tenancyFixture.franchises.alpha2.id ? 'SECOND' : 'MAIN';
    await database.query(`INSERT INTO shipit.franchises (id,organization_id,display_name,franchise_code,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$5)`, [franchise.id, franchise.organization_id, franchise.name, code, fixtureInstant]);
  }
}
