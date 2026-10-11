import {HttpError} from '../../plugins/errors.ts';
import type {ReceiptMethod} from '@shippingco/shared';
const maximum=BigInt(Number.MAX_SAFE_INTEGER);
const conflict=():never=>{throw new HttpError('CASHBOOK_CONFLICT');};
function amount(value:bigint,positive=false) {
 if(typeof value!=='bigint'||value<(positive?1n:0n)||value>maximum)conflict();return value;
}
/** The same locked receipt funds both freight and seller-owned COD applications. */
export function receiptFunds(received:bigint,freight:bigint,cod:bigint) {
 amount(received);amount(freight);amount(cod);
 if(freight+cod>received)throw new HttpError('ALLOCATION_CONFLICT');
 return {received_paise:received.toString(),freight_applied_paise:freight.toString(),cod_reserved_paise:cod.toString(),available_paise:(received-freight-cod).toString()};
}
export function reserveCod(received:bigint,freight:bigint,cod:bigint,requested:bigint,obligationRemaining:bigint) {
 const before=receiptFunds(received,freight,cod);amount(requested,true);amount(obligationRemaining);
 if(requested>BigInt(before.available_paise)||requested>obligationRemaining)throw new HttpError('ALLOCATION_CONFLICT');
 return receiptFunds(received,freight,cod+requested);
}
/** A shop receiving-account payment does not create agent cash possession. */
export function receiptCash(method:ReceiptMethod,value:bigint) {
 amount(value,true);if(!['cash','upi','card','bank_transfer','other'].includes(method))conflict();
 return method==='cash'?value:0n;
}
export function codLiability(collected:bigint,remitted:bigint,reversed:bigint) {
 amount(collected);amount(remitted);amount(reversed);if(remitted+reversed>collected)conflict();
 return {collected_paise:collected.toString(),remitted_paise:remitted.toString(),reversed_paise:reversed.toString(),remaining_paise:(collected-remitted-reversed).toString()};
}
/** Advance cash paid is separate from earned expense until an explicit application. */
export function feePosition(earned:bigint,directPaid:bigint,advancePaid:bigint,advanceApplied:bigint) {
 amount(earned);amount(directPaid);amount(advancePaid);amount(advanceApplied);
 if(advanceApplied>advancePaid||directPaid+advanceApplied>earned)conflict();
 return {earned_paise:earned.toString(),direct_paid_paise:directPaid.toString(),advance_paid_paise:advancePaid.toString(),advance_applied_paise:advanceApplied.toString(),remaining_fee_paise:(earned-directPaid-advanceApplied).toString(),unapplied_advance_paise:(advancePaid-advanceApplied).toString()};
}
/** Explicit approved allocation; no silent application or netting against collections. */
export function feePayment(remainingFee:bigint,unappliedAdvance:bigint,applyAdvance:bigint,newCash:bigint) {
 amount(remainingFee);amount(unappliedAdvance);amount(applyAdvance);amount(newCash);
 if(applyAdvance>unappliedAdvance||applyAdvance+newCash>remainingFee||applyAdvance+newCash===0n)conflict();
 return {advance_applied_paise:applyAdvance.toString(),new_cash_paid_paise:newCash.toString(),remaining_fee_paise:(remainingFee-applyAdvance-newCash).toString()};
}
/** Count variance is evidence, never a producer of debt, receipt or deduction. */
export function countedCustody(expected:bigint,counted:bigint) {
 if(typeof expected!=='bigint')conflict();amount(counted);const variance=counted-expected;
 return {expected_paise:expected.toString(),counted_paise:counted.toString(),variance_paise:variance.toString(),shortage_paise:(variance<0n?-variance:0n).toString(),excess_paise:(variance>0n?variance:0n).toString()};
}
