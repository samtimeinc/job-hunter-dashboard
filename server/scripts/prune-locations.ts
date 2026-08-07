// One-time cleanup: prune jobs that wouldn't pass today's location filter.
//
// Usage:  npm run scan  (to refresh)  →  npm run prune:locations
// This deletes rows from the `jobs` table whose location + workMode combo
// doesn't match the WA/Seattle/Remote rule, then prints before/after counts.

import '../src/config.js';
import { db, schema } from '../src/db/client.js';
import { inArray } from 'drizzle-orm';
import { getDashboardSettings } from '../src/db/queries/settings.js';
import { passesLocationFilter, type RawJob } from '../src/scrapers/types.js';
import type { WorkMode } from '@jobhunt/shared';

async function main() {
  const { locations } = await getDashboardSettings();
  const allowed = locations.length ? locations : ['Seattle', 'Remote'];
  console.log(`[prune] location filter: ${allowed.join(', ')}`);

  const all = await db.select().from(schema.jobs);
  console.log(`[prune] inspecting ${all.length} jobs in DB…`);

  const idsToDelete: string[] = [];
  for (const row of all) {
    const synthetic: RawJob = {
      source: row.source,
      externalId: row.externalId,
      company: row.company,
      title: row.title,
      url: row.url,
      location: row.location,
      workMode: row.workMode as WorkMode,
    };
    if (!passesLocationFilter(synthetic, allowed)) {
      idsToDelete.push(row.id);
    }
  }

  console.log(
    `[prune] ${idsToDelete.length} jobs to delete, ${all.length - idsToDelete.length} to keep`,
  );

  // Delete in chunks of 200 to stay under Neon's parameter-count limits.
  const CHUNK = 200;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    const batch = idsToDelete.slice(i, i + CHUNK);
    await db.delete(schema.jobs).where(inArray(schema.jobs.id, batch));
  }
  console.log(`[prune] done`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[prune] fatal:', err);
    process.exit(1);
  });
