import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import MoneyReceipts from '../operations/MoneyReceipts';
import {createScopeController} from '../operator/scope';
import type {MoneyReceiptResult,MoneyReceiptHistoryEntry,OperatorRole,ReceivingAccountDto} from '@shippingco/shared';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),user=id(3),customerId=id(4),accountId=id(5),receiptId=id(6),booking1=id(7),booking2=id(8),booking3=id(9),now='2026-10-01T12:00:00.000Z';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(initial?:MoneyReceiptResult){
 let accounts:ReceivingAccountDto[]=[{id:accountId,revision_id:id(10),version:1,name:'Synthetic cash drawer',methods:['cash'],other_method_name:null,active:true,recorded_at:now}];
 let bills=[{booking_id:booking1,currency:'INR',gross_paise:100000,outstanding_paise:40000,expected_payment_version:1},{booking_id:booking2,currency:'INR',gross_paise:100000,outstanding_paise:50000,expected_payment_version:2},{booking_id:booking3,currency:'INR',gross_paise:100000,outstanding_paise:10000,expected_payment_version:0}];
 let saved=initial??null,uncertain=false,failed=false;const writes:{path:string;body:Record<string,unknown>;key:string}[]=[];
 let history:MoneyReceiptHistoryEntry[]=initial?[{id:id(40),booking_id:booking1,payment_entry_id:id(50),kind:'allocation',amount_paise:40000,release_of:null,version:1,recorded_at:now,released_paise:0},{id:id(41),booking_id:booking2,payment_entry_id:id(51),kind:'allocation',amount_paise:50000,release_of:null,version:1,recorded_at:now,released_paise:0}]:[];
 const fetcher=vi.fn(async(path:string,options:RequestInit={})=>{
  const url=new URL(path,'https://synthetic.example.test');if(url.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(options.method==='POST'){
   const body=JSON.parse(String(options.body)),key=(options.headers as Record<string,string>)['Idempotency-Key'];writes.push({path:url.pathname,body,key});
   if(url.pathname.includes('/receiving-accounts')){accounts=[{...accounts[0],revision_id:id(11),version:body.expected_version+1,name:body.name,methods:body.methods,other_method_name:body.other_method_name,active:body.active,recorded_at:now}];return json(accounts[0]);}
   if(url.pathname==='/api/v1/money-receipts'){
    if(!saved){const links=body.allocations.map((a:{booking_id:string;amount_paise:number},i:number)=>({id:id(40+i),booking_id:a.booking_id,payment_entry_id:id(50+i),kind:'allocation' as const,amount_paise:a.amount_paise,release_of:null}));const applied=links.reduce((sum:number,a:{amount_paise:number})=>sum+a.amount_paise,0);
     saved={receipt_id:receiptId,customer_id:customerId,version:1,currency:'INR',received_paise:body.amount_paise,allocated_paise:applied,unallocated_paise:body.amount_paise-applied,allocations:links};history=links.map((a:MoneyReceiptResult['allocations'][number])=>({...a,version:1,recorded_at:now,released_paise:0}));bills=bills.map(b=>{const a=links.find((a:{booking_id:string})=>a.booking_id===b.booking_id);return a?{...b,outstanding_paise:b.outstanding_paise-a.amount_paise,expected_payment_version:b.expected_payment_version+1}:b;});
    }
    if(uncertain&&!failed){failed=true;throw new TypeError('Synthetic response lost after save');}return json(saved);
   }
   if(url.pathname.endsWith('/allocation-corrections')){const original=history.find(a=>a.id===body.allocation_id)!;history=history.map(a=>a.id===original.id?{...a,released_paise:a.released_paise+body.amount_paise}:a);
    const link={id:id(60),booking_id:original.booking_id,payment_entry_id:id(61),kind:'release' as const,amount_paise:body.amount_paise,release_of:original.id};saved={...saved!,version:body.expected_version+1,allocated_paise:saved!.allocated_paise-body.amount_paise,unallocated_paise:saved!.unallocated_paise+body.amount_paise,allocations:[link]};history.push({...link,version:saved.version,recorded_at:now,released_paise:0});return json(saved);
   }
   if(url.pathname.endsWith('/allocations')){const links=body.allocations.map((a:{booking_id:string;amount_paise:number},i:number)=>({id:id(70+i),booking_id:a.booking_id,payment_entry_id:id(80+i),kind:'allocation' as const,amount_paise:a.amount_paise,release_of:null})),total=links.reduce((sum:number,a:{amount_paise:number})=>sum+a.amount_paise,0);saved={...saved!,version:body.expected_version+1,allocated_paise:saved!.allocated_paise+total,unallocated_paise:saved!.unallocated_paise-total,allocations:links};return json(saved);}
   throw new Error('Unexpected mutation route');
  }
  if(url.pathname.endsWith('/customers/'+customerId))return json({id:customerId,name:'Synthetic customer',phone:'+12025550101',phone_display:'masked 0101',address:'Fictional Street',version:1,created_at:now,updated_at:now});
  if(url.pathname.endsWith('/customers'))return json({items:[{id:customerId,name:'Synthetic customer',phone:'+12025550101',phone_display:'•••0101',address:'Fictional Street',version:1,created_at:now,updated_at:now}],page:{has_more:false,next_cursor:null}});
  if(url.pathname==='/api/v1/receiving-accounts')return json({items:accounts,next_cursor:null});
  if(url.pathname==='/api/v1/money-receipt-receivers')return json({items:[{id:user,label:'You (signed-in staff)'}],next_cursor:null});
  if(url.pathname==='/api/v1/money-receipt-bills')return json({items:bills,next_cursor:null});
  if(url.pathname==='/api/v1/money-receipts')return json({items:saved?[saved]:[],next_cursor:null});
  if(url.pathname.endsWith('/balance'))return json(saved);
  if(url.pathname.endsWith('/history'))return json({items:history,next_cursor:null});
  if(url.pathname==='/api/v1/money-receipts/'+receiptId)return json({receipt:{id:receiptId,customer_id:customerId,account_id:accountId,account_revision_id:id(10),method:'cash',received_paise:saved!.received_paise,currency:'INR',receiver_id:user,initial_custodian_id:user,occurred_at:now,recorded_at:now,external_reference:'PRIVATE-SYNTHETIC-REF',verification:'manually_recorded_unverified'},balance:saved});
  throw new Error('Unexpected read route');
 });
 vi.stubGlobal('fetch',fetcher);return {fetcher,writes,uncertain(){uncertain=true;},saved:()=>saved};
}
function view(roles:OperatorRole[],path='/business/money-receipts'){const controller=createScopeController();controller.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:roles.join(',')});return render(<MemoryRouter initialEntries={[path]}><a href="/business">Workspace link</a><MoneyReceipts controller={controller} roles={roles}/></MemoryRouter>);}
async function chooseCustomer(){fireEvent.change(screen.getByLabelText(/^Customer name prefix/),{target:{value:'Syn'}});fireEvent.submit(screen.getByRole('form',{name:'Find receipt customer'}));fireEvent.click(await screen.findByRole('button',{name:'Synthetic customer · •••0101'}));await screen.findByText('Customer bills');await screen.findByText('Booking '+booking1);}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('production money receipt workflows',()=>{
 it('retains the exact advance intent after a lost response and blocks replacement/navigation until same-key reconciliation',async()=>{
  const f=fixture();f.uncertain();view(['operator']);await chooseCustomer();
  fireEvent.change(screen.getByLabelText('Amount received (₹)'),{target:{value:'-1'}});expect(screen.getByLabelText(/^Amount received/)).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('button',{name:'Confirm money received'})).toBeDisabled();expect(f.writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(/^Amount received/),{target:{value:'1000'}});
  fireEvent.change(screen.getByLabelText('Apply to booking '+booking1),{target:{value:'401'}});expect(screen.getByLabelText('Apply to booking '+booking1)).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('button',{name:'Confirm money received'})).toBeDisabled();expect(f.writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Apply to booking '+booking1),{target:{value:''}});
fireEvent.change(screen.getByLabelText(/^Receiving account \/ cash drawer/),{target:{value:accountId}});fireEvent.change(screen.getByLabelText(/^Private external reference/),{target:{value:'PRIVATE-SYNTHETIC-REF'}});
  const confirm=screen.getByRole('button',{name:'Confirm money received'});await waitFor(()=>expect(confirm).toBeEnabled());confirm.focus();expect(confirm).toHaveFocus();fireEvent.click(confirm);await screen.findByText(/The outcome is uncertain/);
  expect(screen.getByLabelText(/^Customer name prefix/)).toBeDisabled();expect(confirm).toBeDisabled();expect(fireEvent.click(screen.getByText('Workspace link'))).toBe(false);await screen.findByText(/Finish or reconcile the retained request/);
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByText('Receipt '+receiptId);expect(f.writes).toHaveLength(2);expect(f.writes[1]).toEqual(f.writes[0]);expect(f.saved()).toMatchObject({received_paise:100000,allocated_paise:0,unallocated_paise:100000,allocations:[]});
  expect(screen.getByLabelText('Amount received (₹)')).toHaveValue('');expect(screen.queryByText('PRIVATE-SYNTHETIC-REF')).not.toBeInTheDocument();expect(f.fetcher.mock.calls.some(([path])=>String(path).split('?')[0]==='/api/v1/money-receipts/'+receiptId)).toBe(false);
 });
 it('records one receipt across two current bill versions and displays the residual advance',async()=>{
  const f=fixture();view(['operator'],'/business/money-receipts?'+new URLSearchParams({customer_id:customerId,booking_id:booking1,context:'paid_counter'}));await screen.findByText('Booking '+booking1);fireEvent.change(screen.getByLabelText('Amount received (₹)'),{target:{value:'1000'}});fireEvent.change(screen.getByLabelText(/^Receiving account \/ cash drawer/),{target:{value:accountId}});
  fireEvent.change(screen.getByLabelText(new RegExp('^Apply to booking '+booking1)),{target:{value:'400'}});fireEvent.change(screen.getByLabelText(new RegExp('^Apply to booking '+booking2)),{target:{value:'500'}});const button=screen.getByRole('button',{name:'Confirm money received'});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);await screen.findByText('Receipt '+receiptId);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({customer_id:customerId,account_id:accountId,expected_account_version:1,amount_paise:100000,method:'cash',receiver_id:user,custodian_id:user,allocations:[{booking_id:booking1,amount_paise:40000,context:'paid_counter',expected_payment_version:1},{booking_id:booking2,amount_paise:50000,context:'paid_counter',expected_payment_version:2}]});expect(f.saved()).toMatchObject({allocated_paise:90000,unallocated_paise:10000});
 });
 it('applies an existing advance without recording another inflow',async()=>{
  const initial:MoneyReceiptResult={receipt_id:receiptId,customer_id:customerId,version:1,currency:'INR',received_paise:100000,allocated_paise:90000,unallocated_paise:10000,allocations:[]};const f=fixture(initial);view(['operator']);await chooseCustomer();fireEvent.click(await screen.findByRole('button',{name:'Open receipt'}));await screen.findByText('Apply existing advance');
  const form=screen.getByRole('button',{name:'Apply advance to selected bills'}).closest('form')!;const field=form.querySelector(`input`) as HTMLInputElement;const fields=form.querySelectorAll('input');expect(fields).toHaveLength(3);fireEvent.change(fields[2],{target:{value:'100'}});expect(field).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Apply advance to selected bills'}));await waitFor(()=>expect(f.saved()?.version).toBe(2));
  expect(f.writes).toHaveLength(1);expect(f.writes[0].path).toBe('/api/v1/money-receipts/'+receiptId+'/allocations');expect(f.writes[0].body).toEqual({expected_version:1,allocations:[{booking_id:booking3,amount_paise:10000,context:'to_pay',expected_payment_version:0}]});expect(f.saved()?.received_paise).toBe(100000);
 });
 it('uses the original allocation history for an admin release and keeps private finance evidence role-scoped',async()=>{
  const initial:MoneyReceiptResult={receipt_id:receiptId,customer_id:customerId,version:2,currency:'INR',received_paise:100000,allocated_paise:100000,unallocated_paise:0,allocations:[]};const f=fixture(initial);view(['franchise_admin']);await chooseCustomer();fireEvent.click(await screen.findByRole('button',{name:'Open receipt'}));await screen.findByText('PRIVATE-SYNTHETIC-REF');
  fireEvent.change(await screen.findByLabelText(/^Original allocation/),{target:{value:id(40)}});fireEvent.change(screen.getByLabelText('Release amount (₹)'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'Release allocation (admin)'}));await waitFor(()=>expect(f.saved()?.version).toBe(3));expect(f.writes[0].body).toEqual({expected_version:2,allocation_id:id(40),amount_paise:10000,currency:'INR',reason_code:'incorrect_amount'});expect(f.saved()).toMatchObject({received_paise:100000,unallocated_paise:10000});
  for(const role of ['accountant','org_admin'] as OperatorRole[]){
   cleanup();f.fetcher.mockClear();view([role]);
   expect(screen.queryByRole('form',{name:'Find receipt customer'})).not.toBeInTheDocument();
   fireEvent.change(screen.getByLabelText(/^Receipt reference/),{target:{value:receiptId}});fireEvent.submit(screen.getByRole('form',{name:'Open finance receipt'}));
   await screen.findByText('PRIVATE-SYNTHETIC-REF');await screen.findByText('Booking '+booking1);
   expect(screen.queryByRole('button',{name:'Confirm money received'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Release allocation (admin)'})).not.toBeInTheDocument();
   expect(f.fetcher.mock.calls.some(([path])=>new URL(path,'https://synthetic.example.test').pathname.includes('/customers'))).toBe(false);
  }
  cleanup();const calls=f.fetcher.mock.calls.length;view(['read_only']);expect(screen.getByText('Receipt access unavailable')).toBeVisible();expect(f.fetcher.mock.calls).toHaveLength(calls);
 });
 it('configures a named other receiving method through an append-only administrator account revision',async()=>{
  const f=fixture();view(['franchise_admin']);fireEvent.click(await screen.findByRole('button',{name:'Edit account'}));fireEvent.click(screen.getByRole('checkbox',{name:'Named other method'}));fireEvent.change(screen.getByRole('textbox',{name:'Named other method'}),{target:{value:'Synthetic cheque'}});fireEvent.click(screen.getByRole('button',{name:'Save receiving account'}));await waitFor(()=>expect(f.writes).toHaveLength(1));expect(f.writes[0].path).toBe('/api/v1/receiving-accounts/'+accountId+'/revisions');expect(f.writes[0].body).toEqual({name:'Synthetic cash drawer',methods:['other'],other_method_name:'Synthetic cheque',active:true,expected_version:1});await screen.findByText(/^Synthetic cash drawer.*Active.*version 2$/);
 });
});
