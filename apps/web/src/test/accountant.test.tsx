import React from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AccountantRegister} from '../operations/AccountantRegister';
import type {AccountantSource} from '../data-access/accountant';
import type {AccountantPage} from '@shippingco/shared';
import type {CommandIntent} from '../data-access/command-intent';
import {ApiFailure} from '../data-access/errors';
import {csvBundle} from '../data-access/csv-bundle';
const id='00000000-0000-4000-8000-000000000150';
const page:AccountantPage={snapshot:{id,schema_version:1,definition:'accountant_register_v1',mapping_version:'generic_csv_v1',timezone:'Asia/Kolkata',organization_id:id,franchise_id:id,filter:{from_day:'2026-10-01',to_day:'2026-10-31',sort:'confirmed_asc',franchise_ids:[id],include_references:false,format:'generic_csv_v1'},as_of:'2026-10-19T00:00:00.000001Z',expires_at:'2026-10-20T00:00:00.000001Z',count:0,controls:[],qualification:'generic_only',reconciliation_state:'disabled'},rows:[],next_offset:null};
function fixture():AccountantSource{return {franchise:id,intent:vi.fn(()=>({key:id} as CommandIntent)),execute:vi.fn(async()=>page),page:vi.fn(async()=>page),export:vi.fn(async()=>({snapshot:page.snapshot,files:[{name:'manifest.csv',csv:'"key","value"\r\n'}]}))};}
const view=(source:AccountantSource,canExport=true,initial='/')=><MemoryRouter initialEntries={[initial]}><AccountantRegister source={source} canExport={canExport} franchises={[{id,name:'Fictional shop'}]}/></MemoryRouter>;
afterEach(()=>vi.restoreAllMocks());
describe('accountant register workflow',()=>{
 it('captures with keyboard form, downloads matching artifact, and reloads saved filters',async()=>{
  const source=fixture(),r=render(view(source)),button=screen.getByRole('button',{name:'Capture register'});button.focus();expect(button).toHaveFocus();fireEvent.submit(button.closest('form')!);
  expect(await screen.findByText(/No matching source evidence/)).toBeVisible();expect(source.execute).toHaveBeenCalledTimes(1);
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:accountant')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  fireEvent.click(screen.getByRole('button',{name:'Download CSV bundle'}));await waitFor(()=>expect(source.export).toHaveBeenCalledWith(id));expect(await screen.findByText(/Private CSV bundle downloaded/)).toBeVisible();expect(click).toHaveBeenCalledTimes(1);
  vi.mocked(source.page).mockResolvedValue({...page,snapshot:{...page.snapshot,controls:Array.from({length:101},()=>({family:'receipts',basis:'period',column:'received_paise',source_paise:'0',export_paise:'0',difference_paise:'0'}))}});
  r.unmount();render(view(source,true,'/?accountant_snapshot='+id));await screen.findByText(/No matching source evidence/);expect(screen.getByLabelText('Register from day')).toHaveValue('2026-10-01');expect(screen.getByLabelText('Register through day')).toHaveValue('2026-10-31');fireEvent.click(screen.getByText(/Independent source controls/));expect(screen.getAllByRole('button',{name:'View sources'})).toHaveLength(100);fireEvent.click(screen.getByRole('button',{name:'Next controls'}));expect(screen.getAllByRole('button',{name:'View sources'})).toHaveLength(1);
 });
 it('retries the exact uncertain intent while preserving disabled inputs and read-only export',async()=>{
  const source=fixture();vi.mocked(source.execute).mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));render(view(source,false));fireEvent.click(screen.getByRole('button',{name:'Capture register'}));
  const retry=await screen.findByRole('button',{name:'Retry same register request'});expect(screen.getByLabelText('Register from day')).toBeDisabled();fireEvent.click(retry);await screen.findByText(/No matching source evidence/);const calls=vi.mocked(source.execute).mock.calls;expect(calls[0]![0]).toBe(calls[1]![0]);expect(screen.getByRole('button',{name:'Download CSV bundle'})).toBeDisabled();
 });
 it('opens exact saved source evidence with focus and clears private data after access loss',async()=>{
  const source=fixture(),row={id:'a'.repeat(64),family:'legacy_receipts',meaning:'economic_legacy_receipt',basis:'period' as const,fields:{source_id:'fictional-receipt',source_version:'2',received_paise:'-40',correction_of:'original'}};
  vi.mocked(source.execute).mockResolvedValue({...page,rows:[row],next_offset:100});vi.mocked(source.page).mockResolvedValue({...page,rows:[row]});render(view(source));fireEvent.click(screen.getByRole('button',{name:'Capture register'}));
  fireEvent.click(await screen.findByRole('button',{name:'Next evidence page'}));await waitFor(()=>expect(source.page).toHaveBeenLastCalledWith(id,100,undefined,undefined,undefined,undefined));await waitFor(()=>expect(screen.getByRole('button',{name:'First evidence page'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'First evidence page'}));await waitFor(()=>expect(source.page).toHaveBeenLastCalledWith(id,0,undefined,undefined,undefined,undefined));await waitFor(()=>expect(screen.getByRole('button',{name:'Inspect saved source evidence'})).toBeEnabled());const inspect=screen.getByRole('button',{name:'Inspect saved source evidence'});fireEvent.click(inspect);
  expect(await screen.findByRole('heading',{name:'Saved source and correction evidence'})).toHaveFocus();expect(source.page).toHaveBeenCalledWith(id,0,undefined,row.id,undefined,undefined);fireEvent.click(screen.getByRole('button',{name:'Close source evidence'}));expect(inspect).toHaveFocus();
  vi.mocked(source.export).mockRejectedValue(new ApiFailure('RESOURCE_NOT_FOUND'));fireEvent.click(screen.getByRole('button',{name:'Download CSV bundle'}));await screen.findByText(/Saved register unavailable or expired/);expect(screen.queryByText(/fictional-receipt/)).not.toBeInTheDocument();
 });
 it('ignores a late capture result after the register unmounts',async()=>{
  const source=fixture();let resolve!:(p:AccountantPage)=>void;vi.mocked(source.execute).mockImplementation(()=>new Promise(r=>{resolve=r;}));const r=render(view(source));fireEvent.click(screen.getByRole('button',{name:'Capture register'}));r.unmount();resolve(page);await Promise.resolve();expect(source.page).not.toHaveBeenCalled();
 });
 it('creates a readable USTAR archive with UTF-8 CSV content and valid checksum',async()=>{
  const content='"name"\r\n"Fictional ₹"\r\n',blob=csvBundle([{name:'source.csv',csv:content}]);
  const buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
  const bytes=new Uint8Array(buffer),decode=(start:number,end:number)=>new TextDecoder().decode(bytes.slice(start,end)).replace(/\0.*$/s,'');
  expect(decode(0,100)).toBe('source.csv');expect(decode(257,263)).toBe('ustar');const size=parseInt(decode(124,136),8);expect(new TextDecoder().decode(bytes.slice(512,512+size))).toBe(content);
  const saved=parseInt(decode(148,156),8),check=bytes.slice(0,512);check.fill(32,148,156);expect(check.reduce((n,b)=>n+b,0)).toBe(saved);expect(bytes.slice(-1024).every(b=>b===0)).toBe(true);
 });
 it('rejects traversal and oversized archives',()=>{
  expect(()=>csvBundle([{name:'../secret.csv',csv:''}])).toThrow();expect(()=>csvBundle([{name:'safe.csv',csv:'x'.repeat(8*1024*1024)}])).toThrow();expect(csvBundle([{name:'safe.csv',csv:'a,b\r\n'}]).size).toBe(2048);
 });
});
