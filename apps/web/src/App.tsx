import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/m3/Snackbar';
declare const __SHIPIT_DEMO__: boolean;

// Demo is a deliberate deployment choice. API errors never activate it.
const DemoApp = __SHIPIT_DEMO__ ? lazy(() => import('./DemoApp')) : null;
const OperatorApp = !__SHIPIT_DEMO__ ? lazy(() => import('./operator/OperatorApp')) : null;
function OperatorRouter() {
  const [router, setRouter] = useState<ReturnType<typeof createHashRouter> | null>(null);
  useEffect(() => {
    // Data routing owns POP restoration, including entries preceding this mount.
    // Create/dispose together so StrictMode and remounts cannot leak listeners.
    const next = createHashRouter([{path:'*',element:<Suspense fallback={<p role="status">Checking workspace access…</p>}>{OperatorApp && <OperatorApp />}</Suspense>}]);
    setRouter(next);
    return () => next.dispose();
  }, []);
  return router ? <RouterProvider router={router}/> : <p role="status">Checking workspace access…</p>;
}
export default function App() {
  if (DemoApp) return <Suspense fallback={<p role="status">Loading fictional demo…</p>}><DemoApp /></Suspense>;
  return <ToastProvider><OperatorRouter/></ToastProvider>;
}
