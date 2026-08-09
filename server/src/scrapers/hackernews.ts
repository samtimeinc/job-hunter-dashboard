import type { JobSource } from '@jobhunt/shared';
import {
  detectCountry,
  detectSeniority,
  detectWorkMode,
  fetchJson,
  matchesAny,
  type RawJob,
  type ScraperResult,
} from './types.js';

/**
 * Hacker News "Ask HN: Who is hiring?" — YC-startup heavy monthly megathread.
 *
 * Every month on the 1st (Pacific time), HN posts a thread where every
 * top-level comment is a job posting. Comments follow a loose convention:
 *
 *     Company Name | Location | Role Title | Remote/Onsite | Full-time
 *     <description HTML with <a href> apply link>
 *
 * It's gold for early-stage/seed-stage discovery: many postings show up here
 * before any commercial aggregator picks them up, and YC companies often
 * post ONLY here. Big Tech also shows up (Stripe, Cloudflare, Anthropic,
 * Vercel have all consistently posted).
 *
 * No API key, no signup. Uses HN's official search backend (Algolia):
 *   - Story search:  https://hn.algolia.com/api/v1/search?tags=story&query=...
 *   - Comment fetch: https://hn.algolia.com/api/v1/search?tags=comment,story_<id>
 *
 * Added 2026-08-07 as the strongest no-auth aggregator for SWE roles.
 */

const STORY_SEARCH = 'https://hn.algolia.com/api/v1/search';
const COMMENT_LIMIT = 200; // Top 200 comments — usually the freshest, highest-quality postings.

interface HnHit {
  objectID: string;
  title?: string;
  created_at?: string;
  created_at_i?: number;
  author?: string;
  comment_text?: string;
  url?: string;
  points?: number;
  num_comments?: number;
}

interface HnSearchResponse {
  hits: HnHit[];
  nbHits: number;
  page: number;
}

/** Find the most recent monthly "Ask HN: Who is hiring? (Month Year)" thread.
 *
 *  Algolia returns matches by relevance, NOT recency — naive sort picks
 *  incidental matches like "Why is this post being re-aged?" over the real
 *  monthly thread. So we (a) restrict to stories from ~the last 70 days so
 *  only the current month + 1 prior month are candidates, then (b) match
 *  the strict "Ask HN: Who is hiring? (Month Year)" title regex. */
async function findCurrentMonthThreadId(): Promise<{ id: string; createdAt: Date } | null> {
  const sevenDaysAgo = Math.floor((Date.now() - 70 * 24 * 60 * 60 * 1000) / 1000);
  const url = new URL(STORY_SEARCH);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('query', 'Ask HN Who is hiring');
  url.searchParams.set('numericFilters', `created_at_i>${sevenDaysAgo}`);
  url.searchParams.set('hitsPerPage', '20');

  const data = await fetchJson<HnSearchResponse>(url.toString());
  const candidates = data.hits.filter((h) =>
    /^Ask HN: Who is hiring\? \([A-Z][a-z]+ \d{4}\)$/.test(h.title ?? ''),
  );
  // Defensive: sort by created_at_i desc to guarantee the latest monthly thread.
  candidates.sort((a, b) => (b.created_at_i ?? 0) - (a.created_at_i ?? 0));
  const top = candidates[0];
  if (!top?.objectID) return null;
  return {
    id: top.objectID,
    createdAt: top.created_at ? new Date(top.created_at) : new Date(),
  };
}

/** Decode the HTML entities HN/Algolia escapes in comment text (&#x2F; → /,
 *  &quot; → ", &amp; → &, &#x27; → '). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x2F;/g, '/')
    .replace(/&#x2f;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Pull the first <a href="..."> from a comment body — that's conventionally
 *  the apply link / company site. Returns null when none found. */
function extractFirstUrl(htmlText: string): string | null {
  const match = htmlText.match(/<a\s+[^>]*href="([^"]+)"/i);
  if (!match || !match[1]) return null;
  const href = match[1];
  // Skip fragments / mailto — we want a real URL for the dashboard's Apply.
  if (href.startsWith('#') || href.toLowerCase().startsWith('mailto:')) return null;
  return href;
}

/** Parse the metadata-rich first line of an HN job comment.
 *
 *  Convention: "Company | Location | Role | Remote/Onsite | Full-time"
 *  — but real-world adherence varies wildly (0 to 8+ pipe segments,
 *  sometimes comma-separated). We tolerate both, split by `|` first, then
 *  fall back to splitting on `·` or `,`. Returns whatever we can extract;
 *  reject-by-null only when we have literally nothing. */
function parseCommentMetadata(
  commentText: string,
  threadId: string,
  commentId: string,
): {
  company: string;
  title: string;
  location: string;
  descriptionText: string;
  rawHtml: string;
} | null {
  if (!commentText?.trim()) return null;
  // Use the original (HTML-preserved) text for URL/description extraction.
  const rawHtml = commentText;
  // Use the decoded, tag-stripped text for line-level parsing.
  const plain = decodeHtmlEntities(commentText).replace(/<[^>]+>/g, ' ');
  const normalisedWhitespace = plain.replace(/\s+/g, ' ').trim();
  if (!normalisedWhitespace) return null;

  // First line = the entire run before the first <p> or \n in the raw text.
  // HN threads use <p> between paragraphs and (sometimes) `\n` line breaks.
  const firstLineRaw = normalisedWhitespace.split(/\s*\|\s*|\sat\s*|·|,|[\n]/i)[0]?.trim() || '';

  // Split metadata on `|` first; if no pipes present, try `·` and `,`.
  const splitRegex =
    normalisedWhitespace.includes('|') && normalisedWhitespace.split('|').length > 1
      ? /\s*\|\s*/
      : normalisedWhitespace.includes('·') && normalisedWhitespace.split('·').length > 1
        ? /\s*·\s*/
        : /\s*,\s*/;
  const segments = normalisedWhitespace.split(splitRegex).map((s) => s.trim()).filter(Boolean);

  // First segment is almost always the company name. If there's only one
  // segment, treat it as the title and use "Unknown" for company.
  const company = (segments[0] || 'Unknown').slice(0, 200);
  // The 2nd-3rd segments are usually role/title; otherwise build from firstLineRaw.
  let title = 'Untitled';
  if (segments.length >= 3) {
    // Pick the segment that looks most like a role/title (contains Engineer /
    // Developer / Designer / Manager / etc.). Heuristic but works well.
    const roleish = segments.slice(1, 4).find((s) =>
      /\b(engineer|developer|designer|manager|lead|scientist|architect|intern|specialist|programmer)\b/i.test(
        s,
      ),
    );
    title = (roleish ?? segments[1] ?? firstLineRaw).slice(0, 240);
  } else if (segments.length === 2 && segments[1]) {
    title = segments[1].slice(0, 240);
  } else {
    title = firstLineRaw.slice(0, 240) || 'Untitled';
  }

  // Capture location: scan all segments looking for a city/region/Remote/Onsite marker.
  const locSegment = segments.find((s) =>
    /\b(remote|onsite|hybrid|seattle|san francisco|new york|austin|boston|london|berlin|amsterdam|remote \(|fully remote|us-only|us only|worldwide|emea|apac)\b/i.test(
      s,
    ),
  );
  const location = locSegment
    ? locSegment.replace(/\s*\|\s*$/, '').trim()
    : ''; // Empty = unknown; passesLocationFilter() will reject unless Remote.

  // Description = full plain text (decoded, tag-stripped). We strip the
  // <a href="..."> wrapper because it leaks as raw href noise; the actual
  // URL is pulled out separately as the apply link.
  const descriptionText = normalisedWhitespace.slice(0, 4000);
  void commentId;
  void threadId;
  return { company, title, location, descriptionText, rawHtml };
}

export async function scrapeHackerNews(keywords: string[]): Promise<ScraperResult> {
  const source: JobSource = 'hackernews';
  try {
    const thread = await findCurrentMonthThreadId();
    if (!thread) {
      return {
        source,
        jobs: [],
        error: 'no current "Ask HN: Who is hiring?" thread found in the last 70 days',
      };
    }

    // Fetch the top COMMENT_LIMIT comments (relevance-descending per Algolia).
    const url = new URL(STORY_SEARCH);
    url.searchParams.set('tags', `comment,story_${thread.id}`);
    url.searchParams.set('hitsPerPage', String(COMMENT_LIMIT));
    const data = await fetchJson<HnSearchResponse>(url.toString(), {}, 20_000);

    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    for (const hit of data.hits) {
      const commentId = hit.objectID;
      if (!commentId || seen.has(commentId)) continue;
      seen.add(commentId);

      const parsed = parseCommentMetadata(hit.comment_text ?? '', thread.id, commentId);
      if (!parsed) continue;
      // Keyword filter: HN postings only count if they match our stack.
      // Match against title, description, AND location (so "Remote role using
      // TypeScript" still surfaces even if the title is generic like "Engineer").
      const haystack = `${parsed.title} ${parsed.location} ${parsed.descriptionText}`;
      if (!matchesAny(haystack, keywords)) continue;

      const url = extractFirstUrl(parsed.rawHtml) ?? `https://news.ycombinator.com/item?id=${commentId}`;
      jobs.push({
        source,
        // commentId is the only stable per-post identifier — same role reposted
        // by a different company in a different month gets a different id.
        externalId: commentId,
        company: parsed.company,
        title: parsed.title,
        url,
        location: parsed.location || null,
        workMode: detectWorkMode(parsed.location + ' ' + parsed.descriptionText),
        postedAt: hit.created_at ? new Date(hit.created_at) : thread.createdAt,
        tags: [],
        // Store the decoded plain text so the dashboard can show it without
        // rendering HTML; preserve raw HTML in descriptionHtml for completeness.
        descriptionText: parsed.descriptionText,
        descriptionHtml: hit.comment_text ?? null,
        applyUrl: url,
        requisitionId: commentId,
        country: detectCountry(parsed.location),
        seniority: detectSeniority(parsed.title),
      });
    }

    return { source, jobs };
  } catch (err) {
    return { source, jobs: [], error: (err as Error).message };
  }
}
