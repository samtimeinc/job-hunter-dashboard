// Importing config has a side effect: it loads .env from the monorepo root.
// Must run before neon() is called so DATABASE_URL is populated.
import '../config.js';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

/**
 * Single Neon HTTP client reused across the server lifecycle.
 * Pairs cleanly with @neondatabase/serverless `neon()` and works in
 * Vercel Edge/Node runtimes.
 */
const sql = neon(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/jobhunt',
);

export const db = drizzle(sql, { schema });
export { schema };
