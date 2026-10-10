export type CashbookAction='cashbook.read'|'cashbook.select'|'cashbook.request'|'cashbook.approve'|'cashbook.apply'|'cashbook.configure'|'cashbook.acknowledge';
export interface CashbookScope {access:import('../security/scope.ts').TenantAccess;ownOnly:boolean}
