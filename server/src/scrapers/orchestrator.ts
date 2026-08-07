import type { ScanResult } from '@jobhunt/shared';
import { upsertJob } from '../db/queries/jobs.js';
import { getDashboardSettings } from '../db/queries/settings.js';
import { isTargetCompany, TARGET_COMPANIES, type TargetCompany } from './targets.js';
import { scrapeAdzuna } from './adzuna.js';
import { scrapeAshby } from './ashby.js';
import { scrapeDice } from './dice.js';
import { scrapeGreenhouse } from './greenhouse.js';
import { scrapeJSearch } from './jsearch.js';
import { scrapeLever } from './lever.js';
import { scrapeRemotive } from './remotive.js';
import { scrapeWorkday } from './workday.js';
import { scrapeGitHub } from './github.js';
import { scrapePlaywright } from './playwright/index.js';
import { closeBrowser } from './playwright/browser.js';
import { passesLocationFilter, type ScraperResult } from './types.js';

/**
 * Run every scraper in parallel, persist results, and return a summary.
 * Used by both the in-app "Refresh now" button and the cron worker.
 */
export async function runScan(): Promise<ScanResult[]> {
  const startedAt = new Date().toISOString();
  const { keywords, locations } = await getDashboardSettings();

  // Effective keywords: settings override; fall back to the project defaults.
  const effectiveKeywords = keywords.length ? keywords : ['React', 'Node', 'TypeScript'];
  const effectiveLocations = locations.length ? locations : ['Seattle', 'Remote'];

  const results: ScraperResult[] = [];

  // --- Aggregator API scrapers (always run) ---
  results.push(await scrapeRemotive(effectiveKeywords));
  results.push(await scrapeAdzuna(effectiveKeywords, effectiveLocations));
  results.push(await scrapeJSearch(effectiveKeywords));
  results.push(await scrapeDice(effectiveKeywords));

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
        case 'github':
          // Single-tenant iCIMS board — no slug, always GitHub itself.
          return scrapeGitHub(c.name, effectiveKeywords);
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
  const insertedBySource = new Map<string, number>();
  const rejectedByLocation = new Map<string, number>();
  try {
    for (const result of results) {
      for (const job of result.jobs) {
        if (!passesLocationFilter(job, effectiveLocations)) {
          rejectedByLocation.set(result.source, (rejectedByLocation.get(result.source) ?? 0) + 1);
          continue;
        }
        const inserted = await upsertJob({
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
        });
        if (inserted) {
          insertedBySource.set(result.source, (insertedBySource.get(result.source) ?? 0) + 1);
        }
      }
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
