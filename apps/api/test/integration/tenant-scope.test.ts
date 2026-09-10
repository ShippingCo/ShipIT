import { expect, it, vi } from 'vitest';
import { fixtureId } from '@shippingco/testkit';
import { issueTenantAccess, scopedQuery, type TenantAccess, type PrivateContext } from '../../src/modules/security/scope.ts';
import { withTrustedJobScope, type TrustedJobRecord } from '../../src/modules/security/jobs.ts';
import { findOrganization } from '../../src/modules/tenancy/repository.ts';
import { listMemberships, insertInvitation } from '../../src/modules/memberships/repository.ts';
import { fakeDatabase } from '../support.ts';

const context:PrivateContext = {action:'franchise.profile.read',actor:{type:'user',id:fixtureId(101)},
  organizationId:fixtureId(1),permittedFranchiseIds:[fixtureId(11)],organizationWide:false,
  provenance:'membership',correlationId:'synthetic-scope'};
it('missing, forged and cloned repository capabilities fail before SQL: exactly zero queries', async () => {
  const db=fakeDatabase();
  const valid=issueTenantAccess(db,context,false);
  for(const invalid of [undefined,null,{},context,{...valid},db]) {
    const scope=invalid as TenantAccess;
    await expect(findOrganization(scope,fixtureId(1))).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
    await expect(listMemberships(scope,fixtureId(1))).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
    expect(()=>scopedQuery(scope,['franchise.profile.read'],'SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}}'))
      .toThrow('ACTION_FORBIDDEN');
  }
  expect(db.query).toHaveBeenCalledTimes(0); expect(db.connect).toHaveBeenCalledTimes(0);
});
it('scope is a frozen snapshot; missing action, unscoped SQL and widening fail before SQL', async () => {
  const db=fakeDatabase(),input={...context,actor:{...context.actor},permittedFranchiseIds:[fixtureId(11)]};
  const scope=issueTenantAccess(db,input,false);
  input.permittedFranchiseIds.push(fixtureId(12));input.actor.id=fixtureId(999);
  expect(scope.context.permittedFranchiseIds).toEqual([fixtureId(11)]);
  expect(Object.isFrozen(scope.context.actor)).toBe(true);
  expect(Object.isFrozen(scope.context.permittedFranchiseIds)).toBe(true);
  expect(()=>scopedQuery(scope,['franchise.profile.update'],'SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}}')).toThrow('ACTION_FORBIDDEN');
  expect(()=>scopedQuery(scope,['franchise.profile.read'],'SELECT id FROM shipit.franchises')).toThrow('ACTION_FORBIDDEN');
  await expect(insertInvitation(scope,{organizationId:fixtureId(2),inviteeUserId:fixtureId(102),role:'operator',franchiseIds:[fixtureId(21)],tokenHash:'synthetic',actorUserId:fixtureId(101)})).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
  expect(()=>scopedQuery(scope,['franchise.profile.read'],'UPDATE shipit.franchises SET version=2 WHERE {{franchise:organization_id:id}}')).toThrow('ACTION_FORBIDDEN');
  expect(db.query).toHaveBeenCalledTimes(0);
});
it('invalid scope fields and provenance cannot issue a capability', () => {
  const db=fakeDatabase();
  for(const input of [null,{}, {...context,organizationId:'bad'}, {...context,permittedFranchiseIds:['bad']},
    {...context,actor:{type:'browser',id:'bad'}}, {...context,provenance:'request'}, {...context,correlationId:'unsafe\nvalue'}]) {
    expect(()=>issueTenantAccess(db,input as PrivateContext,false)).toThrow('ACTION_FORBIDDEN');
  }
  expect(db.query).toHaveBeenCalledTimes(0);
});
it('job scope comes from trusted event and installation records; payload fields cannot override it', async () => {
  const db=fakeDatabase();
  const client={query:async(sql:string)=>({rows:[],rowCount:0,command:sql,oid:0,fields:[]}),release:()=>{}};
  const jobDatabase={...db,connect:vi.fn(async()=>client)};
  const record:TrustedJobRecord={eventId:'evt_synthetic_01',installationId:'install_synthetic_01',active:true,
    organizationId:fixtureId(1),franchiseId:fixtureId(11),serviceId:'synthetic-job',correlationId:'synthetic-job',permittedActions:['franchise.profile.read']};
  const identity={eventId:record.eventId,installationId:record.installationId,organization_id:fixtureId(2),franchise_id:fixtureId(21)};
  let captured:TenantAccess|undefined;
  await withTrustedJobScope(jobDatabase,{resolve:async()=>record},identity,'franchise.profile.read',async scope=>{
    captured=scope;expect(scope.context.organizationId).toBe(fixtureId(1));expect(scope.context.permittedFranchiseIds).toEqual([fixtureId(11)]);
  });
  expect(()=>scopedQuery(captured!,['franchise.profile.read'],'SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}}')).toThrow();
  for(const result of [null,{...record,active:false},{...record,eventId:'wrong'},{...record,permittedActions:[]}]) {
    await expect(withTrustedJobScope(jobDatabase,{resolve:async()=>result},identity,'franchise.profile.read',async()=>{throw new Error('must not run');})).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
  }
});
