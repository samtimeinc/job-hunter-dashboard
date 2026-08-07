import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * JSearch via RapidAPI — broad aggregator that surfaces LinkedIn-sourced posts.
 * Docs: https://rapidapi.com/letscrape-f6mXWxLQV4u/api/jsearch4
 * Eating the LinkedIn ToS by going through this aggregator instead of scraping
 * LinkedIn directly.
 * Requires JSEARCH_RAPIDAPI_KEY.
 */
interface JSearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  employer_website?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_description?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
  job_posted_at_datetime_utc?: string;
}

interface JSearchResult {
  status?: string;
  data?: {
    jobs?: JSearchJob[];
  };
}

/** Coerce floats to whole-number integers; null if not a real number. */
function roundSalary(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/** Normalise a company website URL to a root domain (e.g. "stripe.com").
 *  Returns null when nothing useful can be derived. */
function deriveCompanyDomain(website: string | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(website);
    const host = u.hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export async function scrapeJSearch(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'jsearch';
  if (!config.keys.jsearchRapidApiKey) {
    return { source, jobs: [], error: 'JSEARCH_RAPIDAPI_KEY not configured' };
  }

  try {
    const query = encodeURIComponent(keywords.join(' '));
    const url = `https://jsearch.p.rapidapi.com/search-v2?query=${query}&num_pages=1&date_filter=14days&country=us`;
    const data = await fetchJson<JSearchResult>(url, {
      headers: {
        'X-RapidAPI-Key': config.keys.jsearchRapidApiKey,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
    });

    const jobs: RawJob[] = (data.data?.jobs ?? []).map((r) => {
      const loc = [r.job_city, r.job_state, r.job_country].filter(Boolean).join(', ');
      const period = r.job_salary_period === 'hourly' ? 'hour' : 'year';
      const desc =
        typeof r.job_description === 'string' && r.job_description.trim()
          ? r.job_description.trim()
          : null;
      const domain = r.employer_website ? deriveCompanyDomain(r.employer_website) : null;
      return {
        source,
        externalId: r.job_id ?? r.job_google_link ?? '',
        company: r.employer_name ?? 'Unknown',
        title: r.job_title ?? 'Untitled',
        url: r.job_apply_link ?? r.job_google_link ?? '',
        location: loc || null,
        workMode: r.job_is_remote ? 'remote' : detectWorkMode(r.job_description),
        salaryMin: roundSalary(r.job_min_salary),
        salaryMax: roundSalary(r.job_max_salary),
        salaryCurrency: r.job_salary_currency ?? null,
        salaryPeriod: period,
        postedAt: r.job_posted_at_datetime_utc ? new Date(r.job_posted_at_datetime_utc) : null,
        // Preserve the source description verbatim (plain text) and the
        // apply link when it differs from the canonical url we picked above.
        descriptionText: desc,
        applyUrl: r.job_apply_link ? r.job_apply_link : null,
        companyDomain: domain,
      };
    });

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
