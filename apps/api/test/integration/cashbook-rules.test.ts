import {test} from 'vitest';
import assert from 'node:assert/strict';
import {cashbookPosition,movementLegs,correctionLegs,handoverPosition,acknowledgementLegs,maximumPaise,type CashbookFact,type CashLeg,type SourceKind} from '../../src/modules/cashbook/rules.ts';
const facts=(source_kind:SourceKind,source_id:string,legs:CashLeg[]):CashbookFact[]=>legs.map(leg=>({...leg,source_kind,source_id}));
const cash='cash-operator',bank='bank-account',other='cash-receiver';
// Source fixtures are actual received amounts, never booking allocation/release amounts.
const received:CashbookFact={source_kind:'receipt',source_id:'receipt',location_id:cash,direction:'in',amount_paise:400000n};
const setup=()=>[...facts('opening_float','opening',movementLegs('opening_float',100000n,cash,null,0n)),received];

test('1000 float + 4000 actual cash - 500 expense = 4500; noncash expense and allocation bookkeeping cannot change drawer',()=>{
 const source=setup(),copy=structuredClone(source);
 source.push(...facts('expense','expense',movementLegs('expense',50000n,cash,null,cashbookPosition(source,cash).available)));
 source.push({source_kind:'receipt',source_id:'upi-receipt',location_id:bank,direction:'in',amount_paise:30000n});
 source.push(...facts('expense','upi-expense',movementLegs('expense',10000n,bank,null,30000n)));
 assert.deepEqual(cashbookPosition(source,cash),{inflows:500000n,outflows:50000n,recorded:450000n,reserved:0n,available:450000n,shortfall:0n,unknown_sources:0,state:'recorded'});
 assert.equal(cashbookPosition(source,bank).recorded,20000n);
 // Changing customer allocation is represented by no custody leg; original receipt remains unchanged.
 assert.deepEqual(source.slice(0,2),copy);assert.equal(cashbookPosition(source,cash).recorded,450000n);
 assert.throws(()=>cashbookPosition([...source,received],cash),{code:'CASHBOOK_CONFLICT'});
});

test('deposit and withdrawal preserve total owned money with exact linked opposite legs',()=>{
 const source=setup(),before=cashbookPosition(source,cash).recorded;
 const deposit=movementLegs('deposit',200000n,cash,bank,before);assert.deepEqual(deposit,[{location_id:cash,direction:'out',amount_paise:200000n},{location_id:bank,direction:'in',amount_paise:200000n}]);
 source.push(...facts('deposit','deposit',deposit));assert.equal(cashbookPosition(source,cash).recorded,300000n);assert.equal(cashbookPosition(source,bank).recorded,200000n);
 source.push(...facts('withdrawal','withdrawal',movementLegs('withdrawal',50000n,bank,cash,200000n)));
 assert.equal(cashbookPosition(source,cash).recorded+cashbookPosition(source,bank).recorded,before);
 for(const target of [cash,null])assert.throws(()=>movementLegs('deposit',1n,cash,target,1n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>movementLegs('expense',1n,cash,bank,1n),{code:'CASHBOOK_CONFLICT'});
});

test('unacknowledged handover retains possession, reserves only pending remainder and partial/rejected history remains exact',()=>{
 const source=setup(),request=200000n,acks=[{id:'ack1',amount_paise:80000n}];
 assert.equal(cashbookPosition(source,cash,[request]).recorded,500000n);assert.equal(cashbookPosition(source,cash,[request]).available,300000n);assert.equal(cashbookPosition(source,other).recorded,0n);
 source.push(...facts('handover','ack1',acknowledgementLegs(request,[],80000n,cash,other,500000n)));
 const partial=handoverPosition(request,acks);assert.deepEqual(partial,{requested:request,accepted:80000n,remaining:120000n,rejected:0n,state:'partially_accepted'});
 assert.equal(cashbookPosition(source,cash,[partial.remaining]).available,300000n);assert.equal(cashbookPosition(source,other).recorded,80000n);
 assert.deepEqual(handoverPosition(request,acks,true),{requested:request,accepted:80000n,remaining:0n,rejected:120000n,state:'rejected'});
 assert.throws(()=>acknowledgementLegs(request,acks,120001n,cash,other,420000n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>acknowledgementLegs(request,acks,1n,cash,other,420000n,true),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>handoverPosition(request,[...acks,...acks]),{code:'CASHBOOK_CONFLICT'});
 source.push(...facts('handover','ack2',acknowledgementLegs(request,acks,120000n,cash,other,420000n)));
 assert.equal(handoverPosition(request,[...acks,{id:'ack2',amount_paise:120000n}]).state,'accepted');
 assert.equal(cashbookPosition(source,cash).recorded+cashbookPosition(source,other).recorded,500000n);
});

test('prior expense correction appends a linked delta, never rewrites original; truthful correction can expose an exception',()=>{
 const source=setup(),original=facts('expense','old-expense',movementLegs('expense',50000n,cash,null,500000n));source.push(...original);
 const saved=structuredClone(original);source.push(...facts('correction','corrected-expense',correctionLegs('expense',50000n,30000n,cash,null)));
 assert.deepEqual(original,saved);assert.equal(cashbookPosition(source,cash).recorded,470000n);
 source.push(...facts('correction','correction-again',correctionLegs('expense',30000n,600000n,cash,null)));
 const after=cashbookPosition(source,cash);assert.equal(after.recorded,-100000n);assert.equal(after.state,'exception');assert.equal(after.available,0n);
 assert.throws(()=>movementLegs('expense',1n,cash,null,after.available),{code:'CASHBOOK_CONFLICT'});
 assert.deepEqual(correctionLegs('expense',30000n,30000n,cash,null),[]);
 const pair=correctionLegs('deposit',200000n,150000n,cash,bank);assert.equal(pair[0]!.direction,'in');assert.equal(pair[1]!.direction,'out');assert.equal(pair[0]!.amount_paise,pair[1]!.amount_paise);
});

test('actual refund is one outflow and refund recording correction changes meaning without inventing another actual transfer',()=>{
 const source=setup();source.push({source_kind:'refund',source_id:'refund',location_id:cash,direction:'out',amount_paise:20000n});
 source.push({source_kind:'refund_correction',source_id:'refund-correction',location_id:cash,direction:'in',amount_paise:5000n});
 assert.equal(cashbookPosition(source,cash).recorded,485000n);
 const unknown=cashbookPosition(source,cash,[],1);assert.equal(unknown.recorded,485000n);assert.equal(unknown.state,'incomplete');assert.equal(unknown.unknown_sources,1);
 assert.throws(()=>cashbookPosition([{...received,direction:'out'}],cash),{code:'CASHBOOK_CONFLICT'});
});

test('integer limits, gross turnover, capacity and shortage remain exact without unsafe conversion',()=>{
 assert.equal(cashbookPosition([{...received,amount_paise:maximumPaise},{...received,source_id:'second',amount_paise:1n},{...received,source_kind:'expense',source_id:'out',direction:'out',amount_paise:1n}],cash).recorded,maximumPaise);
 assert.throws(()=>cashbookPosition([{...received,amount_paise:maximumPaise},{...received,source_id:'second',amount_paise:1n}],cash),{code:'CASHBOOK_CONFLICT'});
 for(const value of [0n,-1n,maximumPaise+1n])assert.throws(()=>movementLegs('expense',value,cash,null,maximumPaise),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>movementLegs('expense',2n,cash,null,1n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>acknowledgementLegs(2n,[],2n,cash,other,1n),{code:'CASHBOOK_CONFLICT'});
 const short=cashbookPosition([{...received,amount_paise:1n}],cash,[2n]);assert.equal(short.shortfall,1n);assert.equal(short.state,'exception');assert.equal(short.available,0n);
});


test('location input normalizes safe labels but rejects controls, unpaired surrogates and caller ownership fields',async()=>{
 const {locationInput}=await import('../../src/modules/cashbook/location-service.ts');
 const body={account_id:'11111111-1111-4111-8111-111111111111',expected_account_version:1,custodian_id:null,name:' Synthetic drawer ',active:true,expected_version:0};
 assert.equal(locationInput(body).name,'Synthetic drawer');assert.equal(locationInput({...body,name:'Synthetic 📦'}).name,'Synthetic 📦');
 for(const name of ['', ' ', 'x'.repeat(121), 'Synthetic'+String.fromCharCode(0), 'Synthetic'+String.fromCharCode(159), String.fromCharCode(0xd800)])assert.throws(()=>locationInput({...body,name}),{code:'VALIDATION_FAILED'});
 for(const extra of [{organization_id:body.account_id},{franchise_id:body.account_id},{approved:true},{balance_paise:1000}])assert.throws(()=>locationInput({...body,...extra}),{code:'VALIDATION_FAILED'});
});

test('expense proposals validate exact money, private fields, paired sources and reject refund/ownership/approval mass assignment',async()=>{
 const {cashbookRequestInput,cashbookDecisionInput}=await import('../../src/modules/cashbook/request-service.ts');
 const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',body={kind:'expense',source_location_id:id,source_revision_id:id,target_location_id:null,target_revision_id:null,expected_source_version:2,amount_paise:50000,currency:'INR',category:'supplies',payee:' Synthetic vendor ',responsible_employee_id:id,reason:' Synthetic receipt ',occurred_at:'2026-01-01T00:00:00Z'};
 assert.equal(cashbookRequestInput(body).payee,'Synthetic vendor');assert.equal(cashbookRequestInput(body).occurred_at,'2026-01-01T00:00:00Z');
 for(const changes of [{kind:'refund'},{category:'refund'},{amount_paise:0},{amount_paise:0.5},{amount_paise:Number.MAX_SAFE_INTEGER+1},{currency:'USD'},{payee:' '},{reason:String.fromCharCode(0xd800)},{target_location_id:other,target_revision_id:other},{actor_id:id},{approved:true},{balance_paise:50000}])assert.throws(()=>cashbookRequestInput({...body,...changes}),{code:'VALIDATION_FAILED'});
 const deposit={...body,kind:'deposit',category:null,payee:null,target_location_id:other,target_revision_id:other};assert.equal(cashbookRequestInput(deposit).kind,'deposit');
 for(const changes of [{target_location_id:null},{target_location_id:id},{category:'supplies'},{payee:'vendor'}])assert.throws(()=>cashbookRequestInput({...deposit,...changes}),{code:'VALIDATION_FAILED'});
 assert.deepEqual(cashbookDecisionInput({decision:'approved',reason:' Synthetic review ',expected_version:1}),{decision:'approved',reason:'Synthetic review',expected_version:1});
 for(const changes of [{expected_version:2},{decision:'applied'},{amount_paise:1},{reason:' '}])assert.throws(()=>cashbookDecisionInput({decision:'approved',reason:'Review',expected_version:1,...changes}),{code:'VALIDATION_FAILED'});
});

test('application accepts only the exact approval identity and rejects caller-supplied money, source and status fields',async()=>{
 const {cashbookApplyInput}=await import('../../src/modules/cashbook/effect-service.ts'),body={expected_version:2,decision_id:'11111111-1111-4111-8111-111111111111'};
 assert.deepEqual(cashbookApplyInput(body),body);
 for(const changes of [{expected_version:1},{expected_version:3},{decision_id:'not-an-id'},{amount_paise:1},{source_location_id:body.decision_id},{actor_id:body.decision_id},{approved:true},{status:'applied'}])assert.throws(()=>cashbookApplyInput({...body,...changes}),{code:'VALIDATION_FAILED'});
});
