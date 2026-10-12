import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {DatabasePool} from '@shippingco/db';
import {setupShipmentCosts,costQuery as q,costHeaders as headers} from '../shipment-cost-support.ts';
import {org,A} from '../audit-support.ts';
import {approvedAuthority} from '../tenancy-support.ts';
import {createTenancyService} from '../../src/modules/tenancy/service.ts';
import {createShipmentCostService} from '../../src/modules/shipment-costs/service.ts';
const disabled={lifecycle:'disabled',reason_code:'administrative_disable',expected_version:1};
for(const target of ['franchise','organization'] as const)await test(`shipment cost fresh commands reject disabled ${target} while exact recovery and historical reads remain authorized`,{timeout:60000},async t=>{
 const s=await setupShipmentCosts(t),body=s.input(),recordKey=randomUUID(),original=await s.record(body,recordKey),previewKey=randomUUID(),preview=await s.costs.preview(s.local.token,q,previewKey,headers(previewKey),{rows:[body]},randomUUID()),applyKey=randomUUID(),applied=await s.costs.apply(s.local.token,q,preview.id,applyKey,headers(applyKey),{},randomUUID()),report=await s.capture();
 const tenant=createTenancyService({database:s.pool,authorizer:approvedAuthority(org,[A],'service')}),owner=s.db.ownerPool();t.after(()=>owner.close());
 if(target==='franchise')await tenant.changeFranchiseLifecycle(A,disabled);else await tenant.changeOrganizationLifecycle(disabled);
 const code=target==='franchise'?'FRANCHISE_DISABLED':'ORGANIZATION_DISABLED',freshKey=randomUUID();
 await assert.rejects(s.costs.preview(s.local.token,q,freshKey,headers(freshKey),{rows:[body]},randomUUID()),{code});
 await assert.rejects(s.record(body),{code});await assert.rejects(s.record(s.input()),{code});await assert.rejects(s.record({...body,source_id:original.source_id,expected_version:1}),{code});
 const freshApply=randomUUID();await assert.rejects(s.costs.apply(s.local.token,q,preview.id,freshApply,headers(freshApply),{},randomUUID()),{code});
 assert.deepEqual(await s.record(body,recordKey),original);assert.deepEqual(await s.costs.preview(s.local.token,q,previewKey,headers(previewKey),{rows:[body]},randomUUID()),preview);assert.deepEqual(await s.costs.apply(s.local.token,q,preview.id,applyKey,headers(applyKey),{},randomUUID()),applied);
 assert.equal((await s.costs.read(s.local.token,q,original.source_id,randomUUID())).revisions[0]!.id,original.id);assert.ok('items'in await s.costs.list(s.local.token,q,randomUUID()));assert.ok('csv'in await s.contribution.read(s.local.token,report.snapshot.id,q,randomUUID(),true));
 const direct=(operation:string)=>owner.query(`INSERT INTO shipit.shipment_cost_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,result,correlation_id) SELECT $1,organization_id,franchise_id,actor_id,$2,$3,fingerprint,result,$4 FROM shipit.shipment_cost_commands WHERE operation='record' LIMIT 1`,[randomUUID(),operation,randomUUID().replaceAll('-','').repeat(2),randomUUID()]);
 for(const operation of ['record','preview','apply'])await assert.rejects(direct(operation),{sqlState:'42501'});
 assert.equal((await owner.query("SELECT count(*)::int n FROM shipit.shipment_cost_commands WHERE operation IN ('record','preview','apply')")).rows[0]!.n,3);
 if(target==='franchise')await tenant.changeFranchiseLifecycle(A,{lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2});else await tenant.changeOrganizationLifecycle({lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2});
 await owner.query("UPDATE shipit.auth_users SET lifecycle='disabled' WHERE id=$1",[s.local.id]);await assert.rejects(direct('preview'),{sqlState:'42501'});await assert.rejects(s.record(body,recordKey),{code:'UNAUTHENTICATED'});
});
function heldCommit(pool:DatabasePool){
 let release!:()=>void,entered!:()=>void,pid=0;const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 const database:DatabasePool={...pool,async connect(){const client=await pool.connect();pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){if(sql==='COMMIT'){entered();await hold;}return client.query<Row>(sql,params);}};}};
 return {database,ready,release:()=>release(),pid:()=>pid};
}
for(const target of ['franchise','organization'] as const)await test(`shipment cost and ${target} disable serialize in both commit orders`,{timeout:60000},async t=>{
 const s=await setupShipmentCosts(t),writeHold=heldCommit(s.pool),costs=createShipmentCostService(writeHold.database,true),key=randomUUID(),body=s.input(),write=costs.preview(s.local.token,q,key,headers(key),{rows:[body]},randomUUID());await writeHold.ready;
 const tenant=createTenancyService({database:s.pool,authorizer:approvedAuthority(org,[A],'service')}),disable=target==='franchise'?tenant.changeFranchiseLifecycle(A,disabled):tenant.changeOrganizationLifecycle(disabled);
 const blocked=async(pid:number)=>{for(let n=0;n<300;n++){if((await s.db.adminQuery<{waiting:boolean}>('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[pid])).rows[0]!.waiting)return;await delay(10);}assert.fail('Expected concurrent operation to wait on lifecycle row lock');};
 try{await blocked(writeHold.pid());writeHold.release();await write;await disable;}finally{writeHold.release();await Promise.allSettled([write,disable]);}
 const active={lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2};if(target==='franchise')await tenant.changeFranchiseLifecycle(A,active);else await tenant.changeOrganizationLifecycle(active);
 const disableHold=heldCommit(s.pool),heldTenant=createTenancyService({database:disableHold.database,authorizer:approvedAuthority(org,[A],'service')}),again={...disabled,expected_version:3},first=target==='franchise'?heldTenant.changeFranchiseLifecycle(A,again):heldTenant.changeOrganizationLifecycle(again);await disableHold.ready;
 const fresh=randomUUID(),denied=assert.rejects(s.costs.preview(s.local.token,q,fresh,headers(fresh),{rows:[body]},randomUUID()),{code:target==='franchise'?'FRANCHISE_DISABLED':'ORGANIZATION_DISABLED'});
 try{await blocked(disableHold.pid());disableHold.release();await first;await denied;}finally{disableHold.release();await Promise.allSettled([first,denied]);}
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.shipment_cost_commands WHERE operation='preview'")).rows[0]!.n,1);
});
