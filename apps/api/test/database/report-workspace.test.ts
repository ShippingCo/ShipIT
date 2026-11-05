import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentSetup} from '../payment-support.ts';
import {org,A,B} from '../audit-support.ts';
import {workspaceFilter,workspaceTokens} from '../../src/modules/reports/workspace.ts';
await test('live report workspace reconciles assessed financial sources, preserves report quota and reauthorizes exports',{timeout:30000},async t=>{
 const s=await paymentSetup(t);await s.db.prepareReports();await s.db.prepareRoutes();await s.db.prepareDeliveries();
 const year=new Date(s.booked.charges.confirmed_at).getUTCFullYear();
 const query=(franchise=A)=>new URLSearchParams({organization_id:org,franchise_id:franchise,from_day:`${year}-01-01`,to_day:`${year}-12-31`});
 const read=(kind:string,token=s.local.token,franchise=A)=>s.app.inject({method:'GET',url:'/api/v1/reports/workspace/'+kind+'?'+query(franchise),cookies:s.cookies(token)});
 const count=async()=>Number((await s.db.adminQuery('SELECT count(*) n FROM shipit.report_snapshots')).rows[0]!.n),before=await count();
 const finance=await read('finance');assert.equal(finance.statusCode,200);const data=finance.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].amounts.gross,String(s.gross));assert.equal(data.rows[0].amounts.collections,'0');assert.equal(data.rows[0].amounts.outstanding,String(s.gross));assert.equal(data.rows[0].id,s.booked.id);assert.equal(finance.headers['cache-control'],'no-store');
 assert.equal((await read('finance',s.operator.token)).statusCode,403);assert.equal((await read('finance',s.local.token,B)).statusCode,404);
 const delivery=await read('delivery');assert.equal(delivery.statusCode,200);assert.equal(delivery.json().rows[0].booking_id,s.booked.id);assert.equal(delivery.json().rows[0].failed_attempts,0);
 const authorize=(token:string,proof:string)=>s.app.inject({method:'POST',url:'/api/v1/reports/workspace/finance/export?'+new URLSearchParams({organization_id:org,franchise_id:A}),headers:s.headers,cookies:s.cookies(token),payload:JSON.stringify({export_token:proof})});
 const exported=await authorize(s.local.token,data.export_token);assert.equal(exported.statusCode,200);assert.equal(exported.json().id,data.id);assert.equal((await authorize(s.operator.token,data.export_token)).statusCode,403);assert.equal((await authorize(s.local.token,data.export_token+'x')).statusCode,410);
 const incomplete=await s.app.inject({method:'POST',url:'/api/v1/bookings/entries?'+new URLSearchParams({organization_id:org,franchise_id:A}),cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:JSON.stringify({fields:{name:'Synthetic unassessed',override:'123.00'}})});assert.equal(incomplete.statusCode,201);assert.equal((await read('finance')).json().rows.length,1);assert.equal(await count(),before);
 const accesses=await s.db.adminQuery('SELECT action FROM shipit.report_access_events WHERE snapshot_id=$1 ORDER BY occurred_at',[data.id]);assert.deepEqual(accesses.rows.map(r=>r.action),['report.capture','report.export']);
});
await test('live report windows and export proofs reject invalid dates, tampering, changed audience and expiry',()=>{
 assert.equal(workspaceFilter({from_day:'2024-01-01',to_day:'2024-12-31'}).to_day,'2024-12-31');for(const f of [{from_day:'2026-02-30',to_day:'2026-03-01'},{from_day:'2026-01-01',to_day:'2027-01-02'},{from_day:'2026-02-02',to_day:'2026-01-01'}])assert.throws(()=>workspaceFilter(f));
 let now=0;const tokens=workspaceTokens(Buffer.alloc(32,9),()=>now),proof=tokens.issue('synthetic-audience',randomUUID());assert.ok(tokens.read(proof,'synthetic-audience'));assert.throws(()=>tokens.read(proof,'other-audience'));assert.throws(()=>tokens.read(proof+'x','synthetic-audience'));now=900000;assert.throws(()=>tokens.read(proof,'synthetic-audience'));
});
