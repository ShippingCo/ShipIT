import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { outboundSetup } from '../outbound-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createHistoryService } from '../../src/modules/whatsapp/history-service.ts';

const correlation=()=>randomUUID();
async function setup(t:Parameters<typeof outboundSetup>[0]) {
 const s=await outboundSetup(t);await s.db.prepareNotificationAutomation();s.advance(100000);
 const history=createHistoryService(s.pool,s.keys.browser,s.dependencies.clock);
 const read=(id:string,token=s.local.token)=>history.detail(token,'messages',id,s.query,correlation());
 const list=(extra:Record<string,string|undefined>={},token=s.local.token)=>history.list(token,'messages',{...s.query,...extra},correlation());
 return {...s,history,read,list};
}
await test('history exposes accepted, sent, delivered and read from callbacks without regressing on late failures',{timeout:30000},async t=>{
 const s=await setup(t),{id}=await s.enqueue();
 assert.equal((await s.read(id)).message!.state,'queued');
 s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.history44'}));await s.worker.tick();
 assert.equal((await s.read(id)).message!.state,'accepted');assert.equal((await s.read(id)).message!.progress,'none');
 await s.status('wamid.history44','sent');assert.equal((await s.read(id)).message!.state,'accepted');assert.equal((await s.read(id)).message!.progress,'sent');
 await s.status('wamid.history44','delivered');assert.equal((await s.read(id)).message!.state,'delivered');
 await s.status('wamid.history44','failed');assert.equal((await s.read(id)).message!.state,'delivered');
 await s.status('wamid.history44','read');await s.status('wamid.history44','sent');await s.status('wamid.history44','failed');
 const detail=await s.read(id);assert.equal(detail.message!.state,'read');assert.equal(detail.message!.reason_code,'delivery_confirmed');assert.equal(detail.message!.progress,'read');assert.equal(detail.message!.failure_observed,true);
 assert.equal(detail.recovery.kind,'none');assert.equal(detail.attempts.length,1);
 const inbox=await s.request('inbox/'+s.source);assert.equal(inbox.statusCode,200);assert.ok(!inbox.body.includes(s.input.text!));
 const response=await s.request('history/messages/'+id);assert.equal(response.statusCode,200,response.body);
 for(const privateValue of ['15550000001',s.input.text!,'sealed_payload','contact_key','provider_message_id','wamid.history44','fingerprint'])assert.ok(!JSON.stringify([response.json(),s.logs]).includes(privateValue));
 assert.equal((await createHistoryService(s.db.runtimePool(),s.keys.browser).detail(s.local.token,'messages',id,s.query,correlation())).message!.state,'read');
});
await test('history R16/R17 permits only four roles and preserves R18/W44 separation and foreign not-found',{timeout:30000},async t=>{
 const s=await setup(t),{id}=await s.enqueue();
 for(const role of ['franchise_admin','operator','dispatcher']) {
  const user=await s.grant(role,[A]);assert.equal((await s.list({},user.token)).items[0]!.id,id);
  if(role!=='franchise_admin') {
   await assert.rejects(s.service.detail(user.token,id,s.query,correlation()),{code:'ACTION_FORBIDDEN'});
   await assert.rejects(s.service.redrive(user.token,id,s.query,correlation(),{expected_version:1,reason_code:'dependency_repaired'},correlation()),{code:'ACTION_FORBIDDEN'});
  }
 }
 assert.equal((await s.list({},s.admin.token)).items[0]!.id,id);
 for(const role of ['accountant','read_only','delivery_agent']) {
  const user=await s.grant(role,[A]);await assert.rejects(s.list({},user.token),{code:'ACTION_FORBIDDEN'});
  const response=await s.request('history/messages/'+id,undefined,user.token);assert.equal(response.statusCode,403);
 }
 for(const[token,franchise,organization]of[[s.sibling.token,B,org],[s.foreign.token,C,otherOrg]]) {
  const query={organization_id:organization,franchise_id:franchise};
  assert.deepEqual(await s.history.list(token!,'messages',query,correlation()),{items:[],page:{has_more:false,next_cursor:null}});
  for(const ref of [id,randomUUID()])await assert.rejects(s.history.detail(token!,'messages',ref,query,correlation()),{code:'RESOURCE_NOT_FOUND'});
  assert.deepEqual((await s.history.list(token!,'messages',{...query,source_id:s.source},correlation())).items,[]);
 }
});
await test('history server eligibility shares W44 rules, exact replay and original identity across new attempts',{timeout:30000},async t=>{
 const s=await setup(t),{id}=await s.enqueue();s.setSend(async()=>({kind:'configuration_failure',reason:'private-provider-error'}));await s.worker.tick();
 const failed=await s.read(id);assert.equal(failed.message!.state,'failed');assert.equal(failed.recovery.kind,'redrive');
 const operator=await s.grant('operator',[A]);assert.equal((await s.read(id,operator.token)).recovery.kind,'none');assert.equal((await s.read(id,s.admin.token)).recovery.kind,'none');
 const key=correlation(),body={expected_version:failed.recovery.expected_version,reason_code:failed.recovery.allowed_reasons[0]};
 const first=await s.service.redrive(s.local.token,id,s.query,key,body,correlation());
 assert.deepEqual(await s.service.redrive(s.local.token,id,s.query,key,body,correlation()),first);
 await assert.rejects(s.service.redrive(s.local.token,id,s.query,key,{...body,reason_code:'retry_uncertain_confirmed'},correlation()),{code:'IDEMPOTENCY_CONFLICT'});
 s.setSend(async()=>({kind:'uncertain',reason:'acceptance_unknown'}));await s.worker.tick();
 const uncertain=await s.read(id);assert.equal(uncertain.message!.state,'uncertain');assert.equal(uncertain.recovery.kind,'investigate_uncertain');assert.equal(uncertain.attempts.length,2);
 assert.deepEqual((await s.list()).items.map(row=>row.id),[id]);
 await assert.rejects(s.service.redrive(s.local.token,id,s.query,correlation(),{expected_version:uncertain.message!.version,reason_code:'dependency_repaired'},correlation()),{code:'VERSION_CONFLICT'});
 await s.service.redrive(s.local.token,id,s.query,correlation(),{expected_version:uncertain.message!.version,reason_code:'retry_uncertain_confirmed'},correlation());
 s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.recovered44'}));await s.worker.tick();
 const accepted=await s.read(id);assert.equal(accepted.recovery.kind,'none');assert.deepEqual(accepted.attempts.map(a=>a.attempt),[3,2,1]);
});
await test('history expiry, suppression, consent disclosure and bounded attempt detail remain content-free',{timeout:30000},async t=>{
 const s=await setup(t),{id}=await s.enqueue();s.setSend(async()=>({kind:'uncertain',reason:'unknown'}));await s.worker.tick();
 const disclosure=await s.enqueue({...s.input,purpose:'consent_disclosure',text:undefined});
 assert.equal((await s.read(disclosure.id)).notification_kind,'consent_disclosure');
 await s.receive('STOP');await s.worker.tick();assert.equal((await s.read(disclosure.id)).message!.state,'suppressed');
 s.advance(86400001);assert.equal((await s.read(id)).recovery.kind,'none');await s.worker.tick();assert.equal((await s.read(id)).recovery.kind,'none');
 // Synthetic immutable attempt volume; migration identity only, no runtime write bypass.
 await s.db.adminQuery(`INSERT INTO shipit.whatsapp_outbound_attempts(id,organization_id,franchise_id,intent_id,installation_id,attempt,outcome,reason_code)
 SELECT gen_random_uuid(),$1,$2,$3,$4,n,'uncertain','synthetic' FROM generate_series(2,102) n`,[org,A,id,s.installation]);
 const detail=await s.read(id);assert.equal(detail.attempts.length,100);assert.equal(detail.history_truncated,true);assert.equal(detail.attempts[0]!.attempt,102);assert.equal(detail.attempts.at(-1)!.attempt,3);
});
await test('history microsecond time/id pages are stable and cursors bind actor, filters, scope, limit and membership',{timeout:30000},async t=>{
 const s=await setup(t);const ids:string[]=[];
 for(let i=0;i<5;i++){const source=await s.receive('Synthetic '+i);ids.push((await s.enqueue({...s.input,source_id:source})).id);}
 // Exercise equal timestamps and sub-millisecond facts without changing runtime ownership.
 await s.db.adminQuery('ALTER TABLE shipit.whatsapp_outbound DISABLE TRIGGER USER');
 await s.db.adminQuery("UPDATE shipit.whatsapp_outbound SET created_at='2026-09-29T10:00:00.123456Z'");
 await s.db.adminQuery('ALTER TABLE shipit.whatsapp_outbound ENABLE TRIGGER USER');
 // Add genuine sibling and unrelated-Organization records before paging the local feed.
 const foreignIds:string[]=[];
 for(const [token,organization,franchise,binding] of [[s.sibling.token,org,B,'beta_v1'],[s.foreign.token,otherOrg,C,'gamma_v1']]) {
  const installed=await s.request('installations',{binding_key:binding,expected_version:0},token,franchise,organization);assert.equal(installed.statusCode,200,installed.body);
  const installation=installed.json().id,customer=randomUUID(),source=randomUUID();
  const contact=(await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display)
   VALUES($1,$2,$3,'Foreign synthetic','+15550000004','+15550000004') RETURNING contact_version`,[customer,organization,franchise])).rows[0]!.contact_version;
  await s.db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id,state,processed_at)
   VALUES($1,$2,$3,$4,$5,$6,'inbound',$7,clock_timestamp(),$8,'test-v1',$9,'completed',clock_timestamp())`,[source,organization,franchise,installation,'synthetic:'+source,'b'.repeat(64),'wamid.'+source,'A'.repeat(38),randomUUID()]);
  const rows=await s.db.adminQuery(`INSERT INTO shipit.whatsapp_outbound(id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,
   source_id,affected_entity_id,source_kind,purpose,fingerprint,key_version,expires_at,state,reason_code,created_at,correlation_id)
   SELECT gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,gen_random_uuid(),'inbox','requested_assistance',$6,'test-v1',clock_timestamp()+interval '1 day','suppressed','synthetic',clock_timestamp(),$8
   FROM generate_series(1,50) RETURNING id`,[organization,franchise,installation,customer,contact,'a'.repeat(64),source,randomUUID()]);
  foreignIds.push(rows.rows[0]!.id);
  await s.db.adminQuery(`INSERT INTO shipit.whatsapp_outbound_attempts(id,organization_id,franchise_id,intent_id,installation_id,attempt,outcome,reason_code,provider_message_id)
   VALUES(gen_random_uuid(),$1,$2,$3,$4,1,'accepted','provider_accepted','wamid.foreign-attempt')`,[organization,franchise,rows.rows[0]!.id,installation]);
  assert.equal((await s.read(ids[0]!)).attempts.length,0);

  assert.deepEqual((await s.list({source_id:source})).items,[]);
 }
 for(const foreignId of foreignIds)await assert.rejects(s.read(foreignId),{code:'RESOURCE_NOT_FOUND'});
 const one=await s.list({limit:'2'});assert.equal(one.page.has_more,true);assert.equal(one.items[0]!.effective_time,'2026-09-29T10:00:00.123456Z');
 const two=await s.list({limit:'2',cursor:one.page.next_cursor!}),three=await s.list({limit:'2',cursor:two.page.next_cursor!});
 assert.deepEqual([...one.items,...two.items,...three.items].map(x=>x.id),ids.sort().reverse());assert.equal(three.page.has_more,false);
 for(const change of [{status:'queued'},{kind:'requested_assistance'},{limit:'3'},{correlation_id:randomUUID()},{source_id:randomUUID()}])await assert.rejects(s.list({...change,limit:change.limit??'2',cursor:one.page.next_cursor!}),{code:'CURSOR_INVALID'});
 await assert.rejects(s.list({limit:'2',cursor:one.page.next_cursor!},s.admin.token),{code:'CURSOR_INVALID'});
 await assert.rejects(s.history.list(s.sibling.token,'messages',{organization_id:org,franchise_id:B,limit:'2',cursor:one.page.next_cursor!},correlation()),{code:'CURSOR_INVALID'});
 await s.db.adminQuery('UPDATE shipit.memberships SET version=version+1 WHERE user_id=$1',[s.local.id]);
 await assert.rejects(s.list({limit:'2',cursor:one.page.next_cursor!}),{code:'CURSOR_INVALID'});
});

await test('history representative 10000-intent query plan uses tenant indexes with bounded output and SQL count',{timeout:60000},async t=>{
 const s=await setup(t),{id}=await s.enqueue();
 await s.db.adminQuery(`INSERT INTO shipit.whatsapp_outbound(id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,
 source_id,affected_entity_id,source_kind,purpose,fingerprint,key_version,expires_at,state,reason_code,created_at,correlation_id)
 SELECT gen_random_uuid(),organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,
 source_id,gen_random_uuid(),source_kind,purpose,fingerprint,key_version,expires_at,'suppressed','synthetic',created_at-n*interval '1 second',correlation_id
 FROM shipit.whatsapp_outbound CROSS JOIN generate_series(1,10000) n WHERE id=$1`,[id]);
 await s.db.adminQuery(`INSERT INTO shipit.whatsapp_outbound_attempts(id,organization_id,franchise_id,intent_id,installation_id,attempt,outcome,reason_code,provider_message_id)
 SELECT gen_random_uuid(),organization_id,franchise_id,id,installation_id,n,'accepted','provider_accepted','wamid.'||replace(id::text,'-','')||'_'||n
 FROM shipit.whatsapp_outbound CROSS JOIN generate_series(1,3) n`);
 await s.db.adminQuery(`INSERT INTO shipit.whatsapp_delivery_observations(organization_id,franchise_id,installation_id,message_id,progress,failure_observed,last_event_at)
 SELECT organization_id,franchise_id,installation_id,provider_message_id,1,false,recorded_at FROM shipit.whatsapp_outbound_attempts`);
 await s.db.adminQuery('ANALYZE shipit.whatsapp_outbound');await s.db.adminQuery('ANALYZE shipit.whatsapp_outbound_attempts');await s.db.adminQuery('ANALYZE shipit.whatsapp_delivery_observations');
 const plans:Record<string,unknown>[]=[];let historyQueries=0;
 const pool={...s.pool,async connect(){const c=await s.pool.connect();return {release:(discard?:boolean)=>c.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
  if(sql.includes('WITH candidates')) {historyQueries++;const result=await c.query<Record<string,unknown>>('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params);plans.push((result.rows[0]!['QUERY PLAN'] as Record<string,unknown>[])[0]!);}
  return c.query<Row>(sql,params);
 }};}};
 const service=createHistoryService(pool,s.keys.browser),first=await service.list(s.local.token,'messages',{...s.query,limit:'25'},correlation());
 assert.equal(first.items.length,25);assert.equal(historyQueries,1);
 await service.list(s.local.token,'messages',{...s.query,limit:'25',cursor:first.page.next_cursor!},correlation());
 assert.equal(historyQueries,2);const serialized=JSON.stringify(plans);assert.ok(serialized.includes('whatsapp_outbound_history'),'Tenant/time outbound index used');assert.ok(/whatsapp_outbound_attempt_history|whatsapp_outbound_attempts_intent_id_attempt_key/.test(serialized),'Intent attempt index used');
 for(const plan of plans)t.diagnostic('History EXPLAIN execution ms: '+plan['Execution Time']);
});
