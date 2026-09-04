import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { subscribe, getSnapshot } from '../data/store';
import type { Database } from '../data/types';

const Ctx = createContext<Database | null>(null);

export function AppProvider({ children }: { children?: React.ReactNode }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  return <Ctx.Provider value={snap}>{children}</Ctx.Provider>;
}

/**
 * The current store snapshot. Re-renders the caller whenever the store changes.
 *
 * Throws outside an AppProvider rather than returning null. Every screen in this app
 * reads the database on its first line, so a null here would mean adding a guard to
 * each one for a case that only happens if the tree is assembled wrongly — a bug to
 * fix at the root, not to handle at 40 call sites.
 */
export function useDB(): Database {
  const snap = useContext(Ctx);
  if (!snap) throw new Error('useDB must be used inside <AppProvider>');
  return snap;
}
