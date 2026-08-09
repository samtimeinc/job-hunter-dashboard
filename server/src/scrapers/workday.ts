import type { JobSource } from '@jobhunt/shared';
import {
  detectCountry,
  detectSeniority,
  matchesAny,
  detectWorkMode,
  type RawJob,
  type ScraperResult,
} from './types.js';
import { fetchJobDetailHtml, parseWorkdayDetailHtml } from './workday-detail.js';

/**
 * Workday career pages (Concentrix, Amgen, Smartsheet, …).
 *
 * Workday doesn't publish a stable public API; the JSON used by their search
 * widget IS stable across tenants:
 *   https://<tenant>.wdN.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
 *
 * We POST { appliedFacets, limit, offset, searchText }.
 *
 * LIMITATIONS of the list endpoint (the source of every data-quality bug the
 * agent surfaced):
 *   - `postedOn` is a relative human string ("Posted 9 Days Ago") — never
 *     a parseable date. We keep it for debugging but do NOT trust it as
 *     postedAt.
 *   - `jobPostings[]` carries NO description body. The body lives in a
 *     separate detail fetch (per-job) that blocks the scan if done naively.
 *   - `bulletFields[0]` carries the stable requisition ID ("JR11114"),
 *     which is the CORRECT dedup identity — different requisitions share
 *     title + location but have distinct `bulletFields[0]`. The list URL slug
 *     embeds it too, which is why `externalPath` is also a reliable key.
 *   - There's no country field; only `locationsText` ("USA - Remote",
 *     "Canada - Remote", "3 Locations"). We can't tell eligibility from the
 *     list alone.
 *
 * To enrich, we hit the HTML detail page for every posting and read its
 * embedded schema.org JSON-LD block, which exposes the real apply page URL +
 * description + ISO `datePosted` + structured `jobLocation.address.country`.
 * Detail fetches run with a bounded concurrency cap + per-request timeout so
 * a slow/aborted tenant can't stall the whole scan.
 */
interface WorkdayJobPosting {
  bulletFields?: string[];
  /** Relative human string ("Posted 9 Days Ago"). Not a parseable date. */
  postedOn?: string;
  /** URL slug of the form "/job/<Loc>/<Title-Slug>_JRnnnn" — the canonical
   *  identity on the list endpoint, it embeds the requisition id. */
  externalPath?: string;
  /** Outbound apply URL when Workday is configured to redirect to an
   *  external portal. Most tenants leave this null. */
  externalUrl?: string;
  title?: string;
  locationsText?: string;
  /** Sometimes populated; usually empty on the list endpoint. */
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
  /** Optional dependency-injected detail-page fetcher. Tests pass a stub to
   *  exercise the parse/assemble logic without real HTTP. Defaults to the
   *  production {@link fetchJobDetailHtml} so callers don't need to know. */
  deps?: { fetchDetailHtml?: typeof fetchJobDetailHtml },
): Promise<ScraperResult> {
  const source: JobSource = 'workday';
  const endpoint = `${host}/wday/cxs/${tenant}/${site}/jobs`;
  const detailsBase = `${host}/en-US/${site}`;
  const fetchDetail = deps?.fetchDetailHtml ?? fetchJobDetailHtml;
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
  /** Hard ceiling per Workday request so a hung tenant can't stall the scan
   *  (Workday tenants have historically hung or been flaky — 504'd the whole
   *  cron because /api/cron runs synchronously within Vercel's maxDuration). */
  const REQUEST_TIMEOUT_MS = 15_000;
  /** Cap on simultaneous detail-page fetches per tenant. Bumped from N
   *  (fire-and-forget) so we don't get rate-limited or trip Workday's
   *  anti-scrape wall (406 when concurrency + load spikes). */
  const DETAIL_CONCURRENCY = 4;

  try {
    const seen = new Set<string>();
    const all: WorkdayJobPosting[] = [];

    for (const keyword of keywords) {
      let offset = 0;
      let batchLength = PAGE_LIMIT; // primes the loop
      for (let page = 0; page < MAX_PAGES && batchLength === PAGE_LIMIT; page++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              appliedFacets: {},
              limit: PAGE_LIMIT,
              offset,
              searchText: keyword,
            }),
          });
        } finally {
          clearTimeout(timer);
        }
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

    const filteredPostings = all.filter((p) => matchesAny(p.title ?? '', keywords));

    // Enrich in bounded-concurrency batches. We fetch the detail HTML page
    // (which carries a JSON-LD `<script type="application/ld+json">` block —
    // the only reliable source for description/date/country on Workday). The
    // older /wday/cxs/<tenant>/<site>/details/<slug> API returns 406 on
    // every tenant we tested (Quantiphi, Amgen, …) — the HTML path is the
    // only universal one.
    const enriched = new Map<string, ReturnType<typeof parseWorkdayDetailHtml> | null>();
    for (let i = 0; i < filteredPostings.length; i += DETAIL_CONCURRENCY) {
      const batch = filteredPostings.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          const path = p.externalPath;
          if (!path) return { path: '', parsed: null };
          const url = `${detailsBase}${path}`;
          try {
            const html = await fetchDetail(url);
            return { path, parsed: html ? parseWorkdayDetailHtml(html) : null };
          } catch {
            // Any fetch/parse failure for a single posting must fail soft —
            // the listing data is still usable, just without enrichment.
            return { path, parsed: null };
          }
        }),
      );
      for (const r of results) {
        if (r.path) enriched.set(r.path, r.parsed);
      }
    }

    const jobs: RawJob[] = filteredPostings.map((p) => {
      // Build a deep-link users can actually open. Workday requires the
      // locale + site segment in the path; the bare `${host}${externalPath}`
      // the original code built produces https://<host>/job/... which
      // 302-redirects to community.workday.com/invalid-url. Prepend /en-US/<site>
      // and the link lands on the real posting page.
      const path = p.externalPath ?? '';
      const detailsUrl = path ? `${detailsBase}${path}` : '';
      // The Workday job page IS the application page (the "Apply" button on
      // the page submits into Workday). When Workday publishes a distinct
      // externalUrl (outbound partner portals), prefer it.
      let applyUrl: string | null = null;
      if (p.externalUrl) {
        applyUrl = p.externalUrl;
      } else if (detailsUrl) {
        applyUrl = detailsUrl;
      }

      // The requisition id is bulletFields[0] when present; otherwise we try
      // to recover it from the URL slug (...) suffix. This is the
      // genuinely-stable identity for dedup grouping (different from
      // `externalPath` only in that it's the bare id, not the slug).
      const requisitionId = p.bulletFields?.[0] ?? extractReqFromPath(path);

      const listingDescription = p.description?.trim() || null;

      // Prefer the enriched JSON-LD block; fall back to the list fields
      // honestly (no fabrication).
      const detail = path ? (enriched.get(path) ?? null) : null;
      const descriptionText = detail?.description?.trim() || listingDescription || null;
      const descriptionHtml = detail?.descriptionHtml ?? null;

      // postedAt: list `postedOn` is a relative string ("Posted 9 Days
      // Ago") — never trust it. The JSON-LD `datePosted` is a real ISO date.
      let postedAt: Date | null = null;
      if (detail?.datePosted) {
        const d = new Date(detail.datePosted);
        if (Number.isFinite(d.getTime())) postedAt = d;
      }

      // Location: prefer the structured JSON-LD locality when the list only
      // gave us a placeholder ("3 Locations") and real text is available.
      const rawLocText = p.locationsText ?? null;
      let location = rawLocText;
      const isPlaceholderCount =
        rawLocText != null && /^\d+\s+locations?$/i.test(rawLocText);
      if (detail?.locality && (!rawLocText || isPlaceholderCount)) {
        location = detail.locality;
      }

      // Country: the strongest signal is the JSON-LD `addressCountry`; fall
      // back to detectCountry() on the location string.
      const country = detail?.country ?? detectCountry(location);

      const workMode = detectWorkMode([location, descriptionText].join(' '));

      const job: RawJob = {
        source,
        externalId: path || p.title || '',
        company: companyName,
        companySlug: tenant,
        title: p.title ?? 'Untitled',
        url: detailsUrl,
        location,
        workMode,
        postedAt,
        descriptionText,
        descriptionHtml,
        applyUrl,
        country,
        requisitionId,
      };
      return job;
    });

    // Attach seniority to every job (cheap pure heuristic — title-based).
    for (const j of jobs) {
      j.seniority = detectSeniority(j.title);
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}

/** Pull the trailing `_JRnnnn` / `_R-123456` requisition suffix out of a
 *  Workday externalPath. Returns null when no recognizable id is embedded. */
function extractReqFromPath(path: string): string | null {
  if (!path) return null;
  // Slug form: "/job/<Loc>/<Title-Slug>_JR11114" or "..._R-243762".
  const m = path.match(/_((?:JR|R-\d+|REQ-\d+|req-\d+)[\w-]*)$/i);
  return m && m[1] ? m[1] : null;
}
