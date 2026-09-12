import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { customerSnapshot } from '@shippingco/shared';
import { phone, createInput, updateInput, searchInput, idempotencyKey, literalPrefix, uuid } from '../../src/modules/customers/validation.ts';
import { customerDto } from '../../src/modules/customers/types.ts';
import { fingerprint, keyDigest } from '../../src/modules/customers/idempotency.ts';
import { customerCursorCodec } from '../../src/modules/customers/cursor.ts';
import { customerScope } from '../../src/modules/memberships/policy.ts';
import type { Membership } from '../../src/modules/memberships/types.ts';
import { find, search, insert } from '../../src/modules/customers/repository.ts';
import { appendCustomer } from '../../src/modules/audit/repository.ts';
import type { TenantAccess } from '../../src/modules/security/scope.ts';
const id='00000000-0000-4000-8000-000000000001';
const input={name:'Synthetic Contact',phone:'+1 202-555-0100',address:'1 Synthetic Lane'};
const row={id,organization_id:id,franchise_id:id,...createInput(input),version:1,
  created_at:new Date('2026-09-12T00:00:00Z'),updated_at:new Date('2026-09-12T00:00:00.120Z')};
it.each(['+1 202-555-0100','+1-202-555-0100','+12025550100'])('normalizes explicit international phone and preserves display: %s',value=>{
  expect(phone(value)).toEqual({normalized:'+12025550100',display:value});
  expect(phone(' '+value+' ')).toEqual(phone(value));
});
it.each(['9876543210','+01 2025550100','+1234567','+1234567890123456','+1 2025550100 ext 1','+1 (202) 5550100',
  '+1--2025550100','+1  2025550100','+12025550100\n','+12025550100\t','+1²025550100','+12025550100-','＋12025550100','',null])('rejects malformed/ambiguous phone %#',value=>{
  expect(()=>phone(value)).toThrow('VALIDATION_FAILED');
});
it('normalizes only declared name/address defaults and enforces Unicode bounds',()=>{
  expect(createInput({...input,name:' Synthetic Contact ',address:'  '})).toMatchObject({name:input.name,address:''});
  expect(createInput({name:input.name,phone:input.phone})).toEqual(createInput({...input,address:''}));
  expect(createInput({...input,name:'界'.repeat(120),address:'界'.repeat(500)}).name).toHaveLength(120);
  for(const change of [{name:''},{name:' '},{name:'n'.repeat(121)},{address:'a'.repeat(501)},{name:'bad\n'},
    {name:'bad\u0085'},{name:'bad\ud800'},{address:'bad\udfff'},{address:null},{name:42}])expect(()=>createInput({...input,...change})).toThrow('VALIDATION_FAILED');
});
it('unknown fields, immutable ownership and submitted version fail with safe schema details',()=>{
  for(const field of ['id','organization_id','franchise_id','version','created_at','updated_at','SYN_PRIVATE_KEY']) {
    try {createInput({...input,[field]:'SYN_VALUE'});expect.fail('must reject');}
    catch(error) {expect(error).toMatchObject({code:'VALIDATION_FAILED',details:[{field:'$',code:'UNKNOWN_FIELD'}]});}
  }
});
it('updates require all contact values and bounded expected_version',()=>{
  expect(updateInput({...input,expected_version:1}).expected_version).toBe(1);
  expect(updateInput({...input,expected_version:2147483646}).expected_version).toBe(2147483646);
  for(const expected_version of [undefined,0,-1,1.1,'1',null,2147483647,Infinity])expect(()=>updateInput({...input,expected_version})).toThrow('VALIDATION_FAILED');
  expect(()=>updateInput({name:input.name,phone:input.phone,expected_version:1})).toThrow('VALIDATION_FAILED');
});
it('DTO projects only approved contact values and snapshots are independent frozen values',()=>{
  const dto=customerDto({...row,private_metadata:'SYN_SECRET'} as typeof row);
  expect(Object.keys(dto).sort()).toEqual(['id','name','phone','phone_display','address','version','created_at','updated_at'].sort());
  expect(dto.created_at).toBe('2026-09-12T00:00:00Z');expect(dto.updated_at).toBe('2026-09-12T00:00:00.12Z');
  const snapshot=customerSnapshot(dto);dto.address='New Synthetic Lane';row.address='Other Synthetic Lane';
  expect(snapshot.address).toBe(input.address);expect(snapshot.source_customer_id).toBe(id);expect(Object.isFrozen(snapshot)).toBe(true);
  expect(JSON.stringify(dto)).not.toMatch(/organization_id|private_metadata|SYN_SECRET/);
});
it('search is bounded, literal, explicit, international and never a one-character list',()=>{
  expect(searchInput({search_by:'phone',q:input.phone})).toEqual({searchBy:'phone',prefix:'+12025550100',limit:50,cursor:null});
  expect(searchInput({search_by:'name',q:' Syn ',limit:'100'})).toMatchObject({prefix:'Syn',limit:100});
  expect(literalPrefix('Syn%_\\')).toBe('Syn\\%\\_\\\\%');
  for(const change of [{q:'a'},{q:'ab'},{q:'---'},{q:'   '},{q:'x'.repeat(121)},{limit:'0'},{limit:'101'},{limit:'01'},
    {limit:'1.0'},{limit:1},{q:['abc','def']},{offset:'1'},{search_by:'anything'},{cursor:'x'.repeat(4097)}]) {
    expect(()=>searchInput({search_by:'name',q:'Syn',...change})).toThrow('VALIDATION_FAILED');
  }
  expect(()=>searchInput({search_by:'phone',q:'+1202555'})).toThrow('VALIDATION_FAILED');
  expect(()=>searchInput({search_by:'phone',q:'2025550100'})).toThrow('VALIDATION_FAILED');
});
it('UUID and idempotency headers reject malformed values, whitespace and duplicates without echo',()=>{
  expect(uuid(id,'customer_id')).toBe(id);expect(idempotencyKey('A_-9',['Idempotency-Key','A_-9'])).toBe('A_-9');
  for(const value of [undefined,'','a b','a,b','a\n',' a','a ',['a','b'],'a'.repeat(256)])expect(()=>idempotencyKey(value)).toThrow('VALIDATION_FAILED');
  expect(()=>idempotencyKey('a',['Idempotency-Key','a','idempotency-key','a'])).toThrow('VALIDATION_FAILED');
  for(const value of [id+'\n','unknown','',null])expect(()=>uuid(value,'customer_id')).toThrow('VALIDATION_FAILED');
});
it('fingerprints canonical validated intent including display, expected version and resource',()=>{
  const original=createInput(input),op='api.v1.customers.create';
  expect(fingerprint(op,null,original)).toBe(fingerprint(op,null,createInput({address:input.address,phone:input.phone,name:' Synthetic Contact '})));
  expect(fingerprint(op,null,original)).not.toBe(fingerprint(op,null,createInput({...input,phone:'+12025550100'})));
  expect(fingerprint(op,null,original)).not.toBe(fingerprint(op,id,original));
  expect(fingerprint('api.v1.customers.update',id,{...original,expected_version:1})).not.toBe(fingerprint('api.v1.customers.update',id,{...original,expected_version:2}));
  expect(keyDigest('SYN_KEY')).toMatch(/^[0-9a-f]{64}$/);expect(keyDigest('SYN_KEY')).not.toBe(keyDigest('syn_key'));
});
it('R05/W03 role ceiling is explicit; no admin inheritance or revoked grants',()=>{
  for(const role of ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as const) {
    const m={role,franchiseIds:[id],lifecycle:'active'} as Membership;
    expect(customerScope([m])).toEqual(['franchise_admin','operator'].includes(role)?[id]:[]);
    expect(customerScope([{...m,lifecycle:'revoked'}])).toEqual([]);
  }
});
it('customer cursor is encrypted, expiring, query bound and distinct from the audit purpose',()=>{
  let now=100000;const key=randomBytes(32),codec=customerCursorCodec(key,()=>now),boundary={id,time:'2026-09-12T00:00:00.123Z'};
  const token=codec.encode('scope',boundary);expect(codec.decode(token,'scope')).toEqual(boundary);
  expect(Buffer.from(token,'base64url').toString()).not.toContain(id);
  for(const value of [token.slice(1),token+'=',token+'\n','!', ''])expect(()=>codec.decode(value,'scope')).toThrow('CURSOR_INVALID');
  expect(()=>codec.decode(token,'other')).toThrow('CURSOR_INVALID');
  expect(()=>customerCursorCodec(randomBytes(32),()=>now).decode(token,'scope')).toThrow('CURSOR_INVALID');
  now+=900000;expect(()=>codec.decode(token,'scope')).toThrow('CURSOR_INVALID');
});
it('customer SQL and audit refuse structural/absent capabilities before database execution',async()=>{
  for(const scope of [undefined,{}, {context:{organizationId:id,action:'customer.list'}}]) {
    await expect(find(scope as TenantAccess,id,id)).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(search(scope as TenantAccess,id,searchInput({search_by:'phone',q:input.phone}),null)).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(insert(scope as TenantAccess,id,createInput(input))).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(appendCustomer(scope as TenantAccess,id,id,1)).rejects.toThrow('ACTION_FORBIDDEN');
  }
});
it('same-phone DTO candidates retain separate stable record IDs without consolidation',()=>{
  const second={...row,id:'00000000-0000-4000-8000-000000000002',name:'Synthetic Household'};
  const candidates=[row,second].map(customerDto);
  expect(candidates).toHaveLength(2);expect(candidates[0]!.phone).toBe(candidates[1]!.phone);
  expect(candidates[0]!.id).not.toBe(candidates[1]!.id);
});
