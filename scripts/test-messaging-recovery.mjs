import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDatabaseTests } from './test-database.mjs';
import { preflightTestDatabase, cleanupRegisteredResources } from '../packages/db/test/support.ts';

// Convenience qualification selection. Normal test:db still discovers every file.
// Reuse its guarded DB preflight, strict nonempty/non-skipped reporter and cleanup.
const names = ['messaging-recovery', 'notification-automation', 'deliveries',
  'final-mile-notifications', 'whatsapp-outbound', 'whatsapp-webhook', 'messaging-history', 'bookings', 'receipts'];
await preflightTestDatabase();
const directory = await mkdtemp(join(tmpdir(), 'shipit-messaging-recovery-'));
const registry = join(directory, 'resources.jsonl');
await writeFile(registry, '', { mode: 0o600 });
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const files = names.map(name => fileURLToPath(new URL(`../apps/api/test/database/${name}.test.ts`, import.meta.url)));
  const result = await executeDatabaseTests(files, registry, { signal: controller.signal });
  console.log(`Messaging recovery qualification: ${result.passed} passed, 0 failed/skipped/cancelled/todo.`);
} finally {
  try { await cleanupRegisteredResources(registry); }
  finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await rm(directory, { recursive: true });
  }
}
