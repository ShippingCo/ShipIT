import React from 'react';
import { describe,it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesView,salesAmount } from '../operations/Sales';
import type { SalesSource } from '../data-access/sales';
import type { CommandIntent } from '../data-access/command-intent';
import { salesMeasures,type SalesPage,type SalesAmounts,type AccountStatement } from '@shippingco/shared';
import { sales } from '../data-access/sales';
import { scopedApi } from '../data-access/scoped-api';
import { createScopeController } from '../operator/scope';
import * as f from './counter-fixture';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000062';
const page:SalesPage={snapshot:{id,schema_version:1,definition:'sales_gst_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,filter:{from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_asc',rate:null,franchise_ids:[id]},as_of:'2026-10-01T00:00:00.000Z',expires_at:'2026-10-02T00:00:00.000Z',count:0,totals:Object.fromEntries(salesMeasures.map(m=>[m,'0'])) as SalesAmounts,groups:[]},rows:[],next_offset:null};
function fixture():SalesSource{return {franchise:id,intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,columns:['booking_id'],csv:'"booking_id"\r\n'})),current:vi.fn(),financeIntent:vi.fn(),executeFinance:vi.fn(),statement:vi.fn()};}
const view=(source:SalesSource,exporting=true)=><SalesView source={source} canExport={exporting} canManage={false} franchises={[{id,name:'Synthetic shop'}]}/>;
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('sales report UI',()=>{
 it('decodes refund corrections and opens a monthly statement with its frozen balance',async()=>{
  const zero=page.snapshot.totals,amounts={...zero,pre_tax:'10000',taxable:'10000',gross:'10000',collections:'1000',refunds:'400',outstanding:'9400'};
  const saved:SalesPage={...page,snapshot:{...page.snapshot,organization_id:f.org,franchise_id:f.A,count:1,totals:amounts},rows:[{id:f.bookingId,franchise_id:f.A,customer_id:f.customerId,confirmed_at:f.now,booking_version:1,payment_version:1,receipt_id:null,receipt_number:null,rate:'0/1',treatment:'zero',jurisdiction:'intra',policy_id:f.id(11),original:amounts,amounts,statement_ids:[f.id(80)],corrections:[{id:f.id(81),kind:'refund_correction',occurred_at:f.now,refund:'100',taxable:'0',pre_tax:'0',cgst:'0',sgst:'0',igst:'0',rounding:'0',reason:'incorrect_refund_recording',approval_ref:'SYN_REVIEW'}]}]};
  const totals={opening:'0',charges:'10000',credits:'0',payments:'1000',refunds:'400',closing:'9400',outstanding:'9400',refundable_credit:'0'};
  const document:AccountStatement={id:f.id(80),kind:'account_statement_v2',account_id:f.id(70),account_revision_id:f.id(71),account_name:'Fictional account',customer_id:f.customerId,from_day:'2099-01-01',to_day:'2099-01-31',as_of:f.now,version:2,previous_statement_id:f.id(79),source_digest:'synthetic',totals,unallocated_advance:'200',advance_sources:[{receipt_id:f.id(90),version:1,received:'1200',allocated:'1000',cod_reserved:'0',returned:'0',unallocated:'200'}],lines:[{booking_id:f.bookingId,confirmed_at:f.now,due_date:'2099-02-10',source_statement_id:f.id(79),payment_version:1,financial_version:2,receipt_id:null,original_gross:'10000',pre_tax:'10000',cgst:'0',sgst:'0',igst:'0',rounding:'0',payment_ids:[],adjustment_ids:[],payment_evidence:[],adjustment_evidence:[],amounts:totals}]};
  vi.stubEnv('VITE_DATA_MODE','production');vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
   if(path.includes('/operator-context'))return f.json(f.context);
   if(path.startsWith('/api/v1/finance/statements/'))return f.json(document);
   if(path.startsWith('/api/v1/finance/bookings/'))return f.json({version:2,payment_version:1,gross:'10000',collections:'1000',refunds:'400',pre_tax:'10000',taxable:'10000',cgst:'0',sgst:'0',igst:'0',rounding:'0',changes:[{...saved.rows[0]!.corrections[0],version:2}]});
   if(path.startsWith('/api/v1/reports/sales/'))return f.json(saved);
   throw new Error('Unexpected synthetic sales request');
  }));
  document.source_digest='a'.repeat(64);document.lines[0]!.payment_ids=[f.id(91)];document.lines[0]!.payment_evidence=[{id:f.id(91),kind:'collection',amount:'1000',recorded_at:f.now}];document.lines[0]!.adjustment_ids=[f.id(92)];document.lines[0]!.adjustment_evidence=[{id:f.id(92),kind:'refund',reason:'customer_refund',credit:'0',refund:'400',recorded_at:f.now}];
  const controller=createScopeController();await controller.load();const source=sales(scopedApi(controller));
  render(<MemoryRouter initialEntries={['/?sales_snapshot='+id]}><SalesView source={source} canExport={false} canManage={false} franchises={[{id:f.A,name:'Synthetic shop'}]}/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'View saved evidence for booking '+f.bookingId}));
  expect(await screen.findByText(/Refund record reduced by ₹1.00 \(no new transfer\)/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Open account statement '+document.id}));
  expect(await screen.findByText(/Revision 2 · Previous/)).toBeVisible();expect(screen.getByText(/= closing ₹94.00/)).toBeVisible();expect(screen.getByText('Separate unallocated advance ₹2.00')).toBeVisible();
  expect((await source.current(f.bookingId)).changes[0]!.kind).toBe('refund_correction');
 });
 it('creates through the labelled keyboard form, reloads saved filters, shows zero sales and requests the saved CSV',async()=>{
  const source=fixture();render(<MemoryRouter>{view(source)}</MemoryRouter>);const button=screen.getByRole('button',{name:'Create sales snapshot'});button.focus();expect(button).toHaveFocus();fireEvent.submit(button.closest('form')!);
  expect(await screen.findByText(/No sales for these filters/)).toBeVisible();expect(screen.getByText(/not an official tax return/)).toBeVisible();
  await waitFor(()=>expect(source.page).toHaveBeenCalledWith(id,0,expect.any(AbortSignal)));
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:sales')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  fireEvent.click(screen.getByRole('button',{name:'Download matching sales CSV'}));await waitFor(()=>expect(source.export).toHaveBeenCalledWith(id));click.mockRestore();expect(salesAmount('-40')).toBe('−₹0.40');
 });
 it('retries the exact uncertain intent and denies exports for a read-only report grant',async()=>{
  const source=fixture();vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));render(<MemoryRouter>{view(source,false)}</MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Create sales snapshot'}));const retry=await screen.findByRole('button',{name:'Retry same report request'});fireEvent.change(screen.getByLabelText('From day'),{target:{value:'2026-09-01'}});fireEvent.click(retry);
  expect(await screen.findByText(/No sales for these filters/)).toBeVisible();const calls=vi.mocked(source.execute).mock.calls;expect(calls[0]![0]).toBe(calls[1]![0]);expect(screen.getByRole('button',{name:'Download matching sales CSV'})).toBeDisabled();
 });
});
