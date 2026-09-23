import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { startTestDelivery } from '../delivery-support.ts';
import { attachmentSetup,photo,intent } from '../attachment-support.ts';
import { createAttachmentService } from '../../src/modules/attachments/service.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { paymentFault } from '../payment-support.ts';
await test('attachment synthetic lifecycle: private bytes, replay, durable reload, grant expiry and audit privacy',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),key=randomUUID();const started=await s.initiate(intent(),key);assert.equal(started.statusCode,201,started.body);const id=started.json().id;
 assert.deepEqual((await s.initiate(intent(),key)).json(),started.json());assert.equal((await s.initiate({...intent(),size_bytes:photo.length+1},key)).statusCode,409);
 assert.equal((await s.request('POST',`/${id}/download-grants`)).statusCode,409);
 assert.equal((await s.upload(id)).statusCode,200);const fkey=randomUUID(),final=await s.finalize(id,fkey);assert.equal(final.statusCode,200,final.body);assert.equal(final.json().state,'ready');
 const before=await s.effects();assert.deepEqual((await s.finalize(id,fkey)).json(),final.json());assert.deepEqual(await s.effects(),before);
 const restarted=createAttachmentService(s.db.runtimePool(),s.deps);assert.deepEqual(await restarted.finalize(s.operator.token,s.bookingId,id,fkey,{},s.q,randomUUID()),final.json());
 assert.deepEqual((await s.request('GET','')).json().items,[final.json()]);
 const grant=(await s.request('POST',`/${id}/download-grants`)).json();const download=()=>s.app.inject({url:grant.url,cookies:s.cookies(s.operator.token)});
 assert.equal((await download()).statusCode,200);assert.deepEqual((await download()).rawPayload,photo);s.advance(59999);assert.equal((await download()).statusCode,200);s.advance(1);assert.equal((await download()).statusCode,404);
 const row=(await s.rows())[0]!;assert.equal(row.actual_size,photo.length);assert.equal(row.digest,intent().sha256);assert.ok(row.linked_at);assert.equal(s.objects.size,1);
 const audits=(await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE resource_type=$1',['attachment'])).rows;
 const publicText=JSON.stringify([final.json(),audits,s.logs]);for(const marker of ['evidence/','SYN_STORAGE_CREDENTIAL',s.operator.token,'data:image','sha256','signed_url'])assert.ok(!publicText.includes(marker));
});
await test('attachment concurrent finalize links exactly once and quota reservation serializes',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;await s.upload(id);const key=randomUUID();const results=await Promise.all([s.finalize(id,key),s.finalize(id,key)]);
 for(const r of results)assert.equal(r.statusCode,200,r.body);assert.deepEqual(results[0]!.json(),results[1]!.json());
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.attachment_audit_events WHERE action='attachments.ready'")).rows[0]!.n,1);
 const requests=await Promise.all(Array.from({length:5},()=>s.initiate()));assert.equal(requests.filter(r=>r.statusCode===201).length,3);assert.equal(requests.filter(r=>r.statusCode===413).length,2);
 assert.equal((await s.rows()).length,4);
});
await test('attachment scanner infected/error fail closed; content mismatch and executable rejected',{timeout:30000},async t=>{
 const s=await attachmentSetup(t);
 for(const result of ['error','infected'] as const){s.setScan(result);const id=(await s.initiate()).json().id;await s.upload(id);const f=await s.finalize(id);assert.equal(f.statusCode,result==='error'?503:422,f.body);assert.equal((await s.request('POST',`/${id}/download-grants`)).statusCode,409);}
 s.setScan('clean');const exe=Buffer.from('MZ synthetic executable payload');const id=(await s.initiate(intent(exe))).json().id;await s.upload(id,exe);assert.equal((await s.finalize(id)).statusCode,422);
 for(const row of await s.rows())assert.notEqual(row.state,'ready');
 s.advance(31*60000);const cleaned=await s.cleanup.tick();assert.equal(cleaned.deleted,3);assert.equal(s.objects.size,0);
 const mismatch=(await s.initiate({...intent(),media_type:'image/jpeg'})).json().id;await s.upload(mismatch);assert.equal((await s.finalize(mismatch)).json().error.code,'ATTACHMENT_CONTENT_MISMATCH');
});
await test('attachment cancellation, orphan expiry and uncertain deletion reconcile durable tombstones',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),ready=await s.ready();assert.equal((await s.request('POST',`/uploads/${ready.id}/cancel`)).statusCode,409);
 const a=(await s.initiate()).json().id,b=(await s.initiate()).json().id;await s.upload(a);await s.request('POST',`/uploads/${a}/cancel`);
 s.advance(15*60000-1);assert.deepEqual(await s.cleanup.tick(),{deleted:0,retry:0});s.advance(1);s.setFault('delete-after');assert.deepEqual(await s.cleanup.tick(),{deleted:0,retry:1});
 assert.equal((await s.rows()).find(r=>r.id===a)!.state,'cleanup_pending');s.setFault('none');s.advance(5*60000);assert.equal((await s.cleanup.tick()).deleted,1);
 s.advance(10*60000);assert.equal((await s.cleanup.tick()).deleted,1);assert.equal((await s.rows()).find(r=>r.id===b)!.state,'deleted');assert.equal(s.objects.size,1);
 assert.deepEqual(await s.cleanup.tick(),{deleted:0,retry:0});
});
await test('attachment storage failure, missing/altered object and uncertain write remain private and recover',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;s.setFault('put-after');assert.equal((await s.upload(id)).statusCode,503);assert.equal(s.objects.size,1);
 s.setFault('none');assert.equal((await s.upload(id)).statusCode,200);s.setFault('get');assert.equal((await s.finalize(id)).statusCode,503);s.setFault('none');
 const object=[...s.objects.values()][0]!;object.uploadId=randomUUID();assert.equal((await s.finalize(id)).statusCode,422);assert.notEqual((await s.rows())[0]!.state,'ready');
 const second=(await s.initiate()).json().id;await s.upload(second);const row=(await s.rows()).find(r=>r.id===second)!;s.objects.delete(row.object_key as string);assert.equal((await s.finalize(second)).statusCode,503);
});
await test('attachment W22 and R14 each enforce every role, assignment purpose and live replay revocation',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),ready=await s.ready();
 for(const role of ['franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only']){
  const actor=await s.grant(role,[A]),read=['franchise_admin','operator','dispatcher'].includes(role);
  assert.equal((await s.request('GET','',{},actor.token)).statusCode,read?200:role==='delivery_agent'?404:403,role);
  const result=await s.request('POST','/uploads',intent(),actor.token);assert.equal(result.statusCode,['franchise_admin','operator'].includes(role)?201:role==='delivery_agent'?404:403,role);
  assert.equal((await s.request('POST',`/${ready.id}/download-grants`,{},actor.token)).statusCode,read?200:role==='delivery_agent'?404:403,role);
 }
 assert.equal((await s.request('GET','',{},s.admin.token)).statusCode,200);assert.equal((await s.request('POST','/uploads',intent(),s.admin.token)).statusCode,403);assert.equal((await s.request('POST',`/${ready.id}/download-grants`,{},s.admin.token)).statusCode,403);
 const actor=await s.grant('operator',[A]),g=await s.request('POST',`/${ready.id}/download-grants`,{},actor.token);await s.memberships.revokeMembership(s.admin.token,actor.member.id,{expected_version:1});
 assert.equal((await s.app.inject({url:g.json().url,cookies:s.cookies(actor.token)})).statusCode,404);
});
await test('attachment foreign Booking and nested Parcel selectors are indistinguishable from unknown',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;
 for(const [organization,franchise] of [[org,B],[otherOrg,C],[org,randomUUID()]]){
  const query={organization_id:organization!,franchise_id:franchise!};
  for(const [method,path,body] of [['POST','/uploads',intent()],['PUT',`/uploads/${id}/content`,photo],['POST',`/uploads/${id}/finalize`,{}],['POST',`/uploads/${id}/cancel`,{}],['GET','',{}],['POST',`/${id}/download-grants`,{}]] as const){
   const result=await s.request(method,path,body,s.operator.token,s.bookingId,query);assert.equal(result.statusCode,404,result.body);assert.equal(result.json().error.code,'RESOURCE_NOT_FOUND');
  }
 }
 assert.equal((await s.initiate({...intent(),parcel_id:randomUUID()})).statusCode,404);
 const altered=await s.initiate({...intent(),object_key:'evidence/foreign'});assert.equal(altered.statusCode,422);assert.equal((await s.rows()).length,1);
});
await test('attachment finalization rollback, lost COMMIT acknowledgement and runtime privileges',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;await s.upload(id);const key=randomUUID(),before=await s.effects();
 const failure=createAttachmentService(paymentFault(s.pool,'INSERT INTO shipit.attachment_commands','before'),s.deps);
 await assert.rejects(failure.finalize(s.operator.token,s.bookingId,id,key,{},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});assert.deepEqual(await s.effects(),before);assert.equal((await s.rows())[0]!.state,'quarantined');
 const lost=createAttachmentService(paymentFault(s.pool,'COMMIT'),s.deps);await assert.rejects(lost.finalize(s.operator.token,s.bookingId,id,key,{},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 // The first commit only read the upload; a clean retry still converges on one identity.
 const result=await s.finalize(id,key);assert.equal(result.statusCode,200,result.body);
 await assert.rejects(s.pool.query('UPDATE shipit.attachments SET organization_id=$1 WHERE id=$2',[otherOrg,id]));await assert.rejects(s.pool.query('DELETE FROM shipit.attachments WHERE id=$1',[id]));await assert.rejects(s.pool.query('DELETE FROM shipit.attachment_audit_events'));
 const role=(await s.pool.query('SELECT current_user')).rows[0]!.current_user;assert.match(role,/runtime/);
});
await test('attachment binary stream checks actual size without trusting Content-Length and upload expiry',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;
 await assert.rejects(s.service.upload(s.operator.token,s.bookingId,id,Readable.from([photo,Buffer.from('extra')]),s.q,randomUUID()));
 assert.notEqual((await s.rows())[0]!.state,'ready');assert.equal(s.objects.size,0);
 s.advance(15*60000);assert.equal((await s.upload(id)).statusCode,409);assert.equal((await s.upload(id)).json().error.code,'ATTACHMENT_UPLOAD_EXPIRED');
});
await test('assigned delivery agent can upload only current parcel proof; reassignment immediately revokes metadata, grant and replay',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),agent=await s.grant('delivery_agent',[A]),replacement=await s.grant('delivery_agent',[A]);
 await startTestDelivery(s,s.parcelId,agent);
 const body={...intent(),purpose:'parcel_proof',parcel_id:s.parcelId},key=randomUUID();
 const start=await s.request('POST','/uploads',body,agent.token,s.bookingId,s.q,key);assert.equal(start.statusCode,201,start.body);const id=start.json().id;
 assert.equal((await s.request('POST','/uploads',{...intent(),parcel_id:s.parcelId},agent.token)).statusCode,404);
 assert.equal((await s.request('PUT',`/uploads/${id}/content`,photo,agent.token)).statusCode,200);
 assert.equal((await s.request('POST',`/uploads/${id}/finalize`,{},agent.token)).statusCode,200);
 const q={...s.q,parcel_id:s.parcelId},list=await s.request('GET','',{},agent.token,s.bookingId,q);assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items.length,1);
 const grant=(await s.request('POST',`/${id}/download-grants`,{},agent.token)).json();assert.equal((await s.app.inject({url:grant.url,cookies:s.cookies(agent.token)})).statusCode,200);
 await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');try{await s.db.adminQuery('UPDATE shipit.parcels SET assigned_agent_id=$1 WHERE id=$2',[replacement.id,s.parcelId]);}finally{await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');}
 assert.equal((await s.request('GET','',{},agent.token,s.bookingId,q)).statusCode,404);assert.equal((await s.app.inject({url:grant.url,cookies:s.cookies(agent.token)})).statusCode,404);assert.equal((await s.request('POST','/uploads',body,agent.token,s.bookingId,s.q,key)).statusCode,404);
});
await test('real A1/A2/B1 attachment chains reject foreign nested parents, bytes, replay and composite FK',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),{draft,start,input}=await import('../pricing-support.ts'),{taxPolicy,taxFacts}=await import('../tax-support.ts'),{contact}=await import('../customer-support.ts');
 await s.memberships.bootstrapAdministrator(s.admin.id,otherOrg);const errors:unknown[]=[];
 for(const [organization,franchise] of [[org,B],[otherOrg,C]] as const){
  const admin=await s.grant('franchise_admin',[franchise],organization),operator=await s.grant('operator',[franchise],organization);
  s.setNow('2098-12-31T23:00:00Z');const price=await s.pricing.create(admin.token,organization,franchise,randomUUID(),draft,randomUUID());await s.pricing.publish(admin.token,organization,franchise,price.id,randomUUID(),{expected_version:1},randomUUID());
  const policy=await s.tax.create(admin.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());await s.tax.publish(admin.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
  const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID()),quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),input,randomUUID()),intentBody={quote_id:quote.id,pricing_input:input,facts:taxFacts};
  const prepared=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),intentBody,randomUUID()),tax=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:prepared.id},randomUUID());
  const booked=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:tax.id,tax_intent:intentBody},randomUUID(),operator.token,franchise,organization);assert.equal(booked.statusCode,201,booked.body);
  const booking=booked.json().id as string,parcel=booked.json().parcels[0].id as string,q={organization_id:organization,franchise_id:franchise};
  const initiated=await s.request('POST','/uploads',intent(),operator.token,booking,q);assert.equal(initiated.statusCode,201,initiated.body);const id=initiated.json().id;
  assert.equal((await s.request('PUT',`/uploads/${id}/content`,photo,operator.token,booking,q)).statusCode,200);assert.equal((await s.request('POST',`/uploads/${id}/finalize`,{},operator.token,booking,q)).statusCode,200);
  for(const target of [booking,randomUUID()])for(const [method,suffix,body] of [['POST','/uploads',intent()],['GET','',{}],['PUT',`/uploads/${id}/content`,photo],['POST',`/uploads/${id}/finalize`,{}],['POST',`/uploads/${id}/cancel`,{}],['POST',`/${id}/download-grants`,{}]] as const){
   const response=await s.request(method,suffix,body,s.operator.token,target);assert.equal(response.statusCode,404,response.body);const error=response.json().error;delete error.correlation_id;errors.push(error);
  }
  assert.equal((await s.initiate({...intent(),parcel_id:parcel,purpose:'parcel_proof'})).statusCode,404);
  assert.equal((await s.request('POST',`/${id}/download-grants`)).statusCode,404);
  const direct=(await s.rows()).find(r=>r.id===id)!;
  await assert.rejects(s.pool.query(`INSERT INTO shipit.attachments(id,organization_id,franchise_id,booking_id,parcel_id,purpose,kind,object_key,declared_size,declared_type,expected_digest,retention_class,initiated_actor,actor_type,actor_id,correlation_id,created_at,upload_expires_at,cleanup_due_at)
   VALUES($1,$2,$3,$4,$5,'parcel_proof','image',$6,$7,'image/png',$8,'delivery_proof',$9::uuid,'user',$9::text,$10,$11,$12,$13)`,
   [randomUUID(),org,A,s.bookingId,parcel,'evidence/'+randomUUID(),photo.length,intent().sha256,s.operator.id,randomUUID(),direct.created_at,direct.upload_expires_at,direct.upload_expires_at]),e=>(e as {sqlState:string}).sqlState==='23503');
 }
 assert.ok(errors.every(e=>JSON.stringify(e)===JSON.stringify(errors[0])));assert.equal((await s.request('GET','')).json().items.length,0);assert.equal((await s.rows()).length,2);
});
await test('count and aggregate reservations are authoritative across different commands and cannot race',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),big=Buffer.alloc(8*1024*1024);photo.copy(big);
 for(let n=0;n<4;n++){const i=await s.initiate(intent(big));assert.equal(i.statusCode,201,i.body);assert.equal((await s.upload(i.json().id,big)).statusCode,200);assert.equal((await s.finalize(i.json().id)).statusCode,200);}
 assert.equal((await s.initiate()).statusCode,413);assert.equal((await s.rows()).length,4);
 const another=await s.book();assert.equal(another.statusCode,201,another.body);const booking=another.json().id;
 for(let n=0;n<10;n++){const i=await s.request('POST','/uploads',intent(),s.operator.token,booking);assert.equal(i.statusCode,201,i.body);await s.request('PUT',`/uploads/${i.json().id}/content`,photo,s.operator.token,booking);assert.equal((await s.request('POST',`/uploads/${i.json().id}/finalize`,{},s.operator.token,booking)).statusCode,200);}
 assert.equal((await s.request('POST','/uploads',intent(),s.operator.token,booking)).statusCode,413);
});
await test('final ready transaction survives a lost HTTP result and process/pool replacement without duplicate evidence',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),{DatabaseError}=await import('@shippingco/db'),id=(await s.initiate()).json().id;await s.upload(id);let commits=0;
 const pool={...s.pool,async connect(){const c=await s.pool.connect();return {release:c.release,async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){const result=await c.query<Row>(sql,params);if(sql==='COMMIT'&&++commits===2)throw new DatabaseError('DB_CONNECTION_FAILED');return result;}};}};
 const service=createAttachmentService(pool,s.deps),key=randomUUID();await assert.rejects(service.finalize(s.operator.token,s.bookingId,id,key,{},s.q,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.rows())[0]!.state,'ready');const before=await s.effects(),restarted=createAttachmentService(s.db.runtimePool(),s.deps);
 const result=await restarted.finalize(s.operator.token,s.bookingId,id,key,{},s.q,randomUUID());assert.equal(result.id,id);assert.deepEqual(await s.effects(),before);
});
await test('attachment dependency failures and altered sizes never link; clean rescan recovers before expiry',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),id=(await s.initiate()).json().id;s.setFault('put');assert.equal((await s.upload(id)).statusCode,503);assert.equal(s.objects.size,0);s.setFault('none');await s.upload(id);
 s.setScan('error');assert.equal((await s.finalize(id)).statusCode,503);s.setScan('clean');assert.equal((await s.finalize(id)).statusCode,200);
 const second=(await s.initiate()).json().id;await s.upload(second);const row=(await s.rows()).find(r=>r.id===second)!,object=s.objects.get(String(row.object_key))!;object.size++;
 assert.equal((await s.finalize(second)).statusCode,422);assert.equal((await s.rows()).find(r=>r.id===second)!.state,'rejected');
 s.advance(15*60000);s.setFault('delete');assert.deepEqual(await s.cleanup.tick(),{deleted:0,retry:1});assert.equal(s.objects.size,2);s.setFault('none');s.advance(5*60000);assert.equal((await s.cleanup.tick()).deleted,1);assert.equal(s.objects.size,1);
});
await test('attachment request/privacy projection excludes sensitive filename, raw payload, grants and credentials from durable evidence',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),markers=['SYN_PHONE_15555550123','SYN_ADDRESS_42_PRIVATE','SYN_AUTH_TOKEN_SECRET','SYN_CSRF_SECRET','SYN_STORAGE_CREDENTIAL','https://private.invalid/?signature=SYN_SIGNED_URL','SYN_OTP_123456'];
 for(const marker of markers){const result=await s.initiate({...intent(),filename:marker});assert.equal(result.statusCode,422);assert.ok(!result.body.includes(marker));}
 const ready=await s.ready(),grant=await s.request('POST',`/${ready.id}/download-grants`);assert.equal(grant.statusCode,200);assert.match(String(grant.headers['cache-control']),/no-store/);
 const persisted=JSON.stringify([await s.effects(),(await s.db.adminQuery('SELECT result FROM shipit.attachment_commands')).rows,(await s.db.adminQuery('SELECT * FROM shipit.audit_history')).rows,(await s.db.adminQuery('SELECT * FROM shipit.domain_events')).rows,s.logs,(await s.request('GET','')).json()]);
 for(const marker of [...markers,grant.json().url,'evidence/','data:image',s.operator.token])assert.ok(!persisted.includes(marker),marker);
 const original=await s.book();assert.equal(original.statusCode,201);assert.ok(!JSON.stringify(original.json()).includes('data:'));
});
await test('live W22 loss during scanning denies finalization without partial link or receipt',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),actor=await s.grant('operator',[A]),start=await s.request('POST','/uploads',intent(),actor.token),id=start.json().id;assert.equal(start.statusCode,201,start.body);await s.request('PUT',`/uploads/${id}/content`,photo,actor.token);
 const service=createAttachmentService(s.pool,{...s.deps,scanner:{async scan(){await s.memberships.revokeMembership(s.admin.token,actor.member.id,{expected_version:1});return 'clean';}}});
 await assert.rejects(service.finalize(actor.token,s.bookingId,id,randomUUID(),{},s.q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});assert.equal((await s.rows())[0]!.state,'quarantined');
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.attachment_commands WHERE operation='finalize'")).rows[0]!.n,0);
});
