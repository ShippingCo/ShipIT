import { ConfigurationError, parseEnvironment } from './env.ts';
import { developerSecretResolver } from './secrets.ts';
import { startRuntime } from './runtime.ts';

const controller = new AbortController();
let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
let stopping = false;
const stop = () => {
  controller.abort();
  if (!runtime || stopping) return;
  stopping = true;
  void runtime.shutdown().then(() => {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }, () => {
    process.stderr.write('{"code":"SHUTDOWN_FAILED"}\n');
    process.exit(1); // Finite failure: never report graceful completion with hung resources.
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const config = parseEnvironment(process.env);
  // This CLI supports local developer composition. #68 supplies a managed resolver
  // to startRuntime for hosted deployment; hosted modes cannot use local credentials.
  const secretResolver = developerSecretResolver(config, process.env.LOCAL_DATABASE_URL,process.env.LOCAL_AUTH_JSON);
  runtime = await startRuntime({ config, secretResolver, signal: controller.signal });
  if (controller.signal.aborted) stop();
} catch (error) {
  const report = error instanceof ConfigurationError
    ? { code: 'CONFIGURATION_INVALID', details: error.issues } : { code: 'STARTUP_FAILED' };
  process.stderr.write(`${JSON.stringify(report)}\n`);
  process.exit(1);
}
