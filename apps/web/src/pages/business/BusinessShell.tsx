import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import { Fab } from '../../components/m3/Button';
import Dashboard from './Dashboard';
import NewBookingPage from './NewBookingPage';
import PackagesPage from './PackagesPage';
import LotsPage from './LotsPage';
import RoutesPage from './RoutesPage';
import { ReceiptsPage, AutomationFeedPage, SettingsPage } from './MiscPages';
import ReportsPage from './ReportsPage';
import EwayPage from './EwayPage';
import { useDB } from '../../context/AppContext';
import CommandPalette, { useCommandPalette } from '../../components/CommandPalette';

const NAV = [
  { path: '/business', end: true, icon: 'space_dashboard', label: 'Dashboard' },
  { path: '/business/booking', icon: 'add_circle', label: 'New Booking' },
  { path: '/business/packages', icon: 'inventory_2', label: 'Packages' },
  { path: '/business/lots', icon: 'layers', label: 'Lots' },
  { path: '/business/routes', icon: 'alt_route', label: 'Dispatch Routes' },
  { path: '/business/feed', icon: 'forward_to_inbox', label: 'Automation Feed' },
  { path: '/business/receipts', icon: 'receipt_long', label: 'Receipts' },
  { path: '/business/reports', icon: 'query_stats', label: 'Reports' },
  { path: '/business/eway', icon: 'local_shipping', label: 'E-way Bills' },
  { path: '/business/settings', icon: 'settings', label: 'Settings' },
];

const TITLES = {
  '/business': 'Dashboard',
  '/business/booking': 'New Booking',
  '/business/packages': 'Packages',
  '/business/lots': 'Lots',
  '/business/routes': 'Dispatch Routes',
  '/business/feed': 'Automation Feed',
  '/business/receipts': 'Receipts',
  '/business/reports': 'Reports',
  '/business/eway': 'E-way Bills',
  '/business/settings': 'Settings',
};

export default function BusinessShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useCommandPalette();
  const [scrolled, setScrolled] = useState(false);
  const data = useDB();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (!data) return null;
  const isHome = location.pathname === '/business' || location.pathname === '/business/';
  const unseen = data.outbox.filter((m) => !m.bizSeen).length;
  const hasDelay = data.routes.some((r) => r.status === 'delayed');
  const biz = data.business;

  return (
    <div className="shell">
      <aside className={`drawer-pane${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-head">
          <div className="avatar lg">{biz.logo ? <img src={biz.logo} alt="" /> : biz.name.charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="t-title-md u-truncate">{biz.name}</div>
            <div className="t-body-sm muted u-truncate">{biz.tagline}</div>
          </div>
        </div>
        <nav className="drawer-section" style={{ overflowY: 'auto', flex: 1 }}>
          {NAV.map((n) => (
            <NavLink key={n.path} to={n.path} end={n.end} className={({ isActive }) => `drawer-item${isActive ? ' active' : ''}`}>
              <Msym name={n.icon} />
              <span>{n.label}</span>
              {n.path === '/business/feed' && unseen > 0 && <span className="count">{unseen}</span>}
              {n.path === '/business/routes' && hasDelay && (
                <span className="count" style={{ background: 'var(--md-error)' }}>!</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="drawer-foot">
          <a href="#/customer" target="_blank" rel="noreferrer" className="btn btn-tonal btn-block" style={{ textDecoration: 'none' }}>
            <Msym name="chat" /> Customer WhatsApp
          </a>
        </div>
      </aside>

      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'var(--md-scrim)', zIndex: 25 }}
        />
      )}

      <div className="main-area">
        <header className={`appbar${scrolled ? ' scrolled' : ''}`}>
          <button className="iconbtn burger" onClick={() => setDrawerOpen(true)} aria-label="Menu">
            <Msym name="menu" />
          </button>
          {!isHome && (
            <button className="iconbtn" onClick={() => navigate('/business')} aria-label="Back to dashboard" title="Back to dashboard">
              <Msym name="arrow_back" />
            </button>
          )}
          <div className="appbar-title u-grow t-title-lg">{TITLES[location.pathname] || 'ShippingCo'}</div>
          {/* One field for every docket, customer, route and lot. */}
          <button className="appbar-search" onClick={() => setPaletteOpen(true)} aria-label="Search everything">
            <Msym name="search" />
            <span className="lbl">Search anything…</span>
            <kbd className="searchbar-kbd">Ctrl K</kbd>
          </button>
          {/* The primary action lives on the dashboard only — every other page has its
              own job, and the drawer keeps New Booking one click away from anywhere. */}
          {isHome && (
            <button className="btn btn-filled appbar-cta" onClick={() => navigate('/business/booking')}>
              <Msym name="add" /> New Booking
            </button>
          )}
        </header>

        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="booking" element={<NewBookingPage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="lots" element={<LotsPage />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="feed" element={<AutomationFeedPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportsPage />} />
          <Route path="eway" element={<EwayPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/business" replace />} />
        </Routes>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        <Fab icon="add" className="fab-mobile-only" style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 40 }} onClick={() => navigate('/business/booking')}>
          New Booking
        </Fab>
      </div>
    </div>
  );
}
