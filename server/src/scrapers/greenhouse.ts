import type { JobSource } from '@jobhunt/shared';
import { matchesAny } from './types.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Greenhouse Job Board API — many tech companies (Stripe, Slack) host here.
 * Docs: https://developers.greenhouse.io/job-board.html
 * No key required; board name == company slug.
 */
interface GreenhouseJob {
  id: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  metadata?: { name: string; value: string }[];
  departments?: { name: string }[];
}

interface GreenhouseBoard {
  jobs?: GreenhouseJob[];
}

export async function scrapeGreenhouse(
  companySlug: string,
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'greenhouse';
  try {
    const data = await fetchJson<GreenhouseBoard>(
      `https://boards-api.greenhouse.io/v1/boards/${companySlug}/jobs?content=true`,
    );
    const jobs: RawJob[] = (data.jobs ?? [])
      .filter((j) => {
        const deptName = j.departments?.map((d) => d.name).join(' / ') ?? '';
        const haystack = [j.title, deptName].filter(Boolean).join(' ');
        // Keywords from settings OR the generic "engineering family" tags that
        // companies use to classify IC-Eng roles (Stripe uses "- Eng" suffix,
        // others use "Engineering" prefixes). This avoids false positives like
        // matching "React" inside a job description and falsely surfacing roles.
        const looksLikeEng =
          /\b(eng(?:ineer(?:ing)?)?|developer|software|backend|frontend|full[- ]?stack|sre|infrastructure)\b/i.test(
            deptName,
          );
        return matchesAny(haystack, keywords) || looksLikeEng;
      })
      .map((j) => ({
        source,
        externalId: String(j.id),
        company: companyName,
        companySlug,
        title: j.title ?? 'Untitled',
        url: j.absolute_url ?? '',
        location: j.location?.name ?? null,
        workMode: detectWorkMode(j.location?.name),
        postedAt: j.updated_at ? new Date(j.updated_at) : null,
        tags:
          j.departments?.map((d) => d.name).filter(Boolean) ??
          j.metadata?.map((m) => m.value).filter(Boolean) ??
          [],
      }));
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
