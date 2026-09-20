import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { whatsappSetup } from '../whatsapp-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { paymentFault } from '../payment-support.ts';

await test('WhatsApp connection, immutable template revisions, rotation and restart preserve safe durable evidence',{timeout:30000},async t=>{
  const s=await whatsappSetup(t),key=randomUUID(),connected=await s.connect(key);assert.equal(connected.statusCode,200,connected.body);
  const id=connected.json().id,path=`installations/${id}`;
  assert.deepEqual((await s.connect(key)).json(),connected.json());assert.equal(s.calls.length,1);
  const sync=await s.request(path+'/sync',{expected_version:1,name:'parcel_update',language:'en_US'});assert.equal(sync.statusCode,200,sync.body);assert.equal(sync.json().template.status,'APPROVED');
  const capability=()=>s.request(path+'/capability',{name:'parcel_update',language:'en_US',variables:['SYNTHETIC']});
  assert.equal((await capability()).json().available,true);
  assert.equal((await s.request(path+'/capability',{name:'parcel_update',language:'hi',variables:['SYNTHETIC']})).json().reason,'template_language_missing');
  assert.equal((await s.request(path+'/capability',{name:'parcel_update',language:'en_US',variables:[7]})).json().reason,'template_variables_invalid');
  const rotation=await s.request(path+'/rotate',{expected_version:2,binding_key:'alpha_v2'});assert.equal(rotation.statusCode,200,rotation.body);
  assert.ok(s.calls.at(-1)!.authorization.endsWith('alpha_v2'));assert.equal((await capability()).json().reason,'template_validation_stale');
  const rotated=await s.db.adminQuery<{credential_ref:string}>('SELECT credential_ref FROM shipit.whatsapp_installations WHERE id=$1',[id]);assert.equal(rotated.rows[0]!.credential_ref,'whatsapp:alpha/v2');
  s.setStatus('REJECTED');assert.equal((await s.request(path+'/sync',{expected_version:3,name:'parcel_update',language:'en_US'})).statusCode,200);
  assert.equal((await capability()).json().reason,'template_not_approved');
  s.setStatus('APPROVED');await s.request(path+'/sync',{expected_version:4,name:'parcel_update',language:'en_US'});
  s.setLanguage('hi');await s.request(path+'/sync',{expected_version:5,name:'parcel_update',language:'en_US'});
  assert.equal((await capability()).json().template.status,'MISSING');
  const fresh=s.db.runtimePool(),restarted=createWhatsappService(fresh,s.dependencies);
  assert.equal((await restarted.read(s.local.token,{organization_id:org,franchise_id:A},randomUUID())).installation!.version,6);
  assert.deepEqual(await s.counts(),{installations:1,commands:6,templates:4});
  const audits=(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='whatsapp_installation' ORDER BY committed_version")).rows;
  assert.equal(audits.length,6);
  const auditFilter={organization_id:org,franchise_id:A,resource_type:'whatsapp_installation',limit:'2'};
  const page=await s.audit.list(s.local.token,auditFilter,randomUUID());assert.equal(page.items.length,2);assert.ok(page.page.next_cursor);
  const next=await s.audit.list(s.local.token,{...auditFilter,cursor:page.page.next_cursor!},randomUUID());assert.equal(next.items.length,2);
  assert.equal(next.items.some(i=>page.items.some(p=>p.id===i.id)),false);
  for(const output of [connected.body,sync.body,rotation.body,(await s.request('installation')).body,JSON.stringify(audits),s.logs.join('')]) {
    for(const secret of ['synthetic_token','whatsapp:alpha','100001','100002','Parcel {{1}}'])assert.equal(output.includes(secret),false);
  }
  // Start a real loopback API listener, verify persisted configuration, and drain it.
  await s.app.listen({host:'127.0.0.1',port:0});
  const address=s.app.server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/api/v1/whatsapp/installation?organization_id=${org}&franchise_id=${A}`,{headers:{cookie:`shipit_session=${s.local.token}`}});
  assert.equal(response.status,200);assert.equal((await response.json() as {installation:{version:number}}).installation.version,6);
});

await test('WhatsApp denies foreign bindings and real foreign resources, checks all roles and CSRF',{timeout:30000},async t=>{
  const s=await whatsappSetup(t),a=await s.connect();assert.equal(a.statusCode,200,a.body);const id=a.json().id;
  const b=await s.request('installations',{binding_key:'beta_v1',expected_version:0},s.sibling.token,B),c=await s.request('installations',{binding_key:'gamma_v1',expected_version:0},s.foreign.token,C,otherOrg);
  assert.equal(b.statusCode,200,b.body);assert.equal(c.statusCode,200,c.body);
  const before=await s.counts(),calls=s.calls.length;
  for(const foreignId of [b.json().id,c.json().id,randomUUID()]) {
    assert.equal((await s.request(`installations/${foreignId}/rotate`,{expected_version:1,binding_key:'alpha_v2'})).statusCode,404);
    assert.equal((await s.request(`installations/${foreignId}/capability`,{name:'parcel_update',language:'en_US',variables:[]})).statusCode,404);
  }
  for(const key of ['beta_v1','gamma_v1','unknown'])assert.equal((await s.request(`installations/${id}/rotate`,{expected_version:1,binding_key:key})).statusCode,404);
  assert.equal((await s.request('installation',undefined,s.local.token,B)).statusCode,404);
  assert.equal((await s.request('installation',undefined,s.local.token,C,otherOrg)).statusCode,404);
  assert.equal((await s.request('installation',undefined,s.admin.token,B)).json().installation.id,b.json().id);
  assert.equal((await s.request(`installations/${id}/disable`,{expected_version:1},s.admin.token)).statusCode,403);
  for(const role of ['operator','dispatcher','delivery_agent','accountant','read_only']) {
    const user=await s.grant(role,[A]);
    assert.equal((await s.request('installation',undefined,user.token)).statusCode,403);
    assert.equal((await s.request(`installations/${id}/disable`,{expected_version:1},user.token)).statusCode,403);
  }
  const csrf=await s.app.inject({method:'POST',url:`/api/v1/whatsapp/installations/${id}/disable?organization_id=${org}&franchise_id=${A}`,cookies:s.cookies(s.local.token),payload:{expected_version:1}});
  assert.equal(csrf.statusCode,403);assert.deepEqual(await s.counts(),before);assert.equal(s.calls.length,calls);
});

await test('WhatsApp concurrent commands, stale revisions, lost commits and rollback retain exactly one command effect',{timeout:30000},async t=>{
  const s=await whatsappSetup(t),key=randomUUID();
  const [a,b]=await Promise.all([s.connect(key),s.connect(key)]);assert.equal(a.statusCode,200,a.body);assert.deepEqual(a.json(),b.json());
  const id=a.json().id,query={organization_id:org,franchise_id:A};
  assert.equal((await s.request('installations',{expected_version:0,binding_key:'alpha_v2'},s.local.token,A,org,key)).statusCode,409);
  const [r1,r2]=await Promise.all([s.request(`installations/${id}/rotate`,{expected_version:1,binding_key:'alpha_v2'}),s.request(`installations/${id}/rotate`,{expected_version:1,binding_key:'alpha_v2'})]);
  assert.deepEqual([r1.statusCode,r2.statusCode].sort(),[200,409]);
  const before=await s.counts();
  const failed=createWhatsappService(paymentFault(s.pool,'INSERT INTO shipit.whatsapp_commands','before'),s.dependencies);
  await assert.rejects(failed.execute(s.local.token,id,'disable',query,randomUUID(),{expected_version:2},randomUUID()),/TEMPORARILY_UNAVAILABLE/);
  assert.deepEqual(await s.counts(),before);assert.equal((await s.request('installation')).json().installation.version,2);
  // Only fail the COMMIT after command persistence; the preflight commit must succeed.
  let commit=0;const pool={...s.pool,async connect(){const client=await s.pool.connect();return {...client,async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await client.query<Row>(sql,params);if(sql==='COMMIT'&&++commit===2)throw new Error('lost_response');return result;
  }};}};
  const uncertain=createWhatsappService(pool,s.dependencies),disableKey=randomUUID();
  await assert.rejects(uncertain.execute(s.local.token,id,'disable',query,disableKey,{expected_version:2},randomUUID()));
  const replay=await s.service.execute(s.local.token,id,'disable',query,disableKey,{expected_version:2},randomUUID());assert.equal(replay.version,3);
  assert.deepEqual(await s.counts(),{installations:1,commands:3,templates:0});
});

await test('WhatsApp checks revoked authority after provider I/O, failures leave no partial writes',{timeout:30000},async t=>{
  const s=await whatsappSetup(t);
  s.setIdentity(false);assert.equal((await s.connect()).statusCode,409);assert.deepEqual(await s.counts(),{installations:0,commands:0,templates:0});
  s.setIdentity(true);s.setHttp(503);assert.equal((await s.connect()).statusCode,503);s.setHttp(200);
  s.setHook(async()=>{s.setHook(undefined);await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});});
  const revoked=await s.connect();assert.ok([403,404].includes(revoked.statusCode),revoked.body);assert.deepEqual(await s.counts(),{installations:0,commands:0,templates:0});
});

await test('WhatsApp freshness, disable, malformed input and configuration changes fail closed',{timeout:30000},async t=>{
  const s=await whatsappSetup(t),connected=await s.connect(),id=connected.json().id,path=`installations/${id}`;
  await s.request(path+'/sync',{expected_version:1,name:'parcel_update',language:'en_US'});s.advance();
  assert.equal((await s.request(path+'/capability',{name:'parcel_update',language:'en_US',variables:['SYNTHETIC']})).json().reason,'template_validation_stale');
  const before=await s.counts(),calls=s.calls.length;
  for(const body of [{expected_version:2,credential_ref:'whatsapp:foreign'},{expected_version:2,token:'secret'},{expected_version:2,binding_key:'alpha_v2',organization_id:otherOrg},{expected_version:2.5,binding_key:'alpha_v2'}])
    assert.equal((await s.request(path+'/rotate',body)).statusCode,422);
  assert.deepEqual(await s.counts(),before);assert.equal(s.calls.length,calls);
  const removed=createWhatsappService(s.pool,{...s.dependencies,configuration:{...s.dependencies.configuration,bindings:[]}});
  assert.equal((await removed.capability(s.local.token,id,{organization_id:org,franchise_id:A},{name:'parcel_update',language:'en_US',variables:['SYNTHETIC']},randomUUID())).reason,'installation_configuration_changed');
  assert.equal((await s.request(path+'/disable',{expected_version:2})).statusCode,200);
  assert.equal((await s.request(path+'/sync',{expected_version:3,name:'parcel_update',language:'en_US'})).statusCode,409);
  assert.equal((await s.request(path+'/capability',{name:'parcel_update',language:'en_US',variables:['SYNTHETIC']})).json().reason,'installation_disabled');
  assert.equal((await s.request(path+'/rotate',{expected_version:3,binding_key:'alpha_v2'})).statusCode,200);
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
  assert.equal((await s.request(path+'/capability',{name:'parcel_update',language:'en_US',variables:['SYNTHETIC']})).json().reason,'owner_disabled');
  assert.equal((await s.request(path+'/rotate',{expected_version:4,binding_key:'alpha_v1'})).json().error.code,'FRANCHISE_DISABLED');
});
