import { describe, it, expect } from 'vitest';
import { classifyStatusFilter } from '../agent.js';

/**
 * Status-filter logic. The SQL builder delegates to {@link classifyStatusFilter}
 * for its branching, so these tests pin down which query shape fires for each
 * combination of statuses without needing a database.
 *
 * Semantics the dashboard + agent surface share:
 *   • A job with no tracker row is treated as implicitly `to_apply`.
 *   • Passing `to_apply` therefore includes untouched jobs.
 *   • Passing only `applied` / `interviewing` requires an explicit tracker.
 */
describe('classifyStatusFilter', () => {
  it("['to_apply'] → untouched-or-to_apply (the default worklist)", () => {
    expect(classifyStatusFilter(['to_apply'])).toBe('untouched_or_to_apply');
  });

  it("['to_apply','applied'] → untouched-or-any (worklist + applied)", () => {
    expect(classifyStatusFilter(['to_apply', 'applied'])).toBe('untouched_or_any');
  });

  it("['applied','interviewing'] → explicit_only (tracked jobs only)", () => {
    expect(classifyStatusFilter(['applied', 'interviewing'])).toBe('explicit_only');
  });

  it("['applied'] → explicit_only (single explicit status)", () => {
    expect(classifyStatusFilter(['applied'])).toBe('explicit_only');
  });

  it("['to_apply','applied','interviewing'] → untouched-or-any (full pipeline)", () => {
    expect(classifyStatusFilter(['to_apply', 'applied', 'interviewing'])).toBe('untouched_or_any');
  });
});
