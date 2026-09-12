import path from 'node:path';
// Applied to the actual rendered Rollup graph, after tree shaking. Includes transitive/alias imports.
export function demoModule(id) {
  const file = id.replaceAll('\\', '/').split('?')[0];
  return /\/src\/(demo\/|data\/|context\/AppContext\.|DemoApp\.|pages\/(Launcher\.|CustomerWhatsApp\.|business\/DemoBusinessShell\.))/.test(file);
}
const forbiddenMarkers = ['shippingco_v1', 'setu_courier_v2', 'shippingco_current_phone', 'shipit_demo_', 'Reset demo data', 'revealOTP',
  'AUTH_SECRET_REF', 'OTP_PEPPER_REF', 'SESSION_SIGNING_KEY_REF', 'WHATSAPP_ACCESS_TOKEN_REF', 'DATABASE_SECRET_REF', 'LOCAL_AUTH_JSON'];
export function assertProductionOutput(modules, source) {
  const leaked = modules.find(demoModule);
  if (leaked) throw new Error(`Production bundle includes demo module: ${path.relative(process.cwd(), leaked)}`);
  const marker = forbiddenMarkers.find(marker => source.includes(marker));
  if (marker) throw new Error(`Production bundle contains forbidden marker: ${marker}`);
}
export function productionIsolationPlugin(demo) {
  return { name: 'shipit-production-isolation', enforce: 'post', generateBundle(_options, bundle) {
    if (demo) return;
    const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
    assertProductionOutput(chunks.flatMap(chunk => Object.entries(chunk.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id)),
      Object.values(bundle).map(output => output.type === 'chunk' ? output.code : String(output.source)).join('\n'));
  } };
}
