import type { Browser } from 'playwright';
import { chromium } from 'playwright';

/**
 * Shared, lazily-initialised headless browser. Spinning one up takes ~600ms,
 * so we reuse the same instance across all in-house-portal adapters in a scan.
 * Closed by closeBrowser() at the end of the orchestrator's scrape loop.
 */
let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      return browser;
    })();
  }
  return browserPromise;
}

/** Close the shared browser after the scan completes. Safe to call repeatedly.
 *
 *  CRITICAL: must never throw, even if `chromium.launch()` rejected (e.g. no
 *  browser binary on a serverless runtime). This is always invoked from the
 *  orchestrator's `finally` block — if it re-threw the rejected launch
 *  promise, the entire scan would 500 even though every per-company scraper
 *  already caught its own failure. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const promise = browserPromise;
  browserPromise = null;
  try {
    const browser = await promise;
    await browser.close();
  } catch {
    // Launch failed — nothing to close. The error was already surfaced by
    // the individual adapter via scrapePlaywright's try/catch.
  }
}
