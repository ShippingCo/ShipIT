import { describe,it,expect } from 'vitest';
import { exactUnit,rateUpload,rateFields } from '../../src/modules/carriers/rate-validation.ts';
const id='11111111-1111-4111-8111-111111111111';
const base={purpose:'customer_selling',origin_mapping_id:id,services:[],locations:[],expected_lanes:[{destination_key:'SYN',service:'standard'}],
  weight_unit:'kg',amount_unit:'rupees',policy:{effective_from:'2099-01-03T00:00:00Z',effective_to:'2099-01-04T00:00:00Z',quote_validity_seconds:600,override_tolerance_paise:0,approval_ref:'SYN'}};
const body=(row='STD,ORG,DEST,0.001,1,kg,125.51,2.49,INR,rupees')=>({...base,content_base64:Buffer.from(rateFields.join(',')+'\n'+row).toString('base64')});
describe('carrier rate boundary',()=>{
  it('converts decimal kg/rupees exactly without rounding',()=>{expect(exactUnit('125.51',2)).toBe(12551);expect(rateUpload(body()).rows[0]?.rule).toMatchObject({min_weight_grams:1,max_weight_grams:1000,freight_paise:12551,packing_paise:249});});
  it('rejects unsupported precision, unsafe values and executable cells',()=>{for(const value of ['1e3','-1','=1+2',' 1','1.0001','9007199254740992'])expect(()=>exactUnit(value,3)).toThrow();expect(rateUpload(body('=SUM(A1),ORG,DEST,1,2,kg,1,0,INR,rupees')).rows[0]?.error).toBe('INVALID_RATE');});
  it('detects mixed weight/currency/amount units per row',()=>{for(const row of ['STD,ORG,DEST,1,2,g,1,0,INR,rupees','STD,ORG,DEST,1,2,kg,1,0,USD,rupees','STD,ORG,DEST,1,2,kg,1,0,INR,paise'])expect(rateUpload(body(row)).rows[0]?.error).toBe('UNIT_MISMATCH');});
  it('rejects unknown purpose and injected financial authority',()=>{expect(()=>rateUpload({...body(),purpose:'actual_cost'})).toThrow();expect(()=>rateUpload({...body(),pricing_version_id:id})).toThrow();});
  it('bounds files, rows and exact headers',()=>{expect(()=>rateUpload({...body(),content_base64:Buffer.from('bad\nrow').toString('base64')})).toThrow();expect(()=>rateUpload(body(Array(101).fill('STD,ORG,DEST,1,2,kg,1,0,INR,rupees').join('\n')))).toThrow();expect(()=>rateUpload({...body(),content_base64:'A'.repeat(90000)})).toThrow();});
  it('requires explicit finite dates and expected lanes',()=>{expect(()=>rateUpload({...body(),expected_lanes:[]})).toThrow();expect(()=>rateUpload({...body(),policy:{...base.policy,effective_to:base.policy.effective_from}})).toThrow();});
});
