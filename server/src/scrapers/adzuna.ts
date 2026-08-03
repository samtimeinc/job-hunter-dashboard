import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Adzuna — free-tier aggregator with structured salary data.
 * Docs: https://developer.adzuna.com/
 * Requires ADZUNA_APP_ID + ADZUNA_API_KEY.
 */
interface AdzunaResult {
  results?: {
    id: string;
    title?: string;
    company?: { display_name?: string };
    /** Adzuna tracking link — redirects through Adzuna and often expires
     *  to the homepage when opened outside the API session. Avoid. */
    url?: string;
    /** Direct link to the employer's original job posting. Prefer this. */
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
    locations.length > 0
      ? locations.filter((l) => !/^remote|united states|usa$/i.test(l))
      : [];

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
          // Prefer redirect_url (direct employer link); fall back to the
          // tracking `url` only when Adzuna omits redirect_url. The tracker
          // link expires to the Adzuna homepage, which is the "apply links
          // go home" bug.
          url: r.redirect_url || r.url || '',
          location: r.location?.display_name ?? null,
          workMode: detectWorkMode(
            [r.description, r.location?.area?.join(', ')].join(' '),
          ),
          // Adzuna returns floats ($96330.49); round to whole dollars
          // to match the integer column type.
          salaryMin: roundSalary(r.salary_min),
          salaryMax: roundSalary(r.salary_max),
          salaryCurrency: 'USD',
          salaryPeriod: 'year',
          postedAt: r.created ? new Date(r.created) : null,
        });
      }
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
