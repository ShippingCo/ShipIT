/** Synthetic loopback-only browser qualification; database lease belongs to the local test runner. */
import {writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';

import type {TestContext} from 'node:test';
import {withTransaction} from '@shippingco/db';
import {AuthRepository} from '../src/modules/auth/repository.ts';
import {digest,secret} from '../src/modules/auth/crypto.ts';
import {cleanupRegisteredResources} from '../../../packages/db/test/support.ts';
import {bookingSetup} from './booking-support.ts';
import {startTestDelivery} from './delivery-support.ts';
import {A,B} from './audit-support.ts';
import {buildServer} from '../src/server.ts';
import {parseEnvironment} from '../src/env.ts';
if(process.env.NODE_ENV!=='test'||!['db_test','db_test_1'].includes(process.env.TEST_DATABASE_IDENTITY??''))throw new Error('SYNTHETIC_FIXTURE_ONLY');
const directory=await mkdtemp(join(tmpdir(),'shipit-custody-browser-')),registry=join(directory,'registry.jsonl');
if(dirname(directory)!==tmpdir())throw new Error('DB_TEST_CLEANUP_FAILED');
await writeFile(registry,'',{mode:0o600});process.env.DB_TEST_RESOURCE_REGISTRY=registry;
const cleanup:(()=>unknown)[]=[],t={after:(f:()=>unknown)=>cleanup.push(f)} as unknown as TestContext;
let finish!:()=>void;const stop=new Promise<void>(resolve=>{finish=resolve;});process.once('SIGINT',finish);process.once('SIGTERM',finish);
try{
 const s=await bookingSetup(t),giver=await s.grant('delivery_agent',[A]),receiver=await s.grant('delivery_agent',[A]),admin=await s.grant('franchise_admin',[A,B]),dispatcher=await s.grant('dispatcher',[A]),candidate=await s.user();
 const booked=await s.book({...s.body,parcels:[{...s.body.parcels[0],weight_grams:400},{...s.body.parcels[0],weight_grams:599}]});
 if(booked.statusCode!==201)throw new Error('SYNTHETIC_BOOKING_FAILED');
 const parcels=booked.json().parcels as {id:string}[];for(const p of parcels)await startTestDelivery({...s,clock:()=>new Date()},p.id,giver,dispatcher);await s.db.prepareCustody();
 const app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3061',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',CUSTODY_ENABLED:'true'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});cleanup.push(()=>app.close());
 const actors={admin,giver,receiver,dispatcher,candidate};
 app.get<{Params:{actor:string}}>('/_fixture/session/:actor',async(request,reply)=>{const actor=actors[request.params.actor as keyof typeof actors];if(!actor)return reply.code(404).send({error:'SYNTHETIC_ACTOR_UNKNOWN'});const token=secret();await withTransaction(s.pool,async tx=>{const repo=new AuthRepository(tx);await repo.newSession((await repo.user(actor.id))!,digest(token));});reply.header('Cache-Control','no-store');reply.header('Set-Cookie','shipit_session='+token+'; HttpOnly; SameSite=Strict; Path=/');return reply.redirect('http://localhost:5173/#/business/custody');});
 app.get('/_fixture/stop',()=>{finish();return {stopping:true};});
 await app.listen({host:'127.0.0.1',port:3061});
 console.log('Synthetic custody fixture ready: http://localhost:3061/_fixture/session/admin');
 console.log(JSON.stringify({giver:giver.id,receiver:receiver.id,dispatcher:dispatcher.id,candidate:candidate.id,parcels:parcels.map(p=>p.id)}));
 await stop;
}catch{console.error('SYNTHETIC_CUSTODY_FIXTURE_FAILED');process.exitCode=1;}
finally{for(const close of cleanup.reverse())try{await close();}catch{process.exitCode=1;}try{await cleanupRegisteredResources(registry);}catch{process.exitCode=1;}await rm(directory,{recursive:true});}
