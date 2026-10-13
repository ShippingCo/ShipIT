import type { NavigateOptions, To } from 'react-router-dom';

// Navigation is fire-and-forget throughout the operator and demo surfaces.
// Data-router navigation may return a Promise; callers do not await it.
// https://reactrouter.com/api/hooks/useNavigate#return-type-augmentation
declare module 'react-router-dom' {
  interface NavigateFunction {
    (to: To, options?: NavigateOptions): void;
    (delta: number): void;
  }
}
