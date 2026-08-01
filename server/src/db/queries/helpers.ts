import { randomUUID } from 'node:crypto';

/** Generate primary keys. UUIDs keep inserts conflict-safe across sources. */
export function newId(): string {
  return randomUUID();
}

/** Stable lowercase slug for company names used in Greenhouse/Lever hostnames. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Builds a deterministic externalId from arbitrary uniqueness keys. */
export function hashExternal(...parts: (string | number)[]): string {
  return parts
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean)
    .join('::');
}

export function nowIso(): Date {
  return new Date();
}
