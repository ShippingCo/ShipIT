import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditSetup,org,A,B} from '../audit-support.ts';
await test('automation feed reads persisted history without provider configuration and preserves scope, privacy and disabled send controls',{timeout:30000},async t=>{
 const s=await auditSetup(t);await s.db.prepareSupport();await s.db.prepareNotificationAutomation();
 const local=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),dispatcher=await s.grant('dispatcher',[A]),accountant=await s.grant('accountant',[A]);
 const query=(franchise=A)=>new URLSearchParams({organization_id:org,franchise_id:franchise}).toString();
 const get=(path:string,token=local.token,franchise=A)=>s.app.inject({method:'GET',url:path+'?'+query(franchise),cookies:{shipit_session:token}});
 for(const path of ['/api/v1/whatsapp/history/messages','/api/v1/whatsapp/history/automation','/api/v1/support']){const response=await get(path);assert.equal(response.statusCode,200);assert.deepEqual(response.json().items,[]);assert.equal(response.headers['cache-control'],'no-store');assert.equal((await get(path,'')).statusCode,401);assert.equal((await get(path,local.token,B)).statusCode,404);assert.equal((await get(path,accountant.token)).statusCode,403);}
 assert.equal((await get('/api/v1/support',operator.token)).statusCode,200);assert.equal((await get('/api/v1/support',dispatcher.token)).statusCode,403);assert.equal((await get('/api/v1/whatsapp/history/messages',dispatcher.token)).statusCode,200);
 const bootstrap=await s.app.inject({method:'GET',url:'/auth/bootstrap'}),csrf=bootstrap.json().csrf_token;const cookies={shipit_session:local.token,...Object.fromEntries(bootstrap.cookies.map(c=>[c.name,c.value]))};
 const command=await s.app.inject({method:'POST',url:'/api/v1/support/'+randomUUID()+'/commands?'+query(),headers:{'content-type':'application/json',origin:'http://localhost:5173','x-csrf-token':csrf,'idempotency-key':randomUUID()},cookies,payload:JSON.stringify({action:'claim',expected_version:1})});assert.equal(command.statusCode,503);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
});
