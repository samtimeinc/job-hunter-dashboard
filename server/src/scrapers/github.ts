import type { JobSource, WorkMode } from '@jobhunt/shared';
import { matchesAny } from './types.js';
import { detectWorkMode, fetchJson, type RawJob, type ScraperResult } from './types.js';

/**
 * GitHub careers JSON API — iCIMS-backed (`window._jibe`), exposed at:
 *   https://www.github.careers/api/jobs?limit=100
 * No key, no auth, plain JSON. Verified live 2026-08-04: 74 postings, every
 * field below present on 100% of records.
 *
 * The board is a single tenant (`client_code: 'githubinc'`), so unlike
 * Greenhouse/Lever there's no per-company slug — every record returned here
 * belongs to GitHub. Backend (Ruby/Rails) roles dominate, but
 * `employment_type` + `category` let us surface frontend/Node roles too.
 *
 * Endpoint shape (top-level):
 *   { jobs: [{ data: GitHubJob }], totalCount, count, locations, filter }
 *
 * The `/api/jobs/search?query=` path returns HTML, not JSON — do not use it.
 * We fetch the full board (limit=100 → all current postings) and filter
 * locally with `matchesAny`, mirroring how greenhouse.ts stays job-board
 * stable across schema drift.
 */
interface GitHubJob {
  /** Stable id used for dedup alongside `source: 'github'`. Same as req_id. */
  slug: string;
  req_id?: string;
  title?: string;
  /** HTML; safe to ignore — keyword match against title + category is enough. */
  description?: string;
  /** e.g. "Remote - United States", "San Francisco, CA". Always populated. */
  full_location?: string;
  short_location?: string;
  location_name?: string;
  /** "On-site" | "Remote" | "Hybrid" (iCIMS workplace type). ~100% populated. */
  location_type?: string;
  country?: string;
  /** Department group e.g. "Engineering". */
  department?: string;
  /** Secondary category e.g. "Software Engineering". */
  category?: string;
  employment_type?: string;
  /** ISO date string, e.g. "2026-07-14T18:21:55.595Z". */
  posted_date?: string;
  apply_url?: string;
  /** Tag arrays populated inconsistently — folded into tags if present. */
  tags2?: string[];
  tags3?: string[];
}

interface GitHubJobsResponse {
  jobs?: { data: GitHubJob }[];
  totalCount?: number;
  count?: number;
}

/** Map iCIMS `location_type` strings to our WorkMode enum.
 *
 * NB: GitHub uses `"ANY"` (anywhere within a country) for every posting —
 * that does NOT mean globally remote (the `short_location` is "United
 * States" / "India" / etc.). So "ANY" → 'unknown', not 'remote', and we
 * let `detectWorkMode` sniff the location free-text for an explicit
 * "Remote" / "Hybrid" keyword as the real signal. */
function coerceWorkMode(value: string | null | undefined): WorkMode {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v === 'any') return 'unknown'; // See note above.
  if (v.includes('remote')) return 'remote';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('on-site') || v.includes('onsite') || v.includes('in-office')) {
    return 'onsite';
  }
  return 'unknown';
}

export async function scrapeGitHub(
  companyName: string,
  keywords: string[],
): Promise<ScraperResult> {
  const source: JobSource = 'github';
  try {
    const data = await fetchJson<GitHubJobsResponse>(
      'https://www.github.careers/api/jobs?limit=100',
    );
    const postings = data.jobs?.map((j) => j.data) ?? [];

    const jobs: RawJob[] = postings
      .filter((p) => {
        // GitHub posts generic titles ("Software Engineer", "Staff") with no
        // tech-stack words anywhere in title/department/category. The
        // department field is universally blank — only `category` is set
        // ("Engineering" / "Sales" / "Design" / "Product" / "Security").
        // Mirror greenhouse.ts: pass through anything in the engineering
        // family so the user's React/Node/TypeScript net catches GitHub's
        // generic eng postings, then narrowed by the user's keywords OR.
        const haystack = [p.title, p.category, p.department].filter(Boolean).join(' ');
        const looksLikeEng =
          /\b(eng(?:ineer(?:ing)?)?|developer|software|backend|frontend|full[- ]?stack|sre|infrastructure|web|services|platform)\b/i.test(
            [p.category, p.department, p.title].filter(Boolean).join(' '),
          );
        return matchesAny(haystack, keywords) || looksLikeEng;
      })
      .map((p) => {
        // iCIMS returns three location fields; `short_location` is the
        // cleanest ("United States", "Canada") while `full_location` repeats
        // the country with a semicolon ("United States; United States") for
        // every record. Prefer short, fall back to full, then name.
        const location = p.short_location ?? p.full_location ?? p.location_name ?? null;
        const workMode = coerceWorkMode(p.location_type) ?? detectWorkMode(location);
        const tags = [
          p.department,
          p.category,
          p.employment_type,
          ...(p.tags2 ?? []),
          ...(p.tags3 ?? []),
        ].filter((t): t is string => typeof t === 'string' && t.length > 0);

        // Canonical posting URL — iCIMS apply_url goes to a login wall; the
        // public board link is the slug-based path. Falls back to apply_url
        // if for some reason slug is missing.
        const url = p.slug
          ? `https://www.github.careers/careers-home/job/${p.slug}`
          : (p.apply_url ?? '');

        return {
          source,
          externalId: p.slug ?? p.req_id ?? p.title ?? Math.random().toString(36),
          company: companyName,
          companySlug: 'github',
          title: p.title ?? 'Untitled',
          url,
          location,
          workMode,
          postedAt: p.posted_date ? new Date(p.posted_date) : null,
          tags,
          // GitHub's iCIMS `description` is HTML but heavy with tracking/
          // boilerplate markup — not a clean posting body. We deliberately do
          // NOT surface it as a description to avoid presenting noise as the
          // job description. The apply_url field is preserved as metadata even
          // though the canonical `url` (slug-based public path) is preferred.
          applyUrl: p.apply_url ?? null,
        };
      });
    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
