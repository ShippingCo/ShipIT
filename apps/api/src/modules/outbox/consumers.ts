import type { Consumer } from './types.ts';
import { createNotificationConsumer } from '../automation/service.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';

// #40/#55/#58 register reviewed consumers here. #39 supplies the database-only
// enqueue effect; #40 owns notification policy and historical replay decisions.
// Provider network calls never run inside these effect transactions.
export function productionConsumers(dependencies:WhatsappDependencies):readonly Consumer[] {
  return Object.freeze([createNotificationConsumer(dependencies)]);
}
