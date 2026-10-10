import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {EffectivenessView} from '../operations/Effectiveness';
import type {EffectivenessSource} from '../data-access/effectiveness';
import type {EffectivenessPage} from '@shippingco/shared';
import type {CommandIntent} from '../data-access/command-intent';
import {ApiFailure} from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000065';
const page:EffectivenessPage={snapshot:{id,schema_version:1,definition:'messaging_effectiveness_v1',organization_id:id,franchise_id:id,filter:{week:'2026-09-28'},count:3,timezone:'UTC',as_of:'2026-10-10T00:00:00.000Z',expires_at:'2026-10-11T00:00:00.000Z',minimum_subjects:5,freshness:{state:'captured',captured_at:'2026-10-10T00:00:00.000Z'},staffing:{state:'configured',timezone:'Asia/Kolkata',weekdays:[1,2,3,4,5],start_minute:540,end_minute:1080,policy:'captured_current_schedule'}},selection:{section:null,category:null},items:[
  {section:'messaging',category:'accepted',count:5,suppressed:false,denominator:5,denominator_kind:'logical_intents',excluded:0,latency_ms:null,business_minutes:null,age_suppressed:false},
  {section:'assistant',category:'thanks',count:null,suppressed:true,denominator:null,denominator_kind:'measured_turns',excluded:null,latency_ms:null,business_minutes:null,age_suppressed:false},
  {section:'queue',category:'open',count:5,suppressed:false,denominator:5,denominator_kind:'active_cases',excluded:0,latency_ms:null,business_minutes:12,age_suppressed:false},
]};
const fixture=():EffectivenessSource=>({intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async(_id,_signal,section=null,category=null)=>({...page,selection:{section,category},items:page.items.filter(r=>(section===null||r.section===section)&&(category===null||r.category===category))}))});
describe('production effectiveness snapshot UI',()=>{
  it('keyboard capture reloads identity and drills through aggregates while separating unknown delivery, thanks and queue policy',async()=>{
    const source=fixture();render(<MemoryRouter><EffectivenessView source={source}/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Week beginning Monday (UTC)'),{target:{value:'2026-09-28'}});
    const button=screen.getByRole('button',{name:'Create effectiveness snapshot'});button.focus();expect(button).toHaveFocus();fireEvent.submit(button.closest('form')!);
    expect(await screen.findByText('messaging · Accepted · delivery unknown')).toBeVisible();expect(screen.getByText('Suppressed')).toBeVisible();expect(screen.getByText(/current weekly schedule in Asia\/Kolkata/)).toBeVisible();
    expect(screen.getByText(/Calls saved and ROI are unmeasured/)).toBeVisible();
    await waitFor(()=>expect(source.page).toHaveBeenCalledWith(id,expect.any(AbortSignal),null,null));
    fireEvent.click(screen.getByRole('button',{name:'Inspect accepted'}));
    await waitFor(()=>expect(source.page).toHaveBeenLastCalledWith(id,expect.any(AbortSignal),'messaging','accepted'));
    expect(await screen.findByText('Selected category: accepted')).toBeVisible();expect(screen.queryByText('assistant · thanks')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Back to all categories'}));await waitFor(()=>expect(source.page).toHaveBeenLastCalledWith(id,expect.any(AbortSignal),'messaging',null));
  });
  it('retries saved failures and reuses the exact uncertain capture while keeping filters disabled',async()=>{
    const source=fixture();vi.mocked(source.page).mockRejectedValueOnce(new ApiFailure('RESOURCE_NOT_FOUND'));
    render(<MemoryRouter initialEntries={['/?effectiveness_snapshot='+id]}><EffectivenessView source={source}/></MemoryRouter>);
    expect(await screen.findByText(/Report unavailable or expired/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Retry saved effectiveness'}));expect(await screen.findByText('messaging · Accepted · delivery unknown')).toBeVisible();
    vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
    fireEvent.click(screen.getByRole('button',{name:'Create effectiveness snapshot'}));const retry=await screen.findByRole('button',{name:'Retry same effectiveness request'});
    expect(screen.getByLabelText('Week beginning Monday (UTC)')).toBeDisabled();fireEvent.click(retry);
    await waitFor(()=>expect(source.execute).toHaveBeenCalledTimes(2));const calls=vi.mocked(source.execute).mock.calls;expect(calls[0]![0]).toBe(calls[1]![0]);
  });
});
