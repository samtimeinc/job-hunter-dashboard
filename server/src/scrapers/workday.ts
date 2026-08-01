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
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appliedFacets: {},
        limit: 50,
        offset: 0,
        searchText: keywords.join(' '),
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as WorkdayResponse;

    const jobs: RawJob[] = (data.jobPostings ?? [])
      .filter((p) => matchesAny(p.title ?? '', keywords))
      .map((p) => ({
        source,
        externalId: p.externalPath ?? p.title ?? '',
        company: companyName,
        companySlug: tenant,
        title: p.title ?? 'Untitled',
        url: p.externalUrl ?? (p.externalPath ? `${host}${p.externalPath}` : ''),
        location: p.locationsText ?? null,
        workMode: detectWorkMode([p.locationsText, p.description].join(' ')),
        postedAt: p.postedOn ? new Date(p.postedOn) : null,
      }));
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
