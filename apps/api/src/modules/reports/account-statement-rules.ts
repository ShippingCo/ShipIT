import {statementMeasures,type StatementAmounts,type AccountStatementLine} from '@shippingco/shared';
export function statementAmounts(opening:bigint,charges:bigint,credits:bigint,payments:bigint,refunds:bigint):StatementAmounts {
 const closing=opening+charges-credits-payments+refunds;
 return {opening:String(opening),charges:String(charges),credits:String(credits),payments:String(payments),refunds:String(refunds),closing:String(closing),outstanding:String(closing>0n?closing:0n),refundable_credit:String(closing<0n?-closing:0n)};
}
export function statementTotals(lines:readonly AccountStatementLine[]):StatementAmounts {
 return Object.fromEntries(statementMeasures.map(k=>[k,String(lines.reduce((s,r)=>s+BigInt(r.amounts[k]),0n))])) as StatementAmounts;
}
