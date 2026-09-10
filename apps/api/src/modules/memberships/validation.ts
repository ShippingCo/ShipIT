import { HttpError } from '../../plugins/errors.ts';
import { roles, type Role } from './types.ts';

const invalid = (): never => { throw new HttpError('VALIDATION_FAILED'); };
export function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value) as object | null) ||
      Reflect.ownKeys(value).some(key=>typeof key !== 'string' || !fields.includes(key))) return invalid();
  return value as Record<string,unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 36 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return invalid();
  return value;
}
export function role(value: unknown): Role {
  if (typeof value !== 'string' || !roles.includes(value as Role)) return invalid();
  return value as Role;
}
export function scopes(value: unknown, selectedRole: Role): string[] {
  if (!Array.isArray(value) || value.length > 100 || (selectedRole !== 'org_admin' && value.length === 0)) return invalid();
  const result=value.map(uuid);
  if (new Set(result).size !== result.length) return invalid();
  return result.sort();
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483646) return invalid();
  return value;
}
export function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return invalid();
  return value;
}
export function createInvitationInput(value: unknown) {
  const input=object(value,['organization_id','invitee_user_id','role','franchise_ids']);
  const selectedRole=role(input.role);
  return { organizationId:uuid(input.organization_id),inviteeUserId:uuid(input.invitee_user_id),
    role:selectedRole,franchiseIds:scopes(input.franchise_ids,selectedRole) };
}
export function updateMembershipInput(value: unknown) {
  const input=object(value,['role','franchise_ids','expected_version']);
  const selectedRole=role(input.role);
  return { role:selectedRole,franchiseIds:scopes(input.franchise_ids,selectedRole),expectedVersion:version(input.expected_version) };
}
export function expectedVersionInput(value: unknown) {
  const input=object(value,['expected_version']);
  return { expectedVersion:version(input.expected_version) };
}
export function acceptanceInput(value: unknown) {
  const input=object(value,['token']); return { token:token(input.token) };
}
