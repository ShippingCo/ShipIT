import {HttpError} from '../../plugins/errors.ts';
const max=BigInt(Number.MAX_SAFE_INTEGER);
const components=['pre_tax','taxable','cgst','sgst','igst','rounding'] as const;
type Component=typeof components[number];
export type FinancialComponents=Record<Component,bigint>;
export interface FinancialSource extends Record<Component,string> {gross:string;collections:string;refunds:string}
export interface FinancialChangeAmounts extends Record<Component,number> {kind:string;refund:number}
export interface FinancialPosition {gross:bigint;held:bigint;outstanding:bigint;refundable_credit:bigint}
/** Classify immutable source totals; this pure calculation grants no financial authority. */
export function financialPosition(gross:bigint,collections:bigint,refunds:bigint):FinancialPosition {
 if([gross,collections,refunds].some(value=>value<0n||value>max)||refunds>collections)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 const held=collections-refunds;
 return {gross,held,outstanding:gross>held?gross-held:0n,refundable_credit:held>gross?held-gross:0n};
}
function observation(source:FinancialSource) {
 let values:FinancialComponents,gross:bigint,collections:bigint,refunds:bigint;
 try {values=Object.fromEntries(components.map(field=>[field,BigInt(source[field])])) as FinancialComponents;gross=BigInt(source.gross);collections=BigInt(source.collections);refunds=BigInt(source.refunds);}
 catch {throw new HttpError('TEMPORARILY_UNAVAILABLE');}
 const position=financialPosition(gross,collections,refunds);
 if(components.some(field=>field==='rounding'?values[field]<-99n||values[field]>99n:values[field]<0n||values[field]>max)||values.taxable>values.pre_tax||gross!==values.pre_tax+values.cgst+values.sgst+values.igst+values.rounding)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 return {values,position,collections,refunds};
}
/** Preview reviewed component reductions or actual outflows against the locked observation. */
export function previewFinancialChange(source:FinancialSource,input:FinancialChangeAmounts) {
 const current=observation(source),before=current.position;
 if(!['discount','cancellation','correction','refund'].includes(input.kind)||!Number.isSafeInteger(input.refund)||input.refund<0||components.some(field=>!Number.isSafeInteger(input[field])||(field==='rounding'?input[field]<-99||input[field]>99:input[field]<0)))throw new HttpError('FINANCIAL_CONFLICT');
 const amounts=Object.fromEntries(components.map(field=>[field,BigInt(input[field])])) as FinancialComponents;
 if(input.kind==='refund'){
  if(input.refund===0||BigInt(input.refund)>before.refundable_credit||components.some(field=>amounts[field]!==0n))throw new HttpError('FINANCIAL_CONFLICT');
  return {before,after:financialPosition(before.gross,current.collections,current.refunds+BigInt(input.refund)),components:current.values};
 }
 const reduction=amounts.pre_tax+amounts.cgst+amounts.sgst+amounts.igst+amounts.rounding;
 const remaining=Object.fromEntries(components.map(field=>[field,current.values[field]-amounts[field]])) as FinancialComponents;
 if(input.refund!==0||reduction<=0n||reduction>before.gross||amounts.taxable>amounts.pre_tax||components.some(field=>field==='rounding'?remaining[field]<-99n||remaining[field]>99n:remaining[field]<0n)||remaining.taxable>remaining.pre_tax||(input.kind==='cancellation'&&components.some(field=>remaining[field]!==0n)))throw new HttpError('FINANCIAL_CONFLICT');
 return {before,after:financialPosition(before.gross-reduction,current.collections,current.refunds),components:remaining};
}

/** Correct an erroneously recorded outflow; this records no new customer transfer. */
export function previewRefundCorrection(source:FinancialSource,originalRefund:bigint,alreadyCorrected:bigint,amount:number) {
 const current=observation(source);
 if(originalRefund<=0n||originalRefund>max||alreadyCorrected<0n||alreadyCorrected>originalRefund)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError('FINANCIAL_CONFLICT');
 const correction=BigInt(amount);
 if(correction>originalRefund-alreadyCorrected||correction>current.refunds)throw new HttpError('FINANCIAL_CONFLICT');
 return {before:current.position,after:financialPosition(current.position.gross,current.collections,current.refunds-correction),components:current.values};
}
