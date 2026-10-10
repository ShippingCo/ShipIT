import {test} from 'vitest';
import assert from 'node:assert/strict';
import {financialPosition,previewFinancialChange,previewRefundCorrection,type FinancialSource,type FinancialChangeAmounts} from '../../src/modules/reports/finance-rules.ts';
const source=(collections='0',refunds='0'):FinancialSource=>({gross:'50000',collections,refunds,pre_tax:'50000',taxable:'50000',cgst:'0',sgst:'0',igst:'0',rounding:'0'});
const cancellation:FinancialChangeAmounts={kind:'cancellation',pre_tax:50000,taxable:50000,cgst:0,sgst:0,igst:0,rounding:0,refund:0};
const refund=(amount:number):FinancialChangeAmounts=>({kind:'refund',pre_tax:0,taxable:0,cgst:0,sgst:0,igst:0,rounding:0,refund:amount});
const zeroCharge=(collections:string,refunds:string):FinancialSource=>({...source(collections,refunds),gross:'0',pre_tax:'0',taxable:'0'});
test('unpaid and paid 500 cancellation remove identical charges but produce distinct refundable money',()=>{
 const unpaid=previewFinancialChange(source(),cancellation),paid=previewFinancialChange(source('50000'),cancellation);
 assert.deepEqual(unpaid.after,{gross:0n,held:0n,outstanding:0n,refundable_credit:0n});
 assert.deepEqual(paid.after,{gross:0n,held:50000n,outstanding:0n,refundable_credit:50000n});
 assert.equal(unpaid.before.outstanding,50000n);assert.equal(paid.before.outstanding,0n);
});
test('actual 200 then 300 refunds exhaust eligible credit; an adjustment alone is no refund',()=>{
 const first=previewFinancialChange(zeroCharge('50000','0'),refund(20000));assert.equal(first.after.refundable_credit,30000n);
 const second=previewFinancialChange(zeroCharge('50000','20000'),refund(30000));assert.deepEqual(second.after,{gross:0n,held:0n,outstanding:0n,refundable_credit:0n});
 assert.throws(()=>previewFinancialChange(zeroCharge('50000','50000'),refund(1)),{code:'FINANCIAL_CONFLICT'});
 assert.throws(()=>previewFinancialChange(source('50000'),refund(1)),{code:'FINANCIAL_CONFLICT'});
});
test('component previews preserve the original tax basis and signed rounding without mutating evidence',()=>{
 const original:FinancialSource={...source(),gross:'13400',pre_tax:'12800',taxable:'12000',cgst:'320',sgst:'320',rounding:'-40'};
 const input={...cancellation,kind:'discount',pre_tax:100,taxable:100},saved=structuredClone({original,input});
 const preview=previewFinancialChange(original,input);assert.equal(preview.after.gross,13300n);assert.deepEqual(preview.components,{pre_tax:12700n,taxable:11900n,cgst:320n,sgst:320n,igst:0n,rounding:-40n});assert.deepEqual({original,input},saved);
 for(const bad of [{...input,taxable:101},{...input,pre_tax:801,taxable:0},{...input,cgst:321},{...input,kind:'cancellation'}])assert.throws(()=>previewFinancialChange(original,bad),{code:'FINANCIAL_CONFLICT'});
 const full={...cancellation,pre_tax:12800,taxable:12000,cgst:320,sgst:320,rounding:-40};assert.equal(previewFinancialChange(original,full).after.gross,0n);
});
test('every valid position independently reconciles held money, debt and credit at exact integer boundaries',()=>{
 const max=BigInt(Number.MAX_SAFE_INTEGER);
 for(const [gross,collections,refunds] of [[0n,0n,0n],[50000n,0n,0n],[50000n,50000n,0n],[0n,50000n,20000n],[max,max,max-1n],[max-1n,max,0n]]){
  const value=financialPosition(gross!,collections!,refunds!);assert.equal(value.gross+value.refundable_credit,value.held+value.outstanding);assert.equal(value.held,collections!-refunds!);
 }
 for(const bad of [[-1n,0n,0n],[0n,-1n,0n],[0n,0n,1n],[max+1n,0n,0n]])assert.throws(()=>financialPosition(bad[0]!,bad[1]!,bad[2]!),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.throws(()=>previewFinancialChange({...source(),gross:'49999'},cancellation),{code:'TEMPORARILY_UNAVAILABLE'});
});

test('correcting a mistaken refund restores only the linked outflow capacity without recording a collection',()=>{
 const observation=zeroCharge('50000','50000'),original=structuredClone(observation);
 const first=previewRefundCorrection(observation,20000n,0n,10000);
 assert.deepEqual(first.after,{gross:0n,held:10000n,outstanding:0n,refundable_credit:10000n});
 const second=previewRefundCorrection(zeroCharge('50000','40000'),20000n,10000n,10000);
 assert.equal(second.after.refundable_credit,20000n);assert.deepEqual(observation,original);
 for(const amount of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,10001])assert.throws(()=>previewRefundCorrection(zeroCharge('50000','40000'),20000n,10000n,amount),{code:'FINANCIAL_CONFLICT'});
 assert.throws(()=>previewRefundCorrection(zeroCharge('50000','0'),20000n,0n,1),{code:'FINANCIAL_CONFLICT'});
 assert.throws(()=>previewRefundCorrection(observation,20000n,20001n,1),{code:'TEMPORARILY_UNAVAILABLE'});
 // A refund correction can reduce debt too; it never changes the reviewed charge.
 const debt=previewRefundCorrection(source('50000','20000'),20000n,0n,10000);
 assert.equal(debt.before.outstanding,20000n);assert.equal(debt.after.outstanding,10000n);assert.equal(debt.after.gross,50000n);
});
