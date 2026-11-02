import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attachmentSetup,intent,photo} from '../attachment-support.ts';
import {invoicePdf} from '../pdf-attachment-fixture.ts';

await test('PDF invoice uses real private attachment lifecycle, scanner gate and download-only response',{timeout:30000},async t=>{
 const s=await attachmentSetup(t),pdf=invoicePdf();
 const started=await s.initiate(intent(pdf,'application/pdf','document'));assert.equal(started.statusCode,201,started.body);
 const id=started.json().id;assert.equal((await s.upload(id,pdf)).statusCode,200);
 s.setScan('error');const failed=await s.finalize(id);assert.equal(failed.statusCode,503,failed.body);
 assert.equal((await s.request('POST',`/${id}/download-grants`)).statusCode,409);
 s.setScan('clean');const key=randomUUID(),ready=await s.finalize(id,key);assert.equal(ready.statusCode,200,ready.body);assert.equal(ready.json().filename,'document.pdf');assert.equal(ready.json().kind,'document');assert.deepEqual((await s.finalize(id,key)).json(),ready.json());
 const grant=(await s.request('POST',`/${id}/download-grants`)).json();const downloaded=await s.app.inject({url:grant.url,cookies:s.cookies(s.operator.token)});
 assert.equal(downloaded.statusCode,200);assert.match(String(downloaded.headers['content-disposition']),/^attachment;/);assert.equal(downloaded.headers['x-content-type-options'],'nosniff');assert.deepEqual(downloaded.rawPayload,pdf);
 const wrong=await s.initiate(intent(photo,'application/pdf','document'));assert.equal(wrong.statusCode,201,wrong.body);await s.upload(wrong.json().id,photo);assert.equal((await s.finalize(wrong.json().id)).statusCode,422);
 const bad=await s.initiate(intent(pdf,'application/pdf','document'));await s.upload(bad.json().id,pdf);s.setScan('infected');assert.equal((await s.finalize(bad.json().id)).statusCode,422);assert.equal((await s.request('POST',`/${bad.json().id}/download-grants`)).statusCode,409);
});
