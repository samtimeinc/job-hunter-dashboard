import { describe, it, expect } from 'vitest';
import {
  detectCountry,
  detectSeniority,
  computeLocationEligibility,
  ELIGIBLE_COUNTRIES,
} from '../eligibility.js';

describe('detectCountry', () => {
  it.each([
    ['Seattle, WA', 'US'],
    ['Seattle, Washington, United States', 'US'],
    ['New York, NY, USA', 'US'],
    ['San Francisco, CA, United States', 'US'],
    ['Austin, TX', 'US'],
    ['USA - Remote', 'US'],
    ['Remote - United States', 'US'],
    // Canada — must NOT match the US-DC alias or any US state.
    ['Toronto, ON, Canada', 'CA'],
    ['Vancouver, BC', 'CA'],
    ['Canada - Remote', 'CA'],
    ['Montreal, Quebec', 'CA'],
    // UK / other
    ['London, United Kingdom', 'GB'],
    ['London, UK', 'GB'],
    // India
    ['Bengaluru, KA, India', 'IN'],
    ['IN-KA-Bengaluru', 'IN'],
  ])('resolves %s → %s', (input, expected) => {
    expect(detectCountry(input)).toBe(expected);
  });

  it('returns null when no country signal is present', () => {
    expect(detectCountry('Remote')).toBeNull();
    expect(detectCountry('Remote - Worldwide')).toBeNull();
    expect(detectCountry('')).toBeNull();
    expect(detectCountry(null)).toBeNull();
  });

  it('returns null for a region that is not a country ("Americas", "EMEA", "APAC")', () => {
    expect(detectCountry('Americas Only')).toBeNull();
    expect(detectCountry('EMEA')).toBeNull();
    expect(detectCountry('APAC - Remote')).toBeNull();
  });
});

describe('computeLocationEligibility', () => {
  it('marks US country codes as eligible', () => {
    expect(computeLocationEligibility('US', 'Seattle, WA', 'onsite')).toBe('eligible');
    expect(computeLocationEligibility('US', 'USA - Remote', 'remote')).toBe('eligible');
  });

  it('marks Canada as ineligible by default (the bug surface area)', () => {
    expect(computeLocationEligibility('CA', 'Canada - Remote', 'remote')).toBe('ineligible');
    expect(computeLocationEligibility('CA', 'Toronto, ON', 'onsite')).toBe('ineligible');
  });

  it('marks India as ineligible', () => {
    expect(computeLocationEligibility('IN', 'Bengaluru', 'onsite')).toBe('ineligible');
  });

  it('flags ambiguous remote-without-country as unknown (review-needed, not auto-eligible)', () => {
    // The whole point of the new field: bare 'Remote' is NOT eligible-by-default.
    expect(computeLocationEligibility(null, 'Remote', 'remote')).toBe('unknown');
    expect(computeLocationEligibility(null, 'Remote - Worldwide', 'remote')).toBe('unknown');
    expect(computeLocationEligibility(null, null, 'remote')).toBe('unknown');
  });

  it('derives eligibility from location string when country is null but location mentions US', () => {
    expect(computeLocationEligibility(null, 'Remote, United States', 'remote')).toBe('eligible');
    expect(computeLocationEligibility(null, 'Seattle, WA', 'onsite')).toBe('eligible');
    // Canada mentioned in location but no country code — detected as ineligible.
    expect(computeLocationEligibility(null, 'Remote, Canada', 'remote')).toBe('ineligible');
  });

  it('treats an explicit-but-unknown country code as ineligible (we know it is NOT in the eligible set)', () => {
    expect(computeLocationEligibility('ZZ', 'Nowhere', 'onsite')).toBe('ineligible');
  });

  it('exposes ELIGIBLE_COUNTRIES including US', () => {
    expect(ELIGIBLE_COUNTRIES.has('US')).toBe(true);
    expect(ELIGIBLE_COUNTRIES.has('CA')).toBe(false);
  });
});

describe('detectSeniority', () => {
  it.each([
    ['Senior Software Engineer', 'senior'],
    ['Staff Software Engineer', 'staff'],
    ['Principal Engineer', 'staff'],
    ['Engineering Manager', 'manager'],
    ['Director of Engineering', 'director'],
    ['Junior Developer', 'entry'],
    ['Software Engineer Intern', 'intern'],
    ['Internship - Engineering', 'intern'],
    ['Software Engineer II', 'senior'], // II = senior band per ATS convention
    ['Software Engineer', 'mid'], // no level → default sane bucket for IC
  ])('classifies %s → %s', (title, expected) => {
    expect(detectSeniority(title)).toBe(expected);
  });

  it('returns null for non-engineering roles with no level signal', () => {
    expect(detectSeniority('Operations Coordinator')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectSeniority('')).toBeNull();
    expect(detectSeniority(null)).toBeNull();
  });
});
