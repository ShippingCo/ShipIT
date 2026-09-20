import type { ScopeTicket } from '../data-access/scope-runtime';
import type { CommandIntent } from '../data-access/command-intent';
// Only opaque recovery references, never contacts, command bodies, files or credentials.
export function recoveryKey(scope: ScopeTicket) {
  const a = scope.authority;
  return `shipit_counter_recovery_v1:${a?.userId}:${a?.organizationId}:${a?.franchiseId}`;
}
export function recoveryMarker(scope: ScopeTicket): boolean {
  try { return sessionStorage.getItem(recoveryKey(scope)) !== null; } catch { return false; }
}
export function retainRecovery(intent: CommandIntent, bookingId?: string) {
  // Fail before dispatch if reload protection cannot be retained.
  sessionStorage.setItem(recoveryKey(intent.scope), JSON.stringify({ operation: intent.operation, key: intent.key, ...(bookingId ? { booking_id: bookingId } : {}) }));
}
export function clearRecovery(scope: ScopeTicket) { try { sessionStorage.removeItem(recoveryKey(scope)); } catch { /* An uncleared marker safely requires reconciliation. */ } }
