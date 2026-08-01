import type { JobSource, WorkMode } from '@jobhunt/shared';

/** Single normalised posting produced by every scraper. */
export interface RawJob {
  source: JobSource;
  /** Source-provided id, combined with source for dedup. */
  externalId: string;
  company: string;
  companySlug?: string;
  title: string;
  url: string;
  location?: string | null;
  workMode: WorkMode;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: 'year' | 'hour' | null;
  postedAt?: Date | null;
  tags?: string[];
}

export interface ScraperResult {
  source: JobSource;
  jobs: RawJob[];
  /** Empty when scraper ran cleanly. */
  error?: string;
}

/** Shared, resilient fetch wrapper with a sane timeout. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Detect work-mode keywords from arbitrary location/free-text. */
export function detectWorkMode(text: string | null | undefined): WorkMode {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (/\bremote\b/.test(t)) return 'remote';
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bonsite|on-site|in[- ]office\b/.test(t)) return 'onsite';
  return 'unknown';
}

/** Returns true if any needle appears as a case-insensitive substring. */
export function matchesAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.toLowerCase().includes(n.toLowerCase()));
}

/**
 * Location filter — applied to every RawJob before it's persisted.
 *
 * Accepts a job if its location matches ANY of the allowed tokens OR if it's
 * explicitly marked remote. Designed to be the single source of truth shared
 * by all scrapers (aggregators AND in-house portals), so adding a new source
 * never accidentally leaks out-of-region roles.
 *
 * Token matching rules:
 *  - "Seattle" passes anything mentioning Seattle (case-insensitive substring).
 *  - "Washington" passes anything mentioning Washington OR WA (state code).
 *  - "Remote" passes anything tagged workMode === 'remote' OR whose location
 *    free-text contains "remote".
 *  - Any other token = case-insensitive substring match on location.
 *
 * Jobs with no location AND workMode !== 'remote' are REJECTED — they'd be
 * ambiguous noise (e.g. Greenhouse postings with a blank location).
 */
export function passesLocationFilter(job: RawJob, allowed: string[]): boolean {
  if (allowed.length === 0) return true; // Filter disabled → accept everything.

  const locationText = (job.location ?? '').toLowerCase();
  const isRemote = job.workMode === 'remote' || /\bremote\b/.test(locationText);

  // Remote is always considered a wildcard match — even when not in the
  // allowed list, a job explicitly tagged remote is by definition available
  // to anyone anywhere in the country/region the search targets.
  const remoteAllowed = allowed.some((a) => a.toLowerCase() === 'remote');

  if (isRemote && remoteAllowed) return true;

  // Otherwise, do substring match for every allowed token. We map common
  // region/state aliases so e.g. "Seattle" matches "Seattle, WA" AND
  // "Washington" matches "WA, United States".
  for (const token of allowed) {
    const lower = token.toLowerCase();
    if (lower === 'remote') continue; // handled above
    if (locationText.includes(lower)) {
      // Trap: "Washington" matches both Washington state AND Washington DC.
      // DC is a different region — reject it explicitly.
      if (lower === 'washington' && /dc|d\.c\.|district of columbia/.test(locationText)) {
        continue;
      }
      return true;
    }
    // Alias expansions: Seattle ↔ WA ↔ Washington (state).
    if (lower === 'seattle') {
      if (/\b(wa|washington|king county|pierce county|snohomish)\b/.test(locationText)) {
        // Same DC trap.
        if (/dc|d\.c\.|district of columbia/.test(locationText)) continue;
        return true;
      }
    }
    if (lower === 'washington' || lower === 'wa') {
      if (/\b(seattle|bellevue|redmond|kirkland|spokane|tacoma|olympia|everett|bellingham|renton|bothell|issaquah|vancouver)\b/.test(locationText)) {
        return true;
      }
      // "WA" word-boundary match (catches "WA, USA" but not "Wall Street").
      // Also reject if paired with DC token.
      if (/\bwa\b/.test(locationText) && !/dc|d\.c\.|district of columbia/.test(locationText)) {
        return true;
      }
    }
  }
  return false;
}
