import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {WorkspaceNavigation} from '../components/workspace/WorkspaceNavigation';
import {ConsoleNavigation} from '../components/workspace/ConsoleFrame';
import {consoleAreas,consoleLinks,consoleTasks} from '../components/workspace/console-navigation';

it('keeps reference tasks directly accessible in the same order in both compositions',()=>{
 const demo=render(<MemoryRouter><ConsoleNavigation links={consoleTasks} area="workspace" onNavigate={()=>{}}/></MemoryRouter>);
 const reference=screen.getAllByRole('link').map(link=>link.textContent);
 demo.unmount();
 render(<MemoryRouter><WorkspaceNavigation links={[...consoleTasks].reverse()} area="workspace" onNavigate={()=>{}}/></MemoryRouter>);
 expect(screen.getAllByRole('link').map(link=>link.textContent)).toEqual(reference);
 expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:'New Booking'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Messages'})).toBeVisible();
});

it('does not add unauthorized links and leaves every authorized destination visible',()=>{
 const onNavigate=vi.fn(),links=[
  {area:'workspace',to:'/business',icon:'space_dashboard',label:'Workspace'},
  {area:'receipts',to:'/business/receipts',icon:'receipt_long',label:'Receipts'},
  {area:'cashbook',to:'/business/cashbook',icon:'payments',label:'Expenses and cashbook'},
 ];
 const view=render(<MemoryRouter><WorkspaceNavigation links={links} area="workspace" onNavigate={onNavigate}/></MemoryRouter>);
 const nav=screen.getByRole('navigation',{name:'Workspace navigation'});
 expect(within(nav).queryByRole('link',{name:'New Booking'})).not.toBeInTheDocument();
 expect(within(nav).getByRole('link',{name:'Receipts'})).toBeVisible();
 // No disclosure: a destination this role may reach is reachable without first finding a toggle.
 expect(within(nav).queryByText('More tools')).not.toBeInTheDocument();
 const cashbook=within(nav).getByRole('link',{name:'Cash and expenses'});
 expect(cashbook).toBeVisible();
 fireEvent.click(cashbook);expect(onNavigate).toHaveBeenCalledOnce();
 view.rerender(<MemoryRouter><WorkspaceNavigation links={links} area="cashbook" onNavigate={onNavigate}/></MemoryRouter>);
 expect(within(nav).getByRole('link',{name:'Cash and expenses'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getByRole('link',{name:'Dashboard'})).not.toHaveAttribute('aria-current');
});

it('gives every listed destination its own icon',()=>{
 render(<MemoryRouter><ConsoleNavigation links={consoleLinks(Object.keys(consoleAreas).map(area=>({area,to:'/business/'+area})))} area="workspace" onNavigate={()=>{}}/></MemoryRouter>);
 const icons=screen.getAllByRole('link').map(link=>link.querySelector('.msym')?.textContent);
 expect(icons.length).toBeGreaterThan(15);
 // An unbundled name silently renders as help_outline, which would also read as a collision.
 expect(icons).not.toContain('help_outline');
 expect(new Set(icons).size).toBe(icons.length);
});
