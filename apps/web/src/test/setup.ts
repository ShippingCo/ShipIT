import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// App loads this module lazily. Compile it before flow assertions so cold Vite
// startup is not charged to Testing Library's one-second UI response deadline.
// App still owns the lazy render, loading state, authentication and API calls.
beforeAll(async () => { await import('../operator/OperatorApp'); });

/* jsdom implements neither ResizeObserver nor element layout, and several Radix
   primitives measure their trigger before positioning. Stub the observer and give
   elements a non-zero box so those components mount instead of throwing. */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});
