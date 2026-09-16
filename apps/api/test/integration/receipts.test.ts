import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {receiptDto,type ReceiptRow} from '../../src/modules/receipts/types.ts';
import {receiptScope} from '../../src/modules/memberships/policy.ts';
import type {Membership,Role} from '../../src/modules/memberships/types.ts';
import {selection,uuid} from '../../src/modules/receipts/validation.ts';
import {byId,insert} from '../../src/modules/receipts/repository.ts';
import type {TenantAccess} from '../../src/modules/security/scope.ts';
const id=randomUUID();
const row=()=>({id,number:'RCT-0000000000000000001',schema_version:1,version:1,booking_id:randomUUID(),issued_at:new Date('2099-01-01T00:00:00Z'),kind:'booking_charge',booking_receipt_id:null,correction_of:null,
 organization_id:'SYN_SECRET',actor_id:'SYN_SECRET',snapshot:{currency:'INR',raw_tax_intent:'SYN_SECRET',issuer:{organization_name:'Synthetic',franchise_name:'Synthetic',franchise_code:'SYN',supplier_gstin:'27ABCDE1234F1Z5',supplier_state:'27',logo:'SYN_SECRET'},booking:{customer_name:'Synthetic',confirmed_at:'2099-01-01T00:00:00.000Z',service:'standard',phone:'SYN_SECRET',parcels:[{docket:'SIT-0000000000000000001',weight_grams:999,address:'SYN_SECRET'}]},charges:{freight_paise:100,packing_paise:0,raw_input:'SYN_SECRET',tax:{pre_tax_paise:100,taxable_basis_paise:100,cgst_paise:0,sgst_paise:0,igst_paise:0,tax_total_paise:0,unrounded_payable_paise:100,rounding_adjustment_paise:0,final_payable_paise:100,policy_id:id,policy_version:1,rule_id:'SYN',classification:'SYN',treatment:'exempt',supplier_state:'27',place_of_supply:'27',jurisdiction:'intra',allocation:'largest_remainder_v1',fingerprint:'SYN_SECRET',components:[{id:'SYN',kind:'CGST',numerator:0,denominator:1,exact_numerator:'0',exact_denominator:'1',amount_paise:0,private:'SYN_SECRET'}]}}}} as unknown as ReceiptRow);
describe('R13 receipt boundary',()=>{
 it.each(['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as Role[])('enforces the exact independent R13 matrix for %s',role=>{
  const m={role,lifecycle:'active',franchiseIds:[id]} as Membership;
  expect(receiptScope([m],[id])).toEqual(['org_admin','franchise_admin','operator','accountant'].includes(role)?[id]:[]);
  expect(receiptScope([{...m,lifecycle:'revoked'}],[id])).toEqual([]);
 });
 it('allowlists every nested booking/issuer/tax field instead of returning stored JSON',()=>{
  const stored=row(),dto=receiptDto(stored);expect(dto.kind).toBe('booking_charge');expect(JSON.stringify(dto)).not.toContain('SYN_SECRET');
  expect(dto.issued_at).toBe('2099-01-01T00:00:00Z');expect(dto).not.toHaveProperty('organization_id');
  expect(dto.booking.parcels[0]).toEqual({docket:'SIT-0000000000000000001',weight_grams:999});
 });
 it('allowlists entry-only collection and linked reversal without stored balances',()=>{
  const stored=row();stored.kind='collection_acknowledgement';stored.booking_receipt_id=id;
  stored.snapshot.entry={id,kind:'collection',amount_paise:1,currency:'INR',context:'paid_counter',method:'cash',collection_reference:id,reversal_of:null,reason_code:null,version:1,occurred_at:'2099-01-01T00:00:00.000Z',command_id:'SYN_SECRET',outstanding_paise:0} as unknown as NonNullable<ReceiptRow['snapshot']['entry']>;
  const ack=receiptDto(stored);expect(ack.kind).toBe('collection_acknowledgement');expect(JSON.stringify(ack)).not.toMatch(/SYN_SECRET|charges|outstanding/);
  stored.kind='collection_reversal';stored.correction_of=id;stored.snapshot.entry.kind='reversal';stored.snapshot.entry.reversal_of=id;
  expect(receiptDto(stored)).toMatchObject({kind:'collection_reversal',correction_of:id});
  stored.correction_of=null;expect(()=>receiptDto(stored)).toThrow('TEMPORARILY_UNAVAILABLE');
 });
 it('rejects malformed selectors and foreign URLs rather than treating a URL as authority',()=>{
  for(const value of ['https://foreign.example/receipt/'+id,'RCT-0000000000000000001','bad',undefined])expect(()=>uuid(value,'receipt_id')).toThrow();
  expect(()=>selection({organization_id:id,franchise_id:id,download_url:'https://foreign.example/receipt'})).toThrow();
 });
 it('rejects forged capabilities before any SQL is executed',async()=>{
  await expect(byId({} as TenantAccess,id)).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
  await expect(insert({} as TenantAccess,id,id,id,'booking_charge',null,null,null)).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
 });
});
