import type { JobSource } from '@jobhunt/shared';
import { matchesAny } from './types.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * Lever Postings API — used by OpenAI and other modern tech companies.
 * Docs: https://github.com/lever/postings-api
 * No key required; board name == company slug.
 */
interface LeverPosting {
  id: string;
  text?: string;
  hostedUrl?: string;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
    department?: string;
  };
  createdAt?: number;
  descriptionPlain?: string;
}

interface LeverResponse extends Array<LeverPosting> {}

export async function scrapeLever(
  companySlug: string,
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'lever';
  try {
    const data = await fetchJson<LeverResponse>(
      `https://api.lever.co/v0/postings/${companySlug}?mode=json`,
    );
    const postings = Array.isArray(data) ? data : [];
    const jobs: RawJob[] = postings
      .filter((p) => {
        const haystack = [p.text, p.categories?.team, p.categories?.department]
          .filter(Boolean)
          .join(' ');
        return matchesAny(haystack, keywords);
      })
      .map((p) => ({
        source,
        externalId: p.id,
        company: companyName,
        companySlug,
        title: p.text ?? 'Untitled',
        url: p.hostedUrl ?? '',
        location: p.categories?.location ?? null,
        workMode: detectWorkMode(p.categories?.location),
        postedAt: p.createdAt ? new Date(p.createdAt) : null,
        tags: [p.categories?.team, p.categories?.department].filter(Boolean) as string[],
      }));
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
