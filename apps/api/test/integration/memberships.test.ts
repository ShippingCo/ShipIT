import { randomBytes } from 'node:crypto';
import { describe,it,expect } from 'vitest';
import { managementAuthority,canManageGrant,tenancyScope } from '../../src/modules/memberships/policy.ts';
import type { Membership } from '../../src/modules/memberships/types.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { fakeDatabase,syntheticEnv } from '../support.ts';

const now=new Date('2026-09-09T00:00:00Z');
const grant=(role:Membership['role'],franchiseIds:string[]):Membership=>({id:`id-${role}`,userId:'user',organizationId:'org',role,
  lifecycle:'active',version:1,franchiseIds,createdAt:now,updatedAt:now,revokedAt:null});

describe('membership authorization boundary',()=>{
  it('uses explicit least-privilege roles and scopes with a denied default',()=>{
    const franchise=managementAuthority([grant('franchise_admin',['f1'])])!;
    expect(canManageGrant(franchise,'operator',['f1'])).toBe(true);
    expect(canManageGrant(franchise,'org_admin',[])).toBe(false);
    expect(canManageGrant(franchise,'operator',['f2'])).toBe(false);
    expect(managementAuthority([grant('read_only',['f1'])])).toBeNull();
    expect(tenancyScope('franchise.profile.read',[grant('operator',['f1'])],['f1','f2'])).toEqual(['f1']);
    expect(tenancyScope('franchise.profile.read',[grant('org_admin',[])],['f1','f2'])).toEqual(['f1','f2']);
    expect(tenancyScope('franchise.profile.update',[grant('operator',['f1'])],['f1'])).toBeNull();
    expect(tenancyScope('franchise.lifecycle.manage',[grant('org_admin',['f2'])],['f1','f2'])).toEqual(['f2']);
    expect(tenancyScope('organization.lifecycle.manage',[grant('org_admin',[])],['f1'])).toBeNull();
    const readExpectations:Record<Membership['role'],string[]|null>={
      org_admin:['f1','f2'],franchise_admin:['f1'],operator:['f1'],dispatcher:['f1'],
      delivery_agent:null,accountant:['f1'],read_only:['f1'],
    };
    for (const [role,expected] of Object.entries(readExpectations) as [Membership['role'],string[]|null][]) {
      expect(tenancyScope('franchise.profile.read',[grant(role,role==='org_admin'?[]:['f1'])],['f1','f2']),role).toEqual(expected);
    }
    for (const role of ['operator','dispatcher','delivery_agent','accountant','read_only'] as const) {
      expect(managementAuthority([grant(role,['f1'])]),role).toBeNull();
      expect(tenancyScope('franchise.profile.update',[grant(role,['f1'])],['f1']),role).toBeNull();
    }
  });
  it('registers no membership surface without auth and applies CSRF before membership database work',async()=>{
    const database=fakeDatabase();
    const without=buildServer({config:parseEnvironment(syntheticEnv),database});
    expect((await without.inject('/api/v1/organizations/00000000-0000-4000-8000-000000000001/memberships')).statusCode).toBe(404);
    await without.close();
    const keys={version:'test',verifier:randomBytes(32),encryption:randomBytes(32),browser:randomBytes(32)};
    const app=buildServer({config:parseEnvironment(syntheticEnv),database,auth:{keys,delivery:{},webhook:undefined}});
    try {
      const rejected=await app.inject({method:'POST',url:'/api/v1/membership-invitations',payload:{},headers:{origin:'http://evil.example'}});
      expect(rejected.statusCode).toBe(403);expect(database.connect).not.toHaveBeenCalled();
      const malformed=await app.inject({method:'POST',url:'/api/v1/membership-invitations',payload:{role:'super_admin'},headers:{origin:'http://localhost:5173'}});
      expect(malformed.statusCode).toBe(403);
      expect(rejected.body+malformed.body).not.toMatch(/super_admin|postgres|token|SQL/);
    } finally {await app.close();}
  });
});
