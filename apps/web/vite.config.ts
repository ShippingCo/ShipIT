/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  // shadcn / 21st.dev components import from '@/...'
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  server: {
    port: 5173,
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
});
