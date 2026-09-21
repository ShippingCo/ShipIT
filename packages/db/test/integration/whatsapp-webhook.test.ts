import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { whatsappSetup } from '../../../../apps/api/test/whatsapp-support.ts';

await test('inbox upgrade preserves populated #36 evidence, rolls back atomically and retries safely',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:23}),{applied:23});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await whatsappSetup(t,db),connection=await s.connect();assert.equal(connection.statusCode,200);
  assert.equal((await s.request(`installations/${connection.json().id}/sync`,{expected_version:1,name:'parcel_update',language:'en_US'})).statusCode,200);
  db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['whatsapp_installations','whatsapp_commands','whatsapp_templates','audit_history','domain_events','outbox_jobs'].map(async table=>
    [table,(await db.adminQuery(`SELECT row_to_json(t) value FROM shipit.${table} t ORDER BY row_to_json(t)::text`)).rows])));
  const before=await snapshot(),directory=await mkdtemp(join(tmpdir(),'shipit-webhook-upgrade-'));
  t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-webhook-upgrade-'));return rm(directory,{recursive:true,force:true});});
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
  const file=join(directory,'1790701200000-whatsapp-webhook-inbox.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue37_function()');};\n");
  await assert.rejects(db.migrate({dir:directory}));
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.whatsapp_inbox') value")).rows[0]!.value,null);
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual(await snapshot(),before);
  // Existing provider configuration APIs continue operating without inbox enablement.
  assert.equal((await s.request('installation')).json().installation.version,2);
  const publicExecute=(await db.adminQuery(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='shipit' AND p.proname IN ('whatsapp_receive','whatsapp_inbox_next','whatsapp_inbox_process') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0]!.n;
  assert.equal(publicExecute,0);
});
