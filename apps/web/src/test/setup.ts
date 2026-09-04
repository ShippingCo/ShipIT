import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetDemo } from '../data/store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  resetDemo();
});

afterEach(() => {
  cleanup();
});
