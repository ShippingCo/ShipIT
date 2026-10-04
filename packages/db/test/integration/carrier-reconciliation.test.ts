import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { legacyCarrierInstallation } from '../legacy-carrier.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { createCarrierService } from '../../../../apps/api/src/modules/carriers/service.ts';
import { referenceInput } from '../../../../apps/api/test/carrier-support.ts';
import { org,A } from '../../../../apps/api/test/audit-support.ts';

await test('reconciliation migration backfills existing observations, preserves domain facts and rolls back atomically',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:38}),{applied:38});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);await db.prepareCarriers();
  const parcel=booked.json().parcels[0].id as string,q={organization_id:org,franchise_id:A},service=createCarrierService(s.pool,s.keys.browser,s.clock);
  const installation=await legacyCarrierInstallation(db,{organization:org,franchise:A,actor:s.local.id,label:'PRE-58',now:s.clock()});
  const ref=await service.mutate('reference',s.local.token,parcel,randomUUID(),referenceInput(installation.id),q,randomUUID());
  const id=randomUUID(),command=randomUUID(),source=randomUUID(),owner=db.ownerPool();
  const evidence={contractVersion:1,reference:{organizationId:org,franchiseId:A,installationId:installation.id,externalDocket:'SYN-54'},
    status:{state:'mapped',status:'delivered_claim',mappingVersionId:id},occurredAt:{state:'unknown',reason:'unknown_timezone'},
    receivedAt:s.clock().toISOString(),provenance:{mode:'manual',actorId:s.local.id,commandId:command},sourceRecordId:source};
  const client=await owner.connect();try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO shipit.carrier_observations(id,organization_id,franchise_id,parcel_id,reference_id,parcel_version,status_code,evidence,command_id,received_at)
      VALUES($1,$2,$3,$4,$5,1,'DONE',$6,$7,$8)`,[id,org,A,parcel,ref.id,evidence,command,s.clock()]);
    await client.query(`INSERT INTO shipit.carrier_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,resource_id,version,reason_code,result,correlation_id,occurred_at)
      VALUES($1,$2,$3,$4,'observation',$5,$5,$6,1,'manual_observation',$7,$8,$9)`,[command,org,A,s.local.id,'a'.repeat(64),id,{id,version:1},randomUUID(),s.clock()]);
    await client.query('COMMIT');
  }finally{client.release();}
  db.migrate=migrate;
  const before=(await db.adminQuery('SELECT * FROM shipit.carrier_observations')).rows;
  const dir=await mkdtemp(join(tmpdir(),'shipit-tracking-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});
  const file=join(dir,'1792083600000-carrier-reconciliation.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.carrier_tracking_records') AS relation")).rows[0]!.relation,null);
  assert.deepEqual((await db.adminQuery('SELECT * FROM shipit.carrier_observations')).rows,before);
  assert.deepEqual(await db.migrate(),{applied:5});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await db.adminQuery('SELECT id,observation_id,source_id,status,time_reason FROM shipit.carrier_tracking_records')).rows,
    [{id,observation_id:id,source_id:'manual:'+source,status:'delivered_claim',time_reason:'unknown_timezone'}]);
  assert.deepEqual((await db.adminQuery('SELECT * FROM shipit.carrier_observations')).rows,before);
  assert.deepEqual((await db.adminQuery('SELECT status,version FROM shipit.parcels WHERE id=$1',[parcel])).rows,[{status:'booked',version:1}]);
});
