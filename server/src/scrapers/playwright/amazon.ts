import type { Browser } from 'playwright';
import type { RawJob } from '../types.js';
import type { PlaywrightAdapter } from './types.js';
import type { WorkMode } from '@jobhunt/shared';

/**
 * amazon.jobs — Amazon's in-house career portal.
 *
 * URL pattern (single search): /en/search?base_query=<KW>&loc_query=&...
 * Each result card's link href: /en/jobs/<id>/<slug>
 * Card text pattern: "<Title> <Location> | Job ID: <id>"
 *
 * Notes:
 *  - The page is a JS SPA; we wait for result anchors to appear.
 *  - amazon.jobs's `base_query` is AND-searching, so a query like
 *    "React Node TypeScript" returns near-zero results. We search once per
 *    keyword and dedupe by externalId (mirror the Adzuna per-location pattern).
 *  - We never use page.route() to block resources — Amazon's SPA bundle is
 *    served from static.amazon.jobs / *.cloudfront.net and blocking it kills
 *    the page entirely.
 */
const AMAZON_BASE = 'https://www.amazon.jobs/en/search';

export const amazonAdapter: PlaywrightAdapter = {
  async scrape({
    browser,
    companyName,
    keywords,
    limit,
  }: {
    browser: Browser;
    companyName: string;
    keywords: string[];
    limit: number;
  }): Promise<RawJob[]> {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });

    try {
      const seenJobIds = new Set<string>();
      const collected: RawJob[] = [];
      const keywordsToQuery = keywords.length ? keywords : ['React'];

      for (const keyword of keywordsToQuery) {
        if (collected.length >= limit) break;

        const url = new URL(AMAZON_BASE);
        url.searchParams.set('base_query', keyword);
        url.searchParams.set('loc_query', '');
        url.searchParams.set('job_count', String(limit));
        url.searchParams.set('result_limit', String(limit));
        url.searchParams.set('sort', 'recently_posted');

        await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // The SPA needs a beat to render the result tiles.
        await page.waitForTimeout(4000);
        // If this keyword returns zero hits, no anchors appear — move on.
        await page.waitForSelector('a[href*="/en/jobs/"]', { timeout: 12_000 }).catch(() => {
          console.warn(`[playwright:amazon] no results for "${keyword}"`);
        });

        const cards = await page.evaluate(() => {
          const anchors = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a[href*="/en/jobs/"]'),
          );
          const seen = new Set<string>();
          const out: { href: string; title: string; location: string | null }[] = [];
          for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            if (seen.has(href)) continue;
            seen.add(href);

            // Walk up to the tile container.
            let card: HTMLElement = a;
            for (let i = 0; i < 6; i++) {
              if (!card.parentElement) break;
              card = card.parentElement;
              if (card.querySelector('h3, h2, .job-title, [class*="title"], li.job')) break;
            }

            // Inside the card, the title is in an <h3>, and the location is in
            // a span/div whose class includes "location" or "text".
            const titleEl = card.querySelector<HTMLElement>('h3, h2, .job-title, [class*="title"]');
            // Amazon uses `.location` and `.text-and-location` containers.
            const locationEl = card.querySelector<HTMLElement>(
              '.location, [class*="location"], .job-location',
            );
            // Fallback: scrape from innerText and split on the location pattern.
            let title = (titleEl?.innerText || '').replace(/\s+/g, ' ').trim();
            // Amazon uses `.location` and `.text-and-location` containers.
            let location: string | null =
              (locationEl?.innerText || '').replace(/\s+/g, ' ').trim() || null;
            // Strip any trailing " | Job ID: <id>" the location element includes.
            location = location ? location.replace(/\s*\|\s*Job ID:\s*\d+\s*$/i, '').trim() : null;
            if (!title) {
              // Last resort: parse the entire card text.
              const fullText = (card.innerText || '').replace(/\s+/g, ' ').trim();
              // Match "<Title> <Location> | Job ID: <id>"
              const m = fullText.match(
                /^(.*?)\s+([A-Z][\w .'-]+(?:,\s*[A-Z][\w .'-]+)+(?:,\s*[A-Z]{2,})?)\s*\|\s*Job ID:\s*(\d+)$/,
              );
              if (m) {
                title = m[1]!.trim();
                location = m[2]!.trim();
              }
            }
            if (title) out.push({ href, title, location });
          }
          return out;
        });

        for (const card of cards) {
          // externalId comes from the URL slug like /en/jobs/<ID>/<slug>.
          const idMatch = card.href.match(/\/en\/jobs\/(\d+)\//);
          const idStr = idMatch?.[1] ?? card.href;
          const externalId = `amazon-${idStr}`;
          if (seenJobIds.has(externalId)) continue;
          seenJobIds.add(externalId);

          const workMode: WorkMode = /remote/i.test((card.location || '').toLowerCase())
            ? 'remote'
            : 'onsite';

          collected.push({
            source: 'playwright',
            externalId,
            company: companyName,
            companySlug: 'amazon',
            title: card.title,
            url: `https://www.amazon.jobs${card.href}`,
            location: card.location ?? null,
            workMode,
            tags: [],
          });
          if (collected.length >= limit) break;
        }
      }
      return collected;
    } finally {
      await page.close();
    }
  },
};
