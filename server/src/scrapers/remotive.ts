import type { JobSource } from '@jobhunt/shared';
import { matchesAny } from './types.js';
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
}

export async function scrapeRemotive(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'remotive';
  try {
    const data = await fetchJson<{ jobs: RemotiveJob[] }>(
      'https://remotive.com/api/remote-jobs?category=software-dev',
    );
    const filtered = (data.jobs ?? []).filter((j) => matchesAny(j.title, keywords));
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
    }));
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
