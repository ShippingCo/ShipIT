import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupShipmentCosts,costQuery as q,costHeaders as headers} from '../shipment-cost-support.ts';
import {setupCashClose} from '../cash-close-support.ts';
import {createSettingsService} from '../../src/modules/settings/service.ts';
import {createSalesService} from '../../src/modules/reports/sales-service.ts';
import {input as quoteInput} from '../pricing-support.ts';
import {taxFacts} from '../tax-support.ts';
import {A,B,org} from '../audit-support.ts';
await test('new quotes and reports pin accepted setting IDs, preserve legacy fingerprints and immutable historical source/EK evidence',{timeout:60000},async t=>{
 const s=await setupShipmentCosts(t);await s.db.prepareSettings();const settings=createSettingsService(s.pool,true),sales=createSalesService(s.pool);
 const update=(expected_version:number,changes:unknown)=>{const k=randomUUID();return settings.update(s.local.token,'franchise',q,k,headers(k),{expected_version,changes,reason:'Synthetic future preference'},randomUUID());};
 const before=(await s.db.adminQuery("SELECT jsonb_build_object('quotes',(SELECT jsonb_agg(result ORDER BY id) FROM shipit.pricing_quotes),'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM shipit.bookings b),'parcels',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shipit.parcels p)) value")).rows[0]!.value;
 const pref=await update(0,{booking_defaults:{service:'standard'},report_scope:{franchise_ids:[A]}});
 const sibling=await s.grant('franchise_admin',[B]),sk=randomUUID(),siblingSetting=await settings.update(sibling.token,'franchise',{organization_id:org,franchise_id:B},sk,headers(sk),{expected_version:0,reason:'Synthetic sibling preference',changes:{booking_defaults:{service:'standard'}}},randomUUID());
 for(const settings_version_id of [siblingSetting.version_id!,randomUUID()])await assert.rejects(s.pricing.quote(s.operator.token,org,A,randomUUID(),{...quoteInput,settings_version_id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const pricing={...quoteInput,settings_version_id:pref.version_id!},quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID());assert.equal(quote.inputs.settings_version_id,pref.version_id);
 const intentBody={quote_id:quote.id,pricing_input:pricing,facts:taxFacts},intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),intentBody,randomUUID()),calculation=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 const filter={...s.filter,settings_version_id:pref.version_id!},reportKey=randomUUID(),capture=await s.capture(filter,reportKey),salesKey=randomUUID(),salesReport=await sales.create(s.local.token,q,salesKey,headers(salesKey),{from_day:filter.from_day,to_day:filter.to_day,settings_version_id:filter.settings_version_id,...('franchise_ids' in filter?{franchise_ids:filter.franchise_ids}:{})},randomUUID());
 assert.equal(capture.snapshot.filter.settings_version_id,pref.version_id);assert.equal(salesReport.snapshot.filter.settings_version_id,pref.version_id);
 await update(1,{booking_defaults:{service:'express'},report_scope:null,collection_calendar:{timezone:'Asia/Kolkata',weekdays:[2,4],holidays:[]}});
 await assert.rejects(s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing,randomUUID()),{code:'VERSION_CONFLICT'});await assert.rejects(s.capture(filter),{code:'VERSION_CONFLICT'});
 assert.deepEqual(await s.capture(filter,reportKey),capture);assert.deepEqual(await sales.create(s.local.token,q,salesKey,headers(salesKey),{from_day:filter.from_day,to_day:filter.to_day,settings_version_id:filter.settings_version_id,...('franchise_ids' in filter?{franchise_ids:filter.franchise_ids}:{})},randomUUID()),salesReport);
 assert.deepEqual(await s.contribution.read(s.local.token,capture.snapshot.id,q,randomUUID()),capture);
 const after=(await s.db.adminQuery("SELECT jsonb_build_object('quotes',(SELECT jsonb_agg(result ORDER BY id) FROM shipit.pricing_quotes WHERE id<>$1),'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM shipit.bookings b),'parcels',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shipit.parcels p)) value",[quote.id])).rows[0]!.value;assert.deepEqual(after,before);
 // A valid already-issued quote remains valid after a preference change, and its exact source follows the booking.
 const booked=await s.booking.create(s.operator.token,org,A,randomUUID(),{customer_id:s.customer.id,expected_customer_version:1,tax_calculation_id:calculation.id,tax_intent:intentBody,parcels:[{weight_grams:999,recipient:{name:'Synthetic Settings Recipient',phone:'+1 202-555-0101',address:'21 Fictional Settings Street'}}]},randomUUID());
 assert.equal(booked.charges.pricing.inputs.settings_version_id,pref.version_id);
 const stored=(await s.db.adminQuery('SELECT pricing_snapshot FROM shipit.bookings WHERE id=$1',[booked.id])).rows[0]!.pricing_snapshot as {inputs:{settings_version_id:string}};assert.equal(stored.inputs.settings_version_id,pref.version_id);
});
await test('saved multi-franchise report reauthorization denies whole read and export after selected grant revocation',{timeout:60000},async t=>{
 const s=await setupShipmentCosts(t);await s.db.prepareSettings();const settings=createSettingsService(s.pool,true),sales=createSalesService(s.pool),multi=await s.grant('accountant',[A,B]);
 const key=randomUUID(),pref=await settings.update(s.admin.token,'organization',{organization_id:org},key,headers(key),{expected_version:0,reason:'Synthetic scoped preference',changes:{report_scope:{franchise_ids:[A,B]}}},randomUUID());
 const filter={...s.filter,franchise_ids:[A,B],settings_version_id:pref.version_id!},capture=await s.capture(filter,randomUUID(),multi),salesKey=randomUUID(),sale=await sales.create(multi.token,q,salesKey,headers(salesKey),{from_day:filter.from_day,to_day:filter.to_day,settings_version_id:filter.settings_version_id,...('franchise_ids' in filter?{franchise_ids:filter.franchise_ids}:{})},randomUUID());
 await s.memberships.revokeMembership(s.admin.token,multi.member.id,{expected_version:1});const invitation=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:multi.id,role:'accountant',franchise_ids:[A]});await s.memberships.acceptInvitation(multi.token,{token:invitation.acceptance_token});
 for(const exporting of [false,true]){await assert.rejects(s.contribution.read(multi.token,capture.snapshot.id,q,randomUUID(),exporting),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(sales.read(multi.token,sale.snapshot.id,q,randomUUID(),exporting),{code:'RESOURCE_NOT_FOUND'});}
 const view=await settings.read(multi.token,'franchise',q,randomUUID());assert.equal(view.values.report_scope.availability,'unavailable');assert.equal(view.values.report_scope.value,null);
});
await test('cutoff/default edits preserve accepted physical counts, current independent-review mode and receipts without closing actions',{timeout:60000},async t=>{
 const s=await setupCashClose(t);await s.db.prepareSettings();await s.receipt();const opening=await s.command('open',null,s.openBody),id=opening.session_id;
 const count=await s.command('count',id,{expected_version:1,counted_at:s.counted,counted_paise:600000,denominations:[],reason:'Synthetic complete count'}),submitted=await s.command('submit',id,{expected_version:2,count_id:count.command_id,reason:'Synthetic complete submission'});
 await s.command('decide',id,{expected_version:3,submission_id:submitted.command_id,kind:'approve',sole_admin_acknowledged:false,reason:'Synthetic independent approval'},s.local);
 const before=await s.closes.read(s.local.token,id,q,randomUUID()),evidence=(await s.db.adminQuery("SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shipit.money_receipts r),'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shipit.cash_close_commands c),'effects',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM shipit.cashbook_effects e)) value")).rows[0]!.value;
 const settings=createSettingsService(s.pool,true),key=randomUUID();await settings.update(s.local.token,'franchise',q,key,headers(key),{expected_version:0,reason:'Synthetic future cutoff intent',changes:{close_cutoff:{timezone:'Asia/Kolkata',minute:23},booking_defaults:{service:'express'}}},randomUUID());
 const after=await s.closes.read(s.local.token,id,q,randomUUID());assert.ok(after.current_controls!.as_of>=before.current_controls!.as_of);
 assert.deepEqual({...after,current_controls:{...after.current_controls,as_of:before.current_controls!.as_of}},before);
 assert.deepEqual((await s.db.adminQuery("SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shipit.money_receipts r),'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shipit.cash_close_commands c),'effects',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM shipit.cashbook_effects e)) value")).rows[0]!.value,evidence);
});
