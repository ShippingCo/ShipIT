import {test} from 'vitest';
import assert from 'node:assert/strict';
import {parseEnvironment,ConfigurationError} from '../../src/env.ts';
import {receiptFunds,reserveCod,receiptCash,codLiability,feePosition,feePayment,countedCustody} from '../../src/modules/agent-settlements/rules.ts';

test('one 2100 receipt separates 100 freight and 2000 seller principal from a 40 fee',()=>{
 const receipt=reserveCod(210000n,10000n,0n,200000n,200000n);
 assert.deepEqual(receipt,{received_paise:'210000',freight_applied_paise:'10000',cod_reserved_paise:'200000',available_paise:'0'});
 assert.equal(receiptCash('cash',210000n),210000n);assert.equal(receiptCash('upi',210000n),0n);
 assert.deepEqual(codLiability(200000n,0n,0n),{collected_paise:'200000',remitted_paise:'0',reversed_paise:'0',remaining_paise:'200000'});
 assert.equal(feePosition(4000n,0n,0n,0n).remaining_fee_paise,'4000');
 // A later freight application cannot consume the principal already reserved.
 assert.throws(()=>receiptFunds(210000n,10001n,200000n),{code:'ALLOCATION_CONFLICT'});
 assert.throws(()=>reserveCod(210000n,10000n,200000n,1n,1n),{code:'ALLOCATION_CONFLICT'});
 assert.throws(()=>reserveCod(210000n,10000n,0n,200000n,199999n),{code:'ALLOCATION_CONFLICT'});
});

test('advance payment then explicit application leaves one earned fee and only the remaining cash payout',()=>{
 const prepaid=feePosition(0n,0n,1000n,0n);assert.equal(prepaid.earned_paise,'0');assert.equal(prepaid.unapplied_advance_paise,'1000');
 const earned=feePosition(4000n,0n,1000n,0n),payment=feePayment(BigInt(earned.remaining_fee_paise),BigInt(earned.unapplied_advance_paise),1000n,3000n);
 assert.deepEqual(payment,{advance_applied_paise:'1000',new_cash_paid_paise:'3000',remaining_fee_paise:'0'});
 assert.deepEqual(feePosition(4000n,3000n,1000n,1000n),{earned_paise:'4000',direct_paid_paise:'3000',advance_paid_paise:'1000',advance_applied_paise:'1000',remaining_fee_paise:'0',unapplied_advance_paise:'0'});
 assert.equal(feePayment(4000n,1000n,0n,3000n).remaining_fee_paise,'1000');
 assert.throws(()=>feePayment(4000n,1000n,1001n,0n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>feePayment(4000n,1000n,1000n,3001n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>feePosition(4000n,3001n,1000n,1000n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>feePosition(4000n,0n,999n,1000n),{code:'CASHBOOK_CONFLICT'});
});

test('COD remittance capacity and count variance stay separate from receipt allocation',()=>{
 assert.deepEqual(countedCustody(210000n,209000n),{expected_paise:'210000',counted_paise:'209000',variance_paise:'-1000',shortage_paise:'1000',excess_paise:'0'});
 assert.equal(countedCustody(210000n,211000n).excess_paise,'1000');
 assert.equal(codLiability(200000n,199000n,0n).remaining_paise,'1000');
 assert.throws(()=>codLiability(200000n,199000n,1001n),{code:'CASHBOOK_CONFLICT'});
 assert.equal(receiptFunds(210000n,10000n,200000n).available_paise,'0');
 for(const invalid of [-1n,BigInt(Number.MAX_SAFE_INTEGER)+1n])assert.throws(()=>feePosition(invalid,0n,0n,0n),{code:'CASHBOOK_CONFLICT'});
});

test('agent money rollout defaults off, accepts strict booleans and rejects demo writes',()=>{
 const env={NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'};
 assert.equal(parseEnvironment(env).agentMoneyWritesEnabled,false);assert.equal(parseEnvironment({...env,AGENT_MONEY_ENABLED:'true'}).agentMoneyWritesEnabled,true);
 assert.throws(()=>parseEnvironment({...env,AGENT_MONEY_ENABLED:'yes'}),(error:unknown)=>error instanceof ConfigurationError&&error.issues.some(x=>x.field==='AGENT_MONEY_ENABLED'&&x.code==='INVALID_FORMAT'));
 assert.throws(()=>parseEnvironment({...env,NODE_ENV:'demo',AGENT_MONEY_ENABLED:'true'}),(error:unknown)=>error instanceof ConfigurationError&&error.issues.some(x=>x.field==='AGENT_MONEY_ENABLED'&&x.code==='INCONSISTENT'));
});

test('counted custody keeps negative ledger evidence and exact aggregate paise without inventing a debt',()=>{
 assert.deepEqual(countedCustody(-1000n,0n),{expected_paise:'-1000',counted_paise:'0',variance_paise:'1000',shortage_paise:'0',excess_paise:'1000'});
 const aggregate=BigInt(Number.MAX_SAFE_INTEGER)*2n;
 assert.equal(countedCustody(aggregate,1n).shortage_paise,(aggregate-1n).toString());
 assert.throws(()=>countedCustody(0n,-1n),{code:'CASHBOOK_CONFLICT'});
 assert.throws(()=>countedCustody(0n,BigInt(Number.MAX_SAFE_INTEGER)+1n),{code:'CASHBOOK_CONFLICT'});
});
