import type {CustodyFailureFact,CustodyProofFact,CustodyReceiptFact,ManifestItemFact} from './types.ts';

/** Only feed facts from the current authorized query, never request/browser objects. */
export type CustodyOutcome='delivered'|'returned'|'held'|'reassigned'|'pending';
export interface ManifestOutcome {
 item_id:string;parcel_id:string;outcome:CustodyOutcome;
 origin_receipt_id:string|null;current_receipt_id:string|null;proof_id:string|null;failure_ids:string[];
}
export class CustodyEvidenceError extends Error {
 readonly code='CUSTODY_EVIDENCE_CONFLICT';
 constructor(){super('Custody evidence is inconsistent');}
}
function fail():never {throw new CustodyEvidenceError();}
function time(value:Date):number {const n=value instanceof Date?value.getTime():NaN;if(!Number.isFinite(n))fail();return n;}
function unique<T extends {id:string}>(facts:readonly T[]):Map<string,T>{
 const rows=new Map<string,T>();for(const f of facts){if(!f.id||rows.has(f.id))fail();rows.set(f.id,f);}return rows;
}

/**
 * A receipt chain proves physical outcomes; parcel.status alone never does.
 * The failure subtotal overlaps outcomes and carries independent source IDs.
 * Caller supplies a complete bounded cohort at one cutoff (not a paged subset).
 */
export function manifestOutcomes(items:readonly ManifestItemFact[],receipts:readonly CustodyReceiptFact[],
 proofs:readonly CustodyProofFact[],failures:readonly CustodyFailureFact[],asOf:Date){
 const cutoff=time(asOf),receiptById=unique(receipts),proofById=unique(proofs);
 unique(items);unique(failures);
 const chains=new Map<string,CustodyReceiptFact[]>();
 for(const f of receipts){
  time(f.recorded_at);
  if(!f.parcel_id||!Number.isSafeInteger(f.sequence)||f.sequence<1||
   (f.kind==='agent_received'?(f.agent_id===null||f.proof_id!==null):(f.agent_id!==null))||
   (f.kind==='office_received'&&f.proof_id!==null)||
   (f.kind==='recipient_received'&&f.proof_id===null)||
   !['agent_received','office_received','recipient_received'].includes(f.kind))fail();
  const chain=chains.get(f.parcel_id)??[];chain.push(f);chains.set(f.parcel_id,chain);
 }
 const proofReferences=new Set<string>();
 for(const chain of chains.values()){
  chain.sort((a,b)=>a.sequence-b.sequence);
  for(let i=0;i<chain.length;i++){
   const f=chain[i]!,previous=chain[i-1];
   if(f.sequence!==i+1||f.previous_receipt_id!==(previous?.id??null)||
    (previous&&time(previous.recorded_at)>time(f.recorded_at))||
    previous?.kind==='recipient_received'||(!previous&&f.kind!=='agent_received'))fail();
   if(f.kind==='recipient_received'){
    const proof=proofById.get(f.proof_id!);
    if(!proof||proof.parcel_id!==f.parcel_id||previous?.kind!=='agent_received'||
     proof.completed_by!==previous.agent_id||time(proof.completed_at)<time(previous.recorded_at)||
     proofReferences.has(proof.id))fail();
    proofReferences.add(proof.id);
   }
  }
 }
 for(const p of proofs)time(p.completed_at);
 for(const f of failures)time(f.recorded_at);
 const visibleItems=items.filter(item=>time(item.prepared_at)<=cutoff),parcels=new Set<string>();
 const rows:ManifestOutcome[]=visibleItems.map(item=>{
  if(parcels.has(item.parcel_id))fail();parcels.add(item.parcel_id);
  const base={item_id:item.id,parcel_id:item.parcel_id,origin_receipt_id:null,current_receipt_id:null,proof_id:null,failure_ids:[]} satisfies Omit<ManifestOutcome,'outcome'>;
  if(item.receipt_id===null)return {...base,outcome:'pending'};
  const origin=receiptById.get(item.receipt_id);
  if(!origin||origin.parcel_id!==item.parcel_id||origin.kind!=='agent_received'||origin.agent_id!==item.agent_id||
   time(origin.recorded_at)<time(item.prepared_at))fail();
  if(time(origin.recorded_at)>cutoff)return {...base,outcome:'pending'};
  const chain=chains.get(item.parcel_id)!.filter(f=>f.sequence>=origin.sequence&&time(f.recorded_at)<=cutoff&&
   (f.kind!=='recipient_received'||time(proofById.get(f.proof_id!)!.completed_at)<=cutoff));
  const current=chain.at(-1)!;
  const firstDeparture=chain.find(f=>f.kind!=='agent_received'||f.agent_id!==item.agent_id);
  const failureIds=failures.filter(f=>f.parcel_id===item.parcel_id&&f.agent_id===item.agent_id&&
   time(f.recorded_at)>=time(origin.recorded_at)&&time(f.recorded_at)<=cutoff&&
   (!firstDeparture||time(f.recorded_at)<=time(firstDeparture.recorded_at))).map(f=>f.id).sort();
  const outcome:CustodyOutcome=current.kind==='recipient_received'?'delivered':current.kind==='office_received'?'returned':
   current.agent_id===item.agent_id?'held':'reassigned';
  return {...base,outcome,origin_receipt_id:origin.id,current_receipt_id:current.id,proof_id:current.proof_id,failure_ids:failureIds};
 });
 const totals={total:rows.length,delivered:0,returned:0,held:0,reassigned:0,pending:0,failed:0};
 const failedSources=new Set<string>();
 for(const row of rows){totals[row.outcome]++;if(row.failure_ids.length)totals.failed++;for(const id of row.failure_ids)failedSources.add(id);}
 return {as_of:asOf.toISOString(),totals,items:rows,failure_count:failedSources.size};
}
