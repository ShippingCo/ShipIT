import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { SupportQueue } from '../operations/Support';
import type { SupportSource,SupportDetail } from '../data-access/support';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000050',actor='00000000-0000-4000-8000-000000000051',instant='2026-10-02T10:00:00.000Z';
const value:SupportDetail={id,state:'open',version:1,reason:'human_requested',assigned_staff_id:null,created_at:instant,updated_at:instant,parcel_id:null,
 current_actor_id:actor,staff:[{id:actor}],availability:'Staff hours are not configured.',history:[],context:[{intent:'human',outcome:'human_requested',recorded_at:instant}]};
function fixture(detail:SupportDetail=value):SupportSource{return {list:vi.fn(async()=>({items:[detail],page:{has_more:false,next_cursor:null}})),detail:vi.fn(async()=>detail),command:vi.fn(()=>({id:'intent50'} as unknown as CommandIntent)),execute:vi.fn(async()=>detail)};}
describe('human support queue',()=>{
 it('gives the support dialog an accessible name, handles Escape and restores keyboard focus',async()=>{
  render(<SupportQueue source={fixture()} canWrite={true}/>);
  const trigger=await screen.findByRole('button',{name:/Review case/});trigger.focus();fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog',{name:'Support case'});
  expect(dialog).toHaveAccessibleDescription('Private staff workspace. Internal notes are never sent to the customer.');
  await screen.findByLabelText('Action');fireEvent.keyDown(dialog,{key:'Escape',code:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
 });
 it('loads private detail on selection and returns keyboard focus after close',async()=>{
  const source=fixture();render(<SupportQueue source={source} canWrite={true}/>);expect(screen.getByRole('status')).toHaveTextContent('Loading');
  const button=await screen.findByRole('button',{name:/Review case/});expect(source.detail).not.toHaveBeenCalled();button.focus();fireEvent.click(button);
  expect(await screen.findByText(value.availability)).toBeVisible();expect(screen.getByLabelText('Action')).toHaveValue('claim');
  fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(button).toHaveFocus());
 });
 it('handles empty, loading and retriable read errors',async()=>{
  const source=fixture();vi.mocked(source.list).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({items:[],page:{has_more:false,next_cursor:null}});
  render(<SupportQueue source={source} canWrite={false}/>);expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByText('No support cases')).toBeVisible();
 });
 it('claims a case then shows owner reply and internal-note actions',async()=>{
  const source=fixture();render(<SupportQueue source={source} canWrite={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review case/}));await screen.findByText(value.availability);
  vi.mocked(source.detail).mockResolvedValue({...value,state:'claimed',version:2,assigned_staff_id:actor});fireEvent.click(screen.getByRole('button',{name:'Save action'}));
  expect(await screen.findByText('Owner: You')).toBeVisible();expect(source.command).toHaveBeenCalledWith(id,{action:'claim',expected_version:1});
  expect(screen.getByLabelText('Customer message')).toBeRequired();fireEvent.change(screen.getByLabelText('Action'),{target:{value:'note'}});expect(screen.getByLabelText('Internal note')).toBeRequired();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.getByRole('button',{name:/Review case/})).toHaveFocus());
 });
 it('preserves an uncertain reply intent and exposes blocked delivery after retry',async()=>{
  const claimed={...value,state:'claimed' as const,version:2,assigned_staff_id:actor},source=fixture(claimed);
  vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
  render(<SupportQueue source={source} canWrite={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review case/}));await screen.findByText(value.availability);
  fireEvent.change(screen.getByLabelText('Customer message'),{target:{value:'Please describe your question.'}});fireEvent.click(screen.getByRole('button',{name:'Save action'}));
  expect(await screen.findByRole('button',{name:'Retry same request'})).toBeVisible();expect(screen.getByLabelText('Customer message')).toHaveValue('Please describe your question.');
  vi.mocked(source.detail).mockResolvedValue({...claimed,version:3,history:[{id,action:'responded',reason:'operational_review',actor_id:actor,actor_type:'user',occurred_at:instant,text:'Please describe your question.',message_state:'failed',message_reason:'customer_window_closed',attempts:0}]});
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));expect(await screen.findByText(/Customer message: failed/)).toBeVisible();expect(vi.mocked(source.execute).mock.calls[0]![0]).toBe(vi.mocked(source.execute).mock.calls[1]![0]);
 });
 it('keeps drafts after stale state and denies read-only staff mutation',async()=>{
  const source=fixture({...value,state:'claimed',version:2,assigned_staff_id:actor});vi.mocked(source.execute).mockRejectedValue(new ApiFailure('VERSION_CONFLICT'));
  const mounted=render(<SupportQueue source={source} canWrite={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review case/}));await screen.findByText(value.availability);
  fireEvent.change(screen.getByLabelText('Customer message'),{target:{value:'Draft remains.'}});fireEvent.click(screen.getByRole('button',{name:'Save action'}));
  expect(await screen.findByRole('alert')).toBeVisible();expect(screen.getByLabelText('Customer message')).toHaveValue('Draft remains.');mounted.unmount();
  render(<SupportQueue source={fixture()} canWrite={false}/>);fireEvent.click(await screen.findByRole('button',{name:/Review case/}));await screen.findByText(value.availability);expect(screen.queryByRole('button',{name:'Save action'})).not.toBeInTheDocument();
 });
 it('requires a reason to reopen a resolved case',async()=>{
  const source=fixture({...value,state:'resolved',version:3});render(<SupportQueue source={source} canWrite={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review case/}));await screen.findByText(value.availability);
  expect(screen.getByLabelText('Action')).toHaveValue('reopen');fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'incorrect_resolution'}});fireEvent.click(screen.getByRole('button',{name:'Save action'}));await waitFor(()=>expect(source.command).toHaveBeenCalledWith(id,{action:'reopen',expected_version:3,reason:'incorrect_resolution'}));
 });
});
