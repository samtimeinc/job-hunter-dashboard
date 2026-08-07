import type { JobSource } from '@jobhunt/shared';
import { config } from '../config.js';
import { detectWorkMode, fetchJson, matchesAny, type RawJob, type ScraperResult } from './types.js';

/**
 * The Muse — employer-branding job board with rich company profiles.
 *
 * API v2 (public, free tier, api-key auth) at themuse.com/developers/api/v2.
 * Unlike Dice/Adzuna which cast a firehose over every employer listing on
 * the market, The Muse is a company-curated board. Advantages:
 *   - Strong on mid->large companies with active culture marketing
 *   - Up-to-date because employers self-publish
 *   - Rich free-text description (use `contents` HTML for full details)
 *
 * Disadvantages:
 *   - Keyword search is permissive (matches against full job descriptions),
 *     producing significant noise (e.g. "Walmart Custodian" for React search).
 *     Mitigated by our `matchesAny` filter against title + description text.
 *
 * Requires THEMUSE_API_KEY (email registration at themuse.com).
 */

const API_BASE = 'https://www.themuse.com/api/public/jobs';

interface MuseCompany {
  name?: string;
}

interface MuseLocation {
  name?: string;
}

interface MuseLevel {
  name?: string;
}

interface MuseCategory {
  name?: string;
}

interface MuseJob {
  id: number | string;
  name?: string;
  company?: MuseCompany;
  locations?: MuseLocation[];
  levels?: MuseLevel[];
  categories?: MuseCategory[];
  contents?: string; // HTML description
  publication_date?: string;
  /** The Muse API returns `refs` with a `landing_page` URL for apply links. */
  refs?: { landing_page?: string };
}

interface MuseResponse {
  results?: MuseJob[];
  total?: number;
  page?: number;
  page_count?: number;
}

/** Strip HTML tags from The Muse's `contents` field for plain-text
 *  description storage. Kept simple — we don't need a full parser. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeTheMuse(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'themuse';
  if (!config.keys.themuseApiKey) {
    return { source, jobs: [], error: 'THEMUSE_API_KEY not configured' };
  }

  try {
    const query = encodeURIComponent(keywords.join(' '));
    const url = `${API_BASE}?q=${query}&page=1&descending=true`;
    const data = await fetchJson<MuseResponse>(url, {
      headers: {
        'api-key': config.keys.themuseApiKey,
        Accept: 'application/json',
      },
    });

    const seen = new Set<string>();
    const jobs: RawJob[] = [];
    for (const r of data.results ?? []) {
      const id = String(r.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      // The Muse's keyword search is noisy (matches full descriptions), so
      // apply the same haystack match as all other aggregators: title +
      // plain-text contents. Without this we'd insert irrelevant roles
      // (e.g. "Custodian" that happened to have React in the boilerplate).
      const title = r.name ?? 'Untitled';
      const descPlain = stripTags(r.contents ?? '');
      const haystack = `${title} ${descPlain}`;
      if (!matchesAny(haystack, keywords)) continue;

      // Work-mode detection: The Muse `levels` sometimes carry "Remote" info.
      // Fall back to detectWorkMode on the full description text.
      const levelNames = (r.levels ?? []).map((l) => l.name).join(' ');
      const locText = (r.locations ?? []).map((l) => l.name).join(', ');

      const url = r.refs?.landing_page ?? `https://www.themuse.com/jobs/${r.publication_date ? r.publication_date : id}`;

      jobs.push({
        source,
        externalId: id,
        company: r.company?.name ?? 'Unknown',
        title,
        url,
        location: locText || null,
        workMode: detectWorkMode(locText + ' ' + levelNames + ' ' + descPlain),
        postedAt: r.publication_date ? new Date(r.publication_date) : null,
        tags: [
          ...(r.categories ?? []).map((c) => c.name).filter((x): x is string => !!x),
          ...(r.levels ?? []).map((l) => l.name).filter((x): x is string => !!x),
        ].slice(0, 12),
        descriptionText: descPlain || null,
        descriptionHtml: r.contents ?? null,
      });
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
