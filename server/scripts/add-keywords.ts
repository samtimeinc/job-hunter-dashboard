import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config.js'; // ensures env is read
import { getDashboardSettings, setDashboardSettings } from '../src/db/queries/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Add one or more keywords to the dashboard settings `keywords` list.
 * Idempotent — dedupes against whatever's already there.
 *
 * Usage: `npx tsx scripts/add-keywords.ts keyword1 keyword2 ...`
 *
 * Example: `npx tsx scripts/add-keywords.ts JavaScript frontend front-end ui web developer software`
 */
async function main(): Promise<void> {
  const toAdd = process.argv.slice(2).map((k) => k.trim()).filter(Boolean);
  if (!toAdd.length) {
    console.error('[add-keywords] pass at least one keyword as a CLI arg');
    process.exit(1);
  }

  const current = await getDashboardSettings();
  const existing = new Set(current.keywords.map((k) => k.toLowerCase()));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const k of toAdd) {
    if (existing.has(k.toLowerCase())) skipped.push(k);
    else {
      added.push(k);
      existing.add(k.toLowerCase());
    }
  }

  const merged = [...current.keywords, ...added];
  await setDashboardSettings({
    targetCompanies: current.targetCompanies,
    keywords: merged,
    locations: current.locations,
  });

  console.log('[add-keywords] added:', added.length ? added.join(', ') : '(none)');
  console.log('[add-keywords] skipped (already present):', skipped.length ? skipped.join(', ') : '(none)');
  console.log('[add-keywords] keywords now:', merged);
}

main().catch((err) => {
  console.error('[add-keywords] fatal:', err);
  process.exit(1);
});
