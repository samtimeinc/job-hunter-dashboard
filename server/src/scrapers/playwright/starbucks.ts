import type { Browser } from 'playwright';
import { matchesAny } from '../types.js';
import type { RawJob } from '../types.js';
import type { PlaywrightAdapter } from './types.js';

/**
 * ⚠️ STATUS: ADAPTER NOT REGISTERED — currently returns 0 jobs on every scan.
 *
 * careers.starbucks.com — Starbucks' in-house portal (Taleo-derived).
 *
 * This adapter is implemented but its DOM selectors are UNVERIFIED against the
 * live site (last attempt 2026-07-28 returned no `a[href*="/job/"]` matches).
 * To activate it:
 *
 *   1. Open careers.starbucks.com/job-search-results/?keyword=React in a
 *      headless script (template: server/scripts/debug-amazon.ts pattern)
 *      and inspect the actual result-card DOM.
 *   2. Update the selectors in this file until it returns real jobs.
 *   3. Add a `career` entry to TARGET_COMPANIES for Starbucks:
 *        { name: 'Starbucks', matchNames: [...], career: { type: 'playwright', adapter: 'starbucks' } }
 *   4. Move 'starbucks' to the "verified" section of PlaywrightAdapter in
 *      scrapers/targets.ts.
 *
 * Until then this file is dead code — the orchestrator never calls it.
 *
 * URL pattern: /job-search-results/?keyword=<KW>&location=
 *  Result card link: <a href="/job/<id>/<slug>">
 *
 * DOM is rendered by an Angular SPA — `a[href*="/job/"]` is the safest
 * signal that the result list is visible. If selectors change, this adapter
 * returns an empty list + a console.warning (no scan-wide crash).
 */
export const starbucksAdapter: PlaywrightAdapter = {
  async scrape({ browser, companyName, keywords, limit }) {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });
    try {
      const url = new URL('https://careers.starbucks.com/job-search-results/');
      url.searchParams.set('keyword', keywords.join(' '));

      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) return route.abort();
        const u = route.request().url();
        if (/google-analytics|doubleclick|linkedin|facebook|mparticle|wistia|litix/i.test(u)) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('a[href*="/job/"]', { timeout: 15_000 }).catch(() => {});

      const cards = await page.evaluate(() => {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/job/"]'),
        );
        const seen = new Set<string>();
        const out: { href: string; text: string }[] = [];
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          if (!href.startsWith('/job/') || seen.has(href)) continue;
          seen.add(href);
          // Pull the visible title (parent heading if present) + nearby text.
          let card: HTMLElement = a;
          for (let i = 0; i < 5; i++) {
            if (!card.parentElement) break;
            card = card.parentElement;
            if (card.querySelector('h2, h3')) break;
          }
          out.push({ href, text: (card.innerText || '').replace(/\s+/g, ' ').trim() });
        }
        return out;
      });

      if (!cards.length) {
        console.warn('[playwright:starbucks] no result anchors found — selectors may need update');
        return [];
      }

      const jobs: RawJob[] = [];
      for (const card of cards) {
        // Best-effort parse. Starbucks cards commonly: "<Title>\n<location>\n<id>"
        const lines = card.text
          .split(/\n| \| /)
          .map((l) => l.trim())
          .filter(Boolean);
        const title = lines[0] ?? 'Untitled';
        const locationIdx = lines.findIndex((l, i) => i > 0 && /[A-Z][a-z]+,?\s+[A-Z]/.test(l));
        const location = locationIdx > 0 ? lines[locationIdx] : null;
        if (!matchesAny(title, keywords)) continue;
        jobs.push({
          source: 'playwright',
          externalId: `starbucks-${card.href.split('/').filter(Boolean)[1] ?? card.href}`,
          company: companyName,
          companySlug: 'starbucks',
          title,
          url: `https://careers.starbucks.com${card.href}`,
          location,
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
