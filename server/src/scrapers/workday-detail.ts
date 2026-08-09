/**
 * Workday detail-page fetcher + JSON-LD parser.
 *
 * Lives in its own module so the heavy DetailHTML parse logic + tests stay
 * isolated from the listings-endpoint orchestration in `workday.ts`, and so
 * `workday.ts` can be tested with a mock detail fetcher injected via
 * dependency-style imports.
 *
 * Why the HTML page (not the /details/ API): the canonical Workday widget
 * detail API at `/wday/cxs/<tenant>/<site>/details<externalPath>` returns
 * HTTP 406 "Not Acceptable" on every tenant we tested (Quantiphi, Amgen,
 * …) regardless of Accept header. The public `/en-US/<site><externalPath>`
 * HTML page, however, embeds a `<script type="application/ld+json">` block
 * carrying the same JobPosting schema.org object (verified live
 * 2026-08-08 against Quantiphi USA/Canada/India requisitions).
 */
import { normalizeCountryCode } from './eligibility.js';

/** Image of the JSON-LD JobPosting block on the Workday detail page. Only the
 *  fields we actually consume are listed — the real payload has more. */
export interface WorkdayJsonLd {
  datePosted?: string; // ISO date ("2026-05-07") — the real posted date
  description?: string; // plain-text body, HTML-entity-escaped
  title?: string;
  employmentType?: string; // "FULL_TIME" / "OTHER" / "CONTRACTOR" / …
  jobLocation?: {
    address?: {
      addressCountry?: string; // "United States of America" / "Canada" / …
      addressLocality?: string; // "USA - Remote" / "Canada - Remote"
    };
  };
  identifier?: { value?: string }; // the requisition id ("JR10000")
  validThrough?: string;
}

/** Parsed detail result — every field optional so callers can distinguish
 *  "the page didn't expose it" (null) from "we never fetched the page". */
export interface ParsedWorkdayDetail {
  /** Cleaned plain-text description. */
  description: string | null;
  /** Raw HTML of the description (when the page carried one). */
  descriptionHtml: string | null;
  /** ISO date string from the JSON-LD `datePosted`. */
  datePosted: string | null;
  /** Normalised country name from JSON-LD `jobLocation.address.addressCountry`. */
  country: string | null;
  /** Locality string (e.g. "USA - Remote"). */
  locality: string | null;
  /** Requisition id when present in the JSON-LD identifier. */
  requisitionId: string | null;
}

/** Hard ceiling for a single detail-page fetch. Workday detail pages are
 *  ~25 KB and resolve in 300–800 ms; 8 s is a generous upper bound that still
 *  keeps the per-tenant detail phase (up to ~100 postings × concurrency 4)
 *  bounded to a few seconds. */
const DETAIL_TIMEOUT_MS = 8_000;

/** A friendly-ish UA so Workday's edge returns 200 instead of a bot check. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Fetch the Workday detail HTML page for one posting.
 *
 * Returns the raw HTML string on success, or null on any HTTP error / timeout
 * / empty body. Never throws — callers do not need to try/catch per-row.
 * Exported so the orchestrator (or tests) can substitute a stub.
 */
export async function fetchJobDetailHtml(url: string): Promise<string | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        // Accept text/html; the JSON-LD block is embedded in the HTML.
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': BROWSER_UA,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text && text.length > 0 ? text : null;
  } catch {
    // Timeout, DNS, network, abort — all non-fatal for a single enrichment.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the relevant fields from a Workday detail-page HTML payload.
 *
 * Strategy: find the `<script type="application/ld+json">` block, parse it as
 * JSON, and read the well-known schema.org JobPosting fields. JSON-LD is
 * Workday's stable structured layer — far more reliable than scraping
 * `<meta>` tags or running selectors.
 *
 * Returns an object whose every field is null when the payload didn't contain
 * that field. Never throws (a malformed JSON-LD yields an all-null result so
 * the listing-data fallback in `workday.ts` takes over).
 */
export function parseWorkdayDetailHtml(html: string): ParsedWorkdayDetail {
  const ld = extractJsonLd(html);
  if (!ld) {
    return emptyDetail();
  }

  const description = cleanDescription(ld.description ?? null);
  // Normalize the addressCountry to an ISO-2 code so downstream logic
  // (ELIGIBLE_COUNTRIES.has(code)) works consistently regardless of whether
  // the source wrote "United States of America" or "US".
  const country = normalizeCountryCode(ld.jobLocation?.address?.addressCountry ?? null);
  const locality = ld.jobLocation?.address?.addressLocality ?? null;
  const datePosted = ld.datePosted ?? null;
  const requisitionId = ld.identifier?.value ?? null;

  // descriptionHtml: the JSON-LD block carries the description as plain text
  // by spec, but some tenants inline HTML markup inside it. We preserve the
  // raw payload as descriptionHtml ONLY when it actually contains HTML
  // markup — otherwise null (preserves the contract that the field is only
  // set for HTML payloads).
  const rawDescription = (ld.description ?? '').trim();
  const descriptionHtml = containsHtml(rawDescription) ? rawDescription : null;

  return {
    description,
    descriptionHtml,
    datePosted,
    country,
    locality,
    requisitionId,
  };
}

/** Find and JSON-parse the first `application/ld+json` script block in the
 *  HTML. Returns null on absence or malformed JSON — never throws. */
function extractJsonLd(html: string): WorkdayJsonLd | null {
  if (!html) return null;
  // Match the JSON-LD block. Use a non-greedy capture for the body; falls
  // down only on extremely large nested scripts, none of which Workday emits.
  const m = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m || !m[1]) return null;
  try {
    const parsed = JSON.parse(m[1].trim()) as WorkdayJsonLd;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Decode common HTML entities + collapse whitespace so the description field
 *  is readable plain text. Returns null when the input is empty. */
function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<[^>]+>/g, ' ') // strip any stray tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Detect whether a (cleaned) description contains leftover HTML markup that
 *  would make descriptionHtml worth populating. Conservative: only treat
 *  common block tags as markup signals. */
function containsHtml(text: string | null): boolean {
  if (!text) return false;
  return /<\/?(p|div|ul|ol|li|h[1-6]|br|strong|em|b|i)\b/i.test(text);
}

function emptyDetail(): ParsedWorkdayDetail {
  return {
    description: null,
    descriptionHtml: null,
    datePosted: null,
    country: null,
    locality: null,
    requisitionId: null,
  };
}
