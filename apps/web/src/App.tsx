import React, { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router-dom';
import { ToastProvider } from './components/m3/Snackbar';
declare const __SHIPIT_DEMO__: boolean;

// Demo is a deliberate deployment choice. API errors never activate it.
const DemoApp = __SHIPIT_DEMO__ ? lazy(() => import('./DemoApp')) : null;
const OperatorApp = !__SHIPIT_DEMO__ ? lazy(() => import('./operator/OperatorApp')) : null;
export default function App() {
  if (DemoApp) return <Suspense fallback={<p role="status">Loading fictional demo…</p>}><DemoApp /></Suspense>;
  return <ToastProvider><HashRouter><Suspense fallback={<p role="status">Checking workspace access…</p>}>{OperatorApp && <OperatorApp />}</Suspense></HashRouter></ToastProvider>;
}
