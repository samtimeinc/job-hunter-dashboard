import type { Browser } from 'playwright';
import type { RawJob } from '../types.js';

/**
 * Each in-house career-portal adapter must implement this interface.
 *
 * Responsibilities:
 *  - Open the search-results page in the headless browser
 *  - Wait for job cards to render (or close gracefully if none)
 *  - Parse each card into the canonical RawJob shape
 *  - Apply keyword filtering using matchesAny() from ../types.ts
 *
 * The orchestrator manages the browser lifecycle (one shared instance per scan).
 */
export interface PlaywrightAdapter {
  /** Returns the RawJob rows for this company. The orchestrator wraps any
   *  rejected promise into a ScraperResult.error. */
  scrape(args: {
    browser: Browser;
    companyName: string;
    /** The keyword list to filter on (same one used by other scrapers). */
    keywords: string[];
    /** Maximum rows to return per adapter — keep scans bounded. */
    limit: number;
  }): Promise<RawJob[]>;
}
