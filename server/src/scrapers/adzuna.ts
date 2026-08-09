import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import {
  detectCountry,
  detectSeniority,
  detectWorkMode,
  fetchJson,
  type RawJob,
  type ScraperResult,
} from './types.js';

/**
 * Adzuna — free-tier aggregator with structured salary data.
 * Docs: https://developer.adzuna.com/
 * Requires ADZUNA_APP_ID + ADZUNA_API_KEY.
 */
interface AdzunaResult {
  results?: {
    id: string;
    title?: string;
    company?: { display_name?: string; website_url?: string };
    /** Adzuna tracking link — redirects through Adzuna and often expires
     *  to the homepage when opened outside the API session. Avoid. */
    url?: string;
    /** Direct link to the employer's original job posting. Prefer this.
     *  If both redirect_url and url are missing, we'll construct a fallback
     *  using the Adzuna search results page with the job ID as a query param,
     *  though this is less reliable than direct links. */
    redirect_url?: string;
    location?: { display_name?: string; area?: string[] };
    description?: string;
    salary_min?: number;
    salary_max?: number;
    salary_is_predicted?: string;
    created?: string;
    contract_time?: string;
  }[];
}

/** Coerce floats to whole-dollar integers; null if not a real number. */
function roundSalary(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/**
 * Extract the best candidate application URL from a job's description text.
 * Looks for explicit "apply at" / "apply here" anchors first, then any
 * raw http(s) URL that is NOT obviously a generic webmail/social link that
 * usually appears in boilerplate ("contact us at", footers, etc.).
 *
 * Returns the first plausible URL or null if none found.
 */
function extractApplyUrlFromDescription(html: string | undefined): string | null {
  if (!html) return null;
  const urlRegex = /https?:\/\/[^\s"'<>()]+/gi;
  const matches = html.match(urlRegex) ?? [];
  if (matches.length === 0) return null;

  // Domains we never want to surface as "apply" links.
  const blocked = [
    'linkedin.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'youtube.com',
    'wikipedia.org',
    'adzuna.com',
    'google.com/mail',
    'gmail.com',
    'outlook.com',
    'yahoo.com',
  ];

  const candidates = matches.filter((u) => {
    const lower = u.toLowerCase();
    return !blocked.some((b) => lower.includes(b));
  });
  if (candidates.length === 0) return null;

  // Prefer URLs that appear right after an "apply" cue in the source text.
  const anchor = html.toLowerCase().indexOf('apply');
  if (anchor !== -1) {
    const tail = html.slice(anchor);
    const anchorMatch = tail.match(urlRegex);
    if (anchorMatch && anchorMatch[0]) return anchorMatch[0];
  }
  // Otherwise return the first non-blocked candidate.
  return candidates[0] ?? null;
}

/**
 * Normalise a company website URL to a root domain we can use to construct
 * a likely `/careers` path. Falls back to deriving a domain from company name.
 */
function deriveCompanyDomain(
  website: string | undefined,
  companyName: string | undefined,
): string | null {
  if (website) {
    try {
      const u = new URL(website);
      return u.hostname.replace(/^www\./, '');
    } catch {
      /* fall through to name-based guess */
    }
  }
  if (companyName) {
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
    if (slug && slug.length > 1) return `${slug}.com`;
  }
  return null;
}

/**
 * Resolve the best URL for an Adzuna job.
 *
 * IMPORTANT CONTEXT (verified 2026-08-05):
 *   Adzuna's API returns two URL-like fields — `url` and `redirect_url`. Both
 *   are Adzuna-hosted trackers that **expire to the homepage when opened
 *   outside the API session**. When surfaced in the dashboard, clicking
 *   "Apply" bounces users to Adzuna's homepage for live jobs (e.g. F5
 *   Networks AI Engineer, id `5815340039`). So neither field is safe to use
 *   as the primary link.
 *
 *   What IS stable and public is the Adzuna details page at
 *   `https://www.adzuna.com/details/{id}` — a real, browseable job page that
 *   never expires. So that becomes the primary URL.
 *
 * Priority order:
 *   1. Adzuna details page built from the job id (stable + always present)
 *   2. Company website from Adzuna's `company.website_url` field
 *   3. Company domain derived from the company name (best-effort `name.com`)
 *   4. Adzuna search results page scoped to the job title
 *   5. URL extracted from the job description (only if no id present)
 */
function buildJobUrl(
  job: {
    id: string;
    title?: string;
    company?: { display_name?: string; website_url?: string };
  },
  description?: string,
): string {
  // 1. Adzuna details page — stable, public, never expires.
  if (job.id) return `https://www.adzuna.com/details/${job.id}`;

  // 2 / 3. No id? Fall back to the company website, then a name-derived domain.
  const domain = deriveCompanyDomain(job.company?.website_url, job.company?.display_name);
  if (domain) return `https://${domain}`;

  // 4. No company info? Try extracting an apply URL from the description.
  const fromDescription = extractApplyUrlFromDescription(description);
  if (fromDescription) return fromDescription;

  // 5. Last resort: Adzuna search page scoped to the job title.
  return `https://www.adzuna.com/au/search-jobs?ca=us&kw=${encodeURIComponent(job.title ?? '')}&refid=ads${job.id ? `&aid=${job.id}` : ''}`;
}

export async function scrapeAdzuna(
  keywords: string[],
  locations: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'adzuna';
  if (!config.keys.adzunaAppId || !config.keys.adzunaApiKey) {
    return { source, jobs: [], error: 'ADZUNA_APP_ID/ADZUNA_API_KEY not configured' };
  }

  // `where` only accepts a single location token, so query each locality in
  // parallel and dedupe by job id afterwards. Skip "Remote" / "United States"
  // — Adzuna's `where` is geo-only; remote roles surface via the keyword.
  const geoLocations =
    locations.length > 0 ? locations.filter((l) => !/^remote|united states|usa$/i.test(l)) : [];

  try {
    const queries = geoLocations.length ? geoLocations : [''];
    const perLocation = await Promise.all(
      queries.map(async (loc) => {
        const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
        url.searchParams.set('app_id', config.keys.adzunaAppId);
        url.searchParams.set('app_key', config.keys.adzunaApiKey);
        url.searchParams.set('results_per_page', '50');
        url.searchParams.set('what', keywords.join(' '));
        url.searchParams.set('content-type', 'application/json');
        if (loc) url.searchParams.set('where', loc);
        return fetchJson<AdzunaResult>(url.toString());
      }),
    );

    const seen = new Set<string>();
    const jobs: RawJob[] = [];
    for (const data of perLocation) {
      for (const r of data.results ?? []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        jobs.push({
          source,
          externalId: r.id,
          company: r.company?.display_name ?? 'Unknown',
          title: r.title ?? 'Untitled',
          // CRITICAL: Adzuna's `url` and `redirect_url` are tracker links
          // that expire to the homepage outside the API session (verified
          // 2026-08-05: F5 Networks AI Engineer id 5815340039). Always use
          // the stable details page built from the job id instead.
          // buildJobUrl() resolves in this priority: details page → company
          // website → name-derived domain → description URL → search page.
          url: buildJobUrl(
            {
              id: r.id,
              title: r.title,
              company: r.company
                ? {
                    display_name: r.company.display_name,
                    website_url: r.company.website_url,
                  }
                : undefined,
            },
            r.description,
          ),
          // Surface the original tracker URL as a secondary applyUrl in case
          // downstream code (UI or stats) wants to try the tracker too. It
          // often expires but costs nothing to store.
          applyUrl: r.redirect_url || r.url || undefined,
          location: r.location?.display_name ?? null,
          workMode: detectWorkMode([r.description, r.location?.area?.join(', ')].join(' ')),
          // Adzuna returns plain-text descriptions — preserve them verbatim so
          // downstream consumers (agent API) get the full posting without an
          // extra HTTP round-trip. Null when the source omitted the field.
          descriptionText:
            typeof r.description === 'string' && r.description.trim() ? r.description.trim() : null,
          // Adzuna returns floats ($96330.49); round to whole dollars
          // to match the integer column type.
          salaryMin: roundSalary(r.salary_min),
          salaryMax: roundSalary(r.salary_max),
          salaryCurrency: 'USD',
          salaryPeriod: 'year',
          postedAt: r.created ? new Date(r.created) : null,
          // Surface the company website (when provided) so downstream code
          // can construct /careers links in the UI if the main url falls back
          // to a search page.
          companyDomain:
            deriveCompanyDomain(r.company?.website_url, r.company?.display_name) ?? undefined,
          // Adzuna is queried against the US endpoint (`/jobs/us/search`), so
          // we know the country up front even when the free-text location
          // doesn't restate it.
          country: detectCountry(r.location?.display_name) ?? 'US',
          requisitionId: r.id ?? null,
          seniority: detectSeniority(r.title),
        });
      }
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
