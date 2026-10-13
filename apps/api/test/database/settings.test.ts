import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {SettingsUpdateInput} from '@shippingco/shared';
import {settingsSetup,settingsQuery as q,settingsHeaders as headers} from '../settings-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {createSettingsService} from '../../src/modules/settings/service.ts';
import {paymentFault} from '../payment-support.ts';
const input=(changes:SettingsUpdateInput['changes'],expected_version=0):SettingsUpdateInput=>({changes,expected_version,reason:'Synthetic reviewed configuration'});
await test('settings start unconfigured, inherit explicit org values, clear overrides, and preserve per-key source history',{timeout:60000},async t=>{
 const s=await settingsSetup(t),empty=await s.read();assert.equal(empty.version,0);assert.ok(Object.values(empty.values).every(v=>v.state==='unconfigured'&&v.value===null));
 const org1=await s.update(input({language:{locale:'hi'},identity:{display_name:'Synthetic organization'},operating_hours:{timezone:'Asia/Kolkata',days:[]}}),'organization',s.admin.token);
 assert.equal(org1.values.language.state,'configured');assert.equal((await s.read()).values.language.state,'inherited');assert.deepEqual((await s.read()).values.operating_hours.value,{timezone:'Asia/Kolkata',days:[]});
 const local=await s.update(input({language:{locale:'en'}}));assert.equal(local.values.language.state,'overridden');assert.equal(local.values.identity.source!.version_id,org1.version_id);
 const later=await s.update(input({identity:{display_name:'Synthetic changed name'}},1),'organization',s.admin.token);assert.equal(later.values.language.source!.version_id,org1.version_id);assert.equal((await s.read()).values.language.value!.locale,'en');
 const cleared=await s.update(input({language:null},1));assert.equal(cleared.values.language.state,'inherited');assert.equal(cleared.values.language.source!.version_id,org1.version_id);
 assert.deepEqual(await createSettingsService(s.db.runtimePool()).read(s.local.token,'franchise',q,randomUUID()),cleared);
 const history=await s.service.history(s.local.token,'franchise',q,randomUUID());assert.equal(history.items.length,2);assert.deepEqual(history.items[0]!.changed_keys,['language']);
 const events=await s.db.adminQuery('SELECT * FROM shipit.settings_events');assert.equal(events.rows.length,4);assert.ok(events.rows.every(r=>r.event_type==='settings.versioned'));
 const audit=await s.db.adminQuery("SELECT action,resource_type FROM shipit.audit_history WHERE action='settings.versioned'");assert.equal(audit.rows.length,4);
});
await test('current own-scope role authority conceals sibling and foreign settings and never promotes financial writes',{timeout:60000},async t=>{
 const s=await settingsSetup(t),accountant=await s.grant('accountant',[A]),readonly=await s.grant('read_only',[A]);
 for(const token of [s.local.token,s.operator.token,accountant.token,readonly.token])await assert.rejects(s.update(input({language:{locale:'hi'}}),'organization',token),{code:'ACTION_FORBIDDEN'});
 for(const token of [s.admin.token,s.operator.token,accountant.token,readonly.token])await assert.rejects(s.update(input({language:{locale:'hi'}}),'franchise',token),{code:'ACTION_FORBIDDEN'});
 for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C},{organization_id:randomUUID(),franchise_id:randomUUID()}]){await assert.rejects(s.read('franchise',s.local.token,query),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(s.update(input({language:{locale:'hi'}}),'franchise',s.local.token,randomUUID(),query),{code:'RESOURCE_NOT_FOUND'});}
 await assert.rejects(s.read('organization',s.admin.token,{organization_id:otherOrg}),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.read('franchise',s.admin.token,{organization_id:org,franchise_id:B})).version,0);
 await assert.rejects(s.update(input({receiving_account:null}),'organization',s.admin.token),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(s.service.history(s.operator.token,'franchise',q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 assert.equal((await s.read('franchise',readonly.token)).values.language.editable,false);
});
await test('CAS races yield one version and same-key canonical retries exactly replay after current authorization',{timeout:60000},async t=>{
 const s=await settingsSetup(t),body=input({language:{locale:'hi'}}),key=randomUUID(),races=await Promise.allSettled([s.update(body),s.update(body)]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal((races.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'VERSION_CONFLICT');
 const current=await s.update(input({identity:{display_name:'Synthetic'}},1),'franchise',s.local.token,key);
 assert.deepEqual(await s.update({reason:'Synthetic reviewed configuration',changes:{identity:{display_name:'Synthetic'}},expected_version:1},'franchise',s.local.token,key),current);
 await assert.rejects(s.update(input({identity:{display_name:'Different'}},1),'franchise',s.local.token,key),{code:'IDEMPOTENCY_CONFLICT'});
 await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});await assert.rejects(s.update(input({identity:{display_name:'Synthetic'}},1),'franchise',s.local.token,key),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.settings_versions')).rows[0]!.n,2);
});
await test('lost commit retries exactly; transactional failure rolls back version, event, audit and receipt',{timeout:60000},async t=>{
 const s=await settingsSetup(t),body=input({language:{locale:'en'}}),key=randomUUID();
 await assert.rejects(createSettingsService(paymentFault(s.pool,'COMMIT'),true).update(s.local.token,'franchise',q,key,headers(key),body,randomUUID()));
 const recovered=await s.update(body,'franchise',s.local.token,key);assert.equal(recovered.version,1);
 const failKey=randomUUID();await assert.rejects(createSettingsService(paymentFault(s.pool,'INSERT INTO shipit.settings_commands','before'),true).update(s.local.token,'franchise',q,failKey,headers(failKey),input({language:null},1),randomUUID()));
 for(const table of ['settings_versions','settings_commands','settings_events'])assert.equal((await s.db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,1);
 const owner=s.db.ownerPool();t.after(()=>owner.close());for(const table of ['settings_versions','settings_commands','settings_events'])await assert.rejects(owner.query(`DELETE FROM shipit.${table}`),{sqlState:'23514'});
});
await test('explicit synthetic calendar and close intent never activate lifecycle; malformed/unapproved forms are rejected atomically',{timeout:60000},async t=>{
 const s=await settingsSetup(t),body=input({collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1,3],holidays:[]},close_cutoff:{timezone:'Asia/Kolkata',minute:1080},credit_policy:{state:'unconfigured',owner:'account_terms_v1'},overdue_policy:{state:'unconfigured',owner:'account_terms_v1'},billing_terms:{state:'unconfigured',owner:'account_terms_v1'}}),saved=await s.update(body);
 assert.equal(saved.values.collection_calendar.availability,'unavailable');assert.equal(saved.values.collection_calendar.consumer,'lifecycle_unavailable');assert.equal(saved.values.close_cutoff.consumer,'configuration_only');
 const malformed=[{collection_calendar:{timezone:'UTC',weekdays:[1],holidays:[]}},{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1,1],holidays:[]}},{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1],holidays:['2025-02-29']}},{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1],holidays:[],exceptional_open_dates:[]}},{operating_hours:{timezone:'Browser/Local',days:[]}},{operating_hours:{timezone:'UTC',days:[{weekday:1,opens_minute:100,closes_minute:99}]}},{approval_policy:{threshold_paise:1}},{language:{locale:'xx'}},{CASH_CLOSE_ENABLED:true},{provider_token:'SYNTHETIC_PRIVATE_SECRET'},{credit_policy:{state:'configured',owner:'account_terms_v1',revision_id:randomUUID()}}];
 for(const changes of malformed)await assert.rejects(async()=>s.service.update(s.local.token,'franchise',q,'synthetic-negative',headers('synthetic-negative'),{changes,expected_version:1,reason:'Synthetic rejected'},randomUUID()),{code:'VALIDATION_FAILED'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.settings_versions')).rows[0]!.n,1);
});
await test('report scope choices use current R11/E03 grants and revoked saved defaults become unavailable without expansion',{timeout:60000},async t=>{
 const s=await settingsSetup(t),multi=await s.grant('accountant',[A,B]);
 assert.deepEqual((await s.service.scopes(s.local.token,q,randomUUID())).items.map(i=>i.id),[A]);
 const orgOptions=await s.service.scopes(s.admin.token,q,randomUUID());assert.deepEqual(orgOptions.items.map(i=>i.id).sort(),[A,B].sort());assert.ok(orgOptions.items.every(i=>!i.can_export));
 assert.ok((await s.service.scopes(multi.token,q,randomUUID())).items.every(i=>i.can_export));await assert.rejects(s.service.scopes(s.operator.token,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(s.service.scopes(s.local.token,{...q,cursor:C},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await s.update(input({report_scope:{franchise_ids:[A,B]},reporting_schedule:{report:'sales',franchise_ids:[A,B],timezone:'Asia/Kolkata',weekday:2,minute:600}}),'organization',s.admin.token);
 const unavailable=await s.read();assert.equal(unavailable.values.report_scope.availability,'unavailable');assert.equal(unavailable.values.report_scope.value,null);
 const multiView=await s.read('franchise',multi.token);assert.deepEqual(multiView.values.report_scope.value!.franchise_ids,[A,B].sort());
 await s.memberships.revokeMembership(s.admin.token,multi.member.id,{expected_version:1});await assert.rejects(s.service.scopes(multi.token,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('financial settings validate current owned revision and owner policy, conceal foreign nested IDs and expose stale references safely',{timeout:60000},async t=>{
 const s=await settingsSetup(t),{createReceivingAccountService}=await import('../../src/modules/payments/account-service.ts'),accounts=createReceivingAccountService(s.pool),{createFinancialWorkflowService}=await import('../../src/modules/reports/finance-workflow-service.ts'),finance=createFinancialWorkflowService(s.pool,true),{createAgentFeeService}=await import('../../src/modules/agent-settlements/fee-service.ts'),fees=createAgentFeeService(s.pool,true);
 const ak=randomUUID(),account=await accounts.configure(s.local.token,null,q,ak,headers(ak),{name:'Synthetic drawer',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const pk=randomUUID(),policy=await finance.configurePolicy(s.local.token,q,pk,headers(pk),{expected_version:0,enabled:true,discount_review_threshold_paise:null,allow_self_approval:false},randomUUID());
 const agent=await s.grant('delivery_agent',[A]),fk=randomUUID(),term=await fees.configure(s.local.token,agent.id,q,fk,headers(fk),{expected_version:0,basis:'per_delivery',amount_paise:111,currency:'INR',valid_from:new Date(Date.now()-60000).toISOString(),valid_until:new Date(Date.now()+3600000).toISOString(),active:true},randomUUID());
 const saved=await s.update(input({receiving_account:{account_id:account.id,revision_id:account.revision_id,method:'cash'},approval_policy:{revision_id:policy.id},agent_fee_policy:{agent_id:agent.id,revision_id:term.resource_id}}));
 for(const key of ['receiving_account','approval_policy','agent_fee_policy'] as const)assert.equal(saved.values[key].availability,'available');
 assert.equal((await s.read('franchise',s.operator.token)).values.receiving_account.value,null);
 for(const changes of [{receiving_account:{account_id:account.id,revision_id:account.revision_id,method:'upi'}},{receiving_account:{account_id:randomUUID(),revision_id:account.revision_id,method:'cash'}},{agent_fee_policy:{agent_id:randomUUID(),revision_id:term.resource_id}},{approval_policy:{revision_id:randomUUID()}}])await assert.rejects(s.service.update(s.local.token,'franchise',q,'synthetic-negative',headers('synthetic-negative'),input(changes as SettingsUpdateInput['changes'],1),randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const sibling=await s.grant('franchise_admin',[B]),bk=randomUUID(),other=await accounts.configure(sibling.token,null,{organization_id:org,franchise_id:B},bk,headers(bk),{name:'Synthetic sibling account',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 await assert.rejects(s.update(input({receiving_account:{account_id:other.id,revision_id:other.revision_id,method:'cash'}},1)),{code:'RESOURCE_NOT_FOUND'});
 const updateKey=randomUUID();await accounts.configure(s.local.token,account.id,q,updateKey,headers(updateKey),{name:'Synthetic retired drawer',methods:['cash'],other_method_name:null,active:false,expected_version:1},randomUUID());
 const p2=randomUUID();await finance.configurePolicy(s.local.token,q,p2,headers(p2),{expected_version:1,enabled:false,discount_review_threshold_paise:null,allow_self_approval:false},randomUUID());
 await s.memberships.revokeMembership(s.admin.token,agent.member.id,{expected_version:1});
 const current=await s.read();for(const key of ['receiving_account','approval_policy','agent_fee_policy'] as const)assert.equal(current.values[key].availability,'unavailable');
 assert.equal(current.version,1);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_fee_earnings')).rows[0]!.n,0);
});
await test('HTTP boundaries enforce cookies CSRF strict payload/no-store and disabled lifecycle exact-replay behavior',{timeout:60000},async t=>{
 const s=await settingsSetup(t),{buildServer}=await import('../../src/server.ts'),{parseEnvironment}=await import('../../src/env.ts'),config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',SETTINGS_WRITES_ENABLED:'true'}),app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},logSink:{write:x=>s.logs.push(x)}});t.after(()=>app.close());
 const boot=await app.inject('/auth/bootstrap'),browser=boot.cookies[0]!,cookies={shipit_session:s.local.token,[browser.name]:browser.value},httpHeaders={'content-type':'application/json',origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token};
 const body=input({language:{locale:'hi'}}),key=randomUUID(),url='/api/v1/settings/franchise?'+new URLSearchParams(q),post=(payload:unknown,id=key)=>app.inject({method:'POST',url,cookies,headers:{...httpHeaders,'idempotency-key':id},payload:JSON.stringify(payload)});
 const noCsrf=await app.inject({method:'POST',url,cookies,headers:{'content-type':'application/json','idempotency-key':key},payload:JSON.stringify(body)});assert.equal(noCsrf.statusCode,403);
 const saved=await post(body);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.headers['cache-control'],'no-store');
 for(const extra of [{actor_id:s.admin.id},{effective_at:'2099-01-01T00:00:00Z'},{provider_token:'SYNTHETIC_PRIVATE_SECRET'},{expected_version:'1'}])assert.equal((await post({...body,...extra},randomUUID())).statusCode,422);
 const read=await app.inject({url,cookies});assert.equal(read.statusCode,200);assert.equal(read.headers['cache-control'],'no-store');
 assert.equal((await app.inject({url})).statusCode,401);
 const disabled=createSettingsService(s.pool);assert.deepEqual(await disabled.update(s.local.token,'franchise',q,key,headers(key),body,randomUUID()),saved.json());await assert.rejects(disabled.update(s.local.token,'franchise',q,'synthetic-negative',headers('synthetic-negative'),input({language:null},1),randomUUID()),{code:'SETTINGS_DISABLED'});
 await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1 WHERE id=$1",[A]);
 assert.deepEqual(await s.update(body,'franchise',s.local.token,key),saved.json());await assert.rejects(s.update(input({language:null},1)),{code:'FRANCHISE_DISABLED'});
 await s.db.adminQuery("UPDATE shipit.organizations SET lifecycle='disabled',version=version+1 WHERE id=$1",[org]);
 assert.deepEqual(await s.update(body,'franchise',s.local.token,key),saved.json());await assert.rejects(s.update(input({language:null},1)),{code:'ORGANIZATION_DISABLED'});
 assert.ok(!s.logs.join('').includes('SYNTHETIC_PRIVATE_SECRET'));assert.ok(!JSON.stringify(saved.json()).includes('provider_token'));
});
await test('exact completed settings replay rechecks saved report scope after a secondary grant is revoked',{timeout:60000},async t=>{
 const s=await settingsSetup(t),invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.local.id,role:'accountant',franchise_ids:[B]}),extra=await s.memberships.acceptInvitation(s.local.token,{token:invite.acceptance_token});
 const body=input({report_scope:{franchise_ids:[A,B]}}),key=randomUUID(),saved=await s.update(body,'franchise',s.local.token,key);assert.deepEqual(saved.values.report_scope.value!.franchise_ids,[A,B].sort());
 await s.memberships.revokeMembership(s.admin.token,extra.id,{expected_version:1});
 await assert.rejects(s.update(body,'franchise',s.local.token,key),{code:'RESOURCE_NOT_FOUND'});
 const current=await s.read();assert.equal(current.values.report_scope.availability,'unavailable');assert.equal(current.values.report_scope.value,null);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.settings_versions')).rows[0]!.n,1);
});
