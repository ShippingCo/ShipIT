import {describe,it,expect} from 'vitest';
import {allocate,receiptBalance,releaseAllocation} from '../../src/modules/payments/allocation-rules.ts';
describe('receipt and allocation conservation',()=>{
  it('applies one receipt to two obligations and retains advance without a second inflow',()=>{
    const first=allocate(100000n,0n,40000n,40000),second=allocate(100000n,BigInt(first.allocated_paise),50000n,50000);
    expect(second).toEqual({currency:'INR',received_paise:100000,allocated_paise:90000,unallocated_paise:10000});
    expect(second.received_paise).toBe(second.allocated_paise+second.unallocated_paise);
    expect(()=>allocate(100000n,90000n,20000n,10001)).toThrow('ALLOCATION_CONFLICT');
    expect(()=>allocate(100000n,90000n,9999n,10000)).toThrow('ALLOCATION_CONFLICT');
  });
  it('releases only unreleased linked allocations and makes the same funds available again',()=>{
    const corrected=releaseAllocation(100000n,90000n,50000n,0n,10000);
    expect(corrected).toMatchObject({received_paise:100000,allocated_paise:80000,unallocated_paise:20000});
    expect(allocate(100000n,80000n,20000n,20000).unallocated_paise).toBe(0);
    expect(()=>releaseAllocation(100000n,80000n,50000n,10000n,40001)).toThrow('ALLOCATION_CONFLICT');
    expect(()=>releaseAllocation(100000n,5000n,50000n,10000n,5001)).toThrow('ALLOCATION_CONFLICT');
  });
  it('preserves exact paise at the safe-integer ceiling and rejects invalid commands/source drift',()=>{
    const max=BigInt(Number.MAX_SAFE_INTEGER);
    expect(allocate(max,max-1n,1n,1)).toMatchObject({received_paise:Number.MAX_SAFE_INTEGER,allocated_paise:Number.MAX_SAFE_INTEGER,unallocated_paise:0});
    for(const amount of [0,-1,0.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>allocate(100n,0n,100n,amount)).toThrow('VALIDATION_FAILED');
    for(const [received,allocated] of [[-1n,0n],[0n,1n],[100n,-1n],[max+1n,0n]])expect(()=>receiptBalance(received!,allocated!)).toThrow('TEMPORARILY_UNAVAILABLE');
    expect(()=>releaseAllocation(100n,50n,101n,0n,1)).toThrow('TEMPORARILY_UNAVAILABLE');
    expect(()=>releaseAllocation(100n,50n,50n,51n,1)).toThrow('TEMPORARILY_UNAVAILABLE');
  });
});
