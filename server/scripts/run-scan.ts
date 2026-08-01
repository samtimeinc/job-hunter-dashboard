import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from '../src/scrapers/orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Standalone scan entry point. Used by:
 *   - `npm run scan` from the command line
 *   - Vercel cron via /api/cron
 *
 * Exit codes: 0 success (with partial scraper errors), 1 only on boot failure.
 */
async function main(): Promise<void> {
  console.log(`[scan] starting at ${new Date().toISOString()}`);
  const results = await runScan();
  for (const r of results) {
    const err = r.errors.length ? `  errors: ${r.errors.map((e) => e.message).join('; ')}` : '';
    console.log(
      `[scan] ${r.source}: fetched ${r.fetched}, inserted ${r.inserted}${err}`,
    );
  }
  console.log(`[scan] finished at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error('[scan] fatal:', err);
  process.exit(1);
});
