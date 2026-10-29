import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {WorkspaceNavigation} from '../components/workspace/WorkspaceNavigation';

it('groups permitted destinations once, expands folders independently and reveals the active route',()=>{
 const onNavigate=vi.fn(),links=[
  {area:'workspace',to:'/business',icon:'space_dashboard',label:'Workspace'},
  {area:'booking',to:'/business/new-booking',icon:'add_box',label:'New Booking'},
  {area:'receipts',to:'/business/receipts',icon:'receipt_long',label:'Receipts'},
  {area:'cashbook',to:'/business/cashbook',icon:'payments',label:'Expenses and cashbook'},
 ];
 const view=render(<MemoryRouter><WorkspaceNavigation links={links} area="workspace" onNavigate={onNavigate}/></MemoryRouter>);
 const nav=screen.getByRole('navigation',{name:'Workspace navigation'});
 expect(within(nav).getAllByRole('button').map(button=>button.textContent)).toHaveLength(3);
 expect(within(nav).queryByRole('button',{name:'Shipments'})).not.toBeInTheDocument();
 const booking=within(nav).getByRole('button',{name:'Booking & pickups'});
 expect(booking).toHaveAttribute('aria-expanded','false');
 expect(within(nav).queryByRole('link',{name:'New Booking'})).not.toBeInTheDocument();
 fireEvent.click(booking);expect(booking).toHaveAttribute('aria-expanded','true');
 expect(document.getElementById(booking.getAttribute('aria-controls')!)).toBeVisible();
 fireEvent.click(within(nav).getByRole('link',{name:'Receipts'}));expect(onNavigate).toHaveBeenCalledOnce();
 fireEvent.click(booking);expect(within(nav).queryByRole('link',{name:'Receipts'})).not.toBeInTheDocument();
 view.rerender(<MemoryRouter><WorkspaceNavigation links={links} area="cashbook" onNavigate={onNavigate}/></MemoryRouter>);
 expect(within(nav).getByRole('button',{name:'Finance'})).toHaveAttribute('aria-expanded','true');
 expect(within(nav).getByRole('link',{name:'Expenses and cashbook'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getByRole('link',{name:'Workspace'})).not.toHaveAttribute('aria-current');
 expect(within(nav).getAllByRole('link')).toHaveLength(2);
});
