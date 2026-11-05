import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {settingsSetup} from '../settings-support.ts';
import {org,A,B} from '../audit-support.ts';
import {conversationSetup} from '../conversation-support.ts';
import {createSettingsService} from '../../src/modules/settings/service.ts';
const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=';
const shop={tagline:'Synthetic courier',origin_city:'Ahmedabad',support_phone:'+12025550100',address:'Synthetic counter',assistant_name:'Synthetic Assist',logo};
await test('shop presentation persists with current business authority, exact replay and immutable audited settings versions',{timeout:30000},async t=>{
 const s=await settingsSetup(t),body={expected_version:0,changes:{identity:{display_name:'Synthetic Courier',shop},language:{locale:'hi' as const}},reason:'Shop details reviewed'},key=randomUUID();
 const saved=await s.update(body,'franchise',s.local.token,key);assert.deepEqual(saved.values.identity.value,{display_name:'Synthetic Courier',shop});assert.deepEqual((await s.read()).values.identity.value,saved.values.identity.value);assert.deepEqual(await s.update(body,'franchise',s.local.token,key),saved);
 await assert.rejects(s.update({...body,expected_version:1},'franchise',s.operator.token),{code:'ACTION_FORBIDDEN'});await assert.rejects(s.read('franchise',s.local.token,{organization_id:org,franchise_id:B}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(async()=>s.update({...body,expected_version:1,changes:{identity:{display_name:'Synthetic Courier',shop:{...shop,logo:'data:image/svg+xml,unsafe'}}}}),{code:'VALIDATION_FAILED'});
 for(const table of ['settings_versions','settings_commands','settings_events'])assert.equal((await s.db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,1);
 const owner=await s.update({...body,expected_version:1},'franchise',s.admin.token);assert.equal(owner.version,2);
});
await test('assistant introductions use saved branch name and language while explicit customer language takes priority',{timeout:30000},async t=>{
 const s=await conversationSetup(t);await s.db.prepareSettings();const settings=createSettingsService(s.pool,true),query={organization_id:org,franchise_id:A};
 // Use the same explicit command key in the raw-header evidence.
 const key=randomUUID();await settings.update(s.admin.token,'franchise',query,key,['idempotency-key',key],{expected_version:0,changes:{identity:{display_name:'Synthetic Courier',shop},language:{locale:'hi'}},reason:'Assistant defaults reviewed'},randomUUID());
 const first=await s.message('hello');await s.worker.tick();assert.match(await s.reply(first),/नमस्ते, मैं Synthetic Assist/);
 const language=await s.message('LANGUAGE EN');await s.worker.tick();assert.match(await s.reply(language),/Language saved/);
 const next=await s.message('hello');await s.worker.tick();assert.match(await s.reply(next),/Hello, I’m Synthetic Assist/);
});
