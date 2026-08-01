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

/** Close the shared browser after the scan completes. Safe to call repeatedly. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } finally {
    browserPromise = null;
  }
}
