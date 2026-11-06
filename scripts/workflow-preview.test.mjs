import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {workflowPreviewCommands} from './workflow-preview.mjs';
test('workflow preview requires guarded test identity and never forwards live credentials to its UI or fixture',()=>{
 for(const env of [{},{NODE_ENV:'production',TEST_DATABASE_IDENTITY:'db_test',TEST_DATABASE_URL:'synthetic'},{NODE_ENV:'test',TEST_DATABASE_URL:'synthetic'}])assert.throws(()=>workflowPreviewCommands('/synthetic',env),/REQUIRES_DISPOSABLE/);
 const [api,web]=workflowPreviewCommands('/synthetic',{NODE_ENV:'test',TEST_DATABASE_IDENTITY:'db_test',TEST_DATABASE_URL:'synthetic-test-db',PATH:'/synthetic/tools',VITE_DATA_MODE:'demo',VITE_API_BASE_URL:'https://live.invalid',SHIPIT_API_PROXY:'https://live.invalid',LOCAL_AUTH_JSON:'private',WHATSAPP_ACCESS_TOKEN_REF:'private',DATABASE_URL:'private'});
 assert.equal(api.env.TEST_DATABASE_URL,'synthetic-test-db');assert.equal(api.env.SHIPIT_COUNTER_PREVIEW_ORIGIN,'http://localhost:5174');assert.equal(web.env.VITE_DATA_MODE,'production');assert.equal(web.env.VITE_API_BASE_URL,'');assert.equal(web.env.SHIPIT_API_PROXY,'http://127.0.0.1:3033');assert.equal(web.env.TEST_DATABASE_URL,undefined);
 assert.ok(web.args.includes('--strictPort'));assert.ok(web.args.includes('127.0.0.1'));assert.equal(api.args.at(-1),resolve('/synthetic','apps/api/test/counter-demo.ts'));
 for(const command of [api,web]){assert.equal(command.env.LOCAL_AUTH_JSON,undefined);assert.equal(command.env.WHATSAPP_ACCESS_TOKEN_REF,undefined);assert.equal(command.env.DATABASE_URL,undefined);}
});
