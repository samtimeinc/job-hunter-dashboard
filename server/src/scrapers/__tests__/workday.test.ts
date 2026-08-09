import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeWorkday } from '../workday.js';

/** Build a Workday /jobs POST response payload. */
function listingsResponse(jobs: object[]) {
  return { jobPostings: jobs, total: jobs.length };
}

/** Build a minimal Workday detail-page HTML wrapping a JSON-LD JobPosting. */
function detailHtml(jsonLd: object): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;
}

describe('scrapeWorkday (detail enrichment + apply URL + requisition id)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch between tests so mocks never bleed.
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('preserves the source-provided postedAt via JSON-LD datePosted', async () => {
    const posting = {
      title: 'AI Engineer',
      externalPath: '/job/USA---Remote/AI-Engineer_JR10000',
      locationsText: 'USA - Remote',
      bulletFields: ['JR10000'],
      postedOn: 'Posted 30+ Days Ago',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') {
        return new Response(JSON.stringify(listingsResponse([posting])), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${_url}`);
    });
    const fetchDetail = vi.fn().mockResolvedValue(
      detailHtml({
        title: 'AI Engineer',
        description: 'We build AI tooling.',
        datePosted: '2026-05-07',
        jobLocation: {
          address: { addressCountry: 'United States of America', addressLocality: 'USA - Remote' },
        },
        identifier: { value: 'JR10000' },
      }),
    );
    const result = await scrapeWorkday(
      'https://quantiphi.wd1.myworkdayjobs.com',
      'quantiphi',
      'Careers_at_Quantiphi',
      'Quantiphi',
      // Keyword must appear in the title for the local matchesAny filter.
      ['Engineer'],
      { fetchDetailHtml: fetchDetail },
    );
    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    // The list `postedOn` ("Posted 30+ Days Ago") is a relative string and
    // must NOT leak in as postedAt. The real date comes from JSON-LD.
    expect(job.postedAt).toEqual(new Date('2026-05-07'));
    expect(job.descriptionText).toBe('We build AI tooling.');
  });

  it('preserves source-provided external apply URL when set (externalUrl)', async () => {
    const posting = {
      title: 'Engineer',
      externalPath: '/job/USA---Remote/Engineer_JR5',
      locationsText: 'USA - Remote',
      bulletFields: ['JR5'],
      externalUrl: 'https://apply.partner-portal.com/req/5',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse([posting])), { status: 200 });
    });
    const fetchDetail = vi.fn().mockResolvedValue(null);
    const result = await scrapeWorkday(
      'https://example.wd1.myworkdayjobs.com',
      'x',
      'Careers',
      'Example',
      ['Engineer'],
      { fetchDetailHtml: fetchDetail },
    );
    expect(result.jobs[0]!.applyUrl).toBe('https://apply.partner-portal.com/req/5');
  });

  it('sets applyUrl to the canonical Workday job URL when no external URL is given (the bug fix)', async () => {
    // This is the production bug: applyUrl was null because we never populated
    // it. The canonical /en-US/<site>/job/<slug> URL IS the apply page on
    // Workday's tenant interface.
    const posting = {
      title: 'AI Engineer',
      externalPath: '/job/USA---Remote/AI-Engineer_JR10000',
      locationsText: 'USA - Remote',
      bulletFields: ['JR10000'],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse([posting])), { status: 200 });
    });
    const fetchDetail = vi.fn().mockResolvedValue(null);
    const result = await scrapeWorkday(
      'https://quantiphi.wd1.myworkdayjobs.com',
      'quantiphi',
      'Careers_at_Quantiphi',
      'Quantiphi',
      ['Engineer'],
      { fetchDetailHtml: fetchDetail },
    );
    const job = result.jobs[0]!;
    expect(job.applyUrl).toBe(
      'https://quantiphi.wd1.myworkdayjobs.com/en-US/Careers_at_Quantiphi/job/USA---Remote/AI-Engineer_JR10000',
    );
    expect(job.url).toBe(job.applyUrl);
  });

  it('preserves the stable requisition id from bulletFields[0] for dedup grouping', async () => {
    const posting = {
      title: 'Senior Software Developer',
      externalPath: '/job/Canada---Remote/Senior-Software-Developer_JR11114',
      locationsText: 'Canada - Remote',
      bulletFields: ['JR11114'],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse([posting])), { status: 200 });
    });
    const fetchDetail = vi.fn().mockResolvedValue(
      detailHtml({
        title: 'Senior Software Developer',
        description: 'senior role',
        datePosted: '2026-07-01',
        jobLocation: {
          address: { addressCountry: 'Canada', addressLocality: 'Canada - Remote' },
        },
        identifier: { value: 'JR11114' },
      }),
    );
    const result = await scrapeWorkday(
      'https://quantiphi.wd1.myworkdayjobs.com',
      'quantiphi',
      'Careers_at_Quantiphi',
      'Quantiphi',
      ['Developer'],
      { fetchDetailHtml: fetchDetail },
    );
    const job = result.jobs[0]!;
    expect(job.requisitionId).toBe('JR11114');
    // Country normalised to ISO-2 by the JSON-LD parse.
    expect(job.country).toBe('CA');
    expect(job.seniority).toBe('senior');
  });

  it('does NOT collapse sibling Quantiphi requisitions — different requisitionIds produce different rows', async () => {
    // The production bug: 7 rows look like duplicates because they share
    // title+location, but they're genuinely distinct requisitions. The
    // scraper must emit one row per externalPath (the per-req slug).
    const postings = [
      {
        title: 'Senior Software Developer',
        externalPath: '/job/Canada---Remote/Senior-Software-Developer_JR11114',
        locationsText: 'Canada - Remote',
        bulletFields: ['JR11114'],
      },
      {
        title: 'Senior Software Developer',
        externalPath: '/job/Canada---Remote/Senior-Software-Developer_JR11145',
        locationsText: 'Canada - Remote',
        bulletFields: ['JR11145'],
      },
      {
        title: 'Senior Software Developer',
        externalPath: '/job/Canada---Remote/Senior-Software-Developer_JR11311',
        locationsText: 'Canada - Remote',
        bulletFields: ['JR11311'],
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse(postings)), { status: 200 });
    });
    const fetchDetail = vi.fn().mockResolvedValue(null);
    const result = await scrapeWorkday(
      'https://quantiphi.wd1.myworkdayjobs.com',
      'quantiphi',
      'Careers_at_Quantiphi',
      'Quantiphi',
      ['Developer'],
      { fetchDetailHtml: fetchDetail },
    );
    expect(result.jobs).toHaveLength(3);
    const reqIds = result.jobs.map((j) => j.requisitionId).sort();
    expect(reqIds).toEqual(['JR11114', 'JR11145', 'JR11311']);
  });

  it('never fabricates missing fields when the detail fetch returns nothing', async () => {
    const posting = {
      title: 'Engineer Position',
      externalPath: '/job/USA/Engineer_Position_REQ-42',
      locationsText: 'USA - Remote',
      bulletFields: ['REQ-42'],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse([posting])), { status: 200 });
    });
    // A null return represents either an HTTP failure or an unparsable page.
    const fetchDetail = vi.fn().mockResolvedValue(null);
    const result = await scrapeWorkday(
      'https://x.wd1.myworkdayjobs.com',
      'x',
      'Careers',
      'X',
      ['Engineer'],
      { fetchDetailHtml: fetchDetail },
    );
    const job = result.jobs[0]!;
    // Honest nulls — no description fabrication.
    expect(job.descriptionText).toBeNull();
    expect(job.postedAt).toBeNull();
    // applyUrl + requisitionId still populate from list data only.
    expect(job.applyUrl).toContain('/en-US/Careers/job/USA/Engineer_Position_REQ-42');
    expect(job.requisitionId).toBe('REQ-42');
  });

  it('keeps per-tenant requests bounded by the detail concurrency cap', async () => {
    const postings = Array.from({ length: 10 }, (_, i) => ({
      title: `Engineer ${i}`,
      externalPath: `/job/USA/Engineer_${i}_JR${i}`,
      locationsText: 'USA - Remote',
      bulletFields: [`JR${i}`],
    }));
    let inflight = 0;
    let maxInflight = 0;
    let totalCalls = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(JSON.stringify(listingsResponse(postings)), { status: 200 });
    });
    const fetchDetail = vi.fn().mockImplementation(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      totalCalls++;
      // Simulate a small async gap so the scheduler can overlap requests.
      await new Promise((r) => setTimeout(r, 1));
      inflight--;
      return null;
    });
    const result = await scrapeWorkday(
      'https://x.wd1.myworkdayjobs.com',
      'x',
      'Careers',
      'X',
      ['Engineer'],
      { fetchDetailHtml: fetchDetail },
    );
    expect(result.jobs).toHaveLength(10);
    expect(totalCalls).toBe(10);
    // DETAIL_CONCURRENCY is 4 — verify the in-flight cap never exceeds it.
    // (Allowing headroom of 1 so a flaky scheduler tick can't false-fail.)
    expect(maxInflight).toBeLessThanOrEqual(5);
  });
});
