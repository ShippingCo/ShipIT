import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Msym } from '../../components/m3/Icon';
import {ConsoleFrame} from '../../components/workspace/ConsoleFrame';
import {consoleTasks} from '../../components/workspace/console-navigation';
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

export default function BusinessShell() {
  const location=useLocation();
  const [paletteOpen,setPaletteOpen]=useCommandPalette();
  const data=useDB();
  if(!data)return null;
  const path=location.pathname.replace('/business/new-booking','/business/booking').replace('/business/automation','/business/feed');
  const area=consoleTasks.find(task=>task.to==='/business'?path==='/business'||path==='/business/':path===task.to||path.startsWith(task.to+'/'))?.area??'workspace';
  const unseen=data.outbox.filter(message=>!message.bizSeen).length;
  const links=consoleTasks.map(task=>({...task,badge:task.area==='automation'&&unseen?unseen:task.area==='routes'&&data.routes.some(route=>route.status==='delayed')?'!':undefined}));
  return <ConsoleFrame links={links} area={area} businessName={data.business.name} subtitle={data.business.tagline} logo={data.business.logo??undefined} onSearch={()=>setPaletteOpen(true)} footer={<a href="#/customer" target="_blank" rel="noreferrer" className="btn btn-tonal btn-block"><Msym name="chat"/>Customer WhatsApp</a>}>
    <main id="workspace-content" tabIndex={-1}>
      <Routes>
        <Route index element={<Dashboard/>}/>
        <Route path="booking" element={<NewBookingPage/>}/>
        <Route path="new-booking" element={<NewBookingPage/>}/>
        <Route path="packages" element={<PackagesPage/>}/>
        <Route path="lots" element={<LotsPage/>}/>
        <Route path="routes" element={<RoutesPage/>}/>
        <Route path="feed" element={<AutomationFeedPage/>}/>
        <Route path="automation" element={<AutomationFeedPage/>}/>
        <Route path="receipts" element={<ReceiptsPage/>}/>
        <Route path="reports" element={<ReportsPage/>}/>
        <Route path="reports/:id" element={<ReportsPage/>}/>
        <Route path="eway" element={<EwayPage/>}/>
        <Route path="settings" element={<SettingsPage/>}/>
        <Route path="*" element={<Navigate to="/business" replace/>}/>
      </Routes>
    </main>
    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen}/>
  </ConsoleFrame>;
}
