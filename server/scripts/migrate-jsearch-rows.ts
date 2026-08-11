import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config.js'; // boots env-aware Drizzle client
import { db } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * One-shot: migrate any leftover `jsearch` rows to `active-jobs-db` so they
 * stay visible in the source-filter chip after the JSearch → Active Jobs DB
 * swap. Idempotent — safe to re-run.
 *
 * Usage: `npx tsx scripts/migrate-jsearch-rows.ts`
 */
async function main(): Promise<void> {
  const migrated = await db.execute(
    sql`UPDATE jobs SET source = 'active-jobs-db' WHERE source = 'jsearch'`,
  );
  const moved = migrated.rowCount ?? migrated.rows?.length ?? 0;
  console.log(`[migrate] moved ${moved} jsearch row(s) → active-jobs-db`);

  const summary = await db.execute(
    sql`SELECT source, count(*)::int AS n FROM jobs GROUP BY source ORDER BY source`,
  );
  console.log('[migrate] current distribution:');
  for (const row of summary.rows ?? []) {
    console.log(`  ${row.source}: ${row.n}`);
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
