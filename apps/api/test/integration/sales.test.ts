import { describe,it,expect } from 'vitest';
import { salesRow,taxRate } from '../../src/modules/reports/sales-repository.ts';
import { salesFilter } from '../../src/modules/reports/sales-service.ts';
import { salesTotals,salesGroups,salesCsv } from '../../src/modules/reports/sales-rules.ts';
import type { TaxCalculationDto,SalesSnapshot } from '@shippingco/shared';
const id='00000000-0000-4000-8000-000000000062';
const tax={pre_tax_paise:12800,taxable_basis_paise:12800,cgst_paise:320,sgst_paise:320,igst_paise:0,rounding_adjustment_paise:-40,final_payable_paise:13400,components:[{numerator:1,denominator:40},{numerator:1,denominator:40}],treatment:'taxable',jurisdiction:'intra',policy_id:id} as TaxCalculationDto;
function source(t:TaxCalculationDto){return {id,franchise_id:id,customer_id:id,confirmed_at:'2026-10-01T00:00:00.000Z',booking_version:1,payment_version:0,receipt_id:null,receipt_number:null,tax:t,collections:'0',refunds:'0',corrections:[],statement_ids:[]};}
describe('sales monetary definitions',()=>{
 it('independently reconciles intra-state, inter-state and zero tax, including untaxed charges and rounding',()=>{
  const intra=salesRow(source(tax)),inter=salesRow(source({...tax,cgst_paise:0,sgst_paise:0,igst_paise:640,jurisdiction:'inter',components:[{numerator:1,denominator:20}] as TaxCalculationDto['components']})),nil=salesRow(source({...tax,taxable_basis_paise:0,cgst_paise:0,sgst_paise:0,igst_paise:0,rounding_adjustment_paise:0,final_payable_paise:12800,treatment:'nil_rated',components:[]}));
  const total=salesTotals([intra,inter,nil]);expect(total.gross).toBe('39600');expect(total.pre_tax).toBe('38400');expect(total.gst).toBe('1280');expect(total.rounding).toBe('-80');expect(total.non_taxable).toBe('12800');expect(salesGroups([intra,inter,nil])).toHaveLength(3);
  expect(taxRate(tax.components)).toBe('1/20');expect(nil.rate).toBe('0/1');expect(salesFilter({from_day:'2026-10-01',to_day:'2026-10-01',rate:'5/100'},id).rate).toBe('1/20');
 });
 it('preserves original evidence and exact aggregate integers without using monthly statements as extra sales',()=>{
  const row=salesRow({...source(tax),statement_ids:[id],corrections:[{id,kind:'discount',refund:'0',occurred_at:'2026-10-02T00:00:00.000Z',reason:'customer_agreement',approval_ref:'SYN_REVIEW',pre_tax:'100',taxable:'100',cgst:'2',sgst:'2',igst:'0',rounding:'-4'}]});
  expect(row.original.gross).toBe('13400');expect(row.amounts.gross).toBe('13300');expect(salesTotals([row]).gross).toBe('13300');
  expect(salesTotals([{amounts:{...row.amounts,gross:'9007199254740991'}},{amounts:{...row.amounts,gross:'9007199254740991'}}]).gross).toBe('18014398509481982');
  expect(salesTotals([]).gst).toBe('0');expect(()=>salesRow(source({...tax,final_payable_paise:13401}))).toThrow('TAX_CONFLICT');
  const snapshot:SalesSnapshot={id,schema_version:1,definition:'sales_gst_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,filter:salesFilter({from_day:'2026-10-01',to_day:'2026-10-01'},id),as_of:'2026-10-02T00:00:00.000Z',expires_at:'2026-10-03T00:00:00.000Z',count:1,totals:salesTotals([row]),groups:salesGroups([row])};
  const csv=salesCsv(snapshot,[row]);expect(csv).toContain('"13300"');expect(csv).toContain('"13400"');expect(csv.split('\r\n')).toHaveLength(3);
 });
});
