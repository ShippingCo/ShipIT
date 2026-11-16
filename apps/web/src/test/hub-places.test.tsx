import React from 'react';
import {describe,expect,it} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {HubPlacePicker} from '../operations/HubPlacePicker';
import {forgetPlace,mintEventRef,readPlaces,rememberPlace,type HubPlace} from '../operations/hub-places';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The picker is controlled, so the chosen place has to come back in as a prop. */
function Host({seen}:{seen:(place:HubPlace|null)=>void}){
  const [place,setPlace]=React.useState<HubPlace|null>(null);
  return <HubPlacePicker value={place} onChange={next=>{setPlace(next);seen(next);}}/>;
}

describe('the hub register',()=>{
 it('gives one hub one reference, however the name is typed',()=>{
  // The whole value of the register. If "Pune hub" and "pune  Hub " minted two ids,
  // the custody history would stop grouping and the field would be worse than useless.
  const first=rememberPlace('Pune sorting hub')!;
  expect(first.id).toMatch(UUID);
  expect(rememberPlace('  pune  Sorting hub ')!.id).toBe(first.id);
  expect(readPlaces()).toHaveLength(1);
 });

 it('keeps the most recently used hub first, so the usual one is already chosen',()=>{
  rememberPlace('Pune sorting hub');rememberPlace('Mumbai hub');rememberPlace('Pune sorting hub');
  expect(readPlaces().map(place=>place.name)).toEqual(['Pune sorting hub','Mumbai hub']);
 });

 it('mints a fresh reference for every event, never a reused one',()=>{
  const refs=new Set(Array.from({length:50},()=>mintEventRef()));
  expect(refs.size).toBe(50);
  for(const ref of refs)expect(ref).toMatch(UUID);
 });

 it('reads as empty rather than throwing when storage is unavailable',()=>{
  // A private window, a cleared profile or a locked-down webview all land here, and the
  // operator is holding a parcel when it happens.
  localStorage.setItem('shippingco.hub-places.v1','{not json');
  expect(readPlaces()).toEqual([]);
 });

 it('names a hub once and chooses it, without asking for a reference',()=>{
  let chosen:HubPlace|null=null;
  render(<Host seen={place=>{chosen=place;}}/>);
  // Nothing saved yet, so the one field that gets the operator moving is already open.
  fireEvent.change(screen.getByLabelText('Name of the hub'),{target:{value:'Pune sorting hub'}});
  fireEvent.click(screen.getByRole('button',{name:'Save hub'}));
  expect(chosen).toMatchObject({name:'Pune sorting hub'});
  expect(chosen!.id).toMatch(UUID);
  const chip=screen.getByRole('radio',{name:'Pune sorting hub'});
  expect(chip).toHaveAttribute('aria-checked','true');
  expect(readPlaces()[0]!.id).toBe(chosen!.id);
 });

 it('forgets a hub on request and leaves the rest alone',()=>{
  const gone=rememberPlace('Mumbai hub')!,kept=rememberPlace('Pune sorting hub')!;
  forgetPlace(gone.id);
  expect(readPlaces().map(place=>place.id)).toEqual([kept.id]);
 });
});
