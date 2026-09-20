import React from 'react';
import type { ScopeController } from '../../operator/scope';
import NewBooking from '../../booking/NewBooking';
import Receipts from '../../booking/Receipts';
import { useLocation, Link } from 'react-router-dom';
import type { OperatorContext } from '@shippingco/shared';
import { Msym } from '../../components/m3/Icon';
import { SelectField } from '../../components/m3/Input';

export default function BusinessShell({ context, select, controller }: { controller: ScopeController; context: OperatorContext; select: (id: string) => void }) {
  const location = useLocation();
  const current = context.franchises.find(franchise => franchise.id === context.active_franchise_id);
  if (!current) return null;
  const settings = location.pathname.endsWith('/settings');
  const booking = location.pathname.endsWith('/new-booking'), receipts = location.pathname.endsWith('/receipts');
  return <div className="shell operator-shell">
    <aside className="drawer-pane">
      <div className="drawer-head"><div className="avatar lg"><Msym name="storefront" /></div>
        <div className="t-title-md">{current.organization.display_name}</div></div>
      <nav className="drawer-section" aria-label="Workspace navigation">
        <Link className={`drawer-item${settings || booking || receipts ? '' : ' active'}`} to="/business"><Msym name="space_dashboard" />Workspace</Link>
        <Link className={`drawer-item${booking ? ' active' : ''}`} to="/business/new-booking"><Msym name="add_box" />New Booking</Link>
        <Link className={`drawer-item${receipts ? ' active' : ''}`} to="/business/receipts"><Msym name="receipt_long" />Receipts</Link>
        <Link className={`drawer-item${settings ? ' active' : ''}`} to="/business/settings"><Msym name="settings" />Settings</Link>
      </nav>
    </aside>
    <div className="main-area">
      <header className="appbar"><div className="appbar-title t-title-lg">{settings ? 'Settings' : booking ? 'New Booking' : receipts ? 'Receipts' : 'Workspace'}</div></header>
      <main className="operator-workspace" key={current.id}>
        <SelectField label="Franchise" aria-label="Franchise" value={current.id} onChange={select} options={context.franchises.map(franchise => ({
          value: franchise.id, label: `${franchise.organization.display_name} · ${franchise.display_name}`,
        }))} />
        <nav className="operator-mobile-nav" aria-label="Mobile workspace navigation"><Link to="/business">Workspace</Link><Link to="/business/new-booking">New Booking</Link><Link to="/business/receipts">Receipts</Link><Link to="/business/settings">Settings</Link></nav>
        {booking ? <NewBooking controller={controller} /> : receipts ? <Receipts controller={controller} /> : <section className="card operator-card" aria-labelledby="workspace-title">
          <h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>{current.display_name}</h1>
          <p role="status">Workspace access confirmed.</p>
          <p>{current.roles.map(role => role.replaceAll('_', ' ')).join(', ')}</p>
          {settings ? <p className="muted">Your business, location and access come from the server. Ask an administrator for membership changes.</p> : <p className="muted">Your workspace is ready. Use New Booking for customer lookup and counter bookings, or Receipts for issued documents.</p>}
        </section>}
      </main>
    </div>
  </div>;
}
