import type { ScanResult } from '@jobhunt/shared';
import { deactivateStaleJobs, upsertJobs } from '../db/queries/jobs.js';
import { getDashboardSettings } from '../db/queries/settings.js';
import { isTargetCompany, TARGET_COMPANIES, type TargetCompany } from './targets.js';
import { scrapeAdzuna } from './adzuna.js';
import { scrapeAshby } from './ashby.js';
import { scrapeGreenhouse } from './greenhouse.js';
import { scrapeHackerNews } from './hackernews.js';
import { scrapeActiveJobsDb } from './active-jobs-db.js';
import { scrapeLever } from './lever.js';
import { scrapeRemotive } from './remotive.js';
import { scrapeTheMuse } from './themuse.js';
import { scrapeUsaJobs } from './usajobs.js';
import { scrapeWorkday } from './workday.js';
import { scrapePlaywright } from './playwright/index.js';
import { closeBrowser } from './playwright/browser.js';
import { passesLocationFilter, type RawJob, type ScraperResult } from './types.js';
import { detectCountry, detectSeniority } from './eligibility.js';
import { computeDuplicateGroupKey } from '../db/queries/dedupe.js';

/**
 * Run every scraper in parallel, persist results, and return a summary.
 * Used by both the in-app "Refresh now" button and the cron worker.
 */
export async function runScan(): Promise<ScanResult[]> {
  const startedAt = new Date().toISOString();
  const { keywords, locations } = await getDashboardSettings();

  // First — expire postings older than 60 days so the dashboard doesn't
  // accumulate stale (likely-closed) roles forever. Idempotent; runs before
  // every scan (cron + manual). See `deactivateStaleJobs` for the rule.
  const deactivated = await deactivateStaleJobs(60);
  if (deactivated > 0) {
    console.log(`[scan] deactivated ${deactivated} stale job(s) older than 60 days`);
  }

  // Effective keywords: settings override; fall back to the project defaults.
  const effectiveKeywords = keywords.length ? keywords : ['React', 'Node', 'TypeScript'];
  const effectiveLocations = locations.length ? locations : ['Seattle', 'Remote'];

  // --- Aggregator API scrapers (run in parallel — each swallows its own
  // errors, so one slow/aborted source can't stall the others). ---
  const [remotive, adzuna, activeJobsDb, hackernews, themuse, usajobs] = await Promise.all([
    scrapeRemotive(effectiveKeywords),
    scrapeAdzuna(effectiveKeywords, effectiveLocations),
    scrapeActiveJobsDb(effectiveKeywords),
    scrapeHackerNews(effectiveKeywords),
    scrapeTheMuse(effectiveKeywords),
    scrapeUsaJobs(effectiveKeywords),
  ]);
  const results: ScraperResult[] = [
    remotive,
    adzuna,
    activeJobsDb,
    hackernews,
    themuse,
    usajobs,
  ];

  // --------- Direct career-page fetchers ---------
  // Split into two groups: API-based scrapers run in parallel (fast), while
  // Playwright-based in-house-portal scrapers share ONE browser instance
  // and must run sequentially (each navigation reuses the same Chromium).
  type CompanyWithCareer = TargetCompany & { career: NonNullable<TargetCompany['career']> };
  const apiTargets = TARGET_COMPANIES.filter(
    (c): c is CompanyWithCareer => c.career != null && c.career.type !== 'playwright',
  );
  const playwrightTargets = TARGET_COMPANIES.filter(
    (
      c,
    ): c is CompanyWithCareer & {
      career: Extract<NonNullable<TargetCompany['career']>, { type: 'playwright' }>;
    } => c.career?.type === 'playwright',
  );

  const careerResults = await Promise.all(
    apiTargets.map(async (c): Promise<ScraperResult> => {
      // After the type guard above, c.career is non-null and not playwright.
      const career = c.career;
      switch (career.type) {
        case 'greenhouse':
          return scrapeGreenhouse(career.slug, c.name, effectiveKeywords);
        case 'lever':
          return scrapeLever(career.slug, c.name, effectiveKeywords);
        case 'ashby':
          return scrapeAshby(career.slug, c.name, effectiveKeywords);
        case 'workday':
          return scrapeWorkday(career.host, career.tenant, career.site, c.name, effectiveKeywords);
        // playwright handled separately below.
        case 'playwright':
          throw new Error('unreachable');
      }
    }),
  );
  results.push(...careerResults);

  // Playwright (serial) — one shared browser instance.
  // SKIPPED on Vercel serverless: the runtime has no writable/persistent
  // filesystem to hold the Chromium binary (`npx playwright install` can't
  // run, and bundling the ~300MB binary exceeds the serverless limits).
  // Enterprise portals (Amazon/Google/Microsoft/Starbucks) are scraped only
  // by the local `npm run scan` script in this path. On Vercel the same
  // companies are still surfaced via their ATS-API sourced rows where one
  // exists.
  const skipPlaywright = process.env.SKIP_PLAYWRIGHT === '1' || Boolean(process.env.VERCEL);
  if (skipPlaywright) {
    for (const c of playwrightTargets) {
      results.push({
        source: 'playwright',
        jobs: [],
        error: 'playwright source skipped (no browser binary available in serverless runtime)',
      });
    }
  } else {
    for (const c of playwrightTargets) {
      const career = c.career;
      results.push(await scrapePlaywright(career.adapter, c.name, effectiveKeywords));
    }
  }

  // --- Persist results into the DB ---
  // Apply the global location filter (WA / Seattle / Remote) BEFORE insert
  // so out-of-region roles never leak into the dashboard. Every scraper —
  // aggregators, ATS APIs, and Playwright adapters — funnels through here.
  // Batched upsert: one DB round-trip per ~100 rows instead of ~2 per job
  // (this was the main reason /api/cron timed out with a 504 on Vercel).
  const insertedBySource = new Map<string, number>();
  const rejectedByLocation = new Map<string, number>();
  try {
    const toPersist: { source: string; job: RawJob }[] = [];
    for (const result of results) {
      for (const job of result.jobs) {
        if (!passesLocationFilter(job, effectiveLocations)) {
          rejectedByLocation.set(result.source, (rejectedByLocation.get(result.source) ?? 0) + 1);
          continue;
        }
        // Normalise country + seniority at the orchestrator chokepoint so
        // every persisted row has them even when a scraper didn't set them.
        // The scraper's value (more specific — e.g. Workday's JSON-LD
        // addressCountry) wins; we only fill in when it's missing.
        if (!job.country) {
          job.country = detectCountry(job.location);
        }
        if (!job.seniority) {
          job.seniority = detectSeniority(job.title);
        }
        // Stamp the canonical duplicate-group key so it persists at insert
        // time (avoids a per-request recomputation across the whole DB on
        // every agent query).
        if (!job.duplicateGroupKey) {
          job.duplicateGroupKey = computeDuplicateGroupKey({
            company: job.company,
            title: job.title,
            location: job.location,
            country: job.country,
            requisitionId: job.requisitionId,
          });
        }
        toPersist.push({ source: result.source, job });
      }
    }

    // Group by source so each chunk stays within one source's external-id
    // namespace (the DB unique constraint is on (source, externalId)).
    const bySource = new Map<string, RawJob[]>();
    for (const { source, job } of toPersist) {
      const list = bySource.get(source);
      if (list) list.push(job);
      else bySource.set(source, [job]);
    }

    for (const [source, jobs] of bySource) {
      const { inserted } = await upsertJobs(
        jobs.map((job) => ({
          externalId: job.externalId,
          source: job.source,
          company: job.company,
          companySlug: job.companySlug ?? null,
          title: job.title,
          url: job.url,
          location: job.location ?? null,
          workMode: job.workMode,
          salaryMin: job.salaryMin ?? null,
          salaryMax: job.salaryMax ?? null,
          salaryCurrency: job.salaryCurrency ?? null,
          salaryPeriod: job.salaryPeriod ?? null,
          postedAt: job.postedAt ?? null,
          tags: job.tags ?? [],
          isTargetCompany: isTargetCompany(job.company),
          // Pass through the detail fields so they persist alongside the
          // existing salary/location/source data. Sources that don't expose
          // them leave these as null cleanly.
          descriptionText: job.descriptionText ?? null,
          descriptionHtml: job.descriptionHtml ?? null,
          applyUrl: job.applyUrl ?? null,
          companyDomain: job.companyDomain ?? null,
          country: job.country ?? null,
          requisitionId: job.requisitionId ?? null,
          seniority: job.seniority ?? null,
          duplicateGroupKey: job.duplicateGroupKey ?? null,
        })),
      );
      insertedBySource.set(source, inserted);
    }
  } finally {
    // Always close the headless browser at the end of the scan so it doesn't
    // leak across cron runs. Safe if no Playwright scraper was invoked.
    await closeBrowser();
  }

  const finishedAt = new Date().toISOString();
  return results.map((r) => {
    const rejected = rejectedByLocation.get(r.source) ?? 0;
    const errors: { source: string; message: string }[] = [];
    if (r.error) errors.push({ source: r.source, message: r.error });
    if (rejected > 0) {
      errors.push({
        source: r.source,
        message: `location filter rejected ${rejected} job${rejected === 1 ? '' : 's'} (allowed: ${effectiveLocations.join(', ')})`,
      });
    }
    return {
      startedAt,
      finishedAt,
      source: r.source,
      fetched: r.jobs.length,
      inserted: insertedBySource.get(r.source) ?? 0,
      errors,
    };
  });
}
