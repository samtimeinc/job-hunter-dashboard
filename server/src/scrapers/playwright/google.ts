import type { Browser } from 'playwright';
import { matchesAny } from '../types.js';
import type { RawJob } from '../types.js';
import type { PlaywrightAdapter } from './types.js';

/**
 * ⚠️ STATUS: ADAPTER NOT REGISTERED — currently returns 0 jobs on every scan.
 *
 * google.com/about/careers/applications/jobs — Google's in-house portal.
 *
 * This adapter is implemented but its DOM selectors are UNVERIFIED against the
 * live site. **Google deliberately obfuscates all CSS class names** (random
 * tokens like `ObfsIf-eEDwDf-…`) AND splits each role across many leaf
 * elements with no `<a href>` wrapper. This makes deterministic scraping very
 * brittle and is partly intentional anti-scraping. Consider whether the
 * effort is worth it before flipping this on.
 *
 * To activate it (if you choose to):
 *
 *   1. Open google.com/about/careers/applications/jobs/results/?q=React in a
 *      headless script (template: server/scripts/debug-amazon.ts pattern)
 *      and find a more stable selector than the current h2/h3 heuristic.
 *   2. Update the selectors in this file until it returns real jobs.
 *   3. Add a `career` entry to TARGET_COMPANIES for Google:
 *        { name: 'Google', matchNames: [...], career: { type: 'playwright', adapter: 'google' } }
 *   4. Move 'google' to the "verified" section of PlaywrightAdapter in
 *      scrapers/targets.ts.
 *
 * Until then this file is dead code — the orchestrator never calls it.
 *
 * URL pattern (search results):
 *   /about/careers/applications/jobs/results/?q=<KW>&location=<LOC>
 *
 * WARNING: Google obfuscates all CSS class names (random tokens like
 * `ObfsIf-eEDwDf-…`) and splits each role across many leaf elements with
 * no `<a href>` wrapper. This adapter is best-effort. If Google changes
 * its DOM it returns [] with a warning — never a crash.
 */
export const googleAdapter: PlaywrightAdapter = {
  async scrape({ browser, companyName, keywords, limit }) {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });
    try {
      const url = new URL('https://www.google.com/about/careers/applications/jobs/results/');
      url.searchParams.set('q', keywords.join(' '));
      url.searchParams.set('location', 'United States');
      url.searchParams.set('page', '1');

      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) return route.abort();
        const u = route.request().url();
        if (/google-analytics|doubleclick|google\.com\/(ccm|rmkt|pagead|g\/collect)/i.test(u)) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30_000 });

      // Google's SPA sometimes needs an extra beat to render the list.
      await page.waitForTimeout(2500);

      // Strategy: collect each "card" as a block of leaf text. We look for the
      // repeated title pattern that appears across all Google job cards.
      const cards = await page.evaluate(() => {
        // Find candidate role-name leaf elements (heuristic): each ends with text
        // matching common engineering-job keywords.
        const jobTitleRegex =
          /(Software (Engineer|Developer|Architect|Lead|Manager))|(Frontend|Backend|Full[- ]?Stack|Infra|SRE|Site Reliability)/i;

        const all = Array.from(document.querySelectorAll('h2, h3, [role="heading"]')) as HTMLElement[];
        if (all.length) {
          // Fast path: typical heading-based cards.
          const out: { text: string }[] = [];
          const seen = new Set<string>();
          for (const h of all) {
            const t = (h.innerText || '').trim();
            if (!jobTitleRegex.test(t) || t.length < 10 || t.length > 200) continue;
            if (seen.has(t)) continue;
            seen.add(t);
            // Pull surrounding context (siblings) for location/company.
            const ctx = h.parentElement?.parentElement;
            out.push({
              text: (ctx?.innerText || t).replace(/\s+/g, ' ').trim().slice(0, 300),
            });
          }
          return out;
        }

        // Slow path: scan all leaves for any role-shaped text.
        const leaves = Array.from(document.querySelectorAll('span, div, p')) as HTMLElement[];
        const out: { text: string }[] = [];
        const seen = new Set<string>();
        for (const el of leaves) {
          if (el.children.length > 0) continue;
          const t = (el.innerText || '').trim();
          if (t.length < 10 || t.length > 200 || !jobTitleRegex.test(t)) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push({ text: t });
          if (out.length >= 60) break;
        }
        return out;
      });

      if (!cards.length) {
        console.warn('[playwright:google] no role cards matched — DOM may have changed');
        return [];
      }

      const jobs: RawJob[] = [];
      for (const card of cards) {
        const text = card.text.replace(/\s+/g, ' ').trim();
        // Google cards often start with the title; location usually follows.
        const firstComma = text.indexOf(',');
        const title = firstComma > 0 ? text.slice(0, firstComma) : text.slice(0, 120);
        if (!matchesAny(title, keywords)) continue;
        const location = firstComma > 0 ? text.slice(firstComma + 1, firstComma + 80).trim() : null;
        jobs.push({
          source: 'playwright',
          // No clean job_id from the DOM; hash the title+location.
          externalId: `google-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
          company: companyName,
          companySlug: 'google',
          title,
          // Google portal rarely exposes per-job URLs; deep-link to the search.
          url: 'https://www.google.com/about/careers/applications/jobs/results/?q=' +
            encodeURIComponent(title),
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
