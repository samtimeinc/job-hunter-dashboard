import type { JobSource } from '@jobhunt/shared';
import {
  detectCountry,
  matchesAny,
  detectSeniority,
} from './types.js';
import { fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Remotive — free remote-jobs API, no key.
 * Docs: https://remotive.com/api-documentation
 * Always remote. We filter by our keywords list.
 */
interface RemotiveJob {
  id: number;
  title: string;
  company_name: string;
  url: string;
  candidate_required_location?: string;
  salary?: string;
  publication_date?: string;
  tags?: string[];
  /** Plain-text job description (HTML-stripped by Remotive). */
  description?: string;
}

export async function scrapeRemotive(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'remotive';
  try {
    const data = await fetchJson<{ jobs: RemotiveJob[] }>(
      'https://remotive.com/api/remote-jobs?category=software-dev',
    );
    // Search across title AND tags. Remotive tags carry the tech stack
    // (e.g. ["react","typescript","node"]) — title-only filtering was
    // rejecting every generic-role posting ("Senior Frontend Engineer"),
    // which is exactly why Remotive always returned 0 jobs.
    const filtered = (data.jobs ?? []).filter((j) => {
      const haystack = [j.title, ...(j.tags ?? [])].join(' ');
      return matchesAny(haystack, keywords);
    });
    const jobs: RawJob[] = filtered.map((j) => ({
      source,
      externalId: String(j.id),
      company: j.company_name,
      title: j.title,
      url: j.url,
      location: j.candidate_required_location ?? 'Remote',
      workMode: 'remote' as const,
      postedAt: j.publication_date ? new Date(j.publication_date) : null,
      tags: j.tags ?? [],
      // Remotive rarely exposes structured salary — honour the "N/A when not posted" rule.
      // Remotive's `url` is the apply page (a stable Remotive-hosted details/apply page).
      applyUrl: j.url ?? null,
      requisitionId: j.id != null ? String(j.id) : null,
      descriptionText: j.description?.trim() || null,
      // candidate_required_location is a region/country free-text — country may
      // resolve when it explicitly states one ("USA Only", "Americas Only"
      // remain null since "Americas" isn't a country).
      country: detectCountry(j.candidate_required_location),
      seniority: detectSeniority(j.title),
    }));
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
