import {it,expect} from 'vitest';
import {statementAmounts} from '../../src/modules/reports/account-statement-rules.ts';
it('keeps paid/cancelled/refunded balances and advances separate with exact large paise',()=>{
 expect(statementAmounts(10000n,20000n,5000n,12000n,1000n)).toMatchObject({closing:'14000',outstanding:'14000',refundable_credit:'0'});
 expect(statementAmounts(0n,10000n,10000n,3000n,0n)).toMatchObject({closing:'-3000',outstanding:'0',refundable_credit:'3000'});
 expect(statementAmounts(0n,10000n,10000n,3000n,3000n)).toMatchObject({closing:'0',outstanding:'0',refundable_credit:'0'});
 expect(statementAmounts(900719925474099100n,1n,0n,0n,0n).closing).toBe('900719925474099101');
});
