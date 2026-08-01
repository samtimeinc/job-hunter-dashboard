import type { JobSource } from '@jobhunt/shared';
import { getBrowser } from './browser.js';
import { amazonAdapter } from './amazon.js';
import { googleAdapter } from './google.js';
import { microsoftAdapter } from './microsoft.js';
import { starbucksAdapter } from './starbucks.js';
import type { PlaywrightAdapter } from './types.js';
import type { RawJob, ScraperResult } from '../types.js';

/**
 * Headless-browser scraper for in-house career portals.
 *
 * Use one shared Chromium instance across all in-house companies per scan
 * (see browser.ts). Returns a ScraperResult per company, just like the
 * API-based scrapers do — the orchestrator calls this once per company.
 */
const ADAPTERS: Record<import('../targets.js').PlaywrightAdapter, PlaywrightAdapter> = {
  amazon: amazonAdapter,
  starbucks: starbucksAdapter,
  microsoft: microsoftAdapter,
  google: googleAdapter,
};

const MAX_ROWS_PER_COMPANY = 30;

export async function scrapePlaywright(
  adapterName: keyof typeof ADAPTERS,
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'playwright';
  const adapter = ADAPTERS[adapterName];
  if (!adapter) {
    return { source, jobs: [], error: `Unknown playwright adapter: ${adapterName}` };
  }
  try {
    const browser = await getBrowser();
    const jobs: RawJob[] = await adapter.scrape({
      browser,
      companyName,
      keywords,
      limit: MAX_ROWS_PER_COMPANY,
    });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
