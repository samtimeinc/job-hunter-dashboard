import type { JobSource } from '@jobhunt/shared';
import { matchesAny } from './types.js';
import { detectWorkMode, type RawJob, type ScraperResult } from './types.js';

/**
 * Workday career pages (Smartsheet, Redfin use custom Workday instances).
 * Workday doesn't publish a stable public API; the JSON used by their search
 * widget IS stable across tenants:
 *   https://<tenant>.wd1.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
 *
 * We POST { appliedFacets, limit, offset, searchText }.
 */
interface WorkdayJobPosting {
  bulletFields?: string[];
  postedOn?: string;
  externalPath?: string;
  externalUrl?: string;
  title?: string;
  locationsText?: string;
  description?: string;
}

interface WorkdayResponse {
  jobPostings?: WorkdayJobPosting[];
  total?: number;
}

export async function scrapeWorkday(
  /** e.g. "https://smartsheet.wd1.myworkdayjobs.com" */
  host: string,
  /** tenant name (first path segment) e.g. "smartsheet" */
  tenant: string,
  /** site e.g. "Smartsheet_Job_Careers" */
  site: string,
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'workday';
  const endpoint = `${host}/wday/cxs/${tenant}/${site}/jobs`;
  // Workday's /jobs endpoint hard-rejects limit > 20 with HTTP 400 (verified
  // 2026-08-02 against amgen.wd1). Modern tenants enforce this cap strictly,
  // so we cap at 20 per page and walk via `offset`.
  //
  // searchText: query EACH keyword separately and merge, rather than joining
  // keywords into one query. Why: Workday's multi-token search behaves
  // inconsistently per tenant — Amgen ORs ("React Node TypeScript" → 10
  // matches), but BigCommerce ANDs and returns nothing relevant. Per-keyword
  // queries are reliable across every tenant we tested (Concentrix, Amgen,
  // BigCommerce, Quantiphi, BMO, RELX, MillerKnoll, Prudential).
  // Final matchesAny() filter strips the relevance noise locally.
  const PAGE_LIMIT = 20;
  /** Safety cap per keyword so a runaway result set can't stall a scan. */
  const MAX_PAGES = 5; // → up to 100 postings × N keywords per tenant

  try {
    const seen = new Set<string>();
    const all: WorkdayJobPosting[] = [];

    for (const keyword of keywords) {
      let offset = 0;
      let batchLength = PAGE_LIMIT; // primes the loop
      for (let page = 0; page < MAX_PAGES && batchLength === PAGE_LIMIT; page++) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE_LIMIT,
            offset,
            searchText: keyword,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as WorkdayResponse;
        const batch = data.jobPostings ?? [];
        for (const p of batch) {
          const key = p.externalPath ?? p.title ?? '';
          if (key && !seen.has(key)) {
            seen.add(key);
            all.push(p);
          }
        }
        offset += batch.length;
        batchLength = batch.length;
        if (batch.length === 0) break; // End of results for this keyword.
      }
    }

    const jobs: RawJob[] = all
      .filter((p) => matchesAny(p.title ?? '', keywords))
      .map((p) => {
        // Build a deep-link users can actually open. Workday requires the
        // locale + site segment in the path; the bare `${host}${externalPath}
        // the original code built produces https://<host>/job/... which
        // 302-redirects to community.workday.com/invalid-url (the same
        // "Apply link goes home" bug we fixed in Adzuna). Prepend /en-US/<site>
        // and the link lands on the real posting page.
        let url = '';
        let applyUrl: string | null = null;
        if (p.externalUrl) {
          url = p.externalUrl;
        } else if (p.externalPath) {
          url = `${host}/en-US/${site}${p.externalPath}`;
        }
        // Workday sometimes exposes a standalone apply URL (e.g. an outbound
        // redirect for partner tenants). Preserve it as metadata when present;
        // the canonical /en-US/<site> deep-link stays the primary `url`.
        if (p.externalUrl) {
          applyUrl = p.externalUrl;
        }
        return {
          source,
          externalId: p.externalPath ?? p.title ?? '',
          company: companyName,
          companySlug: tenant,
          title: p.title ?? 'Untitled',
          url,
          location: p.locationsText ?? null,
          workMode: detectWorkMode([p.locationsText, p.description].join(' ')),
          postedAt: p.postedOn ? new Date(p.postedOn) : null,
          // NOTE: Workday's /jobs (list) endpoint does NOT return a posting
          // description body — only the per-job detail endpoint does. We
          // deliberately leave descriptionText null here rather than making an
          // extra HTTP round-trip per posting (which would multiply scan time
          // and trip the tenant-specific latent bugs documented in repo memory).
          // The detail GET would be added later if/when the scraper fetches
          // full postings; for now absence is preserved honestly.
          descriptionText: null,
          applyUrl,
        };
      });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
