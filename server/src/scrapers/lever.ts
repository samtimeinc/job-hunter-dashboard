import type { JobSource, WorkMode } from '@jobhunt/shared';
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
  /** Authoritative remote/hybrid/onsite tag — set by the employer in Lever.
   *  More reliable than `categories.location` for work mode (e.g. Relay's
   *  "Frontend Developer" posting has location "San Diego, CA" but
   *  workplaceType "remote"). */
  workplaceType?: 'remote' | 'hybrid' | 'onsite';
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
    // Some boards are large enough to trip the default 10s timeout
    // (jobgether had 3.8k postings). Give Lever a 25s ceiling so big boards
    // don't abort and lose every result.
    const data = await fetchJson<LeverResponse>(
      `https://api.lever.co/v0/postings/${companySlug}?mode=json`,
      {},
      25_000,
    );
    const postings = Array.isArray(data) ? data : [];
    const jobs: RawJob[] = postings
      .filter((p) => {
        const haystack = [p.text, p.categories?.team, p.categories?.department]
          .filter(Boolean)
          .join(' ');
        return matchesAny(haystack, keywords);
      })
      .map((p) => {
        // Prefer Lever's structured `workplaceType` over heuristic detection
        // on the location string. detectWorkMode stays as the fallback for
        // any board that hasn't set the field (older postings, etc.).
        const workMode: WorkMode =
          p.workplaceType ?? detectWorkMode(p.categories?.location);
        return {
          source,
          externalId: p.id,
          company: companyName,
          companySlug,
          title: p.text ?? 'Untitled',
          url: p.hostedUrl ?? '',
          location: p.categories?.location ?? null,
          workMode,
          postedAt: p.createdAt ? new Date(p.createdAt) : null,
          tags: [p.categories?.team, p.categories?.department].filter(Boolean) as string[],
        };
      });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
