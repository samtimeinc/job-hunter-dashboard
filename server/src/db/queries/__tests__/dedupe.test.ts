import { describe, it, expect } from 'vitest';
import {
  computeDuplicateGroupKey,
  normalizeCompany,
  normalizeTitle,
  normalizeLocation,
  fnv1a,
} from '../dedupe.js';

describe('normalizeCompany', () => {
  it('strips "Inc", "LLC", punctuation, and case', () => {
    expect(normalizeCompany('Stripe, Inc.')).toBe('stripe');
    expect(normalizeCompany('STRIPE INC')).toBe('stripe');
    expect(normalizeCompany('Airbnb LLC')).toBe('airbnb');
    expect(normalizeCompany('The Lego Group')).toBe('lego group');
  });
});

describe('normalizeTitle', () => {
  it('lowercases + collapses whitespace + strips punctuation', () => {
    expect(normalizeTitle('Senior Software Engineer')).toBe('senior software engineer');
    expect(normalizeTitle('Sr. Software Engineer (Remote)')).toBe('sr software engineer remote');
  });
});

describe('normalizeLocation', () => {
  it('extracts country + leading city token', () => {
    expect(normalizeLocation('Seattle, WA', 'US')).toBe('us:seattle');
    expect(normalizeLocation('Seattle, Washington, United States', 'US')).toBe('us:seattle');
  });
  it('falls back to "unknown" country when missing', () => {
    expect(normalizeLocation('Remote', null)).toBe('unknown:remote');
  });
});

describe('fnv1a', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a('Quantiphi|Senior Software Developer|ca:canada remote')).toBe(
      fnv1a('Quantiphi|Senior Software Developer|ca:canada remote'),
    );
  });
  it('returns different hashes for different inputs', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
});

describe('computeDuplicateGroupKey', () => {
  it('collapses two rows with the SAME requisition id (the URL-change case)', () => {
    const k1 = computeDuplicateGroupKey({
      company: 'Stripe',
      title: 'Senior Engineer',
      location: 'Seattle, WA',
      country: 'US',
      requisitionId: 'gh-42',
    });
    const k2 = computeDuplicateGroupKey({
      company: 'Stripe',
      title: 'Senior Engineer',
      location: 'Seattle, Washington, USA', // different text, same place
      country: 'US',
      requisitionId: 'gh-42', // same req id
    });
    expect(k1).toBe(k2);
  });

  it('DOES NOT collapse Quantiphi sibling requisitions (the duplicate-surface bug)', () => {
    // The production rows that looked like duplicates — same company, exact
    // same title + location, BUT different requisition ids.
    const jr11114 = computeDuplicateGroupKey({
      company: 'Quantiphi',
      title: 'Senior Software Developer',
      location: 'Canada - Remote',
      country: 'CA',
      requisitionId: 'JR11114',
    });
    const jr11145 = computeDuplicateGroupKey({
      company: 'Quantiphi',
      title: 'Senior Software Developer',
      location: 'Canada - Remote',
      country: 'CA',
      requisitionId: 'JR11145',
    });
    expect(jr11114).not.toBe(jr11145);
  });

  it('treats a missing requisition id as a looser (company+title+location) key', () => {
    // Two aggregator rows for the same posting with no source-provided id.
    const k1 = computeDuplicateGroupKey({
      company: 'Stripe',
      title: 'Senior Engineer',
      location: 'Seattle, WA',
      country: 'US',
    });
    const k2 = computeDuplicateGroupKey({
      company: 'stripe, inc.',
      title: 'Senior Engineer',
      location: 'Seattle, Washington, United States',
      country: 'US',
    });
    expect(k1).toBe(k2);
  });

  it('separates same-title/same-company rows in different locations', () => {
    const seattle = computeDuplicateGroupKey({
      company: 'Stripe',
      title: 'Engineer',
      location: 'Seattle, WA',
      country: 'US',
    });
    const ny = computeDuplicateGroupKey({
      company: 'Stripe',
      title: 'Engineer',
      location: 'New York, NY',
      country: 'US',
    });
    expect(seattle).not.toBe(ny);
  });

  it('is deterministic (same inputs → same key)', () => {
    const input = {
      company: 'Quantiphi',
      title: 'AI Engineer',
      location: 'USA - Remote',
      country: 'US',
      requisitionId: 'JR10000',
    };
    expect(computeDuplicateGroupKey(input)).toBe(computeDuplicateGroupKey(input));
  });
});
