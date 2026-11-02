import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {WorkspaceNavigation} from '../components/workspace/WorkspaceNavigation';
import {SearchField} from '../components/m3/Input';
import {ChoiceField} from '../components/workspace/ChoiceField';

it('exposes only permitted creation destinations as direct links',async()=>{
 render(<MemoryRouter><WorkspaceNavigation area="booking" links={[{area:'booking',to:'/business/new-booking',icon:'add',label:'New Booking'}]} onNavigate={()=>{}}/></MemoryRouter>);
 expect(screen.getByRole('link',{name:'New Booking'})).toHaveAttribute('href','/business/new-booking');
 expect(screen.queryByRole('link',{name:'Record received money'})).not.toBeInTheDocument();
});
it('clears a search draft without submitting the surrounding form',()=>{
 const change=vi.fn(),submit=vi.fn();render(<form onSubmit={submit}><SearchField label="Tracking number" value="ABC" onChange={change}/></form>);
 fireEvent.click(screen.getByRole('button',{name:'Clear Tracking number'}));expect(change).toHaveBeenCalledWith('');expect(submit).not.toHaveBeenCalled();
});
it('labels custom choices and exposes disabled state',()=>{
 render(<ChoiceField label="Search by" value="name" onChange={()=>{}} disabled options={[{value:'name',label:'Customer name'}]} helper="Choose a search method."/>);
 expect(screen.getByRole('combobox',{name:'Search by'})).toBeDisabled();expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Choose a search method.');
});
