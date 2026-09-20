import type { Consumer } from './types.ts';

// #36/#39/#40/#55/#58 register reviewed consumers here. Empty is intentional:
// #35 must not activate provider calls, notification policy or business projections.
export const productionConsumers: readonly Consumer[] = Object.freeze([]);
