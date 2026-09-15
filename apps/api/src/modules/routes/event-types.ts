import type { RouteRow } from './types.ts';
import type { RouteEventInput } from '@shippingco/shared';
export type { RouteEventKind,RouteEventInput,RouteEventResult } from '@shippingco/shared';
export type RouteEventOperation = `routes.${RouteEventInput['kind']}`;
export interface RouteExecutionRow extends RouteRow {
  execution_state: 'pending' | 'departed' | 'arrived'; last_effective_at: Date | null;
  base_eta_at: Date | null; total_delay_minutes: number;
}
