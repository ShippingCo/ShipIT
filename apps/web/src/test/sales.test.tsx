import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesView,salesAmount } from '../operations/Sales';
import type { SalesSource } from '../data-access/sales';
import type { CommandIntent } from '../data-access/command-intent';
import { salesMeasures,type SalesPage,type SalesAmounts } from '@shippingco/shared';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000062';
const page:SalesPage={snapshot:{id,schema_version:1,definition:'sales_gst_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,filter:{from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_asc',rate:null,franchise_ids:[id]},as_of:'2026-10-01T00:00:00.000Z',expires_at:'2026-10-02T00:00:00.000Z',count:0,totals:Object.fromEntries(salesMeasures.map(m=>[m,'0'])) as SalesAmounts,groups:[]},rows:[],next_offset:null};
function fixture():SalesSource{return {franchise:id,intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,columns:['booking_id'],csv:'"booking_id"\r\n'})),current:vi.fn(),financeIntent:vi.fn(),executeFinance:vi.fn(),statement:vi.fn()};}
const view=(source:SalesSource,exporting=true)=><SalesView source={source} canExport={exporting} canManage={false} franchises={[{id,name:'Synthetic shop'}]}/>;
describe('sales report UI',()=>{
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
