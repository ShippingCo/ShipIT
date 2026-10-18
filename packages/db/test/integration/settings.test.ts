import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';
import {bookingSetup} from '../../../../apps/api/test/booking-support.ts';
import {createSettingsService} from '../../../../apps/api/src/modules/settings/service.ts';
import {createReceiptService} from '../../../../apps/api/src/modules/receipts/service.ts';
import {createSalesService} from '../../../../apps/api/src/modules/reports/sales-service.ts';
import {createParcelService} from '../../../../apps/api/src/modules/parcels/service.ts';
import {settingsSetup} from '../../../../apps/api/test/settings-support.ts';
import {org,A} from '../../../../apps/api/test/audit-support.ts';
await test('released50 populated upgrade preserves profiles quotes bookings receipts reports held parcels and leaves all settings unconfigured',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),old=await mkdtemp(join(tmpdir(),'shipit-settings-upgrade-')),directory=fileURLToPath(new URL('../../migrations/',import.meta.url));t.after(()=>rm(old,{recursive:true}));
 for(const name of(await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<'1793120400000-versioned-settings.cjs'))await copyFile(join(directory,name),join(old,name));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await bookingSetup(t,db),booked=await s.booking.create(s.operator.token,org,A,randomUUID(),s.body,randomUUID());await db.prepareReceipts();await db.prepareReports();
 const q={organization_id:org,franchise_id:A},receipt=createReceiptService(s.pool),sales=createSalesService(s.pool),day=booked.charges.confirmed_at.slice(0,10),key=randomUUID();
 const intake=randomUUID(),held=await createParcelService(s.pool,s.clock).execute(s.operator.token,booked.parcels[0]!.id,q,intake,['idempotency-key',intake],{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()},'parcels.check_in',randomUUID());assert.equal(held.status,'checked_in');
 await receipt.read(s.operator.token,booked.id,null,q,randomUUID());await sales.create(s.local.token,q,key,['idempotency-key',key],{from_day:day,to_day:day},randomUUID());
 const evidence=async()=>(await db.adminQuery("SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM shipit.franchises f),'quotes',(SELECT jsonb_agg(result ORDER BY id) FROM shipit.pricing_quotes),'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM shipit.bookings b),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shipit.issued_receipts r),'reports',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shipit.report_snapshots r),'parcels',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shipit.parcels p),'lifecycle_events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY event_id) FROM shipit.domain_events e)) value")).rows[0]!.value;
 const before=await evidence();assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,50);
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await evidence(),before);
 for(const table of ['settings_versions','settings_commands','settings_events']){assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'INSERT\') allowed',[db.runtimeRole,'shipit.'+table])).rows[0]!.allowed,false);}
 await db.prepareSettings();const settings=createSettingsService(s.pool,true),empty=await settings.read(s.local.token,'franchise',q,randomUUID());assert.equal(empty.version,0);assert.ok(Object.values(empty.values).every(v=>v.value===null));
 const save=randomUUID();await settings.update(s.local.token,'franchise',q,save,['idempotency-key',save],{expected_version:0,reason:'Synthetic upgrade calendar only',changes:{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[2,4],holidays:[]}}},randomUUID());assert.deepEqual(await evidence(),before);
});
await test('database guards validate typed shape, provenance, current actor, tenant, generated intervals and mandatory atomic receipt',{timeout:60000},async t=>{
 const s=await settingsSetup(t),key=randomUUID();await s.update({expected_version:0,changes:{language:{locale:'en'}},reason:'Synthetic initial setting'},'franchise',s.local.token,key);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const bad=[{operating_hours:{}},{operating_hours:{timezone:'UTC',days:[{weekday:1,opens_minute:50,closes_minute:49}]}},{operating_hours:{timezone:'Browser/Local',days:[]}},{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1,1],holidays:[]}},{collection_calendar:{timezone:'Asia/Kolkata',weekdays:[1],holidays:['2025-02-29']}},{report_scope:{franchise_ids:[A,A]}},{reporting_schedule:{report:null,franchise_ids:[A],timezone:'UTC',weekday:1,minute:0}},{receiving_account:{account_id:randomUUID(),revision_id:randomUUID(),method:null}},{language:{locale:'en',provider_token:'SYN_PRIVATE_TOKEN'}},{close_cutoff:{timezone:'UTC',minute:1.5}},{identity:{display_name:'\n'}},{credit_policy:{state:'configured',owner:'account_terms_v1'}}];
 async function append(changes:Record<string,unknown>,override:Record<string,unknown>={}){
  const payload={language:{locale:'en'},...changes},sources={language:1,...Object.fromEntries(Object.keys(changes).map(k=>[k,2]))},row={organization:org,franchise:A,version:2,actor:s.local.id,payload,sources,effective:null,...override};
  return owner.query(`INSERT INTO shipit.settings_versions(id,organization_id,franchise_id,version,actor_id,reason,correlation_id,payload,changes,source_versions,effective_at) VALUES($1,$2,$3,$4,$5,'Synthetic guarded settings',$6,$7,$8,$9,$10)`,[randomUUID(),row.organization,row.franchise,row.version,row.actor,randomUUID(),JSON.stringify(row.payload),JSON.stringify(changes),JSON.stringify(row.sources),row.effective]);
 }
 for(const changes of bad)await assert.rejects(append(changes),{sqlState:'23514'});
 await assert.rejects(append({language:{locale:'hi'}},{sources:{language:1}}),{sqlState:'23514'});
 await assert.rejects(append({language:{locale:'hi'}},{effective:'2099-01-01T00:00:00Z'}),{sqlState:'23514'});
 await assert.rejects(append({language:{locale:'hi'}},{version:1}),{sqlState:'40001'});
 await assert.rejects(append({language:{locale:'hi'}},{actor:s.operator.id}),{sqlState:'42501'});
 await assert.rejects(append({language:{locale:'hi'}},{organization:randomUUID()}),{sqlState:'42501'});
 // A syntactically valid version alone cannot commit without its exact actor/scope receipt.
 await assert.rejects(append({language:{locale:'hi'}}),{sqlState:'23514'});
 for(const table of ['settings_versions','settings_events','settings_commands'])assert.equal((await s.db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT has_table_privilege($1,\'shipit.settings_events\',\'INSERT\') allowed',[s.db.runtimeRole])).rows[0]!.allowed,false);
});
