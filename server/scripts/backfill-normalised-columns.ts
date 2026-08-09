/**
 * One-shot backfill of the four new normalised columns on `jobs`
 * (country, requisition_id, seniority, duplicate_group_key) for existing rows.
 *
 * Run once after the schema-only push, then forget about it — every future
 * scan populates these columns at insert time. Safe to re-run (each update
 * statement is unconditional; this is the desired first-time fill).
 *
 *   npx tsx server/scripts/backfill-normalised-columns.ts
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { detectCountry, detectSeniority } from '../src/scrapers/eligibility.js';
import { computeDuplicateGroupKey } from '../src/db/queries/dedupe.js';

type Row = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  country: string | null;
  requisitionId: string | null;
  seniority: string | null;
  url: string;
  externalId: string;
};

async function main() {
  console.log('[backfill] fetching all jobs to compute normalised fields...');
  const rows = (await db
    .select({
      id: schema.jobs.id,
      company: schema.jobs.company,
      title: schema.jobs.title,
      location: schema.jobs.location,
      country: schema.jobs.country,
      requisitionId: schema.jobs.requisitionId,
      seniority: schema.jobs.seniority,
      url: schema.jobs.url,
      externalId: schema.jobs.externalId,
    })
    .from(schema.jobs)) as Row[];

  console.log(`[backfill] ${rows.length} rows to inspect`);

  let countryFilled = 0;
  let reqFilled = 0;
  let seniorityFilled = 0;
  let groupKeyFilled = 0;

  const updates: {
    id: string;
    country: string | null;
    requisitionId: string | null;
    seniority: string | null;
    groupKey: string;
  }[] = [];

  for (const r of rows) {
    const country = r.country ?? detectCountry(r.location);
    const seniority = r.seniority ?? detectSeniority(r.title);

    // Requisition id backfill — best-effort: derive from source-specific
    // patterns when the scraper didn't fill it. Most pre-fix rows have null;
    // we only fill when an obvious id appears in externalId.
    let requisitionId = r.requisitionId;
    if (!requisitionId && r.externalId) {
      const m = r.externalId.match(/((?:JR|R-\d+|REQ-\d+|req-\d+)[\w-]*)$/i);
      if (m && m[1]) requisitionId = m[1];
      else if (/^\d+$/.test(r.externalId)) requisitionId = r.externalId;
      else if (/^[a-f0-9-]{36}$/i.test(r.externalId)) requisitionId = r.externalId;
    }

    const groupKey = computeDuplicateGroupKey({
      company: r.company,
      title: r.title,
      location: r.location,
      country,
      requisitionId,
    });

    if (country && !r.country) countryFilled++;
    if (seniority && !r.seniority) seniorityFilled++;
    if (requisitionId && !r.requisitionId) reqFilled++;
    if (groupKey) groupKeyFilled++;

    updates.push({ id: r.id, country, requisitionId, seniority, groupKey });
  }

  // Apply per-row updates serially. Neon HTTP driver supports neither
  // transactions nor true batching, but per-row UPDATEs are cheap and the run
  // is a one-shot. 1003 rows ≈ ~60 s on a warm Neon connection.
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i]!;
    await db
      .update(schema.jobs)
      .set({
        country: u.country,
        requisitionId: u.requisitionId,
        seniority: u.seniority as never,
        duplicateGroupKey: u.groupKey,
      })
      .where(eq(schema.jobs.id, u.id));
    if (i % 100 === 0) {
      process.stdout.write(`[backfill] ${i}/${updates.length} rows written\r`);
    }
  }
  console.log(`[backfill] ${updates.length}/${updates.length} rows written`);

  // Coverage summary across the whole table.
  const result = await db.execute(
    sql`SELECT
      count(*) AS total,
      count(*) FILTER (WHERE country IS NOT NULL) AS with_country,
      count(*) FILTER (WHERE seniority IS NOT NULL) AS with_seniority,
      count(*) FILTER (WHERE requisition_id IS NOT NULL) AS with_req,
      count(*) FILTER (WHERE duplicate_group_key IS NOT NULL) AS with_group_key
    FROM jobs`,
  );
  const summary = (result.rows?.[0] ?? {}) as Record<string, unknown>;
  console.log('[backfill] coverage summary:', summary);

  console.log(
    `[backfill] done. Filled country=${countryFilled}, requisitionId=${reqFilled}, seniority=${seniorityFilled}, duplicateGroupKey=${groupKeyFilled}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});
