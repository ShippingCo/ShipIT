import { describe,it,expect } from 'vitest';
import { command,destination,filter,stateGuard } from '../../src/modules/lots/validation.ts';
import { fingerprint } from '../../src/modules/lots/idempotency.ts';
import { lotScope } from '../../src/modules/memberships/policy.ts';
import { lotCursorCodec } from '../../src/modules/lots/cursor.ts';
import { createLotService,lotDto } from '../../src/modules/lots/service.ts';
import { fakeDatabase } from '../support.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import * as lots from '../../src/modules/lots/repository.ts';
const id='00000000-0000-4000-8000-000000000001';
describe('lot strict contract',()=>{
  it('normalizes only name; code, destination and ownership cannot be mass assigned',()=>{
    expect(command('lots.create',{name:'  Batch  ',destination_key:'SYN_DEST'})).toEqual({name:'Batch',destination_key:'SYN_DEST'});
    for(const value of ['', 'a',' SYN','SYN\n','A'.repeat(33),'Mumbai City'])expect(()=>destination(value)).toThrow();
    for(const extra of ['code','actor','organization_id','franchise_id','version','state','route_id','note'])expect(()=>command('lots.create',{name:'Lot',destination_key:'SYN', [extra]:id})).toThrow();
    for(const name of ['', ' '.repeat(4),'a'.repeat(121),'bad\u0000','bad\ud800'])expect(()=>command('lots.create',{name,destination_key:'SYN'})).toThrow();
  });
  it('requires versions and exact membership identity with closed operation inputs',()=>{
    for(const version of [undefined,null,0,-1,1.1,2147483647,'1'])expect(()=>command('lots.archive',{expected_version:version})).toThrow();
    expect(command('lots.membership.move',{expected_version:1,expected_target_version:2,membership_id:id,target_lot_id:id})).toEqual({expected_version:1,expected_target_version:2,membership_id:id,target_lot_id:id});
    expect(()=>command('lots.update',{expected_version:1,name:'Lot',destination_key:'OTHER'})).toThrow();
  });
  for(const status of ['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'])it(`state guard ${status}`,()=>{
    if(['delivered','rto'].includes(status))expect(()=>stateGuard(status,true,true,false)).toThrow('PARCEL_STATE_CONFLICT');
    else {expect(stateGuard(status,false,true,false)).toBe(['booked','checked_in'].includes(status));expect(stateGuard(status,true,true,true)).toBe(true);}
    expect(stateGuard(status,false,false,true)).toBe(false);expect(stateGuard(status,true,false,true)).toBe(true);
  });
  it('canonical fingerprints bind all intent fields and IDs but ignore object key order',()=>{
    const b={expected_version:1,membership_id:id,target_lot_id:id,expected_target_version:2};
    const first=fingerprint('lots.membership.move',id,id,b);
    expect(fingerprint('lots.membership.move',id,id,{target_lot_id:id,membership_id:id,expected_target_version:2,expected_version:1})).toBe(first);
    for(const changed of [{...b,expected_version:2},{...b,expected_target_version:3},{...b,membership_id:id.replace(/1$/,'2')},{...b,target_lot_id:id.replace(/1$/,'2')}])expect(fingerprint('lots.membership.move',id,id,changed)).not.toBe(first);
    expect(fingerprint('lots.membership.move',id,null,b)).not.toBe(first);
  });
  it('bounded filters reject malformed selectors and unknown query fields',()=>{
    const q={organization_id:id,franchise_id:id};expect(filter(q).limit).toBe(50);
    for(const extra of [{limit:'101'},{limit:'0'},{limit:['2']},{limit:'1.5'},{state:'deleted'},{code:'A'},{cursor:''},{destination_key:'a'}])expect(()=>filter({...q,...extra})).toThrow();
  });
  it('cursor is opaque, purpose/scope/expiry bound',()=>{
    let now=0;const codec=lotCursorCodec(Buffer.alloc(32,1),()=>now),b={value:'2026-09-14T00:00:00Z',id};
    const token=codec.encode('actor-A',b);expect(token).not.toContain('actor-A');expect(codec.decode(token,'actor-A')).toEqual(b);
    expect(()=>codec.decode(token,'actor-B')).toThrow('CURSOR_INVALID');expect(()=>codec.decode(token+'x','actor-A')).toThrow();
    now=900000;expect(()=>codec.decode(token,'actor-A')).toThrow();
  });
  it('R08/W04 role sets do not inherit operational rights',()=>{
    for(const role of ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as const){
      const m=[{id,userId:id,organizationId:id,role,franchiseIds:[id],lifecycle:'active' as const,version:1,createdAt:new Date(0),updatedAt:new Date(0),revokedAt:null}];
      expect(lotScope('lots.create',m,[id]).length>0).toBe(['franchise_admin','operator','dispatcher'].includes(role));
      expect(lotScope('lots.read',m,[id]).length>0).toBe(!['delivery_agent','accountant'].includes(role));
    }
  });
  it('lot repositories reject other-domain and evidence-only capabilities before SQL',async()=>{
    const db=fakeDatabase();
    for(const action of ['customer.read','bookings.read','lots.audit','lots.events'] as const){
      const scope=issueTenantAccess(db,{action,actor:{type:'user',id},organizationId:id,permittedFranchiseIds:[id],
        organizationWide:false,provenance:'membership',correlationId:'synthetic-lot-scope'},false);
      for(const read of [lots.load,lots.parcel,lots.currentMembership,lots.membershipById,lots.locked])await expect(read(scope,id)).rejects.toThrow('ACTION_FORBIDDEN');
    }
    expect(db.query).toHaveBeenCalledTimes(0);expect(db.connect).toHaveBeenCalledTimes(0);
  });
  it('projects only operational fields and rejects invalid commands before database work',async()=>{
    const r={id,code:'LOT-0000000000000000001',name:'Lot',destination_key:'SYN',version:1,state:'active' as const,
      created_at:new Date(0),updated_at:new Date(0),archived_at:null,active_member_count:0,secret:'DO_NOT_RETURN'};
    expect(lotDto(r)).not.toHaveProperty('secret');
    const db=fakeDatabase();const service=createLotService(db,Buffer.alloc(32));
    await expect(service.execute('invalid',null,null,{},'key',[],{name:'Lot'},'lots.create',id)).rejects.toThrow();
  });
});
