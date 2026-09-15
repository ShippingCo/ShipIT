import { FieldValidationError } from '../../plugins/errors.ts';
import { object, integer, uuid, timestamp } from '../pricing/validation.ts';
import type { RouteEventInput } from './event-types.ts';
export function eventCommand(value: unknown): RouteEventInput {
  const b = object(value, ['kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref','base_eta_at','total_delay_minutes']);
  if (!['departure','delay','arrival'].includes(b.kind as string)) throw new FieldValidationError('kind','INVALID_FORMAT');
  const common = {
    kind: b.kind as RouteEventInput['kind'], expected_version: integer(b.expected_version,'expected_version',1,2147483646),
    manifest_id: uuid(b.manifest_id,'manifest_id'), manifest_version: integer(b.manifest_version,'manifest_version',1,2147483646),
    effective_at: timestamp(b.effective_at,'effective_at'), evidence_ref: uuid(b.evidence_ref,'evidence_ref'),
  };
  if (b.kind !== 'departure' && 'base_eta_at' in b) throw new FieldValidationError('base_eta_at','UNKNOWN_FIELD');
  if (b.kind !== 'delay' && 'total_delay_minutes' in b) throw new FieldValidationError('total_delay_minutes','UNKNOWN_FIELD');
  if (b.kind === 'departure') {
    const base = b.base_eta_at === null ? null : timestamp(b.base_eta_at,'base_eta_at');
    if (base && Date.parse(base) < Date.parse(common.effective_at)) throw new FieldValidationError('base_eta_at','OUT_OF_RANGE');
    return {...common, base_eta_at: base};
  }
  return b.kind === 'delay' ? {...common,total_delay_minutes:integer(b.total_delay_minutes,'total_delay_minutes',0,43200)} : common;
}
