import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ReportWorkspace,reportWindow,reportMoney,reportCsv} from '../operations/ReportWorkspace';
import {createScopeController} from '../operator/scope';
import {reportWorkspace} from '../data-access/report-workspace';
import {scopedApi} from '../data-access/scoped-api';
import {id,org,A,json} from './counter-fixture';
const now=new Date().toISOString();
const amounts={pre_tax:'10000',taxable:'10000',non_taxable:'0',cgst:'0',sgst:'0',igst:'1800',gst:'1800',rounding:'0',gross:'11800',collections:'0',refunds:'0',outstanding:'11800',refundable_credit:'0'};
const sale={id:id(5),confirmed_at:now,rate:'9/50',amounts};
const performance={id:id(14),booking_id:id(5),customer_id:id(4),confirmed_at:now,version:1,destination:'Mumbai',service:'Standard',courier:null,status:'delivered',failed_attempts:2,dispatched_at:null,delivered_at:now,original_eta_at:null,revised_eta_at:null,original_eta_version:null,revised_eta_version:null,route_id:null,manifest_id:null,route_departed_at:null,route_arrived_at:null,duration_seconds:null,outcome:'unknown'};
const parcel={id:id(14),booking_id:id(5),docket:'SYN-14',weight_grams:800,version:1,status:'delivered',custody:'delivered',confirmed_at:now,sender:{source_customer_id:id(4),source_customer_version:1,name:'Synthetic Sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Synthetic origin'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Synthetic address'},details:{city:'Mumbai'}};
function controller(){const c=createScopeController();c.runtime.bind({userId:id(6),organizationId:org,franchiseId:A,permissions:'franchise_admin'});return c;}
function transport(){const request=vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic'});if(options.method==='POST')return json({id:id(90)});if(path.includes('/parcels?'))return json({items:[parcel],page:{has_more:false,next_cursor:null}});const u=new URL(path,'http://localhost');return json({id:id(90),organization_id:org,franchise_id:A,as_of:now,filter:{from_day:u.searchParams.get('from_day'),to_day:u.searchParams.get('to_day'),sort:'confirmed_desc'},rows:path.includes('/finance')?[sale]:[performance],export_token:'synthetic-proof'});});vi.stubGlobal('fetch',request);return request;}
function app(path='/business/reports'){render(<MemoryRouter initialEntries={[path]}><ReportWorkspace controller={controller()} roles={['franchise_admin']}/></MemoryRouter>);}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('opens all five demo reports with exact assessed totals, aligned columns, payment colors and recorded delivery facts',async()=>{
 const request=transport();app();await screen.findAllByText('₹118');
 for(const [title,expected] of [['Sales register','SYN-14'],['GST summary','18%'],['Outstanding','+12025550100'],['Destinations','Mumbai'],['Delivery performance','Delivered']]){
  const card=screen.getByText(title).closest('button')!;fireEvent.click(card);const table=await screen.findByRole('table',{name:title});expect(within(table).getAllByText(expected!)[0]).toBeVisible();expect(screen.getByText('1 row')).toBeVisible();
  if(title==='Sales register'){expect(within(table).getByText('To pay')).toHaveClass('pill-warn');expect(within(table).getAllByText('₹118')).toHaveLength(2);}
  if(title==='Outstanding')expect(within(table).getByRole('link',{name:'Call'})).toHaveAttribute('href','tel:+12025550100');
  if(title==='Delivery performance'){expect(within(table).getByText('Delivered')).toHaveClass('st-delivered');expect(within(table).getByText('2')).toBeVisible();}
  fireEvent.click(screen.getByRole('button',{name:'All reports'}));await screen.findByText('Sales register');
 }
 fireEvent.click(screen.getByRole('button',{name:'Financial year'}));await waitFor(()=>expect(request.mock.calls.some(([p])=>p.includes('from_day='+reportWindow('fy').from))).toBe(true));expect(request.mock.calls.some(([p])=>p.includes('/bookings/entries'))).toBe(false);
});
it('exports only the filtered view after authorization and does not export all rows when filters match nothing',async()=>{
 transport();const created=vi.fn((_blob:Blob)=> 'blob:synthetic');vi.stubGlobal('URL',class extends URL{static override createObjectURL=created;static override revokeObjectURL=vi.fn();});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});app('/business/reports/sales');await screen.findByRole('table');fireEvent.click(screen.getByRole('button',{name:'Filters'}));fireEvent.change(screen.getByLabelText('Filter Docket'),{target:{value:'No such docket'}});await screen.findByText('Nothing matches these filters.');fireEvent.click(screen.getByRole('button',{name:'Export'}));await screen.findByText('Exported 0 rows from the current filtered view.');expect(created).toHaveBeenCalledTimes(1);
 const blob=created.mock.calls[0]![0] as unknown as Blob;const text=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsText(blob);});expect(text).toContain('Captured at');expect(text).not.toContain('Synthetic Sender');expect(text).not.toContain('SYN-14');
});
it('keeps exact paise, Kolkata fiscal boundaries and CSV formula escaping',()=>{
 expect(reportMoney('9007199254740991')).toBe('₹9,00,71,99,25,47,409.91');expect(reportMoney('-101')).toBe('-₹1.01');expect(reportWindow('fy',new Date('2026-03-31T18:30:00Z')).from).toBe('2026-04-01');expect(reportWindow('lastmonth',new Date('2026-01-02T00:00:00Z')).to).toBe('2025-12-31');expect(reportWindow('quarter',new Date('2026-02-02T00:00:00Z')).from).toBe('2026-01-01');expect(reportCsv(['Name'],[[' =SUM(A1)'],['"Synthetic"']])).toContain('"\' =SUM(A1)"');
});
it('rejects a report response for another requested period',async()=>{
 transport();const c=controller(),source=reportWorkspace(scopedApi(c));await expect(source.finance('2026-01-01','2026-01-02')).resolves.toBeDefined();vi.stubGlobal('fetch',vi.fn(async()=>json({id:id(90),organization_id:org,franchise_id:A,as_of:now,filter:{from_day:'2025-01-01',to_day:'2025-01-02',sort:'confirmed_desc'},rows:[sale],export_token:'synthetic-proof'})));await expect(source.finance('2026-01-01','2026-01-02')).rejects.toThrow();
});
