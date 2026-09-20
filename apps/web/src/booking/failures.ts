import { ApiFailure, recoveryFor } from '../data-access/errors';
export function uncertain(error: unknown) {
  return error instanceof ApiFailure && ['uncertain', 'pending'].includes(recoveryFor(error, true));
}
export function failureMessage(error: unknown): string {
  if (!(error instanceof ApiFailure)) return 'The request could not be sent. Your entered values are retained. Retry explicitly.';
  if (uncertain(error)) return 'Outcome uncertain: the server may have saved this request. Retry the same request to reconcile; do not enter it again.';
  const messages: Record<string, string> = {
    QUOTE_STALE: 'Pricing expired or changed. Get a fresh price and tax calculation, review the totals, then confirm again.',
    TAX_STALE: 'Tax evidence expired or changed. Get a fresh price and tax calculation, review the totals, then confirm again.',
    VERSION_CONFLICT: 'The customer changed. Refresh the customer, review the latest record alongside your entered values, then confirm your choice.',
    DOCKET_CONFLICT: 'That docket cannot be allocated. Enter another docket or leave it blank for server allocation.',
    NO_RATE: 'No configured rate matches this destination, service and weight. Ask your franchise administrator to review the rate card.',
    TAX_POLICY_UNAVAILABLE: 'No approved tax policy matches these facts. Ask your franchise administrator to review the policy.',
    TAX_CONFLICT: 'Tax facts need authorized resolution. Check the service recipient and evidence with your franchise administrator.',
    TAX_TIME_UNSUPPORTED: 'This tax timing is unsupported. Ask your franchise administrator to review the evidence.',
    IDEMPOTENCY_CONFLICT: 'This request identity conflicts with saved evidence. Authorized reconciliation is required; do not resubmit with a new key.',
    PAYMENT_REFERENCE_CONFLICT: 'Payment evidence conflicts. Reconcile the collection with an authorized franchise administrator.',
    PAYMENT_OVER_COLLECTION: 'The outstanding balance changed. Refresh payment status and reconcile the collection before recording more money.',
    ACTION_FORBIDDEN: 'This action is not permitted with your current access. Ask an authorized franchise administrator.',
    RESOURCE_NOT_FOUND: 'This record is unavailable in your current workspace.',
    UNAUTHENTICATED: 'Your session ended. Sign in again to access private records.',
    SCOPE_CHANGED: 'Workspace changed. Previous requests cannot be replayed here.',
    VALIDATION_FAILED: 'The server rejected an input. Review the highlighted fields; your draft is retained.',
    RATE_LIMITED: 'Too many requests. Wait before retrying the same request.',
    FRANCHISE_DISABLED: 'This franchise is unavailable for new bookings.',
    ORGANIZATION_DISABLED: 'This organization is unavailable for new bookings.',
  };
  return messages[error.code] ?? (error.kind === 'protocol' ? 'The service returned an invalid response. Retry to verify the server result.' : 'Service temporarily unavailable. Your draft is retained; retry explicitly.');
}
