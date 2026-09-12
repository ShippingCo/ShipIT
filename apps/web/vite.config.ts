/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import { parseBrowserConfig } from './src/config/browser-config';
import { productionIsolationPlugin } from '../../scripts/web-isolation.mjs';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const config = parseBrowserConfig(loadEnv(mode, root, 'VITE_'));
  return {
    plugins: [react(), productionIsolationPlugin(config.dataMode === 'demo'), viteSingleFile()],
    define: { __SHIPIT_DEMO__: JSON.stringify(config.dataMode === 'demo') },
    base: './',
    // shadcn / 21st.dev components import from '@/...'
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    server: {
      port: 5173,
      proxy: { '/auth': process.env.SHIPIT_API_PROXY ?? 'http://127.0.0.1:3000', '/api': process.env.SHIPIT_API_PROXY ?? 'http://127.0.0.1:3000' },
      open: false,
      // Accept any Cloudflare quick-tunnel host. The hostname is regenerated on every
      // `cloudflared` run, so pinning one means editing this file each time — and a
      // personal tunnel URL has no business being committed to a public repo. This is
      // a dev-server Host-header check only; it has no effect on a built bundle.
      allowedHosts: ['.trycloudflare.com'],
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
