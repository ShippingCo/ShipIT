import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { bookingSetup } from './booking-support.ts';
import { org,A } from './audit-support.ts';
import { start } from './pricing-support.ts';
export const external={issuer:'SYN_ISSUER',reference:'SYN-REF-1',source_ref:'SYN_SOURCE',issued_at:start,official_valid_until:'2099-01-02T00:00:00Z',validity_evidence_ref:'SYN_EVIDENCE'};
export const ewayInput={declaration:{value_paise:123456,source_ref:'SYN_DECLARATION'},external,vehicle_number:'SYN-123',distance_km:53};
export async function ewaySetup(t:Parameters<typeof bookingSetup>[0]) {
 const s=await bookingSetup(t);await s.db.prepareEway();const b=await s.book();assert.equal(b.statusCode,201,b.body);const bookingId=b.json().id as string;
 const q={organization_id:org,franchise_id:A};
 const request=(method:'POST'|'PATCH'|'GET',suffix='',body:unknown=undefined,token=s.operator.token,booking=bookingId,query:Record<string,string>=q,key=randomUUID())=>s.app.inject({method,
  url:(suffix==='reminders'?'/api/v1/eway/reminders':`/api/v1/bookings/${booking}/eway${suffix}`)+'?'+new URLSearchParams(query),
  headers:{...s.headers,...(method==='GET'?{}:{'idempotency-key':key})},cookies:s.cookies(token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
 const create=(body:unknown=ewayInput,key=randomUUID())=>request('POST','',body,s.operator.token,bookingId,q,key);
 const correct=(body:unknown={expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN_CORRECTION',distance_km:71},key=randomUUID())=>request('PATCH','',body,s.operator.token,bookingId,q,key);
 const counts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.eway_records) records,(SELECT count(*)::int FROM shipit.eway_record_revisions) revisions,(SELECT count(*)::int FROM shipit.eway_commands) commands,(SELECT count(*)::int FROM shipit.audit_history WHERE resource_type='eway') audits`)).rows[0];
 async function policy(version=1,effective=start,threshold:number|null=200000,approved=true) {
  const id=randomUUID();await s.db.adminQuery(`INSERT INTO shipit.eway_policies(id,organization_id,franchise_id,version,approved,effective_from,source_ref,approval_ref,threshold_paise,warning_seconds,estimate_rule,block_km,block_seconds)
   VALUES($1,$2,$3,$4,$5,$6,'SYN_POLICY','SYN_APPROVAL',$7,60,'distance_blocks_v1',10,100)`,[id,org,A,version,approved,effective,threshold]);return id;
 }
 return {...s,bookingId,q,request,ewayCreate:create,correct,ewayCounts:counts,policy};
}
