import {HttpError} from '../../plugins/errors.ts';
export const maximumPaise=BigInt(Number.MAX_SAFE_INTEGER);
export type MovementKind='opening_float'|'owner_funds'|'expense'|'deposit'|'withdrawal';
export type SourceKind=MovementKind|'receipt'|'refund'|'refund_correction'|'correction'|'handover';
export interface CashbookFact {source_kind:SourceKind;source_id:string;location_id:string;direction:'in'|'out';amount_paise:bigint}
export interface CashLeg {location_id:string;direction:'in'|'out';amount_paise:bigint}
export interface HandoverAcknowledgement {id:string;amount_paise:bigint}
const conflict=():never=>{throw new HttpError('CASHBOOK_CONFLICT');};
function amount(value:bigint,zero=false):bigint {
 if(typeof value!=='bigint'||value<(zero?0n:1n)||value>maximumPaise)conflict();return value;
}
function bounded(value:bigint):bigint {if(value < -maximumPaise||value>maximumPaise)conflict();return value;}
function identity(value:string):string {if(typeof value!=='string'||!value||value.length>128)conflict();return value;}
/** Recorded custody is independent of reservations and customer booking allocations. */
export function cashbookPosition(facts:readonly CashbookFact[],location:string,reservations:readonly bigint[]=[],unknownSources=0) {
 identity(location);if(!Number.isSafeInteger(unknownSources)||unknownSources<0)conflict();
 let inflows=0n,outflows=0n;const seen=new Set<string>();
 for(const fact of facts){
  identity(fact.source_id);identity(fact.location_id);amount(fact.amount_paise);
  if(!['opening_float','owner_funds','expense','deposit','withdrawal','receipt','refund','refund_correction','correction','handover'].includes(fact.source_kind)||!['in','out'].includes(fact.direction))conflict();
  // One source contributes at most one leg to a location; a paired transfer has distinct locations.
  const key=JSON.stringify([fact.source_kind,fact.source_id,fact.location_id]);if(seen.has(key))conflict();seen.add(key);
  if((['receipt','opening_float','owner_funds','refund_correction'].includes(fact.source_kind)&&fact.direction!=='in')||(['expense','refund'].includes(fact.source_kind)&&fact.direction!=='out'))conflict();
  if(fact.location_id!==location)continue;
  if(fact.direction==='in')inflows+=fact.amount_paise;else outflows+=fact.amount_paise;
 }
 // All intermediate arithmetic stays exact even when the gross turnover exceeds JS safe integers.
 const recorded=bounded(inflows-outflows),reserved=reservations.reduce((sum,value)=>sum+amount(value,true),0n);bounded(reserved);
 const available=recorded>reserved?recorded-reserved:0n,shortfall=recorded<reserved?reserved-recorded:0n;
 return {inflows,outflows,recorded,reserved,available,shortfall,unknown_sources:unknownSources,
  state:recorded<0n||shortfall>0n?'exception' as const:unknownSources>0?'incomplete' as const:'recorded' as const};
}
/** New outflows consume spendable custody; a reservation never claims actual receipt. */
export function movementLegs(kind:MovementKind,value:bigint,source:string,target:string|null,available:bigint):CashLeg[] {
 amount(value);identity(source);amount(available,true);
 if(!['opening_float','owner_funds','expense','deposit','withdrawal'].includes(kind))conflict();
 const paired=kind==='deposit'||kind==='withdrawal';
 if(paired){if(target===null||identity(target)===source)conflict();}
 else if(target!==null)conflict();
 if(kind==='opening_float'||kind==='owner_funds')return [{location_id:source,direction:'in',amount_paise:value}];
 if(value>available)conflict();
 const out:CashLeg={location_id:source,direction:'out',amount_paise:value};
 return paired?[out,{location_id:target!,direction:'in',amount_paise:value}]:[out];
}
/** Correct financial meaning through linked deltas; do not invent an actual new transfer.
 * A truthful approved correction may expose a negative balance. Subsequent spending must
 * stop on that exception; accepted history is never edited to hide it.
 */
export function correctionLegs(kind:MovementKind,previous:bigint,replacement:bigint,source:string,target:string|null):CashLeg[] {
 amount(previous,true);amount(replacement,true);identity(source);
 const paired=kind==='deposit'||kind==='withdrawal';
 if(!['opening_float','owner_funds','expense','deposit','withdrawal'].includes(kind)||(paired?(target===null||identity(target)===source):target!==null))conflict();
 const delta=replacement-previous;if(delta===0n)return [];
 const originalIn=kind==='opening_float'||kind==='owner_funds',direction=(delta>0n)===originalIn?'in' as const:'out' as const;
 const magnitude=delta<0n?-delta:delta,result:CashLeg[]=[{location_id:source,direction,amount_paise:magnitude}];
 if(paired)result.push({location_id:target!,direction:direction==='in'?'out':'in',amount_paise:magnitude});return result;
}
export function handoverPosition(requested:bigint,acknowledgements:readonly HandoverAcknowledgement[],rejected=false) {
 amount(requested);if(typeof rejected!=='boolean')conflict();let accepted=0n;const seen=new Set<string>();
 for(const ack of acknowledgements){identity(ack.id);if(seen.has(ack.id))conflict();seen.add(ack.id);accepted+=amount(ack.amount_paise);}
 if(accepted>requested)conflict();const remainder=requested-accepted;
 return {requested,accepted,remaining:rejected?0n:remainder,rejected:rejected?remainder:0n,
  state:rejected?'rejected' as const:remainder===0n?'accepted' as const:accepted>0n?'partially_accepted' as const:'requested' as const};
}
export function acknowledgementLegs(requested:bigint,acknowledgements:readonly HandoverAcknowledgement[],value:bigint,source:string,target:string,recordedAvailableExcludingThis:bigint,rejected=false):CashLeg[] {
 const current=handoverPosition(requested,acknowledgements,rejected);amount(value);identity(source);identity(target);amount(recordedAvailableExcludingThis,true);
 if(source===target||value>current.remaining||value>recordedAvailableExcludingThis)conflict();
 return [{location_id:source,direction:'out',amount_paise:value},{location_id:target,direction:'in',amount_paise:value}];
}
