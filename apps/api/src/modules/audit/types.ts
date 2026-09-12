export const resourceTypes = ['organization','franchise','membership','invitation','identity','audit','request','customer','pricing','tax'] as const;
export type ResourceType = typeof resourceTypes[number];
export const denialActions = ['tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate','pricing.read','pricing.draft','pricing.publish','pricing.quote','audit.read','membership.manage','invitation.create','invitation.accept','invitation.revoke',
  'customer.read','customer.list','customer.create','customer.update','auth.start','auth.verify','auth.resend','auth.session','auth.manage','security.request'] as const;
export type DenialAction = typeof denialActions[number];
export const denialReasons = ['ACTION_FORBIDDEN','UNAUTHENTICATED','RESOURCE_NOT_FOUND','RATE_LIMITED'] as const;
export type DenialReason = typeof denialReasons[number];
export interface AuditRow {
  id:string;organization_id:string;franchise_ids:string[];actor_type:string;actor_id:string;action:string;
  resource_type:ResourceType;resource_id:string|null;result:string;reason_code:string;correlation_id:string;
  occurred_at:string;previous_lifecycle:string|null;new_lifecycle:string|null;committed_version:number|null;role:string|null;
}
export interface AuditFilter {
  organizationId:string;franchiseId:string|null;resourceType:ResourceType|null;resourceId:string|null;
  from:string|null;to:string|null;limit:number;cursor:string|null;
}
export interface AuditBoundary { time:string;id:string }
