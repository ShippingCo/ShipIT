import { describe,it,expect,vi,afterEach } from 'vitest';
import { render,fireEvent,screen,cleanup } from '@testing-library/react';
import type { BookingReceiptDto,CollectionReceiptDto,ReceiptDto } from '@shippingco/shared';
import { receiptHTML,receiptMoney,printReceipt,renderReceiptView } from '../utils/receipt';
const dto:BookingReceiptDto={id:'receipt-1',number:'RCT-0000000000000000001',schema_version:1,version:1,booking_id:'booking-1',issued_at:'2099-01-01T01:00:00.000Z',kind:'booking_charge',currency:'INR',booking_receipt_id:null,correction_of:null,
 issuer:{organization_name:'Synthetic Courier',franchise_name:'Synthetic Branch',franchise_code:'SYN',supplier_gstin:'27ABCDE1234F1Z5',supplier_state:'27'},
 booking:{customer_name:'Synthetic Customer',confirmed_at:'2099-01-01T00:00:00.000Z',service:'standard',parcels:[{docket:'SIT-0000000000000000001',weight_grams:999}]},
 charges:{freight_paise:9852,packing_paise:249,tax:{policy_id:'policy-1',policy_version:1,rule_id:'SYN_RULE',classification:'SYN_CLASS',treatment:'taxable',supplier_state:'27',place_of_supply:'27',jurisdiction:'intra',pre_tax_paise:10101,taxable_basis_paise:10101,cgst_paise:253,sgst_paise:252,igst_paise:0,tax_total_paise:505,unrounded_payable_paise:10606,rounding_adjustment_paise:-6,final_payable_paise:10600,allocation:'largest_remainder_v1',components:[{id:'C',kind:'CGST',numerator:1,denominator:40,exact_numerator:'10101',exact_denominator:'40',amount_paise:253},{id:'S',kind:'SGST',numerator:1,denominator:40,exact_numerator:'10101',exact_denominator:'40',amount_paise:252}]}}};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('issued receipt presentation',()=>{
 it('renders booked paise and saved rounding without settlement or a moving ETA',()=>{
  const before=structuredClone(dto),html=receiptHTML(dto);expect(html).toContain('Booked total');expect(html).toContain('₹106.00');expect(html).toContain('-₹0.06');
  expect(html).not.toMatch(/Total paid|PAID|SETTLED|Estimated delivery|Tax Invoice/);expect(dto).toEqual(before);
  vi.useFakeTimers();try{vi.setSystemTime(new Date('2100-01-01'));expect(receiptHTML(dto)).toBe(html);}finally{vi.useRealTimers();}
  expect(receiptMoney(Number.MAX_SAFE_INTEGER)).toBe('₹90071992547409.91');
 });
 it('keeps partial collection and reversal entry labels separate from booked total and settlement',()=>{
  const ack:CollectionReceiptDto={...dto,kind:'collection_acknowledgement',booking_receipt_id:dto.id,correction_of:null,entry:{id:'entry-1',kind:'collection',amount_paise:500,currency:'INR',context:'to_pay',method:'cash',collection_reference:'reference-1',reversal_of:null,reason_code:null,version:1,occurred_at:dto.issued_at}};
  expect(receiptHTML(ack)).toContain('Collected amount');expect(receiptHTML(ack)).toContain('₹5.00');expect(receiptHTML(ack)).not.toMatch(/Booked total|PAID|SETTLED|outstanding/);
  const reversal:ReceiptDto={...ack,kind:'collection_reversal',correction_of:ack.id,entry:{...ack.entry,kind:'reversal',reversal_of:ack.entry.id,reason_code:'incorrect_amount',collection_reference:null}};
  expect(receiptHTML(reversal)).toContain('Reversed amount');expect(receiptHTML(reversal)).toContain('Corrects acknowledgement');
 });
 it('escapes every layout text context and ignores foreign download and executable logo URLs',()=>{
  for(const text of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','"><svg/onload=alert(1)>']){
   const html=renderReceiptView({heading:text,number:text,issuer:text,customer:text,rows:[[text,text]],totalLabel:text,total:text,note:text});
   const root=document.createElement('div');root.innerHTML=html;expect(root.querySelector('script,img,svg,a,iframe,form')).toBeNull();
   expect(root.textContent?.split(text).length).toBe(10);expect(html).toContain('&lt;');
  }
  const hostile={...dto,download_url:'https://foreign.example/private-receipt',issuer:{...dto.issuer,logo:'javascript:alert(1)',address:'<img src=x>',phone:'SYN_PRIVATE'}};
  const html=receiptHTML(hostile);expect(html).not.toMatch(/foreign.example|javascript:|SYN_PRIVATE|<img|href=|src=/);
 });
 it('prints only on explicit action; cancelled/no-op printing keeps source state and clears private DOM',async()=>{
  const source={booking:{id:dto.booking_id},payments:[],outbox:[],receipt:structuredClone(dto)},before=structuredClone(source);
  const retrieve=vi.fn().mockResolvedValue(structuredClone(source.receipt));const issued=await retrieve();
  const transport=vi.fn();vi.stubGlobal('fetch',transport);
  const print=vi.spyOn(window,'print').mockImplementation(()=>{expect(document.getElementById('print-root')?.textContent).toContain(dto.number);});
  render(<button onClick={()=>printReceipt(issued)}>Print receipt</button>);expect(print).not.toHaveBeenCalled();
  const button=screen.getByRole('button',{name:'Print receipt'});button.focus();fireEvent.click(button);fireEvent.click(button);
  expect(print).toHaveBeenCalledTimes(2);expect(source).toEqual(before);expect(source.booking.id).toBe(dto.booking_id);expect(transport).not.toHaveBeenCalled();
  expect(button).toHaveFocus();expect(document.getElementById('print-root')).toBeNull();expect(document.body).not.toHaveClass('printing');
 });
 it('cleans up private print markup even when browser print throws',()=>{
  vi.spyOn(window,'print').mockImplementation(()=>{throw Error('SYN_PRINT_UNAVAILABLE');});
  expect(()=>printReceipt(dto)).toThrow('SYN_PRINT_UNAVAILABLE');expect(document.getElementById('print-root')).toBeNull();expect(document.body).not.toHaveClass('printing');
 });
});
