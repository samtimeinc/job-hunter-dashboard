import type { Browser } from 'playwright';
import { matchesAny } from '../types.js';
import type { RawJob } from '../types.js';
import type { PlaywrightAdapter } from './types.js';

/**
 * ⚠️ STATUS: ADAPTER NOT REGISTERED — currently returns 0 jobs on every scan.
 *
 * careers.microsoft.com — Microsoft's in-house portal.
 *
 * This adapter is implemented but its DOM selectors are UNVERIFIED against the
 * live site (last attempt 2026-07-28 returned no `a[href*="/v2/global/en/job/"]`
 * matches). To activate it:
 *
 *   1. Open careers.microsoft.com/v2/global/en/search.html?q=React and inspect
 *      the actual result-card DOM with a headless script
 *      (template: server/scripts/debug-amazon.ts pattern).
 *   2. Update the selectors in this file until it returns real jobs.
 *   3. Add a `career` entry to TARGET_COMPANIES for Microsoft:
 *        { name: 'Microsoft', matchNames: [...], career: { type: 'playwright', adapter: 'microsoft' } }
 *   4. Move 'microsoft' to the "verified" section of PlaywrightAdapter in
 *      scrapers/targets.ts.
 *
 * Until then this file is dead code — the orchestrator never calls it.
 *
 * URL pattern (search):
 *   /v2/global/en/search.html?q=<KW>&p=Software%20Development&lc=United%20States&pg=1&pp=10
 *
 * Cards render server-side as static HTML inside a `li.job` row containing
 * a link to /v2/global/en/job/<job-id>/<slug>.Microsoft lists 10-25 jobs
 * per page. We don't paginate — keeping scans bounded.
 */
export const microsoftAdapter: PlaywrightAdapter = {
  async scrape({ browser, companyName, keywords, limit }) {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });
    try {
      const url = new URL('https://careers.microsoft.com/v2/global/en/search.html');
      url.searchParams.set('q', keywords.join(' '));
      url.searchParams.set('p', 'Software Development');
      url.searchParams.set('lc', 'United States');
      url.searchParams.set('pg', '1');
      url.searchParams.set('pp', String(limit));

      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) return route.abort();
        const u = route.request().url();
        if (/google-analytics|doubleclick|linkedin|facebook|msn-media/i.test(u)) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page
        .waitForSelector('a[href*="/v2/global/en/job/"], .job, [data-job-id]', { timeout: 15_000 })
        .catch(() => {});

      const cards = await page.evaluate(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/v2/global/en/job/"]'),
        );
        const seen = new Set<string>();
        const out: { href: string; text: string }[] = [];
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          if (seen.has(href)) continue;
          seen.add(href);
          let card: HTMLElement = a;
          for (let i = 0; i < 5; i++) {
            if (!card.parentElement) break;
            card = card.parentElement;
            if (card.querySelector('h2, h3, .job-title')) break;
          }
          out.push({ href, text: (card.innerText || '').replace(/\s+/g, ' ').trim() });
        }
        return out;
      });

      if (!cards.length) {
        console.warn('[playwright:microsoft] no result anchors found — selectors may need update');
        return [];
      }

      const jobs: RawJob[] = [];
      for (const card of cards) {
        // Microsoft card text is "Title\nLocation\nDate\n…". Split cleanly.
        const lines = card.text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const title = lines[0] ?? 'Untitled';
        const location = lines.find((l, i) => i > 0 && /[A-Z][a-z]/.test(l));
        if (!matchesAny(title, keywords)) continue;
        const idMatch = card.href.match(/\/job\/([^/]+)\//);
        const externalId = idMatch ? `microsoft-${idMatch[1]}` : `microsoft-${card.href}`;
        jobs.push({
          source: 'playwright',
          externalId,
          company: companyName,
          companySlug: 'microsoft',
          title,
          url: card.href.startsWith('http')
            ? card.href
            : `https://careers.microsoft.com${card.href}`,
          location: location ?? null,
          workMode: /remote/i.test((location || '').toLowerCase()) ? 'remote' : 'onsite',
          tags: [],
        });
        if (jobs.length >= limit) break;
      }
      return jobs;
    } finally {
      await page.close();
    }
  },
};
