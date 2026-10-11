import {test} from 'vitest';
import assert from 'node:assert/strict';
import {custodyAgentOnly} from '../../src/modules/memberships/policy.ts';
import {manifestOutcomes} from '../../src/modules/custody/rules.ts';
import type {CustodyReceiptFact,CustodyProofFact,ManifestItemFact} from '../../src/modules/custody/types.ts';
const date=(n:number)=>new Date(1700000000000+n*1000),agent='agent';
function cohort(){
 const items:ManifestItemFact[]=[],receipts:CustodyReceiptFact[]=[],proofs:CustodyProofFact[]=[];
 for(let n=0;n<10;n++){
  const parcel='p'+n,id='r'+n;items.push({id:'i'+n,parcel_id:parcel,agent_id:agent,prepared_at:date(0),receipt_id:id});
  receipts.push({id,parcel_id:parcel,sequence:1,previous_receipt_id:null,kind:'agent_received',agent_id:agent,recorded_at:date(1),proof_id:null});
  if(n<8){
   receipts.push({id:'s'+n,parcel_id:parcel,sequence:2,previous_receipt_id:id,kind:n<6?'recipient_received':'office_received',agent_id:null,recorded_at:date(3),proof_id:n<6?'proof'+n:null});
   if(n<6)proofs.push({id:'proof'+n,parcel_id:parcel,completed_by:agent,completed_at:date(3)});
  }
 }
 return {items,receipts,proofs};
}
test('ten source-linked outcomes reconcile six actual proofs, two physical returns and two held; failures overlap',()=>{
 const c=cohort(),failures=[{id:'f6',parcel_id:'p6',agent_id:agent,recorded_at:date(2)}];
 const result=manifestOutcomes(c.items,c.receipts,c.proofs,failures,date(4));
 assert.deepEqual(result.totals,{total:10,delivered:6,returned:2,held:2,reassigned:0,pending:0,failed:1});
 assert.equal(result.failure_count,1);
 assert.deepEqual(result.items[6]!.failure_ids,['f6']);assert.equal(result.items[6]!.current_receipt_id,'s6');
 assert.deepEqual(result.items.slice(0,6).map(i=>i.proof_id),c.proofs.map(p=>p.id));
 assert.equal(result.items.filter(i=>i.outcome==='held').length,2);
});
test('one cutoff excludes later receipt/proof facts and does not invent acknowledgement',()=>{
 const c=cohort();
 assert.deepEqual(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(0)).totals,
  {total:10,delivered:0,returned:0,held:0,reassigned:0,pending:10,failed:0});
 assert.equal(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(2)).totals.held,10);
 assert.equal(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(3)).totals.delivered,6);
 assert.equal(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(-1)).totals.total,0);
});
test('a later agent receipt preserves original manifest and failure attribution',()=>{
 const c=cohort(),original=structuredClone(c);
 c.receipts.push({id:'new-agent',parcel_id:'p8',sequence:2,previous_receipt_id:'r8',kind:'agent_received',agent_id:'other',recorded_at:date(3),proof_id:null});
 const result=manifestOutcomes(c.items,c.receipts,c.proofs,[
  {id:'old-failure',parcel_id:'p8',agent_id:agent,recorded_at:date(2)},
  {id:'later-failure',parcel_id:'p8',agent_id:'other',recorded_at:date(4)}
 ],date(5));
 assert.equal(result.totals.reassigned,1);assert.deepEqual(result.items[8]!.failure_ids,['old-failure']);
 assert.equal(result.items[8]!.origin_receipt_id,'r8');assert.equal(result.items[8]!.current_receipt_id,'new-agent');
 assert.deepEqual(c.items,original.items);assert.deepEqual(c.proofs,original.proofs);
});
test('proof without receipt, wrong completing agent, missing predecessor and conflicting successors fail closed',()=>{
 for(const alter of [
  (c:ReturnType<typeof cohort>)=>{c.proofs.splice(0,1);},
  (c:ReturnType<typeof cohort>)=>{c.proofs[0]!.completed_by='other';},
  (c:ReturnType<typeof cohort>)=>{c.receipts[1]!.previous_receipt_id='foreign';},
  (c:ReturnType<typeof cohort>)=>{c.receipts.push({...c.receipts[1]!,id:'fork'});},
  (c:ReturnType<typeof cohort>)=>{c.receipts[1]!.recorded_at=date(0);},
  (c:ReturnType<typeof cohort>)=>{c.items[0]!.receipt_id='missing';},
 ]){
  const c=cohort();alter(c);assert.throws(()=>manifestOutcomes(c.items,c.receipts,c.proofs,[],date(5)),{code:'CUSTODY_EVIDENCE_CONFLICT'});
 }
});
test('unacknowledged manifest cannot be promoted to held or delivered',()=>{
 const c=cohort();c.items[8]!.receipt_id=null;
 const result=manifestOutcomes(c.items,c.receipts,c.proofs,[],date(5));
 assert.equal(result.totals.pending,1);assert.equal(result.totals.held,1);assert.equal(result.items[8]!.proof_id,null);
});
test('duplicate cohort parcels, duplicate facts and invalid cutoffs fail without partial counts',()=>{
 for(const change of [
  (c:ReturnType<typeof cohort>)=>{c.items[1]!.parcel_id=c.items[0]!.parcel_id;},
  (c:ReturnType<typeof cohort>)=>{c.receipts.push(c.receipts[0]!);},
  (c:ReturnType<typeof cohort>)=>{c.proofs.push(c.proofs[0]!);},
 ]){const c=cohort();change(c);assert.throws(()=>manifestOutcomes(c.items,c.receipts,c.proofs,[],date(5)),{code:'CUSTODY_EVIDENCE_CONFLICT'});}
 const c=cohort();assert.throws(()=>manifestOutcomes(c.items,c.receipts,c.proofs,[],new Date(NaN)),{code:'CUSTODY_EVIDENCE_CONFLICT'});
});

test('agent plus dispatcher does not gain administrator transfer authority; receipt acknowledgement remains actor-bound',()=>{
 assert.equal(custodyAgentOnly('custody.prepare',['delivery_agent','dispatcher']),true);
 assert.equal(custodyAgentOnly('custody.prepare',['delivery_agent','franchise_admin']),false);
 assert.equal(custodyAgentOnly('custody.acknowledge',['delivery_agent','franchise_admin']),true);
 assert.equal(custodyAgentOnly('custody.release',['delivery_agent','franchise_admin']),true);
});
test('authorized staff reads use their separate R10 role while dispatcher assignment is not agent receipt acknowledgement',()=>{
 assert.equal(custodyAgentOnly('custody.read',['delivery_agent']),true);
 assert.equal(custodyAgentOnly('custody.read',['delivery_agent','dispatcher']),false);
 assert.equal(custodyAgentOnly('custody.authorize',['delivery_agent','dispatcher']),false);
});


test('manifest command validation is bounded, duplicate-safe, canonical and rejects injected ownership/proof fields',async()=>{
 const {handoverInput,returnInput,grantInput}=await import('../../src/modules/custody/validation.ts');
 const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const item=(n:number)=>({parcel_id:id(n),expected_parcel_version:5,previous_receipt_id:null,instruction_id:null,grant_id:null});
 assert.deepEqual(handoverInput({agent_id:id(99),items:[item(2),item(1)]}).items,[item(1),item(2)]);
 for(const value of [
  {agent_id:id(99),items:[]},{agent_id:id(99),items:Array.from({length:51},(_,n)=>item(n))},
  {agent_id:id(99),items:[item(1),item(1)]},{agent_id:id(99),items:[{...item(1),proof_id:id(4)}]},
  {agent_id:id(99),items:[item(1)],franchise_id:id(8)},
  {agent_id:id(99),items:[{...item(1),previous_receipt_id:'not-a-source'}]}
 ])assert.throws(()=>handoverInput(value));
 assert.throws(()=>returnInput({parcel_id:id(1),expected_parcel_version:5,source_receipt_id:id(2),discrepancy:'delivered'}));
 assert.throws(()=>grantInput({parcel_id:id(1),source_receipt_id:id(2),destination_kind:'office',destination_agent_id:id(3)}));
 assert.throws(()=>grantInput({parcel_id:id(1),source_receipt_id:id(2),destination_kind:'agent',destination_agent_id:null}));
});

test('transaction recording may precede proof sampling; historical outcome requires both source timestamps at the cutoff',()=>{
 const c=cohort();c.proofs[0]!.completed_at=date(4);
 assert.equal(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(3)).items[0]!.outcome,'held');
 assert.equal(manifestOutcomes(c.items,c.receipts,c.proofs,[],date(4)).items[0]!.outcome,'delivered');
 c.proofs[0]!.completed_at=date(0);
 assert.throws(()=>manifestOutcomes(c.items,c.receipts,c.proofs,[],date(5)),{code:'CUSTODY_EVIDENCE_CONFLICT'});
});
