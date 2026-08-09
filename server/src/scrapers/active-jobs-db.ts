import type { JobSource, WorkMode } from '@jobhunt/shared';
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
 * Active Jobs DB by Fantastic.Jobs via RapidAPI — hourly-refreshed index of
 * jobs from 200k+ company career pages and 55+ ATS platforms (Workday,
 * Greenhouse, Lever, Ashby, iCIMS, SuccessFactors, …) plus LinkedIn,
 * Wellfound, and Y Combinator. Each job is AI-enriched with salary /
 * work-arrangement / seniority / skills.
 *
 * Docs:    https://developer.fantastic.jobs/documentation/how-fantastic-jobs-api-works
 * Catalog: https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/active-jobs-db
 * Sample:  https://files.fantastic.jobs/sample-ats.json
 *
 * Endpoint (RapidAPI):
 *   GET https://active-jobs-db.p.rapidapi.com/active-ats
 *
 * Why this source (replaces JSearch 2026-08-07): JSearch is a real-time
 * scraper of Google for Jobs / LinkedIn, so when its upstream hiccups the
 * whole API silently returns `{"jobs":[]}` for every query. Active Jobs DB
 * is an hourly-refreshed DATABASE — requests hit a pre-built index instead
 * of triggering a live scrape, so it's far more reliable (100% listed
 * uptime vs JSearch's 99%, ~90 ms vs ~870 ms latency).
 *
 * Requires RAPIDAPI_KEY with an Active Jobs DB subscription.
 */
interface ActiveJobsDbSalary {
  value?: number | null;
  min_value?: number | null;
  max_value?: number | null;
  currency?: string | null;
  unit_text?: string | null;
}

interface ActiveJobsDbJob {
  /** Stable source id (numeric string). */
  id?: string;
  /** ISO datetime, e.g. "2026-08-08T01:30:25" (no tz — interpreted as UTC). */
  date_posted?: string | null;
  title?: string;
  organization?: string;
  /** Company website. Often empty in ATS-sourced rows. */
  organization_url?: string;
  /** Canonical apply/details URL on the ATS. */
  url?: string;
  /** ATS name, e.g. "greenhouse", "lever", "workday". */
  source?: string;
  /** ATS host (e.g. "ebxr.fa.us2.oraclecloud.com") — NOT the company domain. */
  source_domain?: string;
  /** AI-derived company root domain (e.g. "stripe.com"). Populated for
   *  ~100% of rows per the sample dataset — far more reliable than
   *  organisation_url which is empty for ~80% of ATS-sourced jobs. */
  domain_derived?: string | null;
  /** Plain string (e.g. "Remote") — fallback for work arrangement. */
  location_type?: string | null;
  /** Fully-qualified location strings, e.g. ["New York, New York, United States"]. */
  locations_derived?: string[];
  /** AI-derived salary — populated even when raw `salary` is missing. */
  ai_salary_min_value?: number | null;
  ai_salary_max_value?: number | null;
  ai_salary_currency?: string | null;
  /** "YEAR" | "HOUR" | "MONTH" | etc. */
  ai_salary_unit_text?: string | null;
  /** "Remote" | "Hybrid" | "On-site" | null. Highest-signal work-mode field. */
  ai_work_arrangement?: string | null;
  /** Plain-text description. Returned when `description_format=text` is set
   *  on the request (which the scraper always does). */
  description_text?: string;
  /** Raw salary struct — preferred over the ai_* fields when present. */
  salary?: ActiveJobsDbSalary | null;
}

type ActiveJobsDbResponse = ActiveJobsDbJob[];

/** Map "Remote" / "Hybrid" / "On-site" → our WorkMode. */
function mapWorkMode(arr: string | null | undefined, locText: string): WorkMode {
  if (arr) {
    const a = arr.toLowerCase();
    if (a.includes('remote')) return 'remote';
    if (a.includes('hybrid')) return 'hybrid';
    if (a.includes('on-site') || a.includes('onsite') || a.includes('office')) return 'onsite';
  }
  return detectWorkMode(locText);
}

/** Coerce to whole-number; null if not finite. */
function roundSalary(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/**
 * Parse Active Jobs DB's `date_posted` defensively. The field is usually a
 * bare "YYYY-MM-DDTHH:mm:ss" (no tz — interpreted as UTC) but occasionally
 * arrives with milliseconds and/or a trailing `Z`. Normalise to a UTC Date
 * and verify it's valid; return null on anything unparseable so the upsert
 * layer never receives an `Invalid Date` (Drizzle throws `RangeError:
 * Invalid time value` on `toISOString()` of one).
 */
function parsePostedAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // Ensure UTC: if it has no tz, append Z. If it already ends in Z, leave it.
  const normalised = /[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Map "HOUR" → "hour" (our schema); anything else → "year". */
function mapSalaryUnit(unit: string | null | undefined): 'hour' | 'year' {
  return unit?.toLowerCase().startsWith('hour') ? 'hour' : 'year';
}

export async function scrapeActiveJobsDb(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'active-jobs-db';
  if (!config.keys.activeJobsDbRapidApiKey) {
    return { source, jobs: [], error: 'RAPIDAPI_KEY not configured (Active Jobs DB)' };
  }

  try {
    // Title filter — OR-across-keywords. The user's keyword list represents
    // ALTERNATIVE search intentions (e.g. they want React jobs OR Node jobs
    // OR TypeScript jobs), not one hybrid role. The API title-param does
    // AND-across-quoted-tokens, so `"React" "Node" "TypeScript"` would match
    // zero jobs (no title literally contains all three). Wrap each in quotes
    // and join with ` OR ` so we get the union. Cap at 10 keywords — keeps
    // the URL well under common length limits while accommodating a realistic
    // long-tail of synonyms (React, JavaScript, frontend, …).
    //
    // Verified against the live API 2026-08-07:
    //   `"React"`            → 33 jobs/7d
    //   `"React" "Node"`     →  1   (AND — almost nothing matches)
    //   `"React" OR "Node"`  → broad union (the intent)
    const cleanedKw = keywords.map((k) => k.replace(/"/g, '')).slice(0, 10);
    const titleExpr = cleanedKw.length
      ? cleanedKw.map((k) => `"${k}"`).join(' OR ')
      : '';
    const url = new URL('https://active-jobs-db.p.rapidapi.com/active-ats');
    url.searchParams.set('title', titleExpr);
    url.searchParams.set('location', '"United States"');
    url.searchParams.set('description_format', 'text');
    // `time_frame` accepts ONLY: 1h, 24h, 7d, 6m. We use 24h — the BASIC
    // (free) RapidAPI plan caps at 250 jobs/month, so a wider window blows
    // the quota in a single scan. 24h keeps each scan to ~5–10 jobs, leaving
    // headroom for daily runs. Bump to `7d` once on a Pro plan.
    url.searchParams.set('time_frame', '24h');
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', '0');

    const data = await fetchJson<ActiveJobsDbResponse>(url.toString(), {
      headers: {
        'X-RapidAPI-Key': config.keys.activeJobsDbRapidApiKey,
        'X-RapidAPI-Host': 'active-jobs-db.p.rapidapi.com',
      },
    });

    const list = Array.isArray(data) ? data : [];

    const jobs: RawJob[] = list.map((r) => {
      const locText = (r.locations_derived ?? []).join(', ');
      const salary = r.salary ?? {};
      const salaryMin = roundSalary(salary.min_value ?? r.ai_salary_min_value);
      const salaryMax = roundSalary(salary.max_value ?? r.ai_salary_max_value);
      const salaryCurrency = salary.currency ?? r.ai_salary_currency ?? null;
      const salaryUnit = mapSalaryUnit(salary.unit_text ?? r.ai_salary_unit_text);
      const desc =
        typeof r.description_text === 'string' && r.description_text.trim()
          ? r.description_text.trim()
          : null;
      return {
        source,
        externalId: r.id ?? r.url ?? '',
        company: r.organization ?? 'Unknown',
        title: r.title ?? 'Untitled',
        url: r.url ?? '',
        location: locText || r.location_type || null,
        workMode: mapWorkMode(r.ai_work_arrangement, locText),
        salaryMin,
        salaryMax,
        salaryCurrency,
        salaryPeriod: salaryUnit,
        // `date_posted` is usually "YYYY-MM-DDTHH:mm:ss" (no tz) but can also
        // arrive with milliseconds and/or a trailing Z. Parse defensively:
        // strip a trailing Z (we'll re-add it), then validate the result is a
        // real Date — falls back to null if not, so we never hand an Invalid
        // Date to Drizzle (which throws RangeError on toISOString).
        postedAt: parsePostedAt(r.date_posted),
        // We request `description_format=text` so the API returns a pre-stripped
        // plain-text body (no HTML to preserve).
        descriptionText: desc,
        // The canonical `url` is the ATS apply/details page — surface it as
        // applyUrl so the agent API can show "hasApplyUrl=true" when the source
        // gave us a real destination (Active Jobs DB always does).
        applyUrl: r.url ?? null,
        // Prefer the provider's AI-derived root domain (~100% coverage per
        // the sample dataset) over organisation_url which is empty for ~80%
        // of ATS-sourced rows.
        companyDomain: r.domain_derived ?? null,
        // Provider row id is the canonical requisition id for this source.
        requisitionId: r.id ?? null,
        // locations_derived is "City, State, Country" — detectCountry picks
        // up the trailing country reliably.
        country: detectCountry(locText),
        seniority: detectSeniority(r.title),
      };
    });

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
