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
  /** Full HTML description — only present when `?content=true` is requested.
   *  Many boards (Figma, Robinhood) bury the only "remote" / "hybrid" mention
   *  in this body text instead of in `location.name`, so we sniff it for the
   *  work-mode keyword as a fallback. */
  content?: string;
}

interface GreenhouseBoard {
  jobs?: GreenhouseJob[];
}

/** Strip HTML tags so a work-mode regex hits plain text only. */
function stripTags(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
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
      .map((j) => {
        // Greenhouse exposes no structured `workplaceType` field — `location.name`
        // is the only first-class location data. But many boards (Figma,
        // Robinhood) put location.name = "Berlin, Germany" (the office) while
        // the job is actually remote/hybrid, with that detail only mentioned
        // in the description body. Sniff title + description as a fallback.
        const locationName = j.location?.name ?? null;
        const seen = detectWorkMode(locationName);
        const workMode =
          seen !== 'unknown'
            ? seen
            : detectWorkMode(
                [j.title, stripTags(j.content)].filter(Boolean).join(' '),
              );
        return {
          source,
          externalId: String(j.id),
          company: companyName,
          companySlug,
          title: j.title ?? 'Untitled',
          url: j.absolute_url ?? '',
          location: locationName,
          workMode,
          postedAt: j.updated_at ? new Date(j.updated_at) : null,
          tags:
            j.departments?.map((d) => d.name).filter(Boolean) ??
            j.metadata?.map((m) => m.value).filter(Boolean) ??
            [],
        };
      });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
