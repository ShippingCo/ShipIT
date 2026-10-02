import { consentIntent } from '../whatsapp/consent-rules.ts';

export const tools=['tracking','eta','delay','charges','receipt','resend'] as const;
export type Tool=typeof tools[number];
export type Intent=Tool|'pickup'|'quote'|'stop'|'start'|'human'|'resume'|'clarify';
export interface Route {intent:Intent;docket:string|null;selectionOnly:boolean}
/** Fixed vocabulary. Customer text can narrow a docket but never choose SQL or an API. */
export function routeMessage(input:unknown):Route {
 const none:Route={intent:'clarify',docket:null,selectionOnly:false};
 if(typeof input!=='string'||!input.trim()||input.length>4096||Array.from(input).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c)))return none;
 const text=input.trim().replace(/\s+/g,' '),consent=consentIntent(text);
 if(consent!=='other')return {...none,intent:consent};
 // STOP inside a request must never fall through to a shipment answer.
 if(/\b(stop|unsubscribe)\b/i.test(text))return {...none,intent:'stop'};
 if(/\b(human|person|staff|operator|call me|talk to someone)\b/i.test(text)||/^help$/i.test(text))return {...none,intent:'human'};
 if(/^resume$/i.test(text))return {...none,intent:'resume'};
 if(/\b(sql|endpoint|ignore (?:the )?rules|bypass|system prompt)\b|https?:\/\//i.test(text))return none;
 if(/^(?:pickup|pickups|cancel pickup|submit pickup)(?:\s|$)/i.test(text))return {...none,intent:'pickup'};
 if(/^(?:quote|confirm quote)(?:\s|$)/i.test(text))return {...none,intent:'quote'};
 const match=text.match(/\b(?:docket|shipment|parcel)\s+([A-Z0-9][A-Z0-9-]{0,39})\b/i);
 // Production dockets contain a digit; plain words such as "parcel status" aren't slots.
 const exact=/^[A-Z0-9][A-Z0-9-]{0,39}$/i.test(text)&&/\d/.test(text)?text.toUpperCase():null;
 const candidates=text.match(/\b[A-Z0-9][A-Z0-9-]{0,39}\b/gi)?.filter(v=>/\d/.test(v))??[];
 if(candidates.length>1)return none;
 const docket=exact??(match&&(/\d/.test(match[1]!)||/^docket\b/i.test(match[0]))?match[1]!.toUpperCase():candidates[0]?.toUpperCase()??null);
 const clean=match&&docket?text.replace(match[0],''):text;
 const found:Tool[]=[];
 if(/\b(track(?:ing)?|status|where|location)\b/i.test(clean))found.push('tracking');
 if(/\b(eta|when|arrival|arrive)\b/i.test(clean))found.push('eta');
 if(/\b(delay|late|delayed)\b/i.test(clean))found.push('delay');
 if(/\b(charges?|amount|cost|paid|balance)\b/i.test(clean))found.push('charges');
 if(/\b(receipt|bill|invoice)\b/i.test(clean))found.push('receipt');
 if(/\b(otp|code|resend)\b/i.test(clean))found.push('resend');
 return {intent:found.length===1?found[0]!:'clarify',docket,selectionOnly:!!exact};
}
