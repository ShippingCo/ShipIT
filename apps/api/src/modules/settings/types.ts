import type {TenantAccess} from '../security/scope.ts';
export const settingsActions=['settings.organization.read','settings.organization.update','settings.franchise.read','settings.franchise.update'] as const;
export type SettingsAction=typeof settingsActions[number];
export interface SettingsAccess {access:TenantAccess;canUpdate:boolean;canReadFinance:boolean;canReadHistory:boolean;organizationActive:boolean;franchiseActive:boolean;reportFranchiseIds:readonly string[];exportFranchiseIds:readonly string[]}
