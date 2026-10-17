import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupCashClose,closeQuery as q} from '../cash-close-support.ts';
import {buildServer} from '../../src/server.ts';
import {parseEnvironment} from '../../src/env.ts';
import {browserToken,csrf} from '../../src/modules/auth/crypto.ts';
import {A} from '../audit-support.ts';
await test('reconciliation HTTP enforces optional defaults, current roles, CSRF, unknown-field rejection and private read/export responses',{timeout:60000},async t=>{
 const s=await setupCashClose(t);await s.db.prepareReconciliation();const accountant=await s.grant('accountant',[A]),reader=await s.grant('read_only',[A]);
 const app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',RECONCILIATION_ENABLED:'true',MONEY_RECEIPTS_ENABLED:'true'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
 const browser=browserToken(s.keys),base='/api/v1/reconciliation',url=(path:string)=>base+path+'?'+new URLSearchParams(q);
 const post=(path:string,body:unknown,actor=s.local,key=randomUUID(),protectedRequest=true)=>app.inject({method:'POST',url:url(path),cookies:{shipit_session:actor.token,shipit_browser:browser},headers:{origin:'http://localhost:5173','content-type':'application/json','idempotency-key':key,...(protectedRequest?{'x-csrf-token':csrf(s.keys,browser)}:{})},payload:JSON.stringify(body)});
 const get=(path:string,actor:{token:string}=s.local)=>app.inject({url:url(path),cookies:{shipit_session:actor.token}});
 assert.equal((await get('/config')).json().enabled,false);assert.equal((await get('/config',reader)).statusCode,403);assert.equal((await get('/config',s.operator)).statusCode,403);assert.equal((await get('/config',s.admin)).statusCode,200);
 assert.equal((await post('/columns',{content_base64:Buffer.from('Date,Amount\n2026-01-01,500').toString('base64')},accountant)).json().error.code,'RECONCILIATION_DISABLED');
 const paths=['/config','/mappings','/mappings/'+randomUUID(),'/columns','/imports','/imports/'+randomUUID()+'/commit','/imports/'+randomUUID()+'/resolve','/transactions/'+randomUUID()+'/classification','/matches','/matches/'+randomUUID()+'/unmatch','/batches','/batches/'+randomUUID(),'/cases','/cases/'+randomUUID(),'/reports'];
 for(const path of paths)assert.equal((await post(path,{},s.local,randomUUID(),false)).statusCode,403,path);
 const config={expected_version:0,enabled:true,reason:'Synthetic opt-in reviewed by franchise admin'},key=randomUUID();assert.equal((await post('/config',{...config,organization_id:q.organization_id})).statusCode,422);assert.equal((await post('/config',config,accountant)).statusCode,403);
 const enabled=await post('/config',config,s.local,key);assert.equal(enabled.statusCode,200,enabled.body);assert.deepEqual((await post('/config',config,s.local,key)).json(),enabled.json());assert.equal((await post('/config',{...config,enabled:false},s.local,key)).statusCode,409);
 const columns=await post('/columns',{content_base64:Buffer.from('Date,Amount,Private\n2026-01-01,500,not-for-logs').toString('base64')},accountant);assert.equal(columns.statusCode,200,columns.body);assert.deepEqual(columns.json(),{headers:['Date','Amount','Private'],row_count:1});assert.match(String(columns.headers['cache-control']),/no-store.*private/);
 assert.equal((await get('/accounts',accountant)).statusCode,200);assert.equal((await get('/mappings',accountant)).statusCode,200);
 // A normal cash receipt remains usable before and after reconciliation opt-out.
 await s.receipt(10000);const offKey=randomUUID();assert.equal((await post('/config',{expected_version:1,enabled:false,reason:'Return to disabled after verification'},s.local,offKey)).statusCode,200);await s.receipt(20000);
 assert.equal((await s.db.adminQuery('SELECT sum(amount_paise)::text n FROM shipit.money_receipts')).rows[0]!.n,'30000');assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.reconciliation_transactions')).rows[0]!.n,0);
 const member=(await s.db.adminQuery("SELECT id,version FROM shipit.memberships WHERE user_id=$1 AND role='franchise_admin'",[s.local.id])).rows[0]!;await s.memberships.revokeMembership(s.admin.token,member.id,{expected_version:member.version});assert.equal((await post('/config',config,s.local,key)).statusCode,404);
 assert.ok(!s.logs.join('').includes('not-for-logs'));
});
