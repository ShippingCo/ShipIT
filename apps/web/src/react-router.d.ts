import type { NavigateOptions, To } from 'react-router-dom';

// App.tsx uses declarative HashRouter, whose navigation returns void.
// Revisit when migrating to RouterProvider/data mode, which returns a Promise.
// https://reactrouter.com/api/hooks/useNavigate#return-type-augmentation
declare module 'react-router-dom' {
  interface NavigateFunction {
    (to: To, options?: NavigateOptions): void;
    (delta: number): void;
  }
}
