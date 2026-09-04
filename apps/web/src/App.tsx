import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './components/m3/Snackbar';
import Launcher from './pages/Launcher';
import BusinessShell from './pages/business/BusinessShell';
import CustomerWhatsApp from './pages/CustomerWhatsApp';

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Launcher />} />
            <Route path="/business/*" element={<BusinessShell />} />
            <Route path="/customer" element={<CustomerWhatsApp />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AppProvider>
  );
}
