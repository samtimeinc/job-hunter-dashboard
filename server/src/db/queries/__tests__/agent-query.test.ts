import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parseAgentFilters } from '../agent.js';
import type { AgentJob } from '@jobhunt/shared';

describe('agent cursor (encode/decode)', () => {
  it('round-trips a (firstSeenAt, id) pair through base64url', () => {
    const firstSeenAt = new Date('2026-08-05T12:34:56.000Z');
    const id = '11111111-2222-3333-4444-555555555555';
    const cursor = encodeCursor(firstSeenAt, id);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('='); // base64url, no padding
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    expect(decoded!.firstSeenAt.toISOString()).toBe(firstSeenAt.toISOString());
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('{bad json').toString('base64url'))).toBeNull();
  });

  it('returns null for a cursor missing required fields', () => {
    const payload = JSON.stringify({ i: 'abc' }); // no `t`
    expect(decodeCursor(Buffer.from(payload, 'utf8').toString('base64url'))).toBeNull();
  });

  it('returns null for an invalid date inside a well-formed cursor', () => {
    const payload = JSON.stringify({ t: 'not-a-date', i: 'abc' });
    expect(decodeCursor(Buffer.from(payload, 'utf8').toString('base64url'))).toBeNull();
  });
});

describe('parseAgentFilters', () => {
  it('parses comma-separated statuses/sources/workModes', () => {
    const f = parseAgentFilters({
      statuses: 'to_apply,applied',
      sources: 'greenhouse,lever',
      workModes: 'remote,hybrid',
    });
    expect(f.statuses).toEqual(['to_apply', 'applied']);
    expect(f.sources).toEqual(['greenhouse', 'lever']);
    expect(f.workModes).toEqual(['remote', 'hybrid']);
  });

  it('drops invalid status tokens', () => {
    const f = parseAgentFilters({ statuses: 'to_apply,bogus,interviewing' });
    expect(f.statuses).toEqual(['to_apply', 'interviewing']);
  });

  it('returns undefined for empty status list', () => {
    const f = parseAgentFilters({ statuses: 'bogus,still-bogus' });
    expect(f.statuses).toBeUndefined();
  });

  it('parses booleans (active, includeDescription)', () => {
    expect(parseAgentFilters({ active: 'true' }).active).toBe(true);
    expect(parseAgentFilters({ active: '0' }).active).toBe(false);
    expect(parseAgentFilters({ active: 'maybe' }).active).toBeUndefined();
    expect(parseAgentFilters({ includeDescription: 'true' }).includeDescription).toBe(true);
    expect(parseAgentFilters({}).includeDescription).toBe(false);
  });

  it('parses numbers (limit, postedWithinDays, page)', () => {
    const f = parseAgentFilters({ limit: '25', postedWithinDays: '14', page: '3' });
    expect(f.limit).toBe(25);
    expect(f.postedWithinDays).toBe(14);
    expect(f.page).toBe(3);
  });

  it('clamps visibility to known values', () => {
    expect(parseAgentFilters({ visibility: 'all' }).visibility).toBe('all');
    expect(parseAgentFilters({ visibility: 'something' }).visibility).toBeUndefined();
  });
});

/** Build a minimal AgentJob used by the shape tests below — only the fields
 *  that the route actually serialise, so the test mirrors the contract. */
function sampleAgentJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'job-1',
    externalId: 'gh-42',
    source: 'greenhouse',
    company: 'Stripe',
    companySlug: 'stripe',
    title: 'Senior Engineer',
    url: 'https://boards.greenhouse.io/stripe/jobs/42',
    location: 'Seattle, WA',
    workMode: 'remote',
    salaryMin: 180000,
    salaryMax: 240000,
    salaryCurrency: 'USD',
    salaryPeriod: 'year',
    postedAt: '2026-08-01T00:00:00.000Z',
    firstSeenAt: '2026-08-02T00:00:00.000Z',
    lastSeenAt: '2026-08-05T00:00:00.000Z',
    active: true,
    tags: ['Engineering'],
    isTargetCompany: true,
    acknowledgedAt: null,
    hiddenAt: null,
    descriptionText: null,
    descriptionHtml: null,
    applyUrl: null,
    companyDomain: 'stripe.com',
    tracker: null,
    ...overrides,
  };
}

describe('AgentJob shape (description nullability)', () => {
  it('keeps description fields null by default', () => {
    const job = sampleAgentJob();
    expect(job.descriptionText).toBeNull();
    expect(job.descriptionHtml).toBeNull();
  });

  it('allows description fields to be populated when present', () => {
    const job = sampleAgentJob({
      descriptionText: 'We are hiring…',
      descriptionHtml: '<p>We are hiring…</p>',
    });
    expect(job.descriptionText).toBe('We are hiring…');
    expect(job.descriptionHtml).toBe('<p>We are hiring…</p>');
  });

  it('preserves applyUrl and companyDomain as nullable detail fields', () => {
    expect(sampleAgentJob().applyUrl).toBeNull();
    expect(sampleAgentJob().companyDomain).toBe('stripe.com');
    expect(sampleAgentJob({ applyUrl: 'https://apply.example.com/j/42' }).applyUrl).toBe(
      'https://apply.example.com/j/42',
    );
  });

  it('includes tracker field that may be null', () => {
    expect(sampleAgentJob().tracker).toBeNull();
    const withTracker = sampleAgentJob({
      tracker: {
        id: 't-1',
        jobId: 'job-1',
        status: 'to_apply',
        appliedAt: null,
        notes: null,
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
    });
    expect(withTracker.tracker?.status).toBe('to_apply');
  });
});
