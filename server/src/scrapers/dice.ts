import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Dice — broad tech-job aggregator (Employer of Record / direct + recruiter
 * postings). Strong coverage of the FAANG / Big Tech target list that the
 * other aggregators miss (Amazon, Google, Microsoft, Starbucks especially).
 *
 * Lives at developer.dice.com. Unlike Adzuna/JSearch which use a static API
 * key, Dice uses OAuth2 client-credentials — we exchange DICE_CLIENT_ID +
 * DICE_CLIENT_SECRET for a short-lived bearer token, then POST to the search
 * endpoint. Requires DICE_CLIENT_ID + DICE_CLIENT_SECRET.
 *
 * Docs (SPA-reacted): https://developer.dice.com/reference
 *
 * Why this matters here: Dice was added 2026-08-07 specifically because the
 * Vercel serverless gating on Playwright removed Amazon's direct listings.
 * Dice surfaces Amazon (and MS/Google/Starbucks) postings via aggregator
 * results, partially closing that gap with no browser binary required.
 */

const TOKEN_ENDPOINT = 'https://eid.dice.com/oauth2/vas/v1/b2b/httpToken';
const SEARCH_ENDPOINT =
  'https://api.dice.com/talentsearch-client-api/apiservice/v1/jobs/search';

interface DiceTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  /** Some Dice responses return a JWT directly. Either is fine for us. */
  id_token?: string;
}

interface DiceSalaryAnnual {
  amount?: number;
  currency?: string;
}
interface DiceSalaryHourly {
  rate?: number;
  currency?: string;
}

interface DiceJobPosting {
  id?: string;
  title?: string;
  company?: string;
  /** Stable details-page link on dice.com. Always public, never expires. */
  detailUrl?: string;
  /** External apply link (employer ATS) — falls back to detailUrl. */
  applyUrl?: string;
  location?: string;
  /** "Remote", "Hybrid", "On-site", or absent. */
  workArrangement?: string;
  description?: string;
  postedDate?: string;
  /** Annual salary object when present. */
  annualSalary?: DiceSalaryAnnual;
  /** Hourly wage object when present. */
  hourlySalary?: DiceSalaryHourly;
  employmentType?: string;
  skills?: string[];
}

interface DiceSearchResponse {
  /** Varies between Dice API versions. We accept several shapes defensively. */
  postings?: DiceJobPosting[];
  jobs?: DiceJobPosting[];
  data?: DiceJobPosting[];
  /** Dice occasionally wraps results under a count envelope. */
  results?: DiceJobPosting[];
}

// ---- OAuth token cache (per-process, ~30 min lifetime) ---------------------
type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

/** Exchange client credentials for a bearer token, cached until ~5 min
 *  before expiry. Returns null if Dice is not configured or auth fails. */
async function getBearerToken(): Promise<string | null> {
  // Refresh if no token, or if we're within 5 minutes of expiry (safety).
  const safetyMarginMs = 5 * 60 * 1000;
  if (tokenCache && tokenCache.expiresAt - safetyMarginMs > Date.now()) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.keys.diceClientId,
    client_secret: config.keys.diceClientSecret,
  });

  try {
    const tokenRes = await fetchJson<DiceTokenResponse>(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const token = tokenRes.access_token ?? tokenRes.id_token;
    const ttlSec = tokenRes.expires_in ?? 1800;
    if (!token) return null;
    tokenCache = { token, expiresAt: Date.now() + ttlSec * 1000 };
    return token;
  } catch {
    // Auth failure — caller surfaces a clean error rather than 500'ing the scan.
    tokenCache = null;
    return null;
  }
}

/** Coerce a salary/wage number into a rounded integer, null if absent/invalid. */
function roundSalary(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/** Normalize Dice's `workArrangement` ("Remote" / "Hybrid" / "On-site") into
 *  our WorkMode union; falls back to free-text detection (description). */
function resolveWorkMode(
  arrangement: string | undefined,
  description: string | undefined,
): ReturnType<typeof detectWorkMode> {
  if (arrangement) {
    const a = arrangement.toLowerCase();
    if (a.includes('remote')) return 'remote';
    if (a.includes('hybrid')) return 'hybrid';
    if (a.includes('on-site') || a.includes('onsite')) return 'onsite';
  }
  return detectWorkMode(description);
}

/** Dice postings can sit under `postings`, `jobs`, `data`, or `results`
 *  depending on API version. Unify them defensively. */
function extractJobs(body: DiceSearchResponse): DiceJobPosting[] {
  return body.postings ?? body.jobs ?? body.data ?? body.results ?? [];
}

/** Build the POST body Dice's search endpoint expects. We lean on the
 *  `q` keyword query (matching how the other aggregators keyword-match)
 *  plus a US-only region filter. Pagination via `from`. */
function buildSearchBody(keywords: string[], from: number): URLSearchParams {
  const params = new URLSearchParams();
  // Dice treats `q` as a free-text relevance query — joining keywords with
  // a space is what their search UI does too. We don't AND terms because
  // that narrows too aggressively for the dashboard's discovery purpose.
  params.set('q', keywords.join(' '));
  params.set('countryCode', 'US');
  params.set('from', String(from));
  params.set('size', '50');
  // Only freshly-posted jobs keep the dashboard useful — 14 days matches
  // postedWithinDays default of JSearch and avoids flooding with stale roles.
  params.set('postedDateRange', '14');
  return params;
}

export async function scrapeDice(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'dice';
  if (!config.keys.diceClientId || !config.keys.diceClientSecret) {
    return { source, jobs: [], error: 'DICE_CLIENT_ID/DICE_CLIENT_SECRET not configured' };
  }

  try {
    const token = await getBearerToken();
    if (!token) {
      return { source, jobs: [], error: 'Dice OAuth token request failed' };
    }

    // Pull a single page (50 jobs) per scan to match the aggregator cadence
    // (Adzuna/JSearch both fetch one page). Dice's relevance ranking surfaces
    // the freshest matching postings first.
    const body = buildSearchBody(keywords, 0);
    const data = await fetchJson<DiceSearchResponse>(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const seen = new Set<string>();
    const jobs: RawJob[] = [];
    for (const r of extractJobs(data)) {
      // Dice's id is the only truly-stable identifier; without it we can't
      // dedupe across scans, so skip rather than risk double-inserts.
      const id = r.id ?? r.detailUrl;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      // Prefer Dice's stable detailUrl as the canonical `url` (always public,
      // never expires, mirroring the Adzuna fix). Use the external applyUrl
      // only when Dice provides one distinct from the detail page.
      const url = r.detailUrl ?? r.applyUrl ?? '';
      const applyUrl = r.applyUrl && r.applyUrl !== url ? r.applyUrl : null;

      // Salary object shape varies: annual jobs return annualSalary with
      // `amount`; hourly/contract roles return hourlySalary with `rate`.
      let salaryMin: number | null = null;
      let salaryMax: number | null = null;
      let salaryPeriod: 'year' | 'hour' | null = null;
      let salaryCurrency: string | null = null;

      if (r.annualSalary) {
        // Dice returns a single amount, not a range; treat as both min & max.
        salaryMin = roundSalary(r.annualSalary.amount);
        salaryMax = salaryMin;
        salaryPeriod = 'year';
        salaryCurrency = r.annualSalary.currency ?? null;
      } else if (r.hourlySalary) {
        salaryMin = roundSalary(r.hourlySalary.rate);
        salaryMax = salaryMin;
        salaryPeriod = 'hour';
        salaryCurrency = r.hourlySalary.currency ?? null;
      }

      const desc =
        typeof r.description === 'string' && r.description.trim()
          ? r.description.trim()
          : null;

      jobs.push({
        source,
        externalId: id,
        company: r.company ?? 'Unknown',
        title: r.title ?? 'Untitled',
        url,
        location: r.location ?? null,
        workMode: resolveWorkMode(r.workArrangement, r.description),
        salaryMin,
        salaryMax,
        salaryCurrency,
        salaryPeriod,
        postedAt: r.postedDate ? new Date(r.postedDate) : null,
        // Dice exposes posted skills as an array — keep them as tags so the
        // dashboard's keyword highlight + filter continue to work.
        tags: (r.skills ?? []).slice(0, 12),
        descriptionText: desc,
        applyUrl,
      });
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
