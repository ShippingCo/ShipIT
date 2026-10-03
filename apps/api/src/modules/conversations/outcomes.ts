import type { Intent } from './router.ts';
import type { Outcome } from './repository.ts';
import type { ToolResult } from './results.ts';

export const categories=['success','clarification','handoff','paused','consent','thanks','control','failure','queued'] as const;
export type Category=typeof categories[number];
export type Reason='none'|'authorization'|'missing_data'|'dependency'|'interpretation'|'invalid_input'|'stale'|'provider_pending';
export interface Evidence {category:Category;reason:Reason}
// An acknowledgement is a signal, never evidence that a need was resolved.
export const isThanks=(text:string)=>/^(?:thanks|thank you|धन्यवाद|शुक्रिया)[.!।\s]*$/iu.test(text.trim());
export function outcomeEvidence(intent:Intent,outcome:Outcome):Evidence {
 if(outcome==='selection_required')return {category:'clarification',reason:'none'};
 if(outcome==='human_requested')return {category:'handoff',reason:intent==='clarify'?'interpretation':'none'};
 if(outcome==='paused'||outcome==='consent')return {category:outcome,reason:'none'};
 if(outcome!=='answered')return {category:'failure',reason:outcome==='forbidden'?'authorization':outcome==='not_found'?'missing_data':outcome==='invalid'?'invalid_input':outcome==='stale'?'stale':'dependency'};
 return {category:['tracking','eta','delay','charges','receipt','quote','pickup'].includes(intent)?'success':intent==='resend'?'queued':'control',reason:intent==='resend'?'provider_pending':'none'};
}
export function toolEvidence(result:ToolResult):Evidence {
 if(result.tool==='resend')return result.state==='queued'?{category:'queued',reason:'provider_pending'}:{category:'failure',reason:'dependency'};
 if((result.tool==='eta'&&result.eta.state==='unavailable')||(result.tool==='delay'&&result.delay?.state!=='available'))return {category:'failure',reason:'missing_data'};
 return {category:'success',reason:'none'};
}
