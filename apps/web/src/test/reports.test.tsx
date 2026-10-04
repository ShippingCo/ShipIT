import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportView } from '../operations/Reports';
import type { ReportSource } from '../data-access/reports';
import type { CommandIntent } from '../data-access/command-intent';
import { reportMeasures,type ReportPage,type ReportMoney } from '@shippingco/shared';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000061';
const page:ReportPage={snapshot:{id,schema_version:1,definition:'booking_cohort_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,
  filter:{from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_desc'},as_of:'2026-10-01T01:00:00.000Z',expires_at:'2026-10-02T01:00:00.000Z',freshness:{state:'captured',captured_at:'2026-10-01T01:00:00.000Z'},count:0,
  totals:Object.fromEntries(reportMeasures.map(m=>[m,{state:'known',paise:'0'}])) as Record<typeof reportMeasures[number],ReportMoney>},rows:[],next_offset:null};
function fixture():ReportSource{return {intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,columns:['booking_id'],csv:'"booking_id"\r\n'}))};}
describe('saved report screen',()=>{
  it('keyboard form creates a snapshot and reloads its server totals with empty export',async()=>{
    const source=fixture();render(<MemoryRouter><ReportView source={source} canExport={true}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('From day'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('Through day'),{target:{value:'2026-10-01'}});
    const button=screen.getByRole('button',{name:'Create snapshot'});button.focus();expect(button).toHaveFocus();fireEvent.submit(button.closest('form')!);
    expect(await screen.findByText('No bookings in this period. CSV contains headers.')).toBeVisible();
    expect(source.intent).toHaveBeenCalledWith({from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_desc'});
    await waitFor(()=>expect(source.page).toHaveBeenCalledWith(id,0,expect.any(AbortSignal)));
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:fixture')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'Download matching CSV'}));
    expect(await screen.findByText('CSV ready. Check your downloads.')).toBeVisible();expect(source.export).toHaveBeenCalledWith(id);click.mockRestore();
  });
  it('reload keeps snapshot identity, denies export without grant and shows safe expiry errors',async()=>{
    const source=fixture();vi.mocked(source.page).mockRejectedValueOnce(new ApiFailure('RESOURCE_NOT_FOUND'));
    render(<MemoryRouter initialEntries={['/?snapshot='+id]}><ReportView source={source} canExport={false}/></MemoryRouter>);
    expect(await screen.findByText(/Report unavailable or expired/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Retry saved report'}));
    expect(await screen.findByRole('button',{name:'Download matching CSV'})).toBeDisabled();expect(source.export).not.toHaveBeenCalled();
  });
  it('an uncertain capture retries the same immutable request after editing the draft',async()=>{
    const source=fixture();vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
    render(<MemoryRouter><ReportView source={source} canExport={true}/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'Create snapshot'}));
    const retry=await screen.findByRole('button',{name:'Retry same snapshot request'});fireEvent.change(screen.getByLabelText('From day'),{target:{value:'2026-09-01'}});fireEvent.click(retry);
    expect(await screen.findByText('No bookings in this period. CSV contains headers.')).toBeVisible();
    const calls=vi.mocked(source.execute).mock.calls;expect(calls[0]![0]).toBe(calls[1]![0]);
  });
});
