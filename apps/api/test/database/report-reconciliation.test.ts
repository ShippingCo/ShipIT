import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconciliationSetup,q,headers} from '../report-reconciliation-support.ts';
import {org,A,B,C,otherOrg} from '../audit-support.ts';
import {createSalesService} from '../../src/modules/reports/sales-service.ts';
import {createAgeingService} from '../../src/modules/reports/ageing-service.ts';
import {createDailyService} from '../../src/modules/reports/daily-service.ts';
import {createAccountantService} from '../../src/modules/reports/accountant-service.ts';
import {createContributionService} from '../../src/modules/shipment-costs/contribution-service.ts';
import {createReconciliationReportService} from '../../src/modules/reconciliation/report-service.ts';
import {createFinancialAuditService} from '../../src/modules/reports/financial-audit-service.ts';
import {createAgentCashCaptureService} from '../../src/modules/agent-settlements/cash-capture-service.ts';
import {captureOwnerSummary} from '../../src/modules/reports/owner-summary-sources.ts';
import {withReportScope} from '../../src/modules/memberships/service.ts';
import {salesMeasures,type AccountantPage,type AccountantRow} from '@shippingco/shared';
import {csvRecords} from '../report-csv-support.ts';
import {createEwayService} from '../../src/modules/eway/service.ts';
import {createSettingsService} from '../../src/modules/settings/service.ts';
import {paymentFault,paymentSetup} from '../payment-support.ts';
import {buildServer} from '../../src/server.ts';
import {parseEnvironment} from '../../src/env.ts';
import {createOwnerSummaryService} from '../../src/modules/reports/owner-summary-service.ts';
import {createOwnerSummaryWorker} from '../../src/modules/reports/owner-summary-worker.ts';
import {createCashbookReportService} from '../../src/modules/cashbook/report-service.ts';
import {createCashCloseExportService} from '../../src/modules/cashbook/close-export-service.ts';
import {createAgentStatementService} from '../../src/modules/agent-settlements/statement-service.ts';
import {createAgentStatementExportService} from '../../src/modules/agent-settlements/export-service.ts';
import type {OwnerSummarySchedule} from '@shippingco/shared';

await test('Issue 67: one shop cycle reconciles independent sources; INR 2000 COD plus INR 100 freight is never INR 2100 revenue',{timeout:60000},async t=>{
 const s=await reconciliationSetup(t),sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta('franchise_admin');
 const salesKey=randomUUID(),salesService=createSalesService(s.pool),sales=await salesService.create(s.local.token,q,salesKey,headers,s.filter,randomUUID());
 assert.deepEqual(await salesService.create(s.local.token,q,salesKey,headers,s.filter,randomUUID()),sales);
 await assert.rejects(salesService.create(s.local.token,q,salesKey,headers,{...s.filter,sort:'confirmed_asc'},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(sales.snapshot.count,3);
 assert.deepEqual(sales.snapshot.totals,{pre_tax:'22800',taxable:'12800',non_taxable:'10000',cgst:'320',sgst:'320',igst:'0',gst:'640',rounding:'-40',gross:'23400',collections:'19000',refunds:'2000',outstanding:'6400',refundable_credit:'0'});
 const cod=sales.rows.find(r=>r.id===s.codBooking.id)!;assert.equal(cod.original.gross,'10000');assert.equal(cod.amounts.pre_tax,'10000');assert.equal(cod.amounts.collections,'10000');assert.equal(cod.amounts.outstanding,'0');
 assert.equal(sales.rows.reduce((n,r)=>n+BigInt(r.original.gross),0n),36800n);
 assert.deepEqual(sales.rows.find(r=>r.id===s.first.id)!.statement_ids,[s.originalStatement.id,s.statement.id].sort());
 assert.equal(s.statement.totals.outstanding,'6400');assert.equal(s.statement.unallocated_advance,'15000');
 const ageing=await createAgeingService(s.pool).create(s.local.token,q,randomUUID(),headers,{anchor:'due',balances:'all'},randomUUID());
 assert.equal(ageing.snapshot.totals.outstanding,'6400');assert.equal(ageing.snapshot.unallocated_advance,'15000');
 assert.equal(ageing.rows.find(r=>r.id===s.codBooking.id)!.due_at,null);assert.equal(ageing.rows.find(r=>r.id===s.codBooking.id)!.bucket,'unknown');
 assert.equal(ageing.rows.find(r=>r.id===s.first.id)!.account_revision_id,s.a.revision_id);
 const daily=await createDailyService(s.pool).create(s.local.token,q,randomUUID(),headers,{day:s.day,mode:'complete_day'},randomUUID());
 assert.equal(daily.snapshot.today.billed_gross,'23400');assert.equal(daily.snapshot.today.tax_exclusive_revenue,'22800');assert.equal(daily.snapshot.today.collections,'234000');assert.equal(daily.snapshot.today.refunds,'2000');assert.equal(daily.snapshot.today.outstanding,'6400');
 assert.notEqual(daily.snapshot.today.collections,sales.snapshot.totals.collections); // Receipt occurrence is not debt allocation.
 assert.equal(s.count.count!.expected_paise,'71500');assert.equal(s.count.count!.variance_paise,'-500');
 assert.equal((await s.position()).locations.find(l=>l.location_id===s.drawer.id)!.known_recorded_paise,'61500');
 assert.equal((await s.position()).locations.find(l=>l.location_id===s.held.id)!.known_recorded_paise,'0');
 const contribution=await createContributionService(s.pool).create(s.local.token,q,randomUUID(),headers,{...s.filter,effective_at:null,recorded_at:null},randomUUID());
 assert.equal(contribution.rows.find(r=>r.id===s.codBooking.id)!.contribution_paise,'4000');assert.equal(contribution.rows.find(r=>r.id===s.first.id)!.state,'incomplete');assert.equal(contribution.snapshot.totals.contribution_paise,null);
 const matched=await createReconciliationReportService(s.pool).capture(s.local.token,q,randomUUID(),headers,{...s.filter,account_id:s.card.id},randomUUID());
 assert.ok(matched.rows.some(r=>r.kind==='transaction'&&r.amount_paise==='4900'&&r.status==='verified'));
 assert.ok(matched.rows.some(r=>r.kind==='transaction'&&r.amount_paise==='700'&&r.remaining_paise==='700'&&r.status==='unassigned'));
 const captures=createAgentCashCaptureService(s.pool,true),agent=await captures.capture(s.operator.token,q,randomUUID(),headers,{agent_id:s.agent.id,day:s.day,counted_at:new Date().toISOString(),counted_paise:0,reason:'Fictional settled custody'},randomUUID());
 const finance=agent.source_snapshot.finance as {totals:{cod_collected_paise:string;cod_remitted_paise:string;origin_receipt_seller_liability_paise:string}};
 assert.equal(finance.totals.cod_collected_paise,'200000');assert.equal(finance.totals.cod_remitted_paise,'150000');assert.equal(finance.totals.origin_receipt_seller_liability_paise,'50000');
 const statements=createAgentStatementService(s.pool,true),submission=await statements.submit(s.operator.token,q,randomUUID(),headers,{capture_id:agent.id,previous_submission_id:null,expected_version:0,reason:'Fictional custody and separate liabilities submitted'},randomUUID());
 await statements.decide(s.local.token,submission.id,q,randomUUID(),headers,{kind:'approve',expected_version:1,reason:'Independent fictional source review'},randomUUID());
 const reviewed=await statements.read(s.accountant.token,submission.id,q,randomUUID());assert.equal(reviewed.status,'approved');assert.deepEqual(reviewed.source_snapshot,agent.source_snapshot);
 const cashbook=await createCashbookReportService(s.pool).capture(s.local.token,q,randomUUID(),headers,s.filter,randomUUID());
 assert.equal(cashbook.snapshot.position.locations.find(l=>l.location_id===s.drawer.id)!.known_recorded_paise,'61500');
 const owner=await withReportScope(s.pool,s.local.token,org,A,false,randomUUID(),(scope,cutoff)=>captureOwnerSummary(scope,{frequency:'daily',timezone:'Asia/Kolkata',from:s.at(0),to:cutoff!,label:s.day},cutoff!),[A],true);
 assert.deepEqual(owner.metrics,daily.snapshot.today);assert.equal(owner.expenses_paise,'3100');assert.equal(owner.agent_held_known_paise,'0');assert.equal(owner.cash_differences_paise,'500');assert.ok(owner.reconciliation_exceptions>0);
 const summaries=createOwnerSummaryService(s.pool,true),failures:string[]=[];
 const schedule=await summaries.save(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional integrated daily summary',timing:{frequency:'daily',timezone:'Asia/Kolkata',minute:0,weekday:1},franchise_ids:[A],recipient_ids:[s.local.id,s.accountant.id],enabled:true,whatsapp:false,corrections:true,alerts:{enabled:false,notify:false,minimum_paise:'100',minimum_overdue_days:1,repeat_hours:null}},randomUUID()) as OwnerSummarySchedule;
 // Inject tomorrow's dispatch clock; sources/capture timestamps remain actual DB facts.
 const worker=createOwnerSummaryWorker(s.pool,undefined,{enabled:true,clock:()=>new Date(s.start+86400000),onFailure:code=>failures.push(code)});
 await worker.tick();assert.deepEqual(failures,[]);
 const history=await summaries.workspace(s.local.token,q,randomUUID()),run=history.runs.find(r=>r.schedule_id===schedule.id)!;assert.ok(run);
 const summary=await summaries.report(s.accountant.token,run.id,q,randomUUID());assert.ok(summary.snapshot);
 assert.deepEqual(summary.snapshot.metrics,daily.snapshot.today);assert.equal(summary.snapshot.expenses_paise,'3100');assert.equal(summary.snapshot.cash_differences_paise,'500');
 await worker.tick();assert.equal((await summaries.workspace(s.local.token,q,randomUUID())).runs.length,history.runs.length);
 const register=createAccountantService(s.pool),page=await register.create(s.local.token,q,randomUUID(),headers,s.filter,randomUUID());
 const rows:AccountantRow[]=[...page.rows];let offset=page.next_offset;
 while(offset!==null){const p=await register.read(s.local.token,page.snapshot.id,{...q,offset:String(offset)},randomUUID()) as AccountantPage;rows.push(...p.rows);offset=p.next_offset;}
 const sum=(family:string,field:string)=>rows.filter(r=>r.family===family).reduce((n,r)=>n+BigInt(r.fields[field]??0),0n);
 assert.equal(sum('sales','gross_paise'),36800n);assert.equal(sum('receipts','received_paise'),234000n);assert.equal(sum('allocations','allocated_paise'),19000n);assert.equal(sum('refunds','refunded_paise'),2000n);assert.equal(sum('cashbook','expense_paise'),3100n);assert.equal(sum('cod_reservations','reserved_paise'),200000n);
 assert.ok(page.snapshot.controls.length>0);for(const c of page.snapshot.controls)assert.equal(c.difference_paise,'0',c.family+':'+c.column);
 const bundle=await register.read(s.local.token,page.snapshot.id,q,randomUUID(),true);assert.ok('files' in bundle);assert.equal(bundle.snapshot.mapping_version,'generic_csv_v1');
 const audit=await createFinancialAuditService(s.pool).captureAudit(s.local.token,q,randomUUID(),headers,s.filter,randomUUID());assert.ok(audit.rows.some(r=>r.kind==='cancellation'));
 // Independently inspect authoritative persisted facts, not just successful projections.
 assert.deepEqual((await s.owner.query(`SELECT (SELECT sum(amount_paise)::text FROM shipit.money_receipts) received,
  (SELECT count(*)::int FROM shipit.money_receipts) receipts,(SELECT count(*)::int FROM shipit.bookings) bookings,
  (SELECT count(*)::int FROM shipit.reconciliation_transactions) transactions`)).rows[0],{received:'234000',receipts:5,bookings:3,transactions:2});
 assert.deepEqual((await s.owner.query('SELECT expense_paise::text,cash_paid_paise::text,advance_applied_paise::text,remaining_paise::text FROM shipit.agent_fee_positions WHERE earning_id=$1',[s.earning.resource_id])).rows[0],{expense_paise:'2000',cash_paid_paise:'500',advance_applied_paise:'500',remaining_paise:'1000'});
 for(const sql of ['UPDATE shipit.money_receipts SET amount_paise=1','DELETE FROM shipit.financial_changes','UPDATE shipit.report_snapshots SET rows=\'[]\''])await assert.rejects(s.pool.query(sql));
 assert.equal((await s.pool.query('SELECT current_user AS role')).rows[0]!.role,s.db.runtimeRole);
 const safe=JSON.stringify({sales,ageing,daily,owner,register:page,logs:s.logs});for(const value of [s.local.token,s.source.phone,s.source.address,'=FICTIONAL_REFERENCE'])if(typeof value==='string')assert.ok(!safe.includes(value));
 // Save source-linked outputs for the following authorization and immutability checks.
 for(const [actor,scope] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
  for(const id of [page.snapshot.id,randomUUID()])await assert.rejects(register.read(actor.token,id,scope,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
 }

 await t.test('saved API and every CSV retain row identity, controls and original source versions',async()=>{
  const exports=[
   [await createCashbookReportService(s.pool).read(s.local.token,q,cashbook.snapshot.id,randomUUID(),true),cashbook.rows.map(r=>r.id),'id'],
   [await createSalesService(s.pool).read(s.local.token,sales.snapshot.id,q,randomUUID(),true),sales.rows.map(r=>r.id),'booking_id'],
   [await createAgeingService(s.pool).read(s.local.token,ageing.snapshot.id,q,randomUUID(),true),ageing.rows.map(r=>r.id),'booking_id'],
   [await createDailyService(s.pool).read(s.local.token,daily.snapshot.id,q,randomUUID(),true),daily.rows.map(r=>r.id),'source_id'],
   [await createContributionService(s.pool).read(s.local.token,contribution.snapshot.id,q,randomUUID(),true),contribution.rows.map(r=>r.id),'booking_id'],
   [await createReconciliationReportService(s.pool).read(s.local.token,matched.snapshot.id,q,randomUUID(),true),matched.rows.map(r=>r.id),'id'],
   [await createFinancialAuditService(s.pool).readAudit(s.local.token,q,audit.snapshot.id,randomUUID(),true),audit.rows.map(r=>r.id),'id'],
  ] as const;
  for(const [exported,ids,column] of exports){assert.ok('csv' in exported);const decoded=csvRecords(exported.csv);assert.deepEqual(decoded.map(r=>r[column]).sort(),[...ids].sort());assert.ok(decoded.every(r=>r.snapshot_id===exported.snapshot.id&&(r.as_of??r.captured_at)===exported.snapshot.as_of),exported.snapshot.definition);}
  const salesExport=exports[1][0];assert.ok('csv' in salesExport);const salesCsv=csvRecords(salesExport.csv);
  for(const measure of salesMeasures){
   // Existing general report CSV protects a leading minus with an apostrophe.
   const exact=(value:string)=>BigInt(value.replace(/^'(?=-[0-9]+$)/,''));
   assert.equal(salesCsv.reduce((n,row)=>n+exact(row[measure+'_paise']!),0n).toString(),sales.snapshot.totals[measure]);
   for(const row of salesCsv)assert.equal(exact(row[measure+'_paise']!).toString(),sales.rows.find(r=>r.id===row.booking_id)!.amounts[measure]);
  }
  assert.ok('files' in bundle);
  for(const file of bundle.files){const family=file.name.replace('.csv','');if(!rows.some(r=>r.family===family))continue;assert.doesNotThrow(()=>csvRecords(file.csv),file.name);const decoded=csvRecords(file.csv);assert.deepEqual(decoded.map(r=>r.event_line_id).sort(),rows.filter(r=>r.family===family).map(r=>r.id).sort());
   for(const control of page.snapshot.controls.filter(c=>c.family===family)){
    const selected=decoded.filter(r=>r.basis===control.basis);
    for(const row of selected)if(row[control.column]==='unknown')assert.equal(rows.find(r=>r.id===row.event_line_id)!.fields[control.column]??null,null);
    assert.equal(selected.filter(r=>r[control.column]!=='unknown').reduce((n,r)=>n+BigInt(r[control.column]!),0n).toString(),control.source_paise);
   }}
  const closeExports=createCashCloseExportService(s.pool),closeMeta=await closeExports.capture(s.local.token,s.count.session_id,q,randomUUID(),headers,{capture_id:s.count.command_id},randomUUID()),closeCsv=await closeExports.download(s.local.token,closeMeta.id,q,randomUUID());
  const physical=csvRecords(closeCsv.csv).find(r=>r.record_kind==='physical_count')!;assert.equal(physical.expected_paise,'71500');assert.equal(physical.counted_paise,'71000');assert.equal(physical.variance_paise,"'-500");assert.equal(physical.review_mode,'independent');
  const agentExports=createAgentStatementExportService(s.pool),agentMeta=await agentExports.capture(s.local.token,submission.id,q,randomUUID(),headers,{},randomUUID()),agentCsv=await agentExports.read(s.local.token,agentMeta.id,q,randomUUID(),true);assert.ok(typeof agentCsv.csv==='string');assert.equal(agentMeta.status,'approved');assert.ok(csvRecords(agentCsv.csv).length>0);
  const summaryCsv=await summaries.report(s.accountant.token,run.id,q,randomUUID(),true);assert.ok(typeof summaryCsv.csv==='string');const summaryRows=csvRecords(summaryCsv.csv);
  for(const metric of ['billed_gross','tax_exclusive_revenue','collections','refunds','outstanding'] as const)assert.equal(summaryRows.filter(r=>r.kind===metric).reduce((n,r)=>n+BigInt(r.amount_paise!),0n).toString(),daily.snapshot.today[metric]);
  const refs=await register.create(s.accountant.token,q,randomUUID(),headers,{...s.filter,include_references:true},randomUUID()),exported=await register.read(s.accountant.token,refs.snapshot.id,q,randomUUID(),true);assert.ok('files' in exported);
  assert.ok(exported.files.find(f=>f.name==='receipts.csv')!.csv.includes("'=FICTIONAL_REFERENCE"));
  assert.ok(csvRecords(exported.files.find(f=>f.name==='sales.csv')!.csv).some(r=>r.rounding_paise==='-40'));
  assert.equal(refs.snapshot.qualification,'generic_only');assert.equal(refs.snapshot.filter.format,'generic_csv_v1');
  const artifact=await s.service.captureStatementExport(s.local.token,s.statement.id,q,randomUUID(),headers,{},randomUUID()),statementCsv=await s.service.statementExport(s.local.token,artifact.id,q,randomUUID());assert.deepEqual(statementCsv.statement,s.statement);
  const original=JSON.stringify({sales,bundle,statement:s.statement,count:s.count});
  await s.db.prepareSettings();const settings=createSettingsService(s.pool,true);
  await settings.update(s.local.token,'franchise',q,randomUUID(),headers,{expected_version:0,reason:'Fictional new report scope preference',changes:{report_scope:{franchise_ids:[A]}}},randomUUID());
  // A late approved reduction changes a fresh capture, never the captured tax or prior evidence.
  await s.adjust({booking_id:s.first.id,expected_version:0,payment_version:2,kind:'discount',reason:'customer_agreement',pre_tax:100,taxable:100});
  const changed=await createSalesService(s.pool).create(s.local.token,q,randomUUID(),headers,s.filter,randomUUID());assert.equal(changed.snapshot.totals.gross,'23300');assert.equal(changed.snapshot.totals.outstanding,'6300');assert.equal(changed.rows.find(r=>r.id===s.first.id)!.original.gross,'13400');
  assert.deepEqual(await createSalesService(s.pool).read(s.local.token,sales.snapshot.id,q,randomUUID()),sales);assert.deepEqual(await register.read(s.local.token,page.snapshot.id,q,randomUUID(),true),bundle);assert.deepEqual(await s.service.accountStatement(s.local.token,s.statement.id,q,randomUUID()),s.statement);
  assert.equal(JSON.stringify({sales,bundle,statement:s.statement,count:s.count}),original);
  assert.deepEqual(await s.service.statementExport(s.local.token,artifact.id,q,randomUUID()),statementCsv);
  await s.owner.query('UPDATE shipit.owner_report_schedules SET next_check=clock_timestamp() WHERE id=$1',[schedule.id]);await worker.tick();assert.deepEqual(failures,[]);
  const corrected=(await summaries.workspace(s.local.token,q,randomUUID())).runs.find(r=>r.corrected_from===run.id)!;assert.ok(corrected);const result=await summaries.report(s.local.token,corrected.id,q,randomUUID());assert.ok(result.snapshot);assert.equal(result.snapshot.metrics.outstanding,'6300');assert.equal(result.snapshot.metrics.billed_gross,'23300');assert.deepEqual(await summaries.report(s.accountant.token,run.id,q,randomUUID()),summary);
 });

 await t.test('e-way source-supported validity, estimate and unknown remain independent',async()=>{
  const eway=createEwayService(s.pool,s.keys.browser,s.clock),official='2099-01-04T00:00:00Z';
  await s.owner.query(`INSERT INTO shipit.eway_policies(id,organization_id,franchise_id,version,approved,effective_from,source_ref,approval_ref,threshold_paise,warning_seconds,estimate_rule,block_km,block_seconds)
   VALUES($1,$2,$3,1,true,'2099-01-01T00:00:00Z','FICTIONAL_POLICY','FICTIONAL_APPROVAL',200000,60,'distance_blocks_v1',10,100)`,[randomUUID(),org,A]);
  const external={issuer:'FICTIONAL_EXTERNAL',reference:'FICTIONAL_EWAY_1',source_ref:'FICTIONAL_SOURCE',issued_at:'2099-01-01T00:00:00Z',official_valid_until:official,validity_evidence_ref:'FICTIONAL_EVIDENCE'};
  await eway.mutate('create',s.operator.token,s.codBooking.id,randomUUID(),{external,distance_km:53},q,randomUUID());
  await eway.mutate('estimate',s.operator.token,s.codBooking.id,randomUUID(),{expected_version:1,reason_ref:'FICTIONAL_ESTIMATE',starts_at:'2099-01-02T00:00:00Z'},q,randomUUID());
  const initial=await eway.read(s.accountant.token,s.codBooking.id,q,randomUUID());assert.equal(initial.state.official_validity_state,'source_supported');assert.equal(initial.state.verification_state,'unverified_external');assert.equal(initial.record!.estimate!.provenance,'shippingco_estimate');
  assert.equal(initial.record!.external!.official_valid_until,official);assert.notEqual(initial.record!.estimate!.estimated_valid_until,official);
  await eway.mutate('correct',s.operator.token,s.codBooking.id,randomUUID(),{expected_version:2,reason_code:'metadata_correction',reason_ref:'FICTIONAL_DISTANCE',distance_km:1000},q,randomUUID());
  const revised=await eway.read(s.accountant.token,s.codBooking.id,q,randomUUID());assert.deepEqual(revised.record!.estimate,initial.record!.estimate);assert.deepEqual(revised.record!.external,initial.record!.external);
  assert.equal((await eway.read(s.local.token,s.first.id,q,randomUUID())).state.official_validity_state,'unknown');
  assert.equal((await eway.list('history',s.accountant.token,s.codBooking.id,q,randomUUID())).items.length,3);
  assert.ok(!JSON.stringify(revised).includes(s.seller.phone));
 });

 await t.test('runtime HTTP drill-through, restart, foreign resources and revocation fail closed',async()=>{
  const call=(path:string,actor:{id:string;token:string}=s.local,scope:Record<string,string>=q,body?:unknown,key=randomUUID())=>s.app.inject({method:body===undefined?'GET':'POST',url:'/api/v1/'+path+'?'+new URLSearchParams(scope),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  const response=await call('reports/sales/'+sales.snapshot.id);assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json(),sales);assert.equal(response.headers['cache-control'],'no-store');
  assert.equal((await call('finance/bookings/'+s.first.id)).json().collections,'7000');assert.deepEqual((await call('finance/statements/'+s.statement.id)).json(),s.statement);
  const adminReport=await call('reports/sales',s.admin,q,s.filter);assert.equal(adminReport.statusCode,200,adminReport.body);assert.equal((await call('reports/sales/'+adminReport.json().snapshot.id+'/export',s.admin)).statusCode,403);
  assert.equal((await call('reports/sales',s.reader,q,s.filter)).statusCode,403);
  assert.equal((await call('finance/bookings/'+s.first.id,s.accountant)).statusCode,200);assert.equal((await call('finance/bookings/'+s.first.id,s.reader)).statusCode,403);
  const detail=await createFinancialAuditService(s.pool).auditDetail(s.local.token,q,audit.snapshot.id,audit.rows[0]!.id,randomUUID());assert.deepEqual(detail.row,audit.rows[0]);
  const readPool=s.db.runtimePool(),config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const restarted=buildServer({config,database:readPool,auth:{keys:s.keys,delivery:{},webhook:undefined}});try{const loaded=await restarted.inject({url:'/api/v1/reports/sales/'+sales.snapshot.id+'?'+new URLSearchParams(q),cookies:s.cookies(s.local.token)});assert.equal(loaded.statusCode,200);assert.deepEqual(loaded.json(),sales);}finally{await restarted.close();await readPool.close();}
  const faultPool=s.db.runtimePool(),unavailable=buildServer({config,database:paymentFault(faultPool,'FROM shipit.report_snapshots','before'),auth:{keys:s.keys,delivery:{},webhook:undefined}});
  try{const failed=await unavailable.inject({url:'/api/v1/reports/sales/'+sales.snapshot.id+'?'+new URLSearchParams(q),cookies:s.cookies(s.local.token)});assert.equal(failed.statusCode,503);assert.equal(failed.json().error.code,'TEMPORARILY_UNAVAILABLE');for(const secret of [s.local.token,s.source.phone,'SELECT','stack'])assert.ok(!failed.body.includes(secret));}finally{await unavailable.close();await faultPool.close();}
  const targets=['reports/sales/'+sales.snapshot.id,'reports/sales/'+sales.snapshot.id+'/export','reports/ageing/'+ageing.snapshot.id+'/export','reports/daily/'+daily.snapshot.id+'/export','reports/accountant/'+page.snapshot.id+'/export','finance/bookings/'+s.first.id,'finance/statements/'+s.statement.id,'bookings/'+s.codBooking.id+'/eway'];
  for(const [actor,scope] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const){
   for(const target of targets){const denied=await call(target,actor,scope),missing=await call(target.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/,randomUUID()),actor,scope);assert.equal(denied.statusCode,404,target);assert.equal(denied.json().error.code,missing.json().error.code);assert.ok(!denied.body.includes(s.first.id));}
   const empty=await call('reports/sales',actor,scope,s.filter);assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().snapshot.count,0);assert.equal(empty.json().snapshot.totals.gross,'0');assert.deepEqual(empty.json().rows,[]);
  }
  for(const body of [{...s.filter,to_day:'bad'},{...s.filter,franchise_ids:[A,C]},{...s.filter,actor_id:s.admin.id}]){const rejected=await call('reports/sales',s.local,q,body);assert.ok([404,422].includes(rejected.statusCode));assert.ok(!rejected.body.includes('stack'));}
  const before=(await s.owner.query('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0];await assert.rejects(createSalesService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before')).create(s.local.token,q,randomUUID(),headers,s.filter,randomUUID()));assert.deepEqual((await s.owner.query('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0],before);
  const events=(await s.owner.query('SELECT actor_id,organization_id,franchise_id,snapshot_id,action,correlation_id FROM shipit.report_access_events WHERE snapshot_id=$1',[sales.snapshot.id])).rows;
  assert.ok(events.some(e=>e.action==='report.capture'));assert.ok(events.some(e=>e.action==='report.export'));assert.ok(events.every(e=>e.actor_id===s.local.id&&e.organization_id===org&&e.franchise_id===A&&e.correlation_id));
  const projected=await s.audit.list(s.accountant.token,{organization_id:org,franchise_id:A},randomUUID());assert.ok(projected.items.length>0);assert.ok(!JSON.stringify(projected).includes(s.source.phone));
  const accountantOwn=await register.create(s.accountant.token,q,randomUUID(),headers,s.filter,randomUUID());
  await s.memberships.revokeMembership(s.admin.token,s.accountant.member.id,{expected_version:1});
  await assert.rejects(register.read(s.accountant.token,accountantOwn.snapshot.id,q,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});
  for(const target of targets)assert.equal((await call(target)).statusCode,404,target);
  assert.equal((await call('reports/sales/'+sales.snapshot.id,s.local,{...q,offset:'100'})).statusCode,404);
  assert.ok(!s.logs.join('').includes(s.local.token));
 });
});

await test('Issue 67: Kolkata month-end API, CSV, grouped GST and accountant rows use identical half-open dates',{timeout:60000},async t=>{
 const s=await paymentSetup(t,100000);await s.db.prepareReports();await s.db.prepareAgentMoney();await s.db.prepareReconciliation();
 const ids=[s.bookingId];for(let i=0;i<3;i++){const r=await s.book(s.paymentBookingInput);assert.equal(r.statusCode,201,r.body);ids.push(r.json().id);}
 const instants=['2026-01-30T18:29:59.999Z','2026-01-30T18:30:00.000Z','2026-01-31T18:29:59.999Z','2026-01-31T18:30:00.000Z'],owner=s.db.ownerPool();t.after(()=>owner.close());
 await owner.query('BEGIN');try{await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');for(let i=0;i<ids.length;i++)await owner.query('UPDATE shipit.bookings SET confirmed_at=$1 WHERE id=$2',[instants[i],ids[i]]);await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');await owner.query('COMMIT');}catch(e){await owner.query('ROLLBACK');throw e;}
 const service=createSalesService(s.pool),filter={from_day:'2026-01-31',to_day:'2026-01-31'},page=await service.create(s.local.token,q,randomUUID(),headers,filter,randomUUID());
 assert.deepEqual(page.rows.map(r=>r.id).sort(),ids.slice(1,3).sort());assert.equal(page.snapshot.totals.gross,'200000');assert.equal(page.snapshot.timezone,'Asia/Kolkata');assert.equal(page.snapshot.groups.reduce((n,g)=>n+BigInt(g.amounts.gross),0n),200000n);
 const exported=await service.read(s.local.token,page.snapshot.id,q,randomUUID(),true);assert.ok('csv' in exported);const rows=csvRecords(exported.csv);assert.deepEqual(rows.map(r=>r.booking_id).sort(),ids.slice(1,3).sort());assert.ok(rows.every(r=>r.from_day==='2026-01-31'&&r.to_day==='2026-01-31'&&r.timezone==='Asia/Kolkata'));
 const accountant=await createAccountantService(s.pool).create(s.local.token,q,randomUUID(),headers,filter,randomUUID());assert.deepEqual(accountant.rows.filter(r=>r.family==='sales'&&r.basis==='period').map(r=>r.fields.source_id).sort(),ids.slice(1,3).sort());
 const daily=await createDailyService(s.pool).create(s.local.token,q,randomUUID(),headers,{day:'2026-01-31',mode:'complete_day'},randomUUID());assert.equal(daily.snapshot.today.billed_gross,'200000');assert.equal(daily.snapshot.yesterday.billed_gross,'100000');
 const next=await service.create(s.local.token,q,randomUUID(),headers,{from_day:'2026-02-01',to_day:'2026-02-01'},randomUUID());assert.deepEqual(next.rows.map(r=>r.id),[ids[3]]);
});
