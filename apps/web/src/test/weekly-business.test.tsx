import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {reportMeasures,type ReportPage,type ReportMoney} from '@shippingco/shared';
import WeeklyBusiness,{weeklyDays} from '../operations/WeeklyBusiness';
import * as reportAccess from '../data-access/reports';
import type {CommandIntent} from '../data-access/command-intent';
import {ApiFailure} from '../data-access/errors';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
afterEach(()=>vi.restoreAllMocks());
function fixture(autoLoad=false){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),days=weeklyDays(today),asOf=new Date().toISOString();
 const rows=Array.from({length:101},(_,index)=>({id:f.id(100+index),confirmed_at:days[index===100?6:0]+'T06:00:00Z',billed_gross:index===100?'900719925474099200':'1'})) as ReportPage['rows'];
 const snapshot:ReportPage['snapshot']={id:f.id(10),schema_version:1,definition:'booking_cohort_v1',timezone:'Asia/Kolkata',organization_id:f.org,franchise_id:f.A,filter:{from_day:days[0]!,to_day:today,sort:'confirmed_asc'},as_of:asOf,expires_at:asOf,freshness:{state:'captured',captured_at:asOf},count:101,totals:Object.fromEntries(reportMeasures.map(m=>[m,{state:'known',paise:m==='billed_gross'?'900719925474099300':'0'}])) as Record<typeof reportMeasures[number],ReportMoney>};
 const first:ReportPage={snapshot,rows:rows.slice(0,100),next_offset:100},last:ReportPage={snapshot,rows:rows.slice(100),next_offset:null};
 const source:reportAccess.ReportSource={intent:vi.fn(()=>({key:crypto.randomUUID()} as CommandIntent)),execute:vi.fn(async()=>first),page:vi.fn(async()=>last),export:vi.fn()};
 vi.spyOn(reportAccess,'reports').mockReturnValue(source);
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'org_admin'});
 render(<WeeklyBusiness controller={controller} autoLoad={autoLoad}/>);
 return {source,first,last};
}
it('waits for every saved page before displaying complete counts and exact paise totals',async()=>{
 const {source,last}=fixture(),pending=f.deferred<ReportPage>();vi.mocked(source.page).mockReturnValueOnce(pending.promise);
 fireEvent.click(screen.getByRole('button',{name:'Load report'}));await waitFor(()=>expect(source.page).toHaveBeenCalledWith(last.snapshot.id,100,expect.any(AbortSignal)));
 expect(screen.queryByText('101 bookings in the selected period')).not.toBeInTheDocument();expect(screen.queryByText('Daily figures')).not.toBeInTheDocument();pending.resolve(last);
 expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Billed amount'}));expect(screen.getByText('₹9,00,71,99,25,47,40,993.00')).toBeVisible();
});
it('recovers a failed next page using the same saved report without another capture',async()=>{
 const {source,first}=fixture();vi.mocked(source.page).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network'}));
 fireEvent.click(screen.getByRole('button',{name:'Load report'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Start a fresh weekly report'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry report'}));expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();expect(source.execute).toHaveBeenCalledTimes(1);expect(vi.mocked(source.page).mock.calls.map(call=>call.slice(0,2))).toEqual([[first.snapshot.id,100],[first.snapshot.id,100]]);
});
it('offers a fresh capture after saved evidence expires and rejects inconsistent page identity',async()=>{
 const {source,first,last}=fixture();vi.mocked(source.page).mockRejectedValueOnce(new ApiFailure('REPORT_EXPIRED'));
 fireEvent.click(screen.getByRole('button',{name:'Load report'}));fireEvent.click(await screen.findByRole('button',{name:'Start a fresh weekly report'}));
 expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();expect(source.intent).toHaveBeenCalledTimes(2);expect(vi.mocked(source.execute).mock.calls[0]![0]).not.toBe(vi.mocked(source.execute).mock.calls[1]![0]);
 vi.mocked(source.page).mockResolvedValueOnce({...last,snapshot:{...first.snapshot,id:f.id(99)}});fireEvent.click(screen.getByRole('button',{name:'Refresh report'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('inconsistent');expect(screen.queryByText('101 bookings in the selected period')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Start a fresh weekly report'})).toBeEnabled();
});
it('retains the exact capture request after an uncertain response and offers no fresh action',async()=>{
 const {source}=fixture();vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
 fireEvent.click(screen.getByRole('button',{name:'Load report'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Start a fresh weekly report'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Retry report'}));expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();expect(source.intent).toHaveBeenCalledTimes(1);expect(vi.mocked(source.execute).mock.calls[0]![0]).toBe(vi.mocked(source.execute).mock.calls[1]![0]);
});

it('loads on entry when requested and uses complete saved evidence for a 30-day preset',async()=>{
 const {source,first,last}=fixture(true);expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();
 const end=first.snapshot.filter.to_day,date=new Date(end+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-29);const from=date.toISOString().slice(0,10),snapshot={...first.snapshot,filter:{...first.snapshot.filter,from_day:from}};
 vi.mocked(source.execute).mockResolvedValueOnce({...first,snapshot});vi.mocked(source.page).mockResolvedValueOnce({...last,snapshot});fireEvent.click(screen.getByRole('button',{name:'Last 30 days'}));
 expect(await screen.findByText('101 bookings in the selected period')).toBeVisible();expect(source.intent).toHaveBeenLastCalledWith({from_day:from,to_day:end,sort:'confirmed_asc'});expect(screen.getByRole('button',{name:'Last 30 days'})).toHaveAttribute('aria-pressed','true');
});
it('rejects invalid custom date ranges locally without creating a report',()=>{
 const {source}=fixture();fireEvent.click(screen.getByRole('button',{name:'Custom dates'}));fireEvent.change(screen.getByLabelText('Chart start date'),{target:{value:'2026-11-02'}});fireEvent.change(screen.getByLabelText('Chart end date'),{target:{value:'2026-11-01'}});fireEvent.click(screen.getByRole('button',{name:'Apply dates'}));
 expect(screen.getByRole('alert')).toHaveTextContent('valid range');expect(source.intent).not.toHaveBeenCalled();
});
