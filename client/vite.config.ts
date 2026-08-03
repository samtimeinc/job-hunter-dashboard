import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite only loads .env from its own project root (client/) by default, but
// this repo keeps a single .env at the monorepo root. Point Vite there so
// VITE_* vars (e.g. VITE_SCAN_SECRET) are picked up by both dev and build.
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// During local dev, proxy /api to the Express server. On Vercel, the same
// /api path is served by the serverless function so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  envDir: monorepoRoot,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
