/**
 * Deterministic duplicate-group key construction.
 *
 * The bug surfaced against production Workday data: Quantiphi appeared
 * multiple times with the SAME title ("Senior Software Developer") +
 * location ("Canada - Remote"), but those rows are GENUINELY DIFFERENT
 * requisitions (JR11114, JR11145, JR11311, …). They're NOT duplicates —
 * they're separate positions the company is hiring for in parallel.
 *
 * Real duplicates in job data come from three sources:
 *   1. The same posting lived at TWO different URLs over time (URL slug
 *      changed, requisition id stayed the same).
 *   2. Multiple scrapers surfaced the same posting (e.g. one row from
 *      Greenhouse directly + a redundant row from Active Jobs DB).
 *   3. The same scraper produced the same job twice in one scan.
 *
 * We DO NOT delete historical rows — the user explicitly asked us not to.
 * Instead we compute a canonical `duplicateGroupKey` so the agent API can:
 *   • fold siblings together via `collapseDuplicates=true`
 *   • flag `dataQuality.possibleDuplicate=true` for review
 *
 * The key is built from (company, normalised title, normalised country)
 * when a stable requisition id is available the key embeds that too —
 * so two rows with the same requisition id collapse together but two
 * different requisitions (same title + location) stay distinct.
 *
 * The function is PURE and DETERMINISTIC (same inputs → same key) so it's
 * safe to compute at insert time or at query time.
 */

/** Normalise a company name. Trims punctuation + case so "Stripe, Inc." and
 *  "stripe inc" share the same key segment. */
export function normalizeCompany(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(inc|llc|corp(\.|oration)?|co\.|company|ltd|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise a job title for matching. Lower-cased, punctuation-stripped,
 *  whitespace-collapsed. We deliberately do NOT strip seniority tokens —
 *  "Senior Engineer" and "Engineer" should NOT pool. */
export function normalizeTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Normalise a location string for matching. We collapse to the country +
 *  a coarse city/region token so "Seattle, WA" and "Seattle, Washington,
 *  United States" share a key but "Seattle, WA" and "Remote" don't. */
export function normalizeLocation(
  location: string | null | undefined,
  country: string | null | undefined,
): string {
  if (!location && !country) return '';
  const loc = (location ?? '').toLowerCase();
  const c = (country ?? '').toLowerCase();
  // Pull a leading city/region token out of the location when present.
  // Stop at the first comma / dash so "San Francisco, CA" → "san francisco".
  const cityMatch = loc.split(/[,\-|]/)[0]?.trim();
  const city = cityMatch ? cityMatch.replace(/\s+/g, ' ').trim() : '';
  return `${c || 'unknown'}:${city}`.slice(0, 120);
}

/**
 * Compute the canonical duplicate-group key for a job.
 *
 * Inputs:
 *   • company     – raw company name
 *   • title       – raw job title
 *   • location    – raw location text
 *   • country     – ISO-2 country code (or null)
 *   • requisitionId – source-provided stable id (Workday JRnnnn, etc.)
 *     When present, the key embeds the requisition id, so two rows with the
 *     same requisition id ALWAYS share a key but two different requisitions
 *     stay distinct (this is why Quantiphi's parallel requisitions do not
 *     collapse — by design).
 *     When absent, the key is (company, title, location) — looser but
 *     catches aggregator/URL duplicates where no requisition id exists.
 */
export function computeDuplicateGroupKey(input: {
  company: string | null | undefined;
  title: string | null | undefined;
  location: string | null | undefined;
  country: string | null | undefined;
  requisitionId?: string | null | undefined;
}): string {
  const company = normalizeCompany(input.company);
  const title = normalizeTitle(input.title);
  const location = normalizeLocation(input.location, input.country);
  // Prepend the requisition id when present — it's the strictest identity so
  // we honour "different requisitions never collapse" even when their human-
  // readable title+location happen to match exactly.
  const req = (input.requisitionId ?? '').trim();
  const seed = req ? `req:${req}|${company}|${title}` : `${company}|${title}`;
  const key = `${seed}|${location}`;
  // Stable hash so the key has a fixed bounded length and no encoding
  // surprises in SQL IN (...) — use FNV-1a (32-bit) for simplicity + no deps.
  return fnv1a(key).toString(36);
}

/** 32-bit FNV-1a hash. Deterministic, fast, dependency-free. Returns a
 *  decimal integer we render in base36. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (FNV prime). Wrap to 32 bits with >>> 0.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
