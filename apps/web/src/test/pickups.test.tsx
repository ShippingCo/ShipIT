import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import { Queue } from '../operations/Pickups';
import type { PickupSource,PickupDetail } from '../data-access/pickups';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000049';
const value:PickupDetail={id,state:'submitted',version:1,review_reason:'heavy',requested_window:{start:'2026-10-03T10:00:00.000Z',end:'2026-10-03T12:00:00.000Z'},agreed_window:null,
 address:'12 Synthetic Street, Fictional City',contact:'+12025550149',assigned_staff_id:null,shipment:{origin_key:'ORIGIN',destination_key:'DEST',weight_grams:2000,dimensions_mm:[100,200,300],service:'standard'},notification:null};
function fixture() {
 const source:PickupSource={list:vi.fn(async()=>({items:[value],page:{has_more:false,next_cursor:null}})),detail:vi.fn(async()=>value),decide:vi.fn(()=>({id:'intent49'} as unknown as CommandIntent)),execute:vi.fn(async()=>value)};
 return source;
}
describe('pickup queue',()=>{
 it('loads private details only after selection; keyboard-accessible dialog restores focus',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  const button=await screen.findByRole('button',{name:/Review pickup/});expect(source.detail).not.toHaveBeenCalled();
  expect(screen.queryByText(value.address)).not.toBeInTheDocument();button.focus();fireEvent.click(button);
  expect(await screen.findByText(value.address)).toBeVisible();expect(screen.getByLabelText(/I reviewed/)).toBeRequired();
  expect(screen.getByLabelText(/I checked capacity/)).toBeRequired();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(button).toHaveFocus());
 });
 it('shows empty and recoverable read errors',async()=>{
  const source=fixture();vi.mocked(source.list).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({items:[],page:{has_more:false,next_cursor:null}});
  render(<Queue source={source} canDecide={false}/>);expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByText('No pickup requests')).toBeVisible();
 });
 it('retries the same uncertain decision and exposes saved state with failed messaging',async()=>{
  const source=fixture();vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
  render(<Queue source={source} canDecide={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review pickup/}));
  const dialog=screen.getByRole('dialog');await within(dialog).findByText(value.address);
  fireEvent.change(screen.getByLabelText('Decision'),{target:{value:'declined'}});fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
  expect(await screen.findByRole('button',{name:'Retry same request'})).toBeVisible();
  const final={...value,state:'declined' as const,version:2,notification:{id,state:'failed',reason_code:'provider_unavailable',version:2,attempts:1,created_at:value.requested_window.start}};
  vi.mocked(source.detail).mockResolvedValue(final);vi.mocked(source.execute).mockResolvedValue(final);
  fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));
  expect(await screen.findByText(/Customer message: failed/)).toBeVisible();
  expect(vi.mocked(source.execute).mock.calls[0]![0]).toBe(vi.mocked(source.execute).mock.calls[1]![0]);
 });
 it('accepts only with a valid agreed window and explicit review, then shows the saved result',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review pickup/}));
  await screen.findByText(value.address);
  const start=new Date(Date.now()+86400000),end=new Date(Date.now()+90000000);
  const local=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  fireEvent.change(screen.getByLabelText('Agreed start (your local time)'),{target:{value:local(start)}});
  fireEvent.change(screen.getByLabelText('Agreed end (your local time)'),{target:{value:local(end)}});
  fireEvent.click(screen.getByLabelText(/I checked capacity/));fireEvent.click(screen.getByLabelText(/I reviewed/));
  vi.mocked(source.detail).mockResolvedValue({...value,state:'accepted',version:2,agreed_window:{start:start.toISOString(),end:end.toISOString()}});
  fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
  expect(await screen.findByText(/Agreed:/)).toBeVisible();
  expect(source.decide).toHaveBeenCalledWith(id,expect.objectContaining({expected_version:1,decision:'accepted',capacity_checked:true,manual_reviewed:true}));
 });
 it('shows a stale-version failure and read-only staff cannot act',async()=>{
  const source=fixture();vi.mocked(source.execute).mockRejectedValue(new ApiFailure('VERSION_CONFLICT'));
  const mounted=render(<Queue source={source} canDecide={true}/>);fireEvent.click(await screen.findByRole('button',{name:/Review pickup/}));await screen.findByText(value.address);
  fireEvent.change(screen.getByLabelText('Decision'),{target:{value:'declined'}});fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_CONFLICT');mounted.unmount();
  render(<Queue source={source} canDecide={false}/>);fireEvent.click(await screen.findByRole('button',{name:/Review pickup/}));await screen.findByText(value.address);
  expect(screen.queryByRole('button',{name:'Save decision'})).not.toBeInTheDocument();
 });
});
