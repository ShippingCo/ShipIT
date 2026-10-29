import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import DataTable from '../components/m3/DataTable';
import {SelectField,TextField} from '../components/m3/Input';
import {RecordTable} from '../components/workspace/Workspace';

afterEach(cleanup);

it('keeps native field names separate from options and connects helpers and validation messages',()=>{
 render(<><TextField label="Customer phone" value="invalid" onChange={()=>{}} error="Include the country code."/>
  <SelectField label="Shipment state" value="active" onChange={()=>{}} options={[{value:'active',label:'Active'},{value:'closed',label:'Closed'}]} helper="Current franchise only."/></>);
 const phone=screen.getByRole('textbox',{name:'Customer phone'});
 expect(phone).toHaveAttribute('aria-invalid','true');expect(phone).toHaveAccessibleDescription('Include the country code.');
 expect(screen.getByRole('combobox',{name:'Shipment state'})).toHaveAccessibleDescription('Current franchise only.');
});

it('preserves supplied server record order and explicit action identity in a named accessible worklist',()=>{
 const open=vi.fn(),rows=[{id:'B',name:'Beta',amount:'₹0.00'},{id:'A',name:'Alpha',amount:'₹120.00'}];
 render(<RecordTable label="Captured receipt evidence" rows={rows} rowKey={row=>row.id} columns={[
  {key:'name',label:'Receipt',cell:row=>row.name},
  {key:'amount',label:'Received',align:'right',cell:row=>row.amount},
  {key:'actions',label:'Actions',cell:row=><button onClick={()=>open(row.id)}>Open {row.name}</button>},
 ]}/>);
 const table=screen.getByRole('table',{name:'Captured receipt evidence'}),records=within(table).getAllByRole('row').slice(1);
 expect(records.map(row=>within(row).getAllByRole('cell')[0].textContent)).toEqual(['Beta','Alpha']);
 expect(within(records[0]).getByText('₹0.00')).toBeVisible();
 expect(screen.getByRole('region',{name:'Captured receipt evidence table'})).toHaveAttribute('tabindex','0');
 fireEvent.click(within(records[0]).getByRole('button',{name:'Open Beta'}));expect(open).toHaveBeenCalledWith('B');
 expect(within(table).queryByRole('button',{name:/sort/i})).not.toBeInTheDocument();
});

it('sorts local ISO dates chronologically, exposes named filters and keeps zero totals and exported view exact',()=>{
 type Row={id:string;confirmed:string;amount:number};
 const view={current:[] as Row[]};
 render(<DataTable caption="Fictional local bookings" viewRef={view} rows={[
  {id:'Later',confirmed:'2026-02-01T10:00:00Z',amount:0},{id:'Earlier',confirmed:'2025-12-31T10:00:00Z',amount:0},
 ]} columns={[
  {key:'id',label:'Docket'},
  {key:'confirmed',label:'Confirmed',type:'date'},
  {key:'amount',label:'Amount',type:'money',total:true,fmt:value=>`₹${value.toFixed(2)}`},
 ]}/>);
 const table=screen.getByRole('table',{name:'Fictional local bookings'});
 expect(within(table).getByRole('row',{name:/Total/})).toHaveTextContent('₹0.00');
 fireEvent.click(within(table).getByRole('button',{name:'Confirmed'}));
 expect(within(table).getByRole('columnheader',{name:'Confirmed'})).toHaveAttribute('aria-sort','ascending');
 expect(view.current.map(row=>row.id)).toEqual(['Earlier','Later']);
 fireEvent.click(screen.getByRole('button',{name:'Filters'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Filter Docket'}),{target:{value:'Earlier'}});
 expect(view.current.map(row=>row.id)).toEqual(['Earlier']);
 fireEvent.change(screen.getByRole('textbox',{name:'Filter Docket'}),{target:{value:'unknown'}});
 expect(view.current).toEqual([]);expect(within(table).getByText('Nothing matches these filters.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(view.current.map(row=>row.id)).toEqual(['Earlier','Later']);
});
