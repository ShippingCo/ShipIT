import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import CustodyActions from '../operations/CustodyActions';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const target=id(1),oldAgent=id(2),receipt=id(3),instruction=id(4),grant=id(5);
const first={parcel_id:id(6),docket:'SYN-OFFICE',parcel_version:7,status:'out_for_delivery',assigned_agent_id:target,attempt_id:id(10),receipt_id:null,physical_custody:'unknown' as const,proof_id:null};
const second={...first,parcel_id:id(7),docket:'SYN-HELD',parcel_version:9,assigned_agent_id:oldAgent,receipt_id:receipt,physical_custody:'agent' as const};
afterEach(cleanup);
describe('custody actions from current source evidence',()=>{
 it('requires reassignment instruction and source-specific grant for mixed custody cohort',()=>{
  const submit=vi.fn();render(<CustodyActions roles={['franchise_admin']} parcels={[first,second]} agents={[{id:target}]} locked={false} submit={submit}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Receiving agent'}),{target:{value:target}});
  fireEvent.click(screen.getByRole('checkbox',{name:/SYN-OFFICE/}));fireEvent.click(screen.getByRole('checkbox',{name:/SYN-HELD/}));
  fireEvent.submit(screen.getByRole('form',{name:'Custody action'}));expect(submit).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Dispatcher instruction for SYN-HELD'),{target:{value:instruction}});fireEvent.change(screen.getByLabelText('Transfer approval for SYN-HELD'),{target:{value:grant}});
  fireEvent.submit(screen.getByRole('form',{name:'Custody action'}));expect(submit).toHaveBeenCalledExactlyOnceWith({kind:'prepare',body:{agent_id:target,items:[{parcel_id:first.parcel_id,expected_parcel_version:7,previous_receipt_id:null,instruction_id:null,grant_id:null},{parcel_id:second.parcel_id,expected_parcel_version:9,previous_receipt_id:receipt,instruction_id:instruction,grant_id:grant}]}});
 });
 it('records missing separately from actual office receipt using exact source version',()=>{
  const submit=vi.fn();render(<CustodyActions roles={['franchise_admin']} parcels={[second]} agents={[]} locked={false} submit={submit}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Custody action kind'}),{target:{value:'return'}});fireEvent.change(screen.getByRole('combobox',{name:'Custody parcel'}),{target:{value:second.parcel_id}});
  fireEvent.change(screen.getByRole('combobox',{name:'Office receipt condition'}),{target:{value:'missing'}});expect(screen.getByText(/leaves custody with the agent/)).toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form',{name:'Custody action'}));expect(submit).toHaveBeenCalledExactlyOnceWith({kind:'return',body:{parcel_id:second.parcel_id,expected_parcel_version:9,source_receipt_id:receipt,discrepancy:'missing'}});
 });
 it('prevents replacement submission while locked and keeps giver actions separate from administration',()=>{
  const submit=vi.fn();const ui=render(<CustodyActions roles={['delivery_agent']} parcels={[second]} agents={[]} locked={false} submit={submit}/>);
  expect(screen.queryByRole('option',{name:'Receive office return'})).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:'Authorize reassignment'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox',{name:'Custody parcel'}),{target:{value:second.parcel_id}});fireEvent.change(screen.getByLabelText('Transfer approval reference'),{target:{value:grant}});fireEvent.change(screen.getByLabelText('Receiving manifest reference (leave empty for office)'),{target:{value:id(11)}});
  ui.rerender(<CustodyActions roles={['delivery_agent']} parcels={[second]} agents={[]} locked={true} submit={submit}/>);fireEvent.submit(screen.getByRole('form',{name:'Custody action'}));expect(submit).not.toHaveBeenCalled();
  ui.rerender(<CustodyActions roles={['delivery_agent']} parcels={[second]} agents={[]} locked={false} submit={submit}/>);fireEvent.submit(screen.getByRole('form',{name:'Custody action'}));expect(submit).toHaveBeenCalledExactlyOnceWith({kind:'release',body:{parcel_id:second.parcel_id,source_receipt_id:receipt,grant_id:grant,manifest_id:id(11)}});
 });
});
