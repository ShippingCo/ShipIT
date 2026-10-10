import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditSetup,org,A,B,C,otherOrg} from '../audit-support.ts';
import {withMessagingReportScope} from '../../src/modules/memberships/service.ts';
import {scopedQuery} from '../../src/modules/security/scope.ts';

await test('R27 restricts report counts to current own-franchise administrators before projection',{timeout:60000},async t=>{
  const s=await auditSetup(t);let projections=0;
  const read=(token:string,organization=org,franchise=A)=>withMessagingReportScope(s.pool,token,organization,franchise,randomUUID(),async scope=>{
    projections++;
    return (await scopedQuery<{n:number}>(scope,['reports.capture'],'SELECT count(*)::int n FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}')).rows[0]!.n;
  });
  assert.equal(await read(s.admin.token),1);assert.equal(await read(s.admin.token,org,B),1);
  const local=await s.grant('franchise_admin',[A]);assert.equal(await read(local.token),1);
  for(const role of ['operator','dispatcher','read_only','delivery_agent','accountant']){
    const actor=await s.grant(role,[A]),before=projections;
    await assert.rejects(read(actor.token),{code:'ACTION_FORBIDDEN'});assert.equal(projections,before);
  }
  for(const [organization,franchise] of [[org,B],[otherOrg,C]]){
    const before=projections;await assert.rejects(read(local.token,organization!,franchise!),{code:'RESOURCE_NOT_FOUND'});assert.equal(projections,before);
  }
  await assert.rejects(read(s.admin.token,otherOrg,C),{code:'RESOURCE_NOT_FOUND'});
  const before=projections;await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[local.id]);
  await assert.rejects(read(local.token),{code:'RESOURCE_NOT_FOUND'});assert.equal(projections,before);
  await assert.rejects(read('invalid-session'),{code:'UNAUTHENTICATED'});
});

await test('effectiveness API saves only public cells, restarts, retries and denies foreign snapshot counts',{timeout:60000},async t=>{
  const {paymentSetup}=await import('../payment-support.ts');const {createEffectivenessService}=await import('../../src/modules/reports/effectiveness-service.ts');
  const s=await paymentSetup(t);await s.db.prepareReports();await s.db.prepareSupport();
  const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7)-7);
  const filter={week:monday.toISOString().slice(0,10)},q={organization_id:org,franchise_id:A},key=randomUUID();
  const service=createEffectivenessService(s.pool),saved=await service.create(s.local.token,q,key,['idempotency-key',key],filter,randomUUID());
  assert.ok(saved.items.length>40);assert.ok(saved.items.every(r=>r.count===0));assert.equal(saved.snapshot.staffing.state,'unavailable');
  const fresh=s.db.runtimePool();t.after(()=>fresh.close());assert.deepEqual(await createEffectivenessService(fresh).read(s.local.token,saved.snapshot.id,q,randomUUID()),saved);
  assert.deepEqual(await service.create(s.local.token,q,key,['idempotency-key',key],filter,randomUUID()),saved);
  const response=await s.app.inject({method:'GET',url:'/api/v1/reports/effectiveness/'+saved.snapshot.id+'?'+new URLSearchParams(q),cookies:s.cookies(s.local.token)});
  assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json(),saved);assert.equal(response.headers['cache-control'],'no-store');
  const selected=await service.read(s.local.token,saved.snapshot.id,{...q,section:'messaging',category:'delivered'},randomUUID());assert.equal(selected.items.length,1);assert.equal(selected.items[0]!.category,'delivered');
  for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]){
    await assert.rejects(service.read(s.local.token,saved.snapshot.id,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
    await assert.rejects(service.read(s.local.token,randomUUID(),query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  }
  const other=await s.grant('franchise_admin',[A]);await assert.rejects(service.read(other.token,saved.snapshot.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(service.read(s.local.token,saved.snapshot.id,{...q,conversation_id:randomUUID()},randomUUID()),{code:'VALIDATION_FAILED'});
  const raw=JSON.stringify([response.json(),s.logs]);for(const marker of ['contact_key','conversation_id','provider_message_id','sealed_payload','phone_normalized','transcript','plaintext'])assert.equal(raw.includes(marker),false);
});

await test('effectiveness rejects arbitrary periods and rolls back failed/concurrent capture without duplicate snapshots',{timeout:60000},async t=>{
  const {paymentSetup,paymentFault}=await import('../payment-support.ts');const {createEffectivenessService}=await import('../../src/modules/reports/effectiveness-service.ts');
  const s=await paymentSetup(t);await s.db.prepareReports();await s.db.prepareSupport();
  const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7)-7);
  const body={week:monday.toISOString().slice(0,10)},q={organization_id:org,franchise_id:A},service=createEffectivenessService(s.pool),key=randomUUID();
  await assert.rejects(createEffectivenessService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before')).create(s.local.token,q,key,['idempotency-key',key],body,randomUUID()));
  const counts=(await s.db.adminQuery('SELECT (SELECT count(*)::int FROM shipit.report_snapshots) snapshots,(SELECT count(*)::int FROM shipit.report_access_events) audits')).rows[0];assert.deepEqual(counts,{snapshots:0,audits:0});
  const create=()=>service.create(s.local.token,q,key,['idempotency-key',key],body,randomUUID());const [a,b]=await Promise.all([create(),create()]);assert.deepEqual(a,b);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
  for(const invalid of [{week:'2026-02-30'},{week:new Date().toISOString().slice(0,10)},{...body,customer_id:randomUUID()},{...body,from_day:body.week}])await assert.rejects(service.create(s.local.token,q,randomUUID(),[],invalid,randomUUID()),{code:'VALIDATION_FAILED'});
});

await test('logical message evidence deduplicates retries/callbacks and preserves confirmed delivery over observed failure',{timeout:60000},async t=>{
  const {outboundSetup}=await import('../outbound-support.ts');const {captureEffectiveness}=await import('../../src/modules/reports/effectiveness-repository.ts');const {messagingCells}=await import('../../src/modules/reports/effectiveness-rules.ts');
  const s=await outboundSetup(t);await s.db.prepareSupport();const {id}=await s.enqueue();
  s.setSend(async()=>({kind:'retryable_not_accepted',reason:'rate_limited'}));await s.worker.tick();s.advance(60000);
  s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.effectiveness65'}));await s.worker.tick();
  await s.status('wamid.effectiveness65','delivered');await s.status('wamid.effectiveness65','delivered');await s.status('wamid.effectiveness65','failed');await s.status('wamid.effectiveness65','read');await s.status('wamid.effectiveness65','sent');
  const source=await withMessagingReportScope(s.pool,s.local.token,org,A,randomUUID(),scope=>captureEffectiveness(scope,new Date(Date.now()-86400000),new Date(Date.now()+86400000),undefined));
  const n=(key:string)=>source.messaging.find(r=>r.category===key)?.n??0;
  assert.equal(n('logical_intents'),1);assert.equal(n('recorded_send_attempts'),2);assert.equal(n('known_customers'),1);assert.equal(n('confirmed_customers'),1);assert.equal(n('read'),1);assert.equal(n('delivered'),0);assert.equal(n('provider_failed'),0);assert.equal(n('provider_failure_observed'),1);assert.equal(n('delivery_unknown'),0);
  // The report already sees callbacks before the owning outbound worker reconciles its state.
  await s.worker.tick();assert.equal((await s.detail(id)).message.state,'read');assert.equal(s.calls(),2);
  const publicRows=messagingCells(source.messaging);assert.equal(publicRows.find(r=>r.category==='read')?.count,null);assert.equal(publicRows.find(r=>r.category==='logical_intents')?.count,null);
});


await test('populated weekly snapshots separate thanks from tool failures and project DST/reopen business hours',{timeout:60000},async t=>{
  const {conversationSetup}=await import('../conversation-support.ts');
  const {captureEffectiveness}=await import('../../src/modules/reports/effectiveness-repository.ts');
  const {createEffectivenessService}=await import('../../src/modules/reports/effectiveness-service.ts');
  const s=await conversationSetup(t);await s.db.prepareSupport();await s.db.prepareReports();
  const monday=new Date();monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7)-7);
  const cases:string[]=[];
  // Historical fixture rows copy outcomes produced by the real conversation worker.
  // New inserts preserve released append-only constraints; no trigger is disabled.
  for(let i=0;i<5;i++){
    const phone=`+1202555030${i}`;let historicalThanks='' ;
    for(const text of ['tracking','thanks']){
      const source=await s.message(text,phone);await s.worker.tick();const target=await s.message('historical fixture',phone);if(text==='thanks')historicalThanks=target;
      await s.db.adminQuery(`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,conversation_id,contact_key,intent,outcome,correlation_id,recorded_at,metric_category,metric_reason,metric_latency_ms,metric_locale)
        SELECT $1,organization_id,franchise_id,installation_id,conversation_id,contact_key,intent,outcome,$2,$3,metric_category,metric_reason,10,metric_locale FROM shipit.customer_conversation_turns WHERE inbox_id=$4`,[target,randomUUID(),monday,source]);
    }
    const id=randomUUID();cases.push(id);
    await s.db.adminQuery(`INSERT INTO shipit.support_cases(id,organization_id,franchise_id,conversation_id,installation_id,contact_key,inbox_id,reason,created_at)
      SELECT $1,organization_id,franchise_id,conversation_id,installation_id,contact_key,inbox_id,'human_requested','2026-03-08T06:00:00Z'
      FROM shipit.customer_conversation_turns WHERE inbox_id=$2`,[id,historicalThanks]);
    await s.db.adminQuery(`INSERT INTO shipit.support_events(id,organization_id,franchise_id,case_id,event_type,reason,version,actor_type,actor_id,correlation_id,occurred_at)
      VALUES($1,$2,$3,$4,'opened','human_requested',1,'service','fixture65',$5,'2026-03-08T06:00:00Z')`,[randomUUID(),org,A,id,randomUUID()]);
  }
  const read=(hours:import('../../src/modules/support/rules.ts').SupportHours)=>withMessagingReportScope(s.pool,s.admin.token,org,A,randomUUID(),scope=>captureEffectiveness(scope,monday,new Date(monday.getTime()+7*86400000),hours));
  const ny={franchise_id:A,timezone:'America/New_York',weekdays:[0],start_minute:60,end_minute:240,staffed:true};
  const spring=await read(ny);
  // Independent Intl projection counts elapsed UTC hours, including DST's skipped
  // or repeated local hour. This test also handles a partially elapsed Sunday.
  const local=new Intl.DateTimeFormat('en-US',{timeZone:ny.timezone,weekday:'short',hour:'numeric',hourCycle:'h23'});
  let expected=0;
  for(let instant=new Date('2026-03-08T06:00:00Z');instant<spring.as_of;instant=new Date(instant.getTime()+3600000)){
    const parts=local.formatToParts(instant),day=parts.find(p=>p.type==='weekday')!.value,hour=Number(parts.find(p=>p.type==='hour')!.value);
    if(day==='Sun'&&hour>=1&&hour<4)expected+=Math.min(3600000,spring.as_of.getTime()-instant.getTime())/60000;
  }
  assert.equal(spring.queue.find(r=>r.category==='all_active')?.business_minutes,expected);
  const reopened=new Date(monday.getTime()+12*3600000);
  for(const id of cases){
    for(const [state,version,assigned] of [['claimed',2,s.admin.id],['resolved',3,s.admin.id],['open',4,null]] as const)await s.db.adminQuery('UPDATE shipit.support_cases SET state=$2,version=$3,assigned_staff_id=$4,updated_at=clock_timestamp() WHERE id=$1',[id,state,version,assigned]);
    for(const [event,version] of [['claimed',2],['resolved',3],['reopened',4]] as const)await s.db.adminQuery(`INSERT INTO shipit.support_events(id,organization_id,franchise_id,case_id,event_type,reason,version,actor_type,actor_id,correlation_id,occurred_at) VALUES($1,$2,$3,$4,$5,'answered',$6,'user',$7,$8,$9)`,[randomUUID(),org,A,id,event,version,s.admin.id,randomUUID(),reopened]);
    await s.db.adminQuery(`INSERT INTO shipit.support_events(id,organization_id,franchise_id,case_id,event_type,reason,version,actor_type,actor_id,correlation_id) VALUES($1,$2,$3,$4,'noted','operational_review',5,'user',$5,$6)`,[randomUUID(),org,A,id,s.admin.id,randomUUID()]);
  }
  const hours={franchise_id:A,timezone:'Asia/Kolkata',weekdays:[1,2,3,4,5],start_minute:540,end_minute:1080,staffed:true};
  const source=await read(hours);let minutes=0;
  for(let day=new Date(monday);day<source.as_of;day=new Date(day.getTime()+86400000))if([1,2,3,4,5].includes(day.getUTCDay())){
    const start=day.getTime()+3.5*3600000,end=day.getTime()+12.5*3600000;
    minutes+=Math.max(0,Math.min(source.as_of.getTime(),end)-Math.max(reopened.getTime(),start))/60000;
  }
  assert.equal(source.queue.find(r=>r.category==='all_active')?.business_minutes,minutes);
  assert.equal((await read({...hours,staffed:false})).queue.find(r=>r.category==='age_unknown')?.n,5);
  const service=createEffectivenessService(s.pool,[hours]),query={organization_id:org,franchise_id:A},key=randomUUID();
  const saved=await service.create(s.admin.token,query,key,['idempotency-key',key],{week:monday.toISOString().slice(0,10)},randomUUID());
  const cell=(section:string,category:string)=>saved.items.find(r=>r.section===section&&r.category===category)!;
  assert.equal(cell('assistant','failure').count,5);assert.equal(cell('assistant','thanks').count,5);assert.equal(cell('assistant','success').count,0);
  assert.equal(cell('assistant','failure').denominator,10);assert.equal(cell('assistant','case_resolved').count,5);assert.equal(cell('assistant','case_reopened').count,5);
  assert.equal(cell('queue','all_active').count,5);assert.equal(cell('queue','all_active').business_minutes,minutes);
  assert.equal(saved.snapshot.staffing.timezone,'Asia/Kolkata');
  await s.db.adminQuery(`UPDATE shipit.support_cases SET updated_at=clock_timestamp() WHERE id=ANY($1::uuid[])`,[cases]);
  assert.deepEqual(await service.read(s.admin.token,saved.snapshot.id,query,randomUUID()),saved);
  const safe=JSON.stringify(saved);for(const marker of ['+120255503','contact_key','conversation_id','inbox_id','sealed_payload'])assert.equal(safe.includes(marker),false);
});

await test('consent denial, template policy failure and recorded provider rejection remain distinct from unknown delivery',{timeout:60000},async t=>{
  const {outboundSetup}=await import('../outbound-support.ts');const {captureEffectiveness}=await import('../../src/modules/reports/effectiveness-repository.ts');
  const s=await outboundSetup(t);await s.db.prepareSupport();
  const failed=await s.enqueue();s.setSend(async()=>({kind:'permanent_failure',reason:'template_rejected'}));await s.worker.tick();
  assert.equal((await s.detail(failed.id)).message.state,'failed');assert.equal(s.calls(),1);
  s.advance(1000);const pendingSource=await s.receive('A second request');const pending=await s.enqueue({...s.input,source_id:pendingSource});
  s.setSend(async()=>({kind:'uncertain',reason:'acceptance_unknown'}));await s.worker.tick();assert.equal((await s.detail(pending.id)).message.state,'uncertain');
  s.advance(1000);const templateSource=await s.receive('Template request');const policy=await s.enqueue({...s.input,source_id:templateSource,format:'template',text:undefined,template_name:'missing_template',template_language:'en',variables:[]});
  assert.equal(policy.state,'failed');assert.match(policy.reason_code,/^template_/);
  s.advance(1000);await s.receive('STOP');s.advance(1000);const stopped=await s.receive('Request after withdrawal'),denied=await s.enqueue({...s.input,source_id:stopped});assert.equal(denied.state,'suppressed');assert.equal(denied.reason_code,'consent_revoked');
  const source=await withMessagingReportScope(s.pool,s.local.token,org,A,randomUUID(),scope=>captureEffectiveness(scope,new Date(Date.now()-86400000),new Date(Date.now()+86400000),undefined));
  const n=(key:string)=>source.messaging.find(r=>r.category===key)?.n??0;
  assert.equal(n('logical_intents'),4);assert.equal(n('known_customers'),1);assert.equal(n('recorded_send_attempts'),2);
  assert.equal(n('provider_failed'),1);assert.equal(n('pre_send_failed'),1);assert.equal(n('consent_suppressed'),1);assert.equal(n('uncertain'),1);
  assert.equal(n('delivery_unknown'),1);assert.equal(n('delivered'),0);assert.equal(n('read'),0);assert.equal(s.calls(),2);
});

await test('failed tool then human handoff projects independent owning turn and case events',{timeout:60000},async t=>{
  const {conversationSetup}=await import('../conversation-support.ts');const {captureEffectiveness}=await import('../../src/modules/reports/effectiveness-repository.ts');
  const s=await conversationSetup(t);await s.db.prepareSupport();s.whatsapp.configuration={...s.whatsapp.configuration,support_enabled:true};
  const from=(await s.db.adminQuery<{instant:Date}>('SELECT clock_timestamp() instant')).rows[0]!.instant;
  const failed=await s.message('tracking','+12025550400');await s.worker.tick();const handoff=await s.message('HUMAN','+12025550400');await s.worker.tick();
  const turns=(await s.db.adminQuery('SELECT inbox_id,metric_category FROM shipit.customer_conversation_turns WHERE inbox_id=ANY($1::uuid[])',[ [failed,handoff] ])).rows;
  assert.equal(turns.find(r=>r.inbox_id===failed)?.metric_category,'failure');assert.equal(turns.find(r=>r.inbox_id===handoff)?.metric_category,'handoff');
  const source=await withMessagingReportScope(s.pool,s.admin.token,org,A,randomUUID(),scope=>captureEffectiveness(scope,from,new Date(Date.now()+1000),undefined));
  const n=(category:string)=>Number(source.assistant.find(r=>r.category===category)?.events??0);
  assert.equal(n('failure'),1);assert.equal(n('handoff'),1);assert.equal(n('case_opened'),1);assert.equal(n('case_resolved'),0);assert.equal(source.queue.find(r=>r.category==='all_active')?.n,1);
});
