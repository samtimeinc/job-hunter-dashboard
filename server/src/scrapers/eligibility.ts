/**
 * Country detection + location-eligibility normalisation.
 *
 * Why this exists: the user's search target is **United States / Seattle / U.S.
 * remote jobs**, but the raw `location` field that every scraper surfaces is
 * mixed free-text — sometimes a city, sometimes a full "City, ST, Country"
 * string, sometimes just "Remote", sometimes a country like "Canada". The
 * bug surfaced against production Workday data: Canadian remote roles were
 * being treated the same as U.S.-eligible remote roles because the only
 * signal we had was the word "Remote".
 *
 * This module exports two pure functions used everywhere a location shows up:
 *
 *   • `detectCountry(location)` – best-effort extraction of a normalised
 *      ISO-2 country code (`'US'`, `'CA'`, `'IN'`, …) or `null` when
 *      undeterminable. Includes explicit country + province + city lists so
 *      we never confuse "WA" (Washington state) with a country, nor "Georgia"
 *      (US state) with the country Georgia.
 *
 *   • `computeLocationEligibility(...)` – maps a (country, free-text location)
 *      pair to one of three buckets an agent can route on:
 *        - `'eligible'`   – clearly within the target markets.
 *        - `'ineligible`' – clearly outside (e.g. Canada-Remote when only US
 *                           is configured as eligible).
 *        - `'unknown'`    – ambiguous; needs human review.
 *
 * The eligibility decision is policy-driven (target countries in
 * `ELIGIBLE_COUNTRIES`), NOT hard-coded to "US only" — the rule travels with
 * the code so it stays testable and obvious. Adding a market (e.g. opening
 * Canada-Remote) is a one-line edit.
 */

/** ISO-style country codes we explicitly recognise from location free-text.
 *  Anything not in this map falls back to name-based detection, then null. */
const COUNTRY_KEYWORDS: ReadonlyArray<{ code: string; names: readonly string[] }> = [
  {
    code: 'US',
    names: ['united states of america', 'united states', 'usa', 'u.s.a.', 'u.s.'],
  },
  { code: 'CA', names: ['canada'] },
  { code: 'GB', names: ['united kingdom', 'uk', 'u.k.', 'england', 'scotland', 'wales'] },
  { code: 'IE', names: ['ireland'] },
  { code: 'DE', names: ['germany', 'deutschland'] },
  { code: 'FR', names: ['france'] },
  { code: 'NL', names: ['netherlands', 'holland'] },
  { code: 'ES', names: ['spain', 'españa'] },
  { code: 'PT', names: ['portugal'] },
  { code: 'IN', names: ['india', 'bharat'] },
  { code: 'AU', names: ['australia'] },
  { code: 'NZ', names: ['new zealand'] },
  { code: 'SG', names: ['singapore'] },
  { code: 'JP', names: ['japan', 'nihon'] },
  { code: 'MX', names: ['mexico', 'méxico'] },
  { code: 'BR', names: ['brazil', 'brasil'] },
];

/** ISO-2 country codes this user's search considers eligible. Edit this set
 *  to add/remove target markets (e.g. open up Canada-Remote by adding 'CA').
 *
 *  IMPORTANT: this is about LOCATION ELIGIBILITY, which is narrower than the
 *  dashboard location filter (`passesLocationFilter`). The dashboard filter
 *  lets "Remote" through as a wildcard (intentional — the dashboard is for
 *  browsing). The eligibility signal here is stricter and used by the agent
 *  API so an automated workflow can confidently route only in-target postings. */
export const ELIGIBLE_COUNTRIES: ReadonlySet<string> = new Set(['US']);

/** Canadian province / territory abbreviations used standalone in locations
 *  ("Vancouver, BC", "Toronto, ON"). Maps unambiguously to Canada. */
const CA_PROVINCE_TOKENS: ReadonlySet<string> = new Set([
  'ab', // Alberta
  'bc', // British Columbia
  'mb', // Manitoba
  'nb', // New Brunswick
  'nl', // Newfoundland and Labrador
  'ns', // Nova Scotia
  'nt', // Northwest Territories
  'nu', // Nunavut
  'on', // Ontario
  'pe', // Prince Edward Island
  'qc', // Quebec
  'sk', // Saskatchewan
  'yt', // Yukon
]);

/** Canadian major cities — when the location names one of these WITHOUT any
 *  country/state context, treat it as Canada. Lets us resolve "Toronto",
 *  "Montreal", etc. without needing the province. */
const CA_CITY_TOKENS: readonly string[] = [
  'toronto',
  'montreal',
  'vancouver',
  'calgary',
  'ottawa',
  'edmonton',
  'winnipeg',
  'quebec city',
  'halifax',
  'victoria, bc',
];

/** Indian state / territory abbreviations used standalone. The Workday
 *  format is "IN-KA-Bengaluru" so we also handle the leading "IN-" prefix. */
const IN_STATE_TOKENS: ReadonlySet<string> = new Set([
  'an',
  'ap', // Andhra Pradesh
  'ar',
  'as',
  'br',
  'ch',
  'ct',
  'dd',
  'dl', // Delhi
  'ga',
  'gj',
  'hp',
  'hr',
  'jh',
  'jk',
  'ka', // Karnataka
  'kl',
  'la',
  'mh', // Maharashtra
  'ml',
  'mn',
  'mp',
  'mz',
  'nl',
  'od',
  'pb',
  'py',
  'rj',
  'sk',
  'tn', // Tamil Nadu
  'tg',
  'tr',
  'ts',
  'uk',
  'up',
  'wb',
]);

/** Indian major cities — when the location names one without country context,
 *  treat it as India. */
const IN_CITY_TOKENS: readonly string[] = [
  'bengaluru',
  'bangalore',
  'mumbai',
  'delhi',
  'hyderabad',
  'pune',
  'chennai',
  'kolkata',
  'gurgaon',
  'noida',
];

/** US state abbreviations. Maps to US when seen standalone. */
const US_STATE_TOKENS: ReadonlySet<string> = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il',
  'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt',
  'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
]);

/** Well-known US metro tokens we treat as US even when the country isn't
 *  spelled out. Lets us say "Seattle" → US with confidence. Use lowercase
 *  exact-match against a normalised token (so "vancouver, wa" picks US
 *  rather than colliding with Vancouver BC). */
const US_METRO_TOKENS: readonly string[] = [
  'seattle',
  'bellevue',
  'redmond',
  'kirkland',
  'spokane',
  'tacoma',
  'olympia',
  'everett',
  'bellingham',
  'renton',
  'bothell',
  'issaquah',
  'vancouver, wa',
  'san francisco',
  'san jose',
  'palo alto',
  'mountain view',
  'sunnyvale',
  'oakland',
  'los angeles',
  'san diego',
  'sacramento',
  'new york',
  'nyc',
  'brooklyn',
  'boston',
  'cambridge, ma',
  'austin',
  'dallas',
  'houston',
  'chicago',
  'denver',
  'boulder',
  'portland, or',
  'atlanta',
  'miami',
  'minneapolis',
  'phoenix',
  'arlington, va',
  'washington, dc',
  'remote (us)',
  'remote - us',
  'usa - remote',
  'us - remote',
  'us remote',
  'remote, us',
  'remote - united states',
  'remote, united states',
];

/** Normalise a location string for matching: lower-case, replace unicode
 *  dashes with ASCII hyphen, collapse runs of whitespace. */
function normalizeLocationText(location: string): string {
  return location
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort detection of an ISO-style country code from a free-text
 *  location string. Returns null when no confident signal is present.
 *
 *  Order of precedence:
 *    1. Explicit country keyword match ("United States", "Canada", …).
 *    2. Explicit non-US country subtokens — Canadian provinces / cities,
 *       Indian states / cities, the Workday "IN-KA-…" / "CA-…" prefixes.
 *    3. US-metro tokens and US state abbreviations (only signals US — other
 *       countries don't have a comparable abbreviation convention we can
 *       disambiguate from state codes).
 *
 *  We deliberately do NOT count "Remote" alone as a country — bare Remote
 *  with no other context is ambiguous (could be worldwide or US-only) and
 *  must route to eligibility = 'unknown' for review. Likewise "Americas",
 *  "EMEA", "APAC", "Worldwide" — not countries → null. */
export function detectCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const t = normalizeLocationText(location);
  if (!t) return null;
  const padded = ` ${t} `;

  // 1. Country name match — most reliable signal.
  for (const c of COUNTRY_KEYWORDS) {
    for (const name of c.names) {
      const re = wordBoundaryRegex(name);
      if (re.test(padded)) return c.code;
    }
  }

  // 2a. Workday-style "IN-KA-City" / "CA-BCCity" prefix → resolve immediately.
  //     The "IN-" prefix is two letters + dash; the first segment is the
  //     ISO-3166-2 country code we want.
  const workdayPrefix = t.match(/^([a-z]{2})-[a-z]{2}-/);
  if (workdayPrefix && workdayPrefix[1]) {
    const cc = workdayPrefix[1].toUpperCase();
    if (cc !== 'US') return cc; // US resolved below if applicable
  }
  // Special-case the bare "CA-" remote prefix ("Canada - Remote") that Workday
  // emits — only treat as Canada when followed by "remote" or a province.
  if (/^ca-/.test(t) || /\bca - remote\b/.test(t) || /\bcanada - remote\b/.test(t)) {
    // Already handled by COUNTRY_KEYWORDS, but keep as a safety net.
    return 'CA';
  }

  // 2b. Canadian province abbreviation as a standalone 2-letter token — covers
  //     "Vancouver, BC" / "Toronto, ON". Has to run BEFORE US state matching
  //     because NB/NL/NT/NU/PE are not US states, but ON/BC/QC/etc. don't
  //     collide with US codes anyway.
  if (hasStandaloneCode(padded, CA_PROVINCE_TOKENS)) return 'CA';

  // 2c. Canadian city token.
  for (const city of CA_CITY_TOKENS) {
    if (wordBoundaryRegex(city).test(padded)) return 'CA';
  }

  // 2d. Indian state abbreviation as a standalone 2-letter token.
  if (hasStandaloneCode(padded, IN_STATE_TOKENS)) return 'IN';

  // 2e. Indian city token.
  for (const city of IN_CITY_TOKENS) {
    if (wordBoundaryRegex(city).test(padded)) return 'IN';
  }

  // 3. US-metro token (covers the most common misclassified US remotes).
  for (const metro of US_METRO_TOKENS) {
    if (wordBoundaryRegex(metro).test(padded)) return 'US';
  }

  // 4. US-state abbreviation as a standalone 2-letter token.
  if (hasStandaloneCode(padded, US_STATE_TOKENS)) return 'US';

  return null;
}

/** Build a word-boundary regex for a (lowercase) country/city/metro name so
 *  it can't match as a substring. */
function wordBoundaryRegex(lowercasedName: string): RegExp {
  return new RegExp(`(^|[^a-z])${escapeRegex(lowercasedName)}([^a-z]|$)`);
}

/** True when the text contains any of the 2-letter codes standing alone (not
 *  inside a longer word). Used for state/province abbreviation matching. */
function hasStandaloneCode(
  padded: string,
  codes: ReadonlySet<string>,
): boolean {
  const re = /(^|[^a-z0-9])([a-z]{2})([^a-z0-9]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(padded)) !== null) {
    const tok = m[2];
    if (tok && codes.has(tok)) return true;
  }
  return false;
}

/** Eligibility bucket an agent can route on. */
export type LocationEligibility = 'eligible' | 'ineligible' | 'unknown';

/**
 * Map a (country, rawLocation, workMode) tuple to an eligibility bucket.
 *
 * Rules:
 *   • If `country` is provided and resolves to a known ISO-2 code:
 *       - In {@link ELIGIBLE_COUNTRIES}  → 'eligible'
 *       - Otherwise                       → 'ineligible'
 *     (Both are confident signals — we know where the job lives.)
 *   • If `country` is null but `location` resolves to a country via
 *     {@link detectCountry}, apply the same rule.
 *   • If we can't resolve a country at all (bare "Remote", "Worldwide",
 *     "EMEA", "APAC", or empty), route to 'unknown' for review rather than
 *     auto-marking eligible. The dashboard's passesLocationFilter() is the
 *     more permissive filter; the agent API must stay strict.
 */
export function computeLocationEligibility(
  country: string | null | undefined,
  location: string | null | undefined,
  workMode?: string,
): LocationEligibility {
  void workMode; // reserved for future per-mode rules (e.g. "anything remote ok")
  const resolved = country ?? detectCountry(location);
  if (!resolved) return 'unknown';
  return ELIGIBLE_COUNTRIES.has(resolved) ? 'eligible' : 'ineligible';
}

/** Normalize a country name OR code to an ISO-2 code, using the same keyword
 *  list {@link detectCountry} consults. Useful when a source exposes a
 *  structured-but-free-text country field (e.g. Workday's JSON-LD
 *  `addressCountry` = "United States of America" / "United Kingdom") and we
 *  want to store the canonical ISO-2 code in `jobs.country` so the eligibility
 *  check (`ELIGIBLE_COUNTRIES.has(code)`) is consistent regardless of how the
 *  source spelled the country.
 *
 *  - Already-ISO-2 input ("US", "CA", "GB") passes through unchanged.
 *  - Recognized name ("United States") → its ISO-2 code ("US").
 *  - Unknown input → null (no fabrication).
 *
 *  Returned codes are upper-cased for set-membership consistency. */
export function normalizeCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Pass-through for already-ISO-2 codes from the COUNTRY_KEYWORDS list.
  const upper = trimmed.toUpperCase();
  for (const c of COUNTRY_KEYWORDS) {
    if (c.code === upper) return c.code;
  }
  // Recognized name/alias.
  const code = detectCountry(trimmed);
  return code ?? null;
}

/** Escape a string for safe interpolation into a `RegExp`. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inferred seniority band. Used by the agent API to rank / filter postings
 *  without an expensive description parse — pure title heuristic, fast and
 *  transparent. `null` means "no signal" (the agent treats that as
 *  unknown rather than mid). */
export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'staff' | 'manager' | 'director';

/** Best-effort seniority classification from a job title.
 *
 *  Heuristic over title keywords — works because ATS titles follow consistent
 *  conventions ("Senior Engineer", "Staff SWE", "Engineering Manager",
 *  "Intern, Software"). Pure function so callers can re-tag jobs without a
 *  re-fetch.
 *
 *  Order matters: we test most-specific signals first (staff > senior > mid),
 *  and "manager"/"intern" are mutually-tagged so an "Engineering Manager,
 *  Internship" still cages as 'intern'. */
export function detectSeniority(title: string | null | undefined): Seniority | null {
  if (!title) return null;
  const t = title.toLowerCase();

  // Internship — strongest single-word signal, overrides everything else
  // ("Engineering Manager Intern" is an internship, not management track).
  if (/\bintern(ship)?\b/.test(t)) return 'intern';

  if (/\b(staff|principal)\b/.test(t) && !/\b(principal product manager|principal accountant)\b/.test(t)) {
    return 'staff';
  }
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\b(manager|mgr|head of|team lead|tech lead|engineering lead)\b/.test(t)) {
    return 'manager';
  }
  // Senior band — explicit "senior/snr/sr" keywords OR the II/III/IV level
  // suffix ladder ("Software Engineer II"/"III"/"IV"). We deliberately do
  // NOT treat bare "2" / "3" as seniority (those collide with team names
  // like "Manager 2"); the roman-numeral ladder is the unambiguous signal.
  if (/\b(senior|snr|sr\.?)\b/.test(t) || /\bi{2,4}\b/.test(t)) {
    return 'senior';
  }
  if (/\b(mid|intermediate)\b/.test(t)) return 'mid';
  if (/\b(junior|jr\.?|entry|graduate|new grad|early career|associate)\b/.test(t)) {
    return 'entry';
  }
  // Default sane bucket for "Software Engineer" with no level: mid.
  if (/(engineer|developer|scientist|architect|designer|programmer|analyst)/.test(t)) {
    return 'mid';
  }
  return null;
}
