import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// .env lives at the monorepo root — load it from there regardless of cwd.
// config.ts is at server/src/, so the root is two levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Centralised config. Reads everything from env with safe fallbacks.
 * Throws on missing required vars at boot so failures are loud and early.
 */
function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Neon (or any Postgres) connection string. */
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/jobhunt'),
  /** Shared secret protecting scan/stats write endpoints (cron + manual). */
  scanSecret: process.env.SCAN_SECRET ?? '',
  /** Optional user-gate key for the dashboard itself (single-user). */
  dashboardToken: process.env.DASHBOARD_TOKEN ?? '',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  isVercel: Boolean(process.env.VERCEL),
  keys: {
    adzunaAppId: process.env.ADZUNA_APP_ID ?? '',
    adzunaApiKey: process.env.ADZUNA_API_KEY ?? '',
    jsearchRapidApiKey: process.env.JSEARCH_RAPIDAPI_KEY ?? '',
  },
} as const;
