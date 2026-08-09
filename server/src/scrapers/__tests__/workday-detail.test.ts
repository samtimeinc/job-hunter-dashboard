import { describe, it, expect } from 'vitest';
import { parseWorkdayDetailHtml } from '../workday-detail.js';

/** Build a minimal Workday HTML page wrapping a JSON-LD JobPosting block. */
function workdayHtml(jsonLd: object): string {
  return [
    '<!doctype html><html><head>',
    '<meta name="description" content="stub" />',
    '<script type="application/ld+json">',
    JSON.stringify(jsonLd),
    '</script>',
    '</head><body>career page body</body></html>',
  ].join('\n');
}

describe('parseWorkdayDetailHtml', () => {
  it('extracts description, datePosted, country, locality, requisition id from a full JSON-LD block', () => {
    const ld = {
      title: 'AI Engineer',
      description: 'We are building AI tooling. &nbsp; Apply today.',
      datePosted: '2026-05-07',
      employmentType: 'OTHER',
      jobLocation: {
        address: {
          addressCountry: 'United States of America',
          addressLocality: 'USA - Remote',
        },
      },
      identifier: { name: 'AI Engineer', value: 'JR10000' },
    };
    const parsed = parseWorkdayDetailHtml(workdayHtml(ld));
    expect(parsed.description).toBe('We are building AI tooling. Apply today.');
    expect(parsed.datePosted).toBe('2026-05-07');
    // Country name normalises to ISO-2 so downstream eligibility checks
    // (ELIGIBLE_COUNTRIES.has(code)) work consistently.
    expect(parsed.country).toBe('US');
    expect(parsed.locality).toBe('USA - Remote');
    expect(parsed.requisitionId).toBe('JR10000');
  });

  it('returns null for every field when the page has no JSON-LD block', () => {
    const html = '<html><head></head><body>no ld+json here</body></html>';
    const parsed = parseWorkdayDetailHtml(html);
    expect(parsed.description).toBeNull();
    expect(parsed.datePosted).toBeNull();
    expect(parsed.country).toBeNull();
    expect(parsed.locality).toBeNull();
    expect(parsed.requisitionId).toBeNull();
    // The contract is "no fabrication" — every field genuinely null.
    expect(parsed.descriptionHtml).toBeNull();
  });

  it('treats a malformed JSON-LD block as if it were missing (never throws)', () => {
    const html =
      '<html><head><script type="application/ld+json">{ not valid json </script></head></html>';
    const parsed = parseWorkdayDetailHtml(html);
    expect(parsed.description).toBeNull();
    expect(parsed.datePosted).toBeNull();
  });

  it('preserves country = Canada for Canadian remote postings', () => {
    const ld = {
      title: 'Senior Software Developer',
      description: 'We are hiring.',
      datePosted: '2026-07-01',
      jobLocation: {
        address: {
          addressCountry: 'Canada',
          addressLocality: 'Canada - Remote',
        },
      },
    };
    const parsed = parseWorkdayDetailHtml(workdayHtml(ld));
    // Normalised to ISO-2 — "Canada" → "CA" so eligibility comparison works.
    expect(parsed.country).toBe('CA');
    expect(parsed.locality).toBe('Canada - Remote');
    expect(parsed.datePosted).toBe('2026-07-01');
  });

  it('returns descriptionHtml only when the body carries actual HTML markup', () => {
    // Plain text-only body — no block tags — should NOT set descriptionHtml.
    const plainLd = { description: 'Just plain text. No tags here.' };
    expect(parseWorkdayDetailHtml(workdayHtml(plainLd)).descriptionHtml).toBeNull();

    // HTML body — `<p>` + `<ul>` markers — should expose descriptionHtml.
    const htmlLd = { description: '<p>We are hiring.</p><ul><li>Remote OK</li></ul>' };
    const parsed = parseWorkdayDetailHtml(workdayHtml(htmlLd));
    expect(parsed.descriptionHtml).toContain('<p>We are hiring.</p>');
    expect(parsed.description).toBe('We are hiring. Remote OK');
  });

  it('never fabricates datePosted when absent — preserves the null contract', () => {
    const ld = { title: 'Untitled', description: 'no date on this one' };
    const parsed = parseWorkdayDetailHtml(workdayHtml(ld));
    expect(parsed.datePosted).toBeNull();
    // description still extracted so callers can use the partial data honestly.
    expect(parsed.description).toBe('no date on this one');
  });

  it('handles missing jobLocation / address fields without throwing', () => {
    const ld = { title: 'R', description: 'desc', datePosted: '2026-01-01' };
    const parsed = parseWorkdayDetailHtml(workdayHtml(ld));
    expect(parsed.country).toBeNull();
    expect(parsed.locality).toBeNull();
    expect(parsed.datePosted).toBe('2026-01-01');
    expect(parsed.description).toBe('desc');
  });

  it('handles empty html string gracefully', () => {
    const parsed = parseWorkdayDetailHtml('');
    expect(parsed.description).toBeNull();
    expect(parsed.datePosted).toBeNull();
  });
});
