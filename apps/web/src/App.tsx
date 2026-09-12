import React, { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router-dom';
import { ToastProvider } from './components/m3/Snackbar';
import OperatorApp from './operator/OperatorApp';

// Demo is a deliberate deployment choice. API errors never activate it.
const DemoApp = import.meta.env.VITE_DATA_MODE === 'demo' ? lazy(() => import('./DemoApp')) : null;
export default function App() {
  if (DemoApp) return <Suspense fallback={<p role="status">Loading fictional demo…</p>}><DemoApp /></Suspense>;
  return <ToastProvider><HashRouter><OperatorApp /></HashRouter></ToastProvider>;
}
