import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {PerformanceView} from '../operations/Performance';
import type {PerformanceSource} from '../data-access/performance';
import type {CommandIntent} from '../data-access/command-intent';
import type {PerformancePage,PerformanceSummary} from '@shippingco/shared';
import {ApiFailure} from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000064';
const summary:PerformanceSummary={booked:0,dispatched:0,delivered:0,open:0,rto:0,failed_parcels:0,failed_attempts:0,on_time:{numerator:0,denominator:0,excluded:0},duration:{total_seconds:0,denominator:0,excluded:0},unknown_destination:0,unknown_courier:0};
const page:PerformancePage={snapshot:{id,schema_version:1,definition:'delivery_performance_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,audience:'franchise',
  filter:{from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_desc',eta:'original'},as_of:'2026-10-01T01:00:00.000Z',expires_at:'2026-10-02T01:00:00.000Z',freshness:{state:'captured',captured_at:'2026-10-01T01:00:00.000Z'},count:0,summary,destinations:[],routes:[]},selection:{destination:null,route_id:null,count:0,summary},rows:[],next_offset:null};
const fixture=():PerformanceSource=>({intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,selection:page.selection,columns:['parcel_id'],csv:'"parcel_id"\r\n'}))});
describe('performance report production UI',()=>{
  it('keyboard submit saves identity, reloads, displays empty denominator and exports matching selection',async()=>{
    const source=fixture();render(<MemoryRouter><PerformanceView source={source} canExport={true}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('From day'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('Through day'),{target:{value:'2026-10-01'}});
    const button=screen.getByRole('button',{name:'Create performance snapshot'});button.focus();expect(button).toHaveFocus();fireEvent.submit(button.closest('form')!);
    expect(await screen.findByText('No parcels match this selection. CSV contains headers.')).toBeVisible();
    expect(screen.getByText(/Unavailable \(no eligible deliveries\)/)).toBeVisible();
    await waitFor(()=>expect(source.page).toHaveBeenCalledWith(id,0,expect.any(AbortSignal),null,null));
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:fixture')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'Download matching performance CSV'}));
    expect(await screen.findByText('Matching CSV ready. Check your downloads.')).toBeVisible();expect(source.export).toHaveBeenCalledWith(id,null,null);click.mockRestore();
  });
  it('reload errors expose retry, denied export remains disabled and uncertain capture reuses exact intent',async()=>{
    const source=fixture();const assigned={...page,snapshot:{...page.snapshot,audience:'assignment' as const}};vi.mocked(source.page).mockResolvedValue(assigned).mockRejectedValueOnce(new ApiFailure('RESOURCE_NOT_FOUND'));vi.mocked(source.execute).mockResolvedValue(assigned);
    render(<MemoryRouter initialEntries={['/?performance_snapshot='+id]}><PerformanceView source={source} canExport={false}/></MemoryRouter>);
    expect(await screen.findByText(/Report unavailable or expired/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Retry saved performance'}));
    expect(await screen.findByRole('button',{name:'Download matching performance CSV'})).toBeDisabled();
    expect(screen.getByText('Your latest assigned parcels only; no franchise totals.')).toBeVisible();
    vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
    fireEvent.click(screen.getByRole('button',{name:'Create performance snapshot'}));const retry=await screen.findByRole('button',{name:'Retry same performance request'});
    expect(screen.getByRole('combobox',{name:/ETA basis/})).toBeDisabled();fireEvent.click(retry);
    await waitFor(()=>expect(source.execute).toHaveBeenCalledTimes(2));const calls=vi.mocked(source.execute).mock.calls;expect(calls[0]![0]).toBe(calls[1]![0]);
  });
});
