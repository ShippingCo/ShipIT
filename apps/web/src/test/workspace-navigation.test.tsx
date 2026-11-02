import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {WorkspaceNavigation} from '../components/workspace/WorkspaceNavigation';

it('shows shallow permitted task areas and reveals tools for the current area',()=>{
 const onNavigate=vi.fn(),links=[
  {area:'workspace',to:'/business',icon:'space_dashboard',label:'Workspace'},
  {area:'booking',to:'/business/new-booking',icon:'add_box',label:'New Booking'},
  {area:'receipts',to:'/business/receipts',icon:'receipt_long',label:'Receipts'},
  {area:'cashbook',to:'/business/cashbook',icon:'payments',label:'Expenses and cashbook'},
 ];
 const view=render(<MemoryRouter><WorkspaceNavigation links={links} area="workspace" onNavigate={onNavigate}/></MemoryRouter>);
 const nav=screen.getByRole('navigation',{name:'Workspace navigation'});
 expect(within(nav).getByRole('link',{name:'Overview'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getByRole('link',{name:'Bookings'})).toHaveAttribute('href','/business/new-booking');
 expect(within(nav).queryByRole('link',{name:'Delivery'})).not.toBeInTheDocument();
 expect(within(nav).queryByRole('link',{name:'Receipts'})).not.toBeInTheDocument();
 view.rerender(<MemoryRouter><WorkspaceNavigation links={links} area="booking" onNavigate={onNavigate}/></MemoryRouter>);
 expect(within(nav).getByRole('group',{name:'Bookings tools'})).toBeVisible();
 fireEvent.click(within(nav).getByRole('link',{name:'Receipts'}));expect(onNavigate).toHaveBeenCalledOnce();
 view.rerender(<MemoryRouter><WorkspaceNavigation links={links} area="cashbook" onNavigate={onNavigate}/></MemoryRouter>);
 expect(within(nav).getByRole('group',{name:'Money tools'})).toBeVisible();
 expect(within(nav).getByRole('link',{name:'Expenses and cashbook'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getByRole('link',{name:'Overview'})).not.toHaveAttribute('aria-current');
 expect(within(nav).queryByRole('link',{name:'Receipts'})).not.toBeInTheDocument();
});
