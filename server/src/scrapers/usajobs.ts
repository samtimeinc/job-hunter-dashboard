import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * USAJOBS — official US federal government job board.
 *
 * API (free tier, developer.usajobs.gov) requires:
 *   - Authorization-Key header (USAJOBS_API_KEY)
 *   - Host: data.usajobs.gov
 *   - User-Agent: <your-email> (their rate-limit policy)
 *
 * Distinctive value: cleared/contractor roles (AWS Federal, Microsoft
 * Federal, Boeing, defense contractors) and genuine SWE roles at agencies
 * like SSA, NASA, GSA that don't appear on any commercial aggregator.
 *
 * Response content-type is `application/hr+json` (not `application/json`),
 * but the body is standard JSON — fetchJson handles it correctly.
 */

const API_BASE = 'https://data.usajobs.gov/api/search';

interface UsaJobsDescriptor {
  PositionID?: string;
  PositionTitle?: string;
  OrganizationName?: string;
  PositionLocationDisplay?: string;
  PositionURI?: string;
  /** USAJOBS wraps HTML content in a UserArea.Details string. */
  UserArea?: { Details?: string };
  PublicationStartDate?: string;
  /** "Yes"/"No" strings for remote/telework eligibility. */
  PositionSchedule?: Array<{ Name?: string }>;
  JobCategory?: Array<{ Name?: string }>;
}

interface UsaJobsResultItem {
  MatchedObjectId?: string;
  MatchedObjectDescriptor?: UsaJobsDescriptor;
}

interface UsaJobsResponse {
  SearchResult?: {
    SearchResultCount?: number;
    SearchResultCountAll?: number;
    SearchResultItems?: UsaJobsResultItem[];
  };
}

/** Strip HTML to plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeUsaJobs(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'usajobs';
  if (!config.keys.usajobsApiKey) {
    return { source, jobs: [], error: 'USAJOBS_API_KEY not configured' };
  }

  try {
    const query = encodeURIComponent(keywords.join(' '));
    const url = `${API_BASE}?Keyword=${query}&ResultsPerPage=50`;
    const data = await fetchJson<UsaJobsResponse>(url, {
      headers: {
        'Authorization-Key': config.keys.usajobsApiKey,
        Host: 'data.usajobs.gov',
        'User-Agent': 'jobhunt-dashboard@github.com',
        Accept: 'application/json',
      },
    });

    const seen = new Set<string>();
    const jobs: RawJob[] = [];
    for (const item of data.SearchResult?.SearchResultItems ?? []) {
      const desc = item.MatchedObjectDescriptor;
      if (!desc) continue;
      const id = desc.PositionID ?? item.MatchedObjectId;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const detailHtml = desc.UserArea?.Details ?? '';
      const detailText = stripTags(detailHtml);

      // Federal job listings include job-category tags (e.g. "Information
      // Technology Management", "2210 series") — these are genuinely useful
      // for relevance and distinct from the generic aggregator tags.
      const categories = (desc.JobCategory ?? []).map((c) => c.Name).filter(Boolean) as string[];

      jobs.push({
        source,
        externalId: id,
        company: desc.OrganizationName ?? 'US Federal Government',
        title: desc.PositionTitle ?? 'Untitled',
        url: desc.PositionURI ?? `https://www.usajobs.gov/job/${id}`,
        location: desc.PositionLocationDisplay ?? null,
        // Federal jobs are mostly onsite (cleared facilities), but some
        // have telework/remote eligibility that USAJOBS signals via
        // PositionSchedule. Fall back to detectWorkMode.
        workMode: detectWorkMode(detailText),
        postedAt: desc.PublicationStartDate ? new Date(desc.PublicationStartDate) : null,
        tags: categories.slice(0, 12),
        descriptionText: detailText || null,
        descriptionHtml: detailHtml || null,
      });
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
