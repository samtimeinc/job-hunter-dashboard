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
  /** Secret authorising machine-to-machine access to /api/agent.
   *  Server-only — MUST NOT be surfaced as a VITE_* var (would ship to the
   *  browser bundle). Accept the key via Authorization: Bearer or X-Agent-Key. */
  agentApiKey: process.env.AGENT_API_KEY ?? '',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  isVercel: Boolean(process.env.VERCEL),
  keys: {
    adzunaAppId: process.env.ADZUNA_APP_ID ?? '',
    adzunaApiKey: process.env.ADZUNA_API_KEY ?? '',
    jsearchRapidApiKey: process.env.JSEARCH_RAPIDAPI_KEY ?? '',
    /** Dice Talent Search API uses OAuth2 client-credentials. Both are issued
     *  from the Dice developer portal (developer.dice.com). */
    diceClientId: process.env.DICE_CLIENT_ID ?? '',
    diceClientSecret: process.env.DICE_CLIENT_SECRET ?? '',
    /** The Muse public API v2 — free tier, email registration at themuse.com.
     *  Docs: https://www.themuse.com/developers/api/v2 */
    themuseApiKey: process.env.THEMUSE_API_KEY ?? '',
    /** USAJOBS official federal job search — free tier, email signup at
     *  developer.usajobs.gov. Docs: https://developer.usajobs.gov/API-Reference */
    usajobsApiKey: process.env.USAJOBS_API_KEY ?? '',
  },
} as const;
