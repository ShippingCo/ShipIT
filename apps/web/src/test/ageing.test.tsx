import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ageingBuckets,ageingMeasures,type AgeingPage,type AgeingAmounts,type AgeingSummary } from '@shippingco/shared';
import { AgeingView } from '../operations/Ageing';
import type { AgeingSource } from '../data-access/ageing';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000063';
const page:AgeingPage={snapshot:{id,schema_version:1,definition:'to_pay_ageing_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,filter:{anchor:'due',status:null,customer_id:null,balances:'outstanding'},as_of:'2026-10-04T00:00:00.000Z',expires_at:'2026-10-05T00:00:00.000Z',count:0,totals:Object.fromEntries(ageingMeasures.map(k=>[k,'0'])) as AgeingAmounts,buckets:Object.fromEntries(ageingBuckets.map(k=>[k,'0'])) as AgeingSummary['buckets'],customers:[],due_date_source:'unavailable',advance_source:'unavailable'},rows:[],next_offset:null};
function fixture():AgeingSource{return {intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,columns:['booking_id'],csv:'"booking_id"\r\n'}))};}
describe('ageing report UI',()=>{
  it('uses explicit age and status filters, restores saved evidence and exports the saved ID',async()=>{
    const source=fixture();render(<MemoryRouter><AgeingView source={source} canExport={true}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Age from'),{target:{value:'due'}});fireEvent.change(screen.getByLabelText('Parcel status'),{target:{value:'delivered'}});
    const create=screen.getByRole('button',{name:'Create ageing snapshot'});create.focus();expect(create).toHaveFocus();fireEvent.submit(create.closest('form')!);
    await waitFor(()=>expect(screen.getByText('No matching balances. CSV contains headers.')).toBeVisible());expect(source.intent).toHaveBeenCalledWith({anchor:'due',status:'delivered',customer_id:null,balances:'outstanding'});
    await waitFor(()=>expect(source.page).toHaveBeenCalledWith(id,0,expect.any(AbortSignal)));expect(screen.getByText(/Booking age is not days overdue/)).toBeVisible();
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:ageing')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'Download matching ageing CSV'}));expect(await screen.findByText('CSV ready. Check your downloads.')).toBeVisible();expect(source.export).toHaveBeenCalledWith(id);click.mockRestore();
  });
  it('keeps uncertain intent after edits and recovers expired reads without granting export',async()=>{
    const source=fixture();vi.mocked(source.page).mockRejectedValueOnce(new ApiFailure('RESOURCE_NOT_FOUND'));
    render(<MemoryRouter initialEntries={['/?ageing_snapshot='+id]}><AgeingView source={source} canExport={false}/></MemoryRouter>);
    expect(await screen.findByText(/Report or customer unavailable/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Retry saved ageing report'}));expect(await screen.findByRole('button',{name:'Download matching ageing CSV'})).toBeDisabled();
    vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));fireEvent.click(screen.getByRole('button',{name:'Create ageing snapshot'}));
    const retry=await screen.findByRole('button',{name:'Retry same ageing request'});fireEvent.change(screen.getByLabelText('Age from'),{target:{value:'booking'}});fireEvent.click(retry);
    await waitFor(()=>expect(source.execute).toHaveBeenCalledTimes(2));expect(vi.mocked(source.execute).mock.calls[0]![0]).toBe(vi.mocked(source.execute).mock.calls[1]![0]);expect(source.export).not.toHaveBeenCalled();
  });
});
