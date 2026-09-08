export type TenancyErrorCode = 'UNAUTHENTICATED' | 'ACTION_FORBIDDEN' | 'RESOURCE_NOT_FOUND' |
  'VALIDATION_FAILED' | 'VERSION_CONFLICT' | 'FRANCHISE_CODE_CONFLICT' |
  'FRANCHISE_DISABLED' | 'ORGANIZATION_DISABLED' | 'TEMPORARILY_UNAVAILABLE';
export class TenancyError extends Error {
  readonly code: TenancyErrorCode;
  constructor(code: TenancyErrorCode) { super(code); this.name = 'TenancyError'; this.code = code; }
}
