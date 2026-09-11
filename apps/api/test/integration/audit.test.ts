import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { auditCursorCodec } from '../../src/modules/audit/cursor.ts';
import { filterInput } from '../../src/modules/audit/validation.ts';
import { createSecurityCounters } from '../../src/modules/audit/telemetry.ts';
import { appendTenancy, list } from '../../src/modules/audit/repository.ts';
import type { TenantAccess } from '../../src/modules/security/scope.ts';
import type { TenancyAuditFact } from '../../src/modules/tenancy/types.ts';
const org='00000000-0000-4000-8000-000000000001';
it('audit filters are closed, bounded and normalize equivalent defaults',()=>{
  expect(()=>filterInput({organization_id:org,cursor:''})).toThrow('CURSOR_INVALID');
  expect(filterInput({organization_id:org})).toEqual(filterInput({organization_id:org,limit:'50',sort:'occurred_at_desc'}));
  for(const extra of [{limit:'0'},{limit:'101'},{limit:'1.5'},{limit:'01'},{limit:['1','2']},{offset:'10'},
    {from:'0000-01-01T00:00:00Z'},{from:'2026-02-30T00:00:00Z'},{from:'2026-01-02T00:00:00Z',to:'2026-01-01T00:00:00Z'},
    {resource_type:"identity' OR true--"},{resource_id:org},{sort:'id;DROP TABLE'},{cursor:'x'.repeat(4097)},
    {franchise_id:'foreign'},{actor_id:org},{limit:20}])expect(()=>filterInput({organization_id:org,...extra})).toThrow('VALIDATION_FAILED');
});
it('cursor encrypts private references, rejects tamper, expiry, scope/filter/revision/key reuse',()=>{
  let now=1000000;const key=randomBytes(32),codec=auditCursorCodec(key,()=>now);
  const b={time:'2026-09-11T00:00:00.123456Z',id:`membership:${org}`},token=codec.encode('scope-one',b);
  expect(token).not.toContain(org);expect(Buffer.from(token,'base64url').toString()).not.toContain(org);
  expect(codec.decode(token,'scope-one')).toEqual(b);
  for(const [candidate,binding] of [[token,'scope-two'],[token.slice(1),'scope-one'],['malformed!','scope-one'],[token+'=','scope-one']]) {
    expect(()=>codec.decode(candidate!,binding!)).toThrow('CURSOR_INVALID');
  }
  expect(()=>auditCursorCodec(randomBytes(32),()=>now).decode(token,'scope-one')).toThrow('CURSOR_INVALID');
  expect(auditCursorCodec(key,()=>now).decode(token,'scope-one')).toEqual(b);
  now+=900000;expect(()=>codec.decode(token,'scope-one')).toThrow('CURSOR_INVALID');
});
it('telemetry stores only closed dimensions and cannot retain injected labels',()=>{
  const counters=createSecurityCounters();
  for(let i=0;i<1000;i++)counters.denied({action:'audit.read',resource_type:'audit',reason_code:'ACTION_FORBIDDEN',result:'denied',
    phone:`synthetic-${i}`,token:'SYN_TOKEN'} as Parameters<typeof counters.denied>[0]);
  counters.denied({action:'SYN_SECRET',resource_type:'audit',reason_code:'ACTION_FORBIDDEN',result:'denied'} as never);
  counters.recordingFailed();const snapshot=counters.snapshot();
  expect(snapshot.counters).toHaveLength(1);expect(snapshot.counters[0]?.count).toBe(1000);
  expect(JSON.stringify(snapshot)).not.toMatch(/synthetic|SYN_|phone|token/);
  snapshot.counters[0]!.count=0;expect(counters.snapshot().counters[0]?.count).toBe(1000);
});
it('audit repositories reject missing/forged capabilities before private SQL',async()=>{
  for(const scope of [undefined,{}, {context:{organizationId:org,action:'audit.read'}}]) {
    await expect(list(scope as TenantAccess,filterInput({organization_id:org}),null)).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(appendTenancy(scope as TenantAccess,{} as TenancyAuditFact)).rejects.toThrow('ACTION_FORBIDDEN');
  }
});
