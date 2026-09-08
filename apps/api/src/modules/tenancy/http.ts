import { DatabaseError } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { TenancyError } from './errors.ts';

// Adapter for future authorized routes and test-only injection composition.
export function toHttpError(error: unknown): HttpError {
  if (error instanceof TenancyError) return new HttpError(error.code);
  if (error instanceof DatabaseError) return new HttpError('TEMPORARILY_UNAVAILABLE');
  return new HttpError('INTERNAL_ERROR');
}
