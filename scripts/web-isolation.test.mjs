import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionOutput, demoModule } from './web-isolation.mjs';

test('production output gate rejects direct/transitive demo modules, aliases and secret/demo markers', () => {
  assert.doesNotThrow(() => assertProductionOutput(['/work/apps/web/src/operator/OperatorApp.tsx'], 'real shell'));
  for (const module of ['data/store.ts', 'data/bot.ts', 'context/AppContext.tsx', 'DemoApp.tsx', 'pages/CustomerWhatsApp.tsx', 'demo/storage.ts', 'pages/business/DemoBusinessShell.tsx']) {
    assert.equal(demoModule(`/work/apps/web/src/${module}`), true);
    assert.throws(() => assertProductionOutput([`/work/apps/web/src/${module}`], ''), /Production bundle includes demo module/);
  }
  for (const marker of ['shipit_demo_database_v1', 'shippingco_v1', 'setu_courier_v2', 'revealOTP', 'AUTH_SECRET_REF', 'LOCAL_AUTH_JSON']) {
    assert.throws(() => assertProductionOutput([], marker), /forbidden marker/);
  }
});
