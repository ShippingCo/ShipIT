export type CashbookAction='cashbook.handover.request'|'cashbook.handover.acknowledge'|'cashbook.handover.select'|'cashbook.read'|'cashbook.select'|'cashbook.request'|'cashbook.approve'|'cashbook.apply'|'cashbook.configure'|'cashbook.acknowledge';
export interface CashbookScope {access:import('../security/scope.ts').TenantAccess;ownOnly:boolean;agentOnly?:boolean}

export type CashCloseAction='cashbook.close.read'|'cashbook.close.open'|'cashbook.close.count'|'cashbook.close.submit'|'cashbook.close.decide'|'cashbook.close.revise_opening'|'cashbook.close.review_opening'|'cashbook.close.reopen';
