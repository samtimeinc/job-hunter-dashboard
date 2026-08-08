import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeActiveJobsDb } from '../src/scrapers/active-jobs-db.js';
import { getDashboardSettings } from '../src/db/queries/settings.js';
import { passesLocationFilter } from '../src/scrapers/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Diagnostic: dumps what Active Jobs DB returns and where jobs may be dropped
 * before they reach the dashboard. Mirrors the old inspect-jsearch.ts shape.
 *
 *   1. Hits the API raw to confirm subscription + response shape
 *   2. Runs the real scraper
 *   3. Reports work-mode breakdown + location-filter outcomes
 *   4. Pretty-prints the first 3 normalised jobs
 *
 * Usage: `npx tsx scripts/inspect-active-jobs-db.ts`
 */
async function main(): Promise<void> {
  const { keywords, locations } = await getDashboardSettings();
  const effectiveKeywords = keywords.length ? keywords : ['React', 'Node', 'TypeScript'];
  const effectiveLocations = locations.length ? locations : ['Seattle', 'Remote'];

  console.log('[inspect] settings keywords  =', effectiveKeywords);
  console.log('[inspect] settings locations =', effectiveLocations);

  // --- Raw fetch so we see the literal payload + any error message verbatim.
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error('[inspect] RAPIDAPI_KEY not set');
    process.exit(1);
  }
  const cleanedKw = effectiveKeywords.map((k) => k.replace(/"/g, '')).slice(0, 6);
  const titleExpr = cleanedKw.length
    ? cleanedKw.map((k) => `"${k}"`).join(' OR ')
    : '';
  const url =
    'https://active-jobs-db.p.rapidapi.com/active-ats?' +
    new URLSearchParams({
      title: titleExpr,
      location: '"United States"',
      description_format: 'text',
      time_frame: '24h',
      limit: '100',
      offset: '0',
    }).toString();
  console.log('\n[inspect] raw URL =', url);

  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': 'active-jobs-db.p.rapidapi.com',
    },
  });
  console.log('[inspect] HTTP status =', res.status, res.statusText);
  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error('[inspect] response is not JSON. First 500 chars:');
    console.error(text.slice(0, 500));
    process.exit(1);
  }
  const rawJobs = Array.isArray(raw) ? raw : [];
  console.log('[inspect] raw jobs returned by API =', rawJobs.length);
  if (!Array.isArray(raw)) {
    console.log('[inspect] response payload (non-array):');
    console.dir(raw, { depth: 3 });
    // Still fall through to the scraper call so we see how our code handles it.
  } else if (rawJobs.length > 0) {
    console.log('[inspect] first raw job keys =', Object.keys(rawJobs[0] as object).join(', '));
  }

  // --- Now run the actual scraper code path used by the orchestrator.
  const result = await scrapeActiveJobsDb(effectiveKeywords);
  console.log('\n[inspect] scraper fetched =', result.jobs.length);
  if (result.error) console.log('[inspect] scraper error   =', result.error);

  console.log('\n[inspect] work-mode breakdown:');
  const byMode = new Map<string, number>();
  for (const j of result.jobs) {
    byMode.set(j.workMode, (byMode.get(j.workMode) ?? 0) + 1);
  }
  for (const [mode, n] of byMode) console.log(`  ${mode}: ${n}`);

  console.log('\n[inspect] location filter outcomes (allowed:', effectiveLocations, '):');
  let passed = 0;
  let rejected = 0;
  let shown = 0;
  for (const j of result.jobs) {
    if (passesLocationFilter(j, effectiveLocations)) passed++;
    else {
      rejected++;
      if (shown < 5) {
        console.log(
          `  REJECT: ${j.company} | ${j.title} | loc=${JSON.stringify(j.location)} mode=${j.workMode}`,
        );
        shown++;
      }
    }
  }
  if (rejected > shown) console.log(`  ... and ${rejected - shown} more rejected`);
  console.log(`\n[inspect] passed = ${passed}, rejected = ${rejected}`);

  console.log('\n[inspect] first 3 normalised jobs:');
  for (const j of result.jobs.slice(0, 3)) {
    console.dir(
      {
        company: j.company,
        title: j.title,
        location: j.location,
        workMode: j.workMode,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryPeriod: j.salaryPeriod,
        postedAt: j.postedAt,
        companyDomain: j.companyDomain,
        hasDescription: Boolean(j.descriptionText ?? j.descriptionHtml),
        url: j.url,
      },
      { depth: null },
    );
  }
}

main().catch((err) => {
  console.error('[inspect] fatal:', err);
  process.exit(1);
});
