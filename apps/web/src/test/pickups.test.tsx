import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,within } from '@testing-library/react';
import { Queue,windowWords,suggestedWindows } from '../operations/Pickups';
import { kolkataInputToInstant } from '../operations/format';
import type { PickupSource,PickupDetail } from '../data-access/pickups';
import type { CommandIntent } from '../data-access/command-intent';
import { ApiFailure } from '../data-access/errors';
const id='00000000-0000-4000-8000-000000000049';
const soon={start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString()};
const value:PickupDetail={id,state:'submitted',version:1,review_reason:null,requested_window:soon,agreed_window:null,
 address:'12 Synthetic Street, Fictional City',contact:'+12025550149',assigned_staff_id:null,shipment:{origin_key:'ORIGIN',destination_key:'DEST',weight_grams:2000,dimensions_mm:[100,200,300],service:'standard'},notification:null};
function fixture(detail:PickupDetail=value) {
 const source:PickupSource={list:vi.fn(async()=>({items:[detail],page:{has_more:false,next_cursor:null}})),detail:vi.fn(async()=>detail),decide:vi.fn(()=>({id:'intent49'} as unknown as CommandIntent)),execute:vi.fn(async()=>detail)};
 return source;
}
const openRequest=async()=>fireEvent.click(await screen.findByRole('button',{name:/^Open the /}));

describe('pickup queue',()=>{
 it('loads private details only after selection; keyboard-accessible dialog restores focus',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  const button=await screen.findByRole('button',{name:/^Open the /});expect(source.detail).not.toHaveBeenCalled();
  expect(screen.queryByText(value.address)).not.toBeInTheDocument();button.focus();fireEvent.click(button);
  expect(await screen.findByText(value.address)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(button).toHaveFocus());
 });

 it('shows the three states with counts, and an empty queue keeps them',async()=>{
  const source=fixture();vi.mocked(source.list).mockResolvedValue({items:[],page:{has_more:false,next_cursor:null}});
  render(<Queue source={source} canDecide={true}/>);
  expect(await screen.findByText('✓ Nothing waiting')).toBeVisible();
  for(const label of ['Waiting','Agreed','Turned down'])
   expect(screen.getByRole('button',{name:new RegExp('0 '+label)})).toBeVisible();
 });

 it('agrees the customer’s own time in one press, repeating it in the button',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);
  await openRequest();
  await screen.findByText(value.address);
  const yes=screen.getByRole('button',{name:'Yes — collect '+windowWords(soon)});
  vi.mocked(source.detail).mockResolvedValue({...value,state:'accepted',version:2,agreed_window:soon});
  fireEvent.click(yes);
  expect(source.decide).toHaveBeenCalledWith(id,{expected_version:1,decision:'accepted',
   agreed_start:soon.start,agreed_end:soon.end,capacity_checked:true,manual_reviewed:true});
  expect(await screen.findByText(/The customer has been told/)).toBeVisible();
 });

 it('offers three future windows instead, and agrees the one chosen',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);
  await openRequest();await screen.findByText(value.address);
  fireEvent.click(screen.getByRole('button',{name:'A different time'}));
  const choices=suggestedWindows();
  expect(choices).toHaveLength(3);
  for(const choice of choices)expect(Date.parse(choice.start)).toBeGreaterThan(Date.now());
  fireEvent.click(screen.getByRole('button',{name:new RegExp(choices[0]!.label)}));
  expect(source.decide).toHaveBeenCalledWith(id,expect.objectContaining({decision:'accepted',agreed_start:choices[0]!.start}));
 });

 it('accepts a typed window in India time and refuses one already past',async()=>{
  const source=fixture();render(<Queue source={source} canDecide={true}/>);
  await openRequest();await screen.findByText(value.address);
  fireEvent.click(screen.getByRole('button',{name:'A different time'}));
  fireEvent.click(screen.getByText('Another time altogether'));
  fireEvent.change(screen.getByLabelText('From (India time)'),{target:{value:'2020-01-01T10:00'}});
  fireEvent.change(screen.getByLabelText('Until (India time)'),{target:{value:'2020-01-01T12:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Agree this time'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a start later than now');
  expect(source.decide).not.toHaveBeenCalled();
  const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  fireEvent.change(screen.getByLabelText('From (India time)'),{target:{value:day+'T10:00'}});
  fireEvent.change(screen.getByLabelText('Until (India time)'),{target:{value:day+'T12:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Agree this time'}));
  expect(source.decide).toHaveBeenCalledWith(id,expect.objectContaining({
   agreed_start:kolkataInputToInstant(day+'T10:00'),agreed_end:kolkataInputToInstant(day+'T12:00')}));
 });

 it('names a request worth a look and will not answer it until that is said',async()=>{
  const source=fixture({...value,review_reason:'heavy_shipment'});
  render(<Queue source={source} canDecide={true}/>);
  await openRequest();await screen.findByText(value.address);
  expect(screen.getByText('Worth a look first: heavy shipment.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'No — we cannot collect'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Say you have looked at this one first.');
  expect(source.decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('I have looked at this one.'));
  fireEvent.click(screen.getByRole('button',{name:'No — we cannot collect'}));
  expect(source.decide).toHaveBeenCalledWith(id,{expected_version:1,decision:'declined'});
 });

 it('says what the customer was told when the decision fails',async()=>{
  const source=fixture();
  vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));
  render(<Queue source={source} canDecide={true}/>);
  await openRequest();
  const dialog=screen.getByRole('dialog');await within(dialog).findByText(value.address);
  fireEvent.click(screen.getByRole('button',{name:'No — we cannot collect'}));
  expect(await screen.findByText('We do not know whether this was saved, and we do not know whether the customer was told anything.')).toBeVisible();
  // The uncertain decision holds the dialog open and retries the exact same intent.
  expect(screen.getByRole('button',{name:'Close'})).toBeDisabled();
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeVisible();
  const final={...value,state:'declined' as const,version:2,notification:{id,state:'failed',reason_code:'provider_unavailable',version:2,attempts:1,created_at:soon.start}};
  vi.mocked(source.detail).mockResolvedValue(final);vi.mocked(source.execute).mockResolvedValue(final);
  fireEvent.click(screen.getByRole('button',{name:'Check if it saved'}));
  expect(await screen.findByText(/the customer may not have been told/)).toBeVisible();
  expect(vi.mocked(source.execute).mock.calls[0]![0]).toBe(vi.mocked(source.execute).mock.calls[1]![0]);
 });

 it('says the module is not set up rather than blaming the connection',async()=>{
  const source=fixture();vi.mocked(source.list).mockRejectedValue(new ApiFailure('RESOURCE_NOT_FOUND',{status:404}));
  render(<Queue source={source} canDecide={true}/>);
  expect(await screen.findByText('Pickups over WhatsApp are not set up')).toBeVisible();
  expect(screen.queryByRole('button',{name:/Waiting/})).not.toBeInTheDocument();
 });

 it('shows a stale-version failure and read-only staff cannot act',async()=>{
  const source=fixture();vi.mocked(source.execute).mockRejectedValue(new ApiFailure('VERSION_CONFLICT'));
  const mounted=render(<Queue source={source} canDecide={true}/>);
  await openRequest();await screen.findByText(value.address);
  fireEvent.click(screen.getByRole('button',{name:'No — we cannot collect'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_CONFLICT');mounted.unmount();
  render(<Queue source={source} canDecide={false}/>);
  await openRequest();await screen.findByText(value.address);
  expect(screen.queryByRole('button',{name:'No — we cannot collect'})).not.toBeInTheDocument();
  expect(screen.getByText('You cannot answer requests in this shop.')).toBeVisible();
 });

 it('reads a window back the way someone would say it',()=>{
  expect(windowWords({start:soon.start,end:soon.end})).toMatch(/to .* tomorrow$/);
  const now=Date.parse('2026-11-13T04:00:00.000Z');
  expect(windowWords({start:'2026-11-13T11:30:00.000Z',end:'2026-11-13T13:30:00.000Z'},now)).toBe('5:00 pm to 7:00 pm today');
 });
});
