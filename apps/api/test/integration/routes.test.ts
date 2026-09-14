import { describe,it,expect } from 'vitest';
import { command,filter } from '../../src/modules/routes/validation.ts';
import { fingerprint } from '../../src/modules/routes/idempotency.ts';
import { routeCursorCodec } from '../../src/modules/routes/cursor.ts';
import { lotCursorCodec } from '../../src/modules/lots/cursor.ts';
import { createRouteService,routeDto } from '../../src/modules/routes/service.ts';
import { fakeDatabase } from '../support.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import * as routes from '../../src/modules/routes/repository.ts';
import { routeMetadata } from '../route-support.ts';
const id='00000000-0000-4000-8000-000000000001';
describe('Route transport and capability contract',()=>{
  it('normalizes labels/UTC and closes every metadata, ownership and provider input',()=>{
    expect(command('routes.create',{...routeMetadata,origin:'  Origin  '})).toEqual({...routeMetadata,origin:'Origin',scheduled_departure_at:'2099-01-01T03:30:00Z'});
    for(const field of ['origin','destination','mode','scheduled_departure_at']){const b:Record<string,unknown>={...routeMetadata};delete b[field];expect(()=>command('routes.create',b)).toThrow();}
    for(const origin of [null,23,'','a'.repeat(121),'bad\u0000','bad\ud800'])expect(()=>command('routes.create',{...routeMetadata,origin})).toThrow();
    for(const carrier_code of [23,'x','A\n',' A','A'.repeat(65),'https://example.com'])expect(()=>command('routes.create',{...routeMetadata,carrier_code})).toThrow();
    for(const field of ['organization_id','franchise_id','actor','state','version','manifest_id','credential','provider','note'])expect(()=>command('routes.create',{...routeMetadata,[field]:id})).toThrow();
    for(const time of ['2099-01-01T09:00:00','2099-02-30T00:00:00Z','2099-01-01','now',23])expect(()=>command('routes.create',{...routeMetadata,scheduled_departure_at:time})).toThrow();
  });
  it('requires every mutation version and closed typed source identity',()=>{
    for(const op of ['routes.update','routes.archive','routes.finalize','routes.lot.attach','routes.lot.detach','routes.parcel.attach','routes.parcel.detach'] as const)
      for(const expected_version of [undefined,null,0,-1,1.5,'1',2147483647])expect(()=>command(op,{expected_version})).toThrow();
    expect(command('routes.parcel.attach',{expected_version:1,parcel_id:id})).toEqual({expected_version:1,parcel_id:id});
    for(const value of [undefined,2,'unknown',id+'x'])expect(()=>command('routes.lot.attach',{expected_version:1,lot_id:value})).toThrow();
    expect(()=>command('routes.finalize',{expected_version:1,status:'departed'})).toThrow();
  });
  it('canonical intent binds operation, target, source and full normalized metadata',()=>{
    const b=command('routes.update',{...routeMetadata,expected_version:1}),first=fingerprint('routes.update',id,null,b);
    expect(fingerprint('routes.update',id,null,command('routes.update',{expected_version:1,...routeMetadata,scheduled_departure_at:'2099-01-01T03:30:00Z'}))).toBe(first);
    for(const changed of [{...b,expected_version:2},{...b,carrier_code:null},{...b,origin:'Other'}])expect(fingerprint('routes.update',id,null,changed)).not.toBe(first);
    expect(fingerprint('routes.update',id,id,b)).not.toBe(first);expect(fingerprint('routes.create',null,null,b)).not.toBe(first);
  });
  it('rejects invalid pages and cryptographically binds purpose, actor and expiry',()=>{
    const q={organization_id:id,franchise_id:id};expect(filter(q).limit).toBe(50);
    for(const extra of [{limit:'101'},{limit:'0'},{limit:['2']},{limit:'1.5'},{state:'departed'},{carrier_code:'A'},{cursor:''}])expect(()=>filter({...q,...extra})).toThrow();
    let now=0;const key=Buffer.alloc(32,1),codec=routeCursorCodec(key,()=>now),b={value:'2099-01-01T00:00:00Z',id};const token=codec.encode('actor-A',b);
    expect(codec.decode(token,'actor-A')).toEqual(b);expect(()=>codec.decode(token,'actor-B')).toThrow('CURSOR_INVALID');
    expect(()=>codec.decode(token+'x','actor-A')).toThrow();expect(()=>lotCursorCodec(key,()=>now).decode(token,'actor-A')).toThrow();
    now=900000;expect(()=>codec.decode(token,'actor-A')).toThrow();
  });
  it('rejects forged, other-domain and evidence-only capabilities before executing SQL',async()=>{
    const db=fakeDatabase();
    for(const action of ['customer.read','bookings.read','routes.audit','routes.events'] as const){
      const scope=issueTenantAccess(db,{action,actor:{type:'user',id},organizationId:id,permittedFranchiseIds:[id],organizationWide:false,provenance:'membership',correlationId:id},false);
      await expect(routes.load(scope,id)).rejects.toThrow('ACTION_FORBIDDEN');
      await expect(routes.manifest(scope,id,id)).rejects.toThrow('ACTION_FORBIDDEN');
      await expect(routes.dispatchManifest(scope,id,id)).rejects.toThrow('ACTION_FORBIDDEN');
    }
    await expect(routes.load({} as Parameters<typeof routes.load>[0],id)).rejects.toThrow();expect(db.query).toHaveBeenCalledTimes(0);
  });
  it('projects a closed DTO and rejects invalid requests without provider or database work',async()=>{
    const r={id,...routeMetadata,mode:'road' as const,state:'planning' as const,version:1,current_manifest_id:id,scheduled_departure_at:new Date(0),created_at:new Date(0),updated_at:new Date(0),secret:'DO_NOT_RETURN'};
    expect(routeDto(r)).not.toHaveProperty('secret');
    const db=fakeDatabase();await expect(createRouteService(db,Buffer.alloc(32)).execute('invalid',null,null,{},'key',[],{},'routes.create',id)).rejects.toThrow();expect(db.query).toHaveBeenCalledTimes(0);
  });
});
