import { expect, it, vi } from 'vitest';
import { fixtureId, fixtureInstant } from '@shippingco/testkit';
import { createTenancyService } from '../../src/modules/tenancy/service.ts';
import { TenancyError } from '../../src/modules/tenancy/errors.ts';
import { toHttpError } from '../../src/modules/tenancy/http.ts';
import { franchiseDto, organizationDto, type TenancyAuthorizer } from '../../src/modules/tenancy/types.ts';
import { lockActiveFranchiseForOperationalWrite } from '../../src/modules/tenancy/repository.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { fakeDatabase, syntheticEnv } from '../support.ts';
import { approvedAuthority, tenancyFixture as f, testTenancyServer } from '../tenancy-support.ts';

const ownId = f.franchises.alpha1.id;
function harness(authorizer: TenancyAuthorizer = approvedAuthority()) {
  const database = fakeDatabase(), audit = { record: vi.fn(async () => {}) };
  return { database, audit, ...testTenancyServer(database, authorizer, audit) };
}

it('normal buildServer exposes no private tenancy routes even with forged authority claims', async () => {
  const database = fakeDatabase(), logs: string[] = [];
  const app = buildServer({ database, config: parseEnvironment(syntheticEnv), logSink: { write: line => { logs.push(line); } } });
  try {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      for (const url of ['/api/v1/organizations', `/api/v1/organizations/${f.organizations.alpha.id}`,
        '/api/v1/franchises', `/api/v1/franchises/${ownId}`]) {
        const response = await app.inject({ method, url,
          headers: { 'x-user-id': f.actors.alphaOrgAdmin.id, 'x-role': 'org_admin',
            'x-organization-id': f.organizations.alpha.id, 'x-franchise-id': ownId, 'x-admin': 'true' } });
        expect(response.statusCode).toBe(404); expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
      }
    }
    expect(database.query).not.toHaveBeenCalled(); expect(database.connect).not.toHaveBeenCalled();
    expect(logs.join('')).not.toContain(f.actors.alphaOrgAdmin.id);
  } finally { await app.close(); }
});

it('trusted test composition rejects malformed names, versions and ownership fields before querying or auditing', async () => {
  const { app, database, audit, logs } = harness();
  try {
    const invalid = [null, [], {}, { display_name: '', expected_version: 1 }, { display_name: ' Synthetic', expected_version: 1 },
      { display_name: 'Synthetic ', expected_version: 1 }, { display_name: 'SYN\nINJECTED', expected_version: 1 },
      { display_name: 'x'.repeat(121), expected_version: 1 }, { display_name: 'Synthetic', expected_version: 0 },
      { display_name: 'Synthetic', expected_version: 1.1 }, { display_name: 'Synthetic', expected_version: '1' },
      { display_name: 'Synthetic', expected_version: 2147483647 },
      { display_name: 'Synthetic', expected_version: 1, organization_id: f.organizations.beta.id },
      { display_name: 'Synthetic', expected_version: 1, franchise_id: f.franchises.beta1.id },
      { display_name: 'Synthetic', expected_version: 1, role: 'org_admin' }];
    for (const payload of invalid) {
      const response = await app.inject({ method: 'PATCH', url: `/test/tenancy/franchises/${ownId}`,
        headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
      expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('VALIDATION_FAILED');
      expect(response.body).not.toMatch(/SYN|Synthetic|organization_id|DB_|constraint/);
    }
    expect(database.connect).not.toHaveBeenCalled(); expect(database.query).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled(); expect(logs.join('')).not.toContain('SYN');
  } finally { await app.close(); }
});

it('strict identifiers, bootstrap DTO, lifecycle reasons and pagination reject ambiguity and widening', async () => {
  const { app, database, audit } = harness(approvedAuthority(null, [], 'service'));
  try {
    for (const franchise_code of ['main', ' MAIN', 'MAIN ', 'A-B', 'MÄIN', 'ＭAIN', '1MAIN', 'A'.repeat(33), 'MAIN\n']) {
      const response = await app.inject({ method: 'POST', url: '/test/tenancy/bootstrap', payload: {
        display_name: 'Synthetic Shop', franchise: { display_name: 'Synthetic First', franchise_code },
      } });
      expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    for (const extra of [{ organization_id: f.organizations.beta.id }, { user: { id: fixtureId(102) } }, { membership: { role: 'org_admin' } }]) {
      const response = await app.inject({ method: 'POST', url: '/test/tenancy/bootstrap', payload: {
        display_name: 'Synthetic Shop', franchise: { display_name: 'Synthetic First', franchise_code: 'MAIN' }, ...extra,
      } });
      expect(response.statusCode).toBe(422);
    }
    expect(database.connect).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
  } finally { await app.close(); }
  const member = harness();
  try {
    for (const input of [{ lifecycle: 'deleted', expected_version: 1, reason_code: 'administrative_disable' },
      { lifecycle: 'disabled', expected_version: 1, reason_code: 'administrative_reactivate' },
      { lifecycle: 'disabled', expected_version: 1 },
      { lifecycle: 'disabled', expected_version: 1, reason_code: 'administrative_disable', reason: 'SYN_FREE_TEXT' }]) {
      const response = await member.app.inject({ method: 'POST', url: `/test/tenancy/franchises/${ownId}/lifecycle`, payload: input });
      expect(response.statusCode).toBe(422);
    }
    for (const input of [{ organization_id: f.organizations.beta.id }, { role: 'org_admin' }, { limit: 0 }, { limit: 101 },
      { limit: '1' }, { limit: null }, { after: { id: ownId, created_at: '2026-09-08' } },
      { after: { id: 'malformed', created_at: '2026-09-08T12:00:00Z' } }]) {
      const response = await member.app.inject({ method: 'POST', url: '/test/tenancy/franchises/list', payload: input });
      expect(response.statusCode).toBe(422);
    }
    const badId = await member.app.inject('/test/tenancy/franchises/not-a-uuid');
    expect(badId.statusCode).toBe(422);
    expect(member.database.connect).not.toHaveBeenCalled(); expect(member.database.query).not.toHaveBeenCalled();
    expect(member.audit.record).not.toHaveBeenCalled();
  } finally { await member.app.close(); }
});

it('denied authorization and mismatched approvals fail closed with no DB or successful audit effects', async () => {
  for (const code of ['UNAUTHENTICATED', 'ACTION_FORBIDDEN'] as const) {
    const authorizer = { authorize: vi.fn(async () => { throw new TenancyError(code); }) };
    const { app, database, audit } = harness(authorizer);
    try {
      const response = await app.inject({ method: 'POST', url: `/test/tenancy/franchises/${ownId}/lifecycle`,
        payload: { lifecycle: 'disabled', expected_version: 1, reason_code: 'administrative_disable' },
        headers: { 'x-role': 'org_admin', 'x-organization-id': f.organizations.beta.id } });
      expect(response.statusCode).toBe(code === 'UNAUTHENTICATED' ? 401 : 403);
      expect(response.json().error.code).toBe(code);
      expect(authorizer.authorize).toHaveBeenCalledWith('franchise.lifecycle.manage');
      expect(database.connect).not.toHaveBeenCalled(); expect(database.query).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    } finally { await app.close(); }
  }
  const database = fakeDatabase(), audit = { record: vi.fn(async () => {}) };
  const authorizer: TenancyAuthorizer = { authorize: async () => ({
    action: 'franchise.profile.read', actor: { type: 'user', id: f.actors.alpha1FranchiseAdmin.id },
    organizationId: f.organizations.alpha.id, permittedFranchiseIds: [ownId], correlationId: fixtureId(8200),
  }) };
  const service = createTenancyService({ database, authorizer, audit });
  await expect(service.changeFranchiseLifecycle(ownId, { lifecycle: 'disabled', expected_version: 1,
    reason_code: 'administrative_disable' })).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
  expect(database.connect).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
});

it('member grants cannot bootstrap tenants, create franchises or mutate organization administration', async () => {
  const { service, app, database, audit } = harness();
  try {
    await expect(service.bootstrap({ display_name: 'Synthetic Shop', franchise: { display_name: 'Synthetic First', franchise_code: 'MAIN' } }))
      .rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(service.createFranchise({ display_name: 'Synthetic Shop', franchise_code: 'NEW' })).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(service.updateOrganizationProfile({ display_name: 'Synthetic Shop', expected_version: 1 })).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(service.changeOrganizationLifecycle({ lifecycle: 'disabled', expected_version: 1, reason_code: 'administrative_disable' }))
      .rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    expect(database.connect).not.toHaveBeenCalled(); expect(database.query).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('DTO mapping allowlists safe fields even when an internal row gains an unrelated secret-like field', () => {
  const domain = { id: ownId, displayName: 'Synthetic Business', organizationId: f.organizations.alpha.id,
    franchiseCode: 'MAIN', lifecycle: 'active' as const, version: 1, createdAt: new Date(fixtureInstant),
    updatedAt: new Date(fixtureInstant), lifecycleChangedAt: new Date(fixtureInstant), futurePrivateColumn: 'SYN_PRIVATE_FIELD' };
  const franchise = franchiseDto(domain), organization = organizationDto(domain);
  expect(franchise).toEqual({ id: ownId, display_name: 'Synthetic Business', organization_id: f.organizations.alpha.id,
    franchise_code: 'MAIN', lifecycle: 'active', version: 1, created_at: '2026-09-08T12:00:00Z',
    updated_at: '2026-09-08T12:00:00Z', lifecycle_changed_at: '2026-09-08T12:00:00Z' });
  expect(organization).not.toHaveProperty('organization_id'); expect(organization).not.toHaveProperty('franchise_code');
  expect(JSON.stringify([organization, franchise])).not.toContain('SYN_PRIVATE_FIELD');
});

it('operational guard refuses an ordinary pool and safe HTTP mapping does not expose unknown errors', async () => {
  const database = fakeDatabase();
  // @ts-expect-error Operational guards require the transaction capability, never an ordinary pool.
  await expect(lockActiveFranchiseForOperationalWrite(database, { organizationId: f.organizations.alpha.id,
    franchiseId: ownId })).rejects.toThrow();
  expect(database.query).not.toHaveBeenCalled();
  expect(toHttpError(new Error('SYN_RAW_SQL_PASSWORD')).code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(toHttpError(new Error('SYN_RAW_SQL_PASSWORD')))).not.toContain('SYN_RAW_SQL_PASSWORD');
});
