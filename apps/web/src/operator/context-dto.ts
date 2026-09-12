import type { OperatorContext, OperatorRole } from '@shippingco/shared';
import { ApiFailure } from '../data-access/errors';
const roles = new Set(['org_admin', 'franchise_admin', 'operator', 'dispatcher', 'delivery_agent', 'accountant', 'read_only']);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol' });
  return value;
};
/** Project the public DTO. Malformed successes cannot become local workspace authority. */
export function operatorContext(value: unknown): OperatorContext {
  const dto = object(value);
  if (!['ready', 'onboarding_required', 'scope_unavailable'].includes(String(dto.state)) || !Array.isArray(dto.franchises)) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol' });
  const franchises = dto.franchises.map(item => {
    const f = object(item), org = object(f.organization);
    if (!Array.isArray(f.roles) || !f.roles.length || !f.roles.every(role => typeof role === 'string' && roles.has(role))) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol' });
    return { id: string(f.id), display_name: string(f.display_name), organization: { id: string(org.id), display_name: string(org.display_name) }, roles: [...f.roles] as OperatorRole[] };
  });
  const active = dto.active_franchise_id === null ? null : string(dto.active_franchise_id);
  if (new Set(franchises.map(f => f.id)).size !== franchises.length || (dto.state === 'ready' ? !franchises.some(f => f.id === active) : active !== null || franchises.length !== 0)) throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol' });
  return { user_id: string(dto.user_id), state: dto.state as OperatorContext['state'], franchises, active_franchise_id: active };
}
