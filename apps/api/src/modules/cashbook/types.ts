export type CashbookAction='cashbook.handover.request'|'cashbook.handover.acknowledge'|'cashbook.handover.select'|'cashbook.read'|'cashbook.select'|'cashbook.request'|'cashbook.approve'|'cashbook.apply'|'cashbook.configure'|'cashbook.acknowledge';
export interface CashbookScope {access:import('../security/scope.ts').TenantAccess;ownOnly:boolean;agentOnly?:boolean}
