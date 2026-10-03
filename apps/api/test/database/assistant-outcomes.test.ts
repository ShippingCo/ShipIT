import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { conversationSetup } from '../conversation-support.ts';
import { org,A,B,otherOrg,C,auditSetup } from '../audit-support.ts';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { MODEL,PROMPT_VERSION,REASONING_EFFORT } from '../../src/modules/conversations/interpreter.ts';
import { withWhatsappScope } from '../../src/modules/memberships/service.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { metricRows,createAssistantMetrics,publicMetrics } from '../../src/modules/conversations/metrics.ts';
import { createConversationWorker } from '../../src/modules/conversations/worker.ts';
import { createSupportService } from '../../src/modules/support/service.ts';
import { assistantEvaluation,injectionEvaluation } from '../assistant-evaluation.ts';

const options={timeout:60000};
const evidence=async(s:Awaited<ReturnType<typeof conversationSetup>>,id:string)=>(await s.db.adminQuery('SELECT metric_category,metric_reason,metric_latency_ms,metric_locale FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[id])).rows[0]!;
const counts=async(s:Awaited<ReturnType<typeof conversationSetup>>,from=new Date(Date.now()-86400000),to=new Date(Date.now()+86400000))=>withWhatsappScope(s.pool,s.admin.token,org,A,'support.read',randomUUID(),scope=>metricRows(scope,from,to));

await test('#52 bilingual persisted tool outcomes, duplicate webhook, concurrent worker and restart',options,async t=>{
 const s=await conversationSetup(t);await s.db.prepareSupport();await s.db.prepareCustomerQuotes();await s.db.preparePickups();
 s.whatsapp.configuration={...s.whatsapp.configuration,customer_quotes_enabled:true,pickup_enabled:true};
 const expected:Record<string,string>={tracking:'success',eta:'failure',delay:'failure',charges:'success',receipt:'failure',resend:'failure',quote:'clarification',pickup:'failure',resume:'control',stop:'consent',start:'consent',clarify:'failure'};
 for(const row of assistantEvaluation.filter(r=>!['human','stop','start'].includes(r.intent)))for(const language of ['en','hi'] as const){
  // Explicit preference and RESUME clear guided drafts between independent needs.
  await s.message('RESUME');await s.worker.tick();await s.message(language==='hi'?'LANGUAGE HI':'LANGUAGE EN');await s.worker.tick();
  const id=await s.message(row[language]);await s.worker.tick();const saved=await evidence(s,id);
  assert.equal(saved.metric_category,expected[row.intent],`${language}: ${row.intent}`);assert.equal(saved.metric_locale,language);
  if(['eta','delay','receipt'].includes(row.intent))assert.equal(saved.metric_reason,'missing_data');
  assert.ok(Number(saved.metric_latency_ms)>=0);
 }
 await s.message('START');await s.worker.tick();
 const source='wamid.'+randomUUID(),id=await s.message('tracking',s.phone,source);
 const fresh=s.db.runtimePool();t.after(()=>fresh.close());const restarted=createConversationWorker(fresh,s.whatsapp,s.keys.browser);
 await Promise.all([s.worker.tick(),restarted.tick()]);const before=await counts(s);
 await s.message('tracking',s.phone,source);assert.equal(await restarted.tick(),null);assert.deepEqual(await counts(s),before);
 assert.equal((await evidence(s,id)).metric_category,'success');
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query("UPDATE shipit.customer_conversation_turns SET metric_category='success' WHERE inbox_id=$1",[id]),{sqlState:'23514'});
 for(const text of ['thanks','धन्यवाद']){const thanks=await s.message(text);await s.worker.tick();assert.equal((await evidence(s,thanks)).metric_category,'thanks');}
 for(const text of injectionEvaluation){const injected=await s.message(text);await s.worker.tick();assert.notEqual((await evidence(s,injected)).metric_category,'success');}
 for(const text of ['STOP','संदेश बंद करो','START','संदेश चालू करो']){const consent=await s.message(text);await s.worker.tick();assert.equal((await evidence(s,consent)).metric_category,'consent');}
 const raw=(await s.db.adminQuery('SELECT metric_category,count(*)::text events FROM shipit.customer_conversation_turns GROUP BY metric_category')).rows;
 for(const row of raw)assert.equal((await counts(s)).find(r=>r.category===row.metric_category)?.events,row.events);
 assert.equal(publicMetrics(await counts(s)).find(r=>r.category==='success')?.events,null);
 const safe=JSON.stringify([await counts(s),s.logs]);for(const marker of [s.phone,s.parcel.docket,'LLM_API_KEY','sealed_payload'])assert.equal(safe.includes(marker),false);
});

await test('#52 handoff and reopen use source events; provider failure is a separate nonresolution',options,async t=>{
 const s=await conversationSetup(t);await s.db.prepareSupport();s.whatsapp.configuration={...s.whatsapp.configuration,support_enabled:true};
 const service=createSupportService(s.pool,s.whatsapp);
 const first=await s.message('HUMAN');await s.worker.tick();const c=(await service.list(s.admin.token,s.q,randomUUID())).items[0]!;
 assert.equal((await evidence(s,first)).metric_category,'handoff');
 await s.message('कर्मचारी से बात');await s.worker.tick();assert.equal((await counts(s)).find(r=>r.category==='case_opened')?.events,'1');
 const command=(body:unknown)=>service.command(s.admin.token,c.id,s.q,randomUUID(),body,randomUUID());
 await command({action:'claim',expected_version:1});await command({action:'resolve',expected_version:2,reason:'answered'});
 await command({action:'reopen',expected_version:3,reason:'needs_followup'});
 const rows=await counts(s);assert.equal(rows.find(r=>r.category==='case_resolved')?.events,'1');assert.equal(rows.find(r=>r.category==='case_reopened')?.events,'1');
 assert.equal((await service.detail(s.admin.token,c.id,s.q,randomUUID())).history[0]!.action,'reopened');
 await command({action:'claim',expected_version:4});await command({action:'resolve',expected_version:5,reason:'answered'});
 s.setOutcome({kind:'permanent_failure',reason:'provider_rejected'});
 const tracked=await s.message('tracking');await s.worker.tick();for(let i=0;i<10;i++)if(await s.outbound.tick()===null)break;
 assert.equal((await evidence(s,tracked)).metric_category,'success'); // Tool result, never delivery or calls saved.
 assert.ok(Number((await counts(s)).find(r=>r.category==='reply_failed')?.events)>0);
});

await test('#52 metrics authorize scope before counts, reject filters and isolate foreign valid conversation IDs',options,async t=>{
 const s=await conversationSetup(t);await s.db.prepareSupport();
 const readOnly=await s.grant('read_only',[A]),sibling=await s.grant('operator',[B]);
 const from=new Date();from.setUTCHours(0,0,0,0);from.setUTCDate(from.getUTCDate()-((from.getUTCDay()+6)%7)-7);
 const week=from.toISOString().slice(0,10),query={...s.q,week},read=createAssistantMetrics(s.pool);
 const call=(token:string,q:Record<string,string>)=>s.app.inject({method:'GET',url:'/api/v1/assistant/metrics?'+new URLSearchParams(q),cookies:{shipit_session:token}});
 assert.equal((await call(readOnly.token,query)).statusCode,403);
 for(const q of [{...query,franchise_id:B},{...query,organization_id:otherOrg,franchise_id:C}])assert.equal((await call(s.admin.token,q)).statusCode,404);
 assert.equal((await call(sibling.token,query)).statusCode,404);
 assert.equal((await call(s.admin.token,{...query,conversation_id:randomUUID()})).statusCode,422);
 const ok=await call(s.admin.token,query);assert.equal(ok.statusCode,200,ok.body);assert.deepEqual(ok.json(),await read(s.admin.token,query,randomUUID()));
 const a=(await s.db.adminQuery('SELECT id FROM shipit.customer_conversations')).rows[0]!.id;
 for(const [organization,franchise] of [[org,B],[otherOrg,C]])await withTransaction(s.pool,async tx=>{
  const scope=issueTenantAccess(tx,{action:'support.read',actor:{type:'user',id:s.admin.id},organizationId:organization!,permittedFranchiseIds:[franchise!],organizationWide:false,correlationId:randomUUID(),provenance:'membership'});
  assert.deepEqual(await metricRows(scope,new Date(0),new Date(Date.now()+1000)),[]);
 });
 assert.equal(ok.body.includes(String(a)),false);assert.equal(ok.body.includes(s.phone),false);
});

await test('#52 abandoned clarification is a stable expiry event; legacy evidence and small cohorts are excluded',options,async t=>{
 const s=await conversationSetup(t);await s.db.prepareSupport();const anchor=new Date(Date.now()-3*86400000);
 const original=(await s.db.adminQuery('SELECT * FROM shipit.customer_conversation_turns LIMIT 1')).rows[0]!;
 async function historical(minutes:number,category:string){
  const id=await s.message('synthetic fixture');
  await s.db.adminQuery(`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,conversation_id,contact_key,intent,outcome,correlation_id,recorded_at,metric_category)
   VALUES($1,$2,$3,$4,$5,$6,'quote','selection_required',$7,$8,$9)`,[id,org,A,original.installation_id,original.conversation_id,original.contact_key,randomUUID(),new Date(anchor.getTime()+minutes*60000),category]);
  return id;
 }
 await historical(0,'clarification');await historical(10,'clarification');const legacy=await historical(30,'unmeasured');
 await s.db.adminQuery(`INSERT INTO shipit.conversation_inferences(inbox_id,organization_id,franchise_id,model,prompt_version,reasoning_effort,state,expires_at,reserved_micro_usd,correlation_id)
  VALUES($1,$2,$3,$4,$5,$6,'reserved',clock_timestamp()+interval '15 seconds',10000,$7)`,[legacy,org,A,MODEL,PROMPT_VERSION,REASONING_EFFORT,randomUUID()]);
 const rows=await counts(s,anchor,new Date(anchor.getTime()+86400000));
 assert.equal(rows.find(r=>r.category==='abandonment')?.events,'1');assert.equal(rows.find(r=>r.category==='unmeasured')?.events,'1');
 assert.equal(rows.find(r=>r.category==='success'),undefined);
 assert.equal(rows.find(r=>r.category==='interpretation_pending')?.events,'1');assert.equal(rows.find(r=>r.category==='interpretation_provider_failed'),undefined);
 const restarted=s.db.runtimePool();t.after(()=>restarted.close());
 assert.deepEqual(await withWhatsappScope(restarted,s.admin.token,org,A,'support.read',randomUUID(),scope=>metricRows(scope,anchor,new Date(anchor.getTime()+86400000))),rows);
 const id=await s.message('tracking');await s.worker.tick();assert.equal((await evidence(s,id)).metric_category,'success');
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query(`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,intent,outcome,correlation_id,metric_category) VALUES($1,$2,$3,$4,'tracking','answered',$5,'raw sensitive text')`,[randomUUID(),org,A,original.installation_id,randomUUID()]),{sqlState:'23514'});
});

await test('#52 populated migration preserves historical turns as unmeasured and old writers remain compatible',options,async t=>{
 const db=await provisionDatabase(t);await db.migrate({count:35});const migrate=db.migrate;db.migrate=async()=>({applied:0});
 const s=await auditSetup(t,undefined,db);await db.prepareConversations();
 const admin=await s.grant('franchise_admin',[A]),binding={key:'upgrade52',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:upgrade52/v1'};
 await createWhatsappService(s.pool,{configuration:{graph_version:'v24.0',bindings:[binding]},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable',reason:'unused'})}}).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 const id=randomUUID();await db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id)
  SELECT $1,organization_id,franchise_id,id,'synthetic52',$2,'inbound','wamid.synthetic52',clock_timestamp(),$3,'test',$4 FROM shipit.whatsapp_installations`,[id,'a'.repeat(64),'a'.repeat(40),randomUUID()]);
 await db.adminQuery(`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,intent,outcome,correlation_id)
  SELECT id,organization_id,franchise_id,installation_id,'tracking','answered',correlation_id FROM shipit.whatsapp_inbox WHERE id=$1`,[id]);
 const before=(await db.adminQuery('SELECT inbox_id,intent,outcome,recorded_at FROM shipit.customer_conversation_turns')).rows;
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:5});assert.deepEqual(await db.migrate(),{applied:0});
 assert.deepEqual((await db.adminQuery('SELECT inbox_id,intent,outcome,recorded_at FROM shipit.customer_conversation_turns')).rows,before);
 assert.deepEqual((await db.adminQuery('SELECT metric_category,metric_reason,metric_latency_ms,metric_locale FROM shipit.customer_conversation_turns')).rows[0],{metric_category:'unmeasured',metric_reason:'none',metric_latency_ms:null,metric_locale:null});
});

await test('#52 authorized weekly API reconciles a five-conversation fixture without revealing references',options,async t=>{
 const s=await conversationSetup(t);await s.db.prepareSupport();
 const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7)-7);
 for(let i=0;i<5;i++){
  const phone=`+1202555020${i}`,source=await s.message('tracking',phone);await s.worker.tick();
  const id=await s.message('historical fixture',phone);
  await s.db.adminQuery(`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,conversation_id,contact_key,intent,outcome,correlation_id,recorded_at,metric_category,metric_reason,metric_latency_ms,metric_locale)
   SELECT $1,organization_id,franchise_id,installation_id,conversation_id,contact_key,intent,outcome,$2,$3,metric_category,metric_reason,10,metric_locale FROM shipit.customer_conversation_turns WHERE inbox_id=$4`,[id,randomUUID(),monday,source]);
 }
 const q={...s.q,week:monday.toISOString().slice(0,10)},result=await createAssistantMetrics(s.pool)(s.admin.token,q,randomUUID());
 assert.equal(result.items.find(r=>r.category==='failure')?.events,5);assert.equal(result.items.find(r=>r.category==='failure_missing_data')?.events,5);
 assert.equal(result.items.find(r=>r.category==='success')?.events,0);
 const pool=s.db.runtimePool();t.after(()=>pool.close());assert.deepEqual(await createAssistantMetrics(pool)(s.admin.token,q,randomUUID()),result);
 const raw=JSON.stringify(result);for(const marker of ['+120255502','conversation_id','contact_key','inbox_id','docket','transcript'])assert.equal(raw.includes(marker),false);
});
