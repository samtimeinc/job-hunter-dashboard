import type { JobSource, WorkMode } from '@jobhunt/shared';
import { matchesAny } from './types.js';
import { fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Ashby job-board API — used by OpenAI, Anthropic, Notion, Linear, etc.
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/{slug}
 * Docs (community): the response shape below is what their hosted widget queries.
 * No key required; board "slug" == the company name on jobs.ashbyhq.com.
 */
interface AshbyPosting {
  id: string;
  title?: string;
  department?: string;
  team?: string;
  location?: string;
  publishedAt?: string;
  isRemote?: boolean | null;
  /** Ashby uses free-text values like "Remote", "Hybrid", "On-Site". */
  workplaceType?: string | null;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  secondaryLocations?: { name?: string }[];
}

interface AshbyResponse {
  jobs?: AshbyPosting[];
}

/** Normalise Ashby's free-text workplaceType to our WorkMode enum. */
function coerceWorkMode(value: string | null | undefined): WorkMode {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v.includes('remote')) return 'remote';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('on-site') || v.includes('onsite')) return 'onsite';
  return 'unknown';
}

export async function scrapeAshby(
  slug: string,
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'ashby';
  try {
    const data = await fetchJson<AshbyResponse>(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?limit=200`,
      // Ashby returns a large payload; bump the timeout.
      {},
      20_000,
    );
    const jobs: RawJob[] = (data.jobs ?? [])
      .filter((p) => {
        const haystack = [p.title, p.department, p.team].filter(Boolean).join(' ');
        const looksLikeEng =
          /\b(eng(?:ineer(?:ing)?)?|developer|software|backend|frontend|full[- ]?stack|sre|infrastructure)\b/i.test(
            `${p.title} ${p.department ?? ''}`,
          );
        return matchesAny(haystack, keywords) || looksLikeEng;
      })
      .map((p) => {
        const tags = [p.department, p.team].filter(Boolean) as string[];
        return {
          source,
          externalId: p.id,
          company: companyName,
          companySlug: slug,
          title: p.title ?? 'Untitled',
          url: p.jobUrl ?? p.applyUrl ?? '',
          location: p.location ?? null,
          workMode: p.isRemote
            ? 'remote'
            : coerceWorkMode(p.workplaceType),
          postedAt: p.publishedAt ? new Date(p.publishedAt) : null,
          tags,
        };
      });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
