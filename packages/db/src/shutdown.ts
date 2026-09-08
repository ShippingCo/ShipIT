import type { Client } from 'pg';
import { DatabaseError } from './errors.ts';
export async function boundedShutdown(operation: () => Promise<void>, destroy: () => void, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          destroy();
          reject(new DatabaseError('DB_SHUTDOWN_FAILED'));
        }, timeoutMs);
      }),
    ]);
  } catch { throw new DatabaseError('DB_SHUTDOWN_FAILED'); }
  finally { clearTimeout(timer); }
}
export async function closeClient(client: Client, timeoutMs = 2000): Promise<void> {
  await boundedShutdown(() => client.end(), () => client.connection.stream.destroy(), timeoutMs);
}
