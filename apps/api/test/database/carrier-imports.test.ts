import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { carrierSetup, referenceInput } from '../carrier-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { paymentFault } from '../payment-support.ts';
import { createCarrierImportService } from '../../src/modules/carriers/import-service.ts';

const fields={shipments:['docket','external_docket','service_code','origin_code','destination_code'],tracking:['docket','external_docket','source_id','status_code','occurred_at']};
export function csvBody(kind:'shipments'|'tracking',rows:string[],bom=false) {
  return {kind,content_base64:Buffer.from((bom?'\uFEFF':'')+fields[kind].join(',')+'\r\n'+rows.join('\r\n')).toString('base64'),
    columns:Object.fromEntries(fields[kind].map(f=>[f,f])),status_mapping:kind==='tracking'?[{source_code:'MOVE',status:'in_transit_claim'},{source_code:'DONE',status:'delivered_claim'}]:[]};
}
async function setup(t:Parameters<typeof carrierSetup>[0]) {
  const s=await carrierSetup(t),iid=(await s.install()).json().id as string;
  const docket=(await s.db.adminQuery<{docket:string}>('SELECT docket FROM shipit.parcels WHERE id=$1',[s.parcel])).rows[0]!.docket;
  const create=(body:unknown,key=randomUUID())=>s.request('POST',`carriers/installations/${iid}/imports`,body,s.local.token,key);
  const commit=(id:string,rows=[2],key=randomUUID())=>s.request('POST',`carriers/imports/${id}/commit`,{rows},s.local.token,key);
  const tracking=(source='EVENT-1',status='MOVE',at=s.clock().toISOString())=>`${docket},SYN-54,${source},${status},${at}`;
  return {...s,iid,docket,create,commit,tracking};
}
await test('CSV preview, selected shipment/tracking apply, deduplication and reload preserve operational authority', {timeout:60000},async t=>{
  const s=await setup(t),before=await s.carrierCounts(),domain=await s.counts();
  const capabilities=(await s.request('GET','carriers/installations')).json().items[0].capabilities;
  assert.equal(capabilities.tracking_import.enabled,true);assert.equal(capabilities.tracking_api.enabled,false);
  const money=(await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows;
  const shipment=csvBody('shipments',[`${s.docket},SYN-54,STD,ORIGIN,UNKNOWN`],true),key=randomUUID();
  const preview=await s.create(shipment,key);assert.equal(preview.statusCode,201,preview.body);const id=preview.json().id;
  assert.deepEqual(preview.json().counts,{total:1,valid:1,rejected:0,conflicted:0,applied:0,duplicate:0});
  assert.deepEqual(await s.carrierCounts(),{...before,audits:Number(before!.audits)+1});assert.deepEqual(await s.counts(),domain);
  assert.equal((await s.create(shipment,key)).json().id,id);
  assert.equal((await s.create(csvBody('shipments',[`${s.docket},OTHER,STD,ORIGIN,UNKNOWN`]),key)).statusCode,409);
  assert.equal((await s.create({...shipment,content_base64:Buffer.from('x').toString('base64')},key)).statusCode,422);
  const applied=await s.commit(id);assert.equal(applied.statusCode,200,applied.body);assert.equal(applied.json().counts.applied,1);
  assert.equal((await s.commit(id)).json().counts.applied,1);
  const repeated=(await s.create(shipment)).json();assert.equal(repeated.counts.valid,1);
  assert.equal((await s.commit(repeated.id)).json().counts.duplicate,1);
  const body=csvBody('tracking',[s.tracking(),s.tracking(),s.tracking('EVENT-2','UNKNOWN'),s.tracking('EVENT-3','DONE')]);
  const track=await s.create(body);assert.equal(track.statusCode,201,track.body);assert.equal(track.json().counts.rejected,1);
  const tid=track.json().id,commitKey=randomUUID();
  assert.equal((await s.commit(tid,[2,4])).statusCode,422);assert.equal((await s.carrierCounts())!.observations,0);
  assert.equal((await s.commit(tid,[2,2])).statusCode,422);
  const partial=await s.commit(tid,[2],commitKey);assert.equal(partial.json().counts.applied,1);assert.equal(partial.json().counts.valid,2);
  assert.equal((await s.commit(tid,[3],commitKey)).statusCode,409);
  const final=await s.commit(tid,[2,3,5]);assert.equal(final.statusCode,200,final.body);
  assert.deepEqual(final.json().counts,{total:4,valid:0,rejected:1,conflicted:0,applied:2,duplicate:1});
  const fresh=createCarrierImportService(s.db.runtimePool(),s.clock);
  assert.deepEqual(await fresh.status(s.local.token,tid,s.q,randomUUID()),final.json());
  const evidence=(await s.request('GET',`parcels/${s.parcel}/carriers/observations`)).json().items;
  assert.equal(evidence.length,2);assert.ok(evidence.every((x:{review_state:string})=>x.review_state==='pending_review'));
  assert.ok(evidence.every((x:{evidence:{provenance:{mode:string;importId:string}}})=>x.evidence.provenance.mode==='file'&&x.evidence.provenance.importId===tid));
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,money);assert.deepEqual(await s.counts(),domain);
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[s.parcel])).rows,[{status:'booked',version:1}]);
  const changed=await s.create(csvBody('tracking',[s.tracking('EVENT-1','DONE')]));assert.equal(changed.json().rows[0].error,'SOURCE_CONFLICT');
  assert.equal(changed.json().rows[0].candidate,null);
  const conflictInFile=await s.create(csvBody('tracking',[s.tracking('NEW-ID'),s.tracking('NEW-ID','DONE')]));
  assert.equal(conflictInFile.json().rows[1].error,'SOURCE_CONFLICT');
});

await test('partial failure resumes only missing rows; concurrent imports and lost commit are safe', {timeout:60000},async t=>{
  const s=await setup(t);assert.equal((await s.link(s.iid)).statusCode,201);
  const input=csvBody('tracking',[s.tracking('A'),s.tracking('B')]),run=(await s.create(input)).json().id as string;
  // Fail the second row after its observation insert. First row has committed; second must roll back.
  let inserts=0;
  const pool:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await client.query<Row>(sql,params);
    if(sql.includes('INSERT INTO shipit.carrier_observations')&&++inserts===2)throw new DatabaseError('DB_CONNECTION_FAILED');return result;
  }};}};
  await assert.rejects(createCarrierImportService(pool,s.clock).commit(s.local.token,run,randomUUID(),{rows:[2,3]},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  const status=(await s.request('GET',`carriers/imports/${run}`)).json();assert.equal(status.counts.applied,1);assert.equal(status.counts.valid,1);
  const resumed=await s.commit(run,[2,3]);assert.equal(resumed.statusCode,200,resumed.body);assert.equal(resumed.json().counts.applied,2);
  const runs=await Promise.all([s.create(input),s.create(input)]);
  const raced=await Promise.all(runs.map(r=>s.commit(r.json().id,[2,3])));raced.forEach(r=>assert.equal(r.json().counts.duplicate,2));
  assert.equal((await s.carrierCounts())!.observations,2);
  const lost=(await s.create(csvBody('tracking',[s.tracking('C')]))).json().id as string;
  const key=randomUUID();
  // Save the selection first, then inject a lost acknowledgement after the row COMMIT.
  let commits=0;
  const uncertain:DatabasePool={...s.pool,async connect(){const c=await s.pool.connect();return {release:d=>c.release(d),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await c.query<Row>(sql,params);if(sql==='COMMIT'&&++commits===2)throw new DatabaseError('DB_CONNECTION_FAILED');return result;
  }};}};
  await assert.rejects(createCarrierImportService(uncertain,s.clock).commit(s.local.token,lost,key,{rows:[2]},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.commit(lost,[2],key)).json().counts.applied,1);assert.equal((await s.carrierCounts())!.observations,3);
  const bad=createCarrierImportService(paymentFault(s.pool,'INSERT INTO shipit.carrier_import_outcomes','before'),s.clock);
  const failed=(await s.create(csvBody('tracking',[s.tracking('D')]))).json().id as string;
  await assert.rejects(bad.commit(s.local.token,failed,randomUUID(),{rows:[2]},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.carrierCounts())!.observations,3);
  const parallelInput=csvBody('tracking',[s.tracking('RACE')]);
  const parallelRuns=await Promise.all([s.create(parallelInput),s.create(parallelInput)]);
  const results=await Promise.all(parallelRuns.map(r=>s.commit(r.json().id)));
  assert.deepEqual(results.map(r=>r.json().counts.applied).sort(),[0,1]);
  assert.deepEqual(results.map(r=>r.json().counts.duplicate).sort(),[0,1]);
  assert.equal((await s.carrierCounts())!.observations,4);
  const owner=s.db.ownerPool();
  await assert.rejects(owner.query('DELETE FROM shipit.carrier_import_outcomes'));
  const stored=(await s.db.adminQuery<{run_id:string}>('SELECT run_id FROM shipit.carrier_import_outcomes LIMIT 1')).rows[0]!;
  await assert.rejects(owner.query(`INSERT INTO shipit.carrier_import_outcomes SELECT (jsonb_populate_record(NULL::shipit.carrier_import_outcomes,
    to_jsonb(o)||$1::jsonb)).* FROM shipit.carrier_import_outcomes o WHERE run_id=$2 LIMIT 1`,[JSON.stringify({franchise_id:B,row_number:200}),stored.run_id]));
});

await test('CSV access, nested foreign docket privacy, validation and audit remain tenant-bound', {timeout:60000},async t=>{
  const s=await setup(t);await s.link(s.iid);const input=csvBody('tracking',[s.tracking()]),run=(await s.create(input)).json().id as string;
  for(const role of ['operator','dispatcher','read_only','accountant','delivery_agent']){
    const actor=await s.grant(role,[A]);
    assert.equal((await s.request('POST',`carriers/installations/${s.iid}/imports`,input,actor.token)).statusCode,403);
    assert.equal((await s.request('POST',`carriers/imports/${run}/commit`,{rows:[2]},actor.token)).statusCode,403);
    assert.equal((await s.request('GET',`carriers/imports/${run}`,undefined,actor.token)).statusCode,['accountant','delivery_agent'].includes(role)?403:200);
  }
  const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
  for(const [actor,q] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
    for(const id of [run,randomUUID()])assert.equal((await s.request('GET',`carriers/imports/${id}`,undefined,actor.token,randomUUID(),q)).statusCode,404);
    assert.equal((await s.request('POST',`carriers/imports/${run}/commit`,{rows:[2]},actor.token,randomUUID(),q)).statusCode,404);
    assert.equal((await s.request('POST',`carriers/installations/${s.iid}/imports`,input,actor.token,randomUUID(),q)).statusCode,404);
    const installation=await s.request('POST','carriers/installations',{label:'SYN-FOREIGN'},actor.token,randomUUID(),q);assert.equal(installation.statusCode,201,installation.body);
    const rejected=await s.request('POST',`carriers/installations/${installation.json().id}/imports`,input,actor.token,randomUUID(),q);
    assert.equal(rejected.statusCode,201,rejected.body);assert.equal(rejected.json().rows[0].error,'REFERENCE_NOT_FOUND');assert.equal(rejected.json().rows[0].candidate,null);
    assert.ok(!rejected.body.includes(s.docket));assert.ok(!rejected.body.includes(s.parcel));
    const unknown=await s.request('POST',`carriers/installations/${installation.json().id}/imports`,csvBody('tracking',[s.tracking().replace(s.docket,'UNKNOWN')]),actor.token,randomUUID(),q);
    assert.deepEqual(unknown.json().rows,rejected.json().rows);
  }
  assert.equal((await s.carrierCounts())!.observations,0);
  for(const [body,code] of [[{...input,content_base64:Buffer.from([0xff]).toString('base64')},'UTF8_REQUIRED'],[{...input,content_base64:'A'.repeat(90000)},'FILE_TOO_LARGE']] as const){
    const response=await s.create(body);assert.equal(response.statusCode,422,response.body);assert.equal(response.json().error.details[0].code,code);
  }
  const formula=await s.create(csvBody('tracking',[s.tracking().replace('EVENT-1','"=SUM(1,2)"')]));
  assert.equal(formula.json().rows[0].error,'INVALID_CODE');assert.ok(!formula.body.includes('SUM'));
  const audit=await s.list(s.local.token,{resource_type:'carrier',franchise_id:A});
  for(const secret of [s.docket,'SYN-54','EVENT-1','SUM','Synthetic Recipient','Fictional Street']){
    assert.ok(!audit.body.includes(secret));assert.ok(!s.logs.join('').includes(secret));
  }
  for(const table of ['carrier_import_runs','carrier_import_commits','carrier_import_outcomes']){
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
  }
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});
  assert.equal((await s.commit(run)).statusCode,404);
});

await test('stale reference, source time and reviewed dimensions cannot be force-applied', {timeout:60000},async t=>{
  const s=await setup(t),ship=(await s.create(csvBody('shipments',[`${s.docket},EXT,STD,ORIGIN,DEST`]))).json().id as string;
  const mapped=await s.request('POST',`carriers/installations/${s.iid}/mappings`,{kind:'service',source_code:'STD',normalized_id:null,expected_version:0,reason_code:'initial_mapping'});assert.equal(mapped.statusCode,201,mapped.body);
  const stale=await s.commit(ship);assert.equal(stale.json().rows[0].error,'STALE_STATE');assert.equal((await s.carrierCounts())!.refs,0);
  await s.link(s.iid);const run=(await s.create(csvBody('tracking',[s.tracking()]))).json().id as string;
  const corrected=await s.link(s.iid,{...referenceInput(s.iid),external_docket:'CORRECTED',expected_version:1,reason_code:'reference_correction'});assert.equal(corrected.statusCode,201);
  assert.equal((await s.commit(run)).json().rows[0].error,'STALE_STATE');assert.equal((await s.carrierCounts())!.observations,0);
  const times=[new Date(s.clock().getTime()+1000).toISOString(),'2000-01-01T00:00:00Z'];
  for(const at of times){const response=await s.create(csvBody('tracking',[s.tracking('OLD','MOVE',at).replace('SYN-54','CORRECTED')]));assert.equal(response.json().rows[0].error,'STALE_STATE');}
  const pending=(await s.create(csvBody('tracking',[s.tracking('VALID').replace('SYN-54','CORRECTED')]))).json().id as string;
  // A later accepted source time makes the already previewed row stale.
  s.setNow(new Date(s.clock().getTime()+60000).toISOString());
  const newer=(await s.create(csvBody('tracking',[s.tracking('NEWER').replace('SYN-54','CORRECTED')]))).json().id as string;
  assert.equal((await s.commit(newer)).json().counts.applied,1);
  assert.equal((await s.commit(pending)).json().rows[0].error,'STALE_STATE');
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
  assert.equal((await s.commit(pending)).json().error.code,'FRANCHISE_DISABLED');
});
