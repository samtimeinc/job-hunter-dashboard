import { and, desc, eq, gte, inArray, isNotNull, isNull, not, or, sql, lt } from 'drizzle-orm';
import type {
  AgentJob,
  AgentJobDataQuality,
  AgentJobFilters,
  AgentJobListResponse,
  ApplicationStatus,
  CompanyScope,
  JobSource,
  Seniority,
  Visibility,
  WorkMode,
} from '@jobhunt/shared';
import { db, schema } from '../client.js';
import {
  ELIGIBLE_COUNTRIES,
  computeLocationEligibility,
} from '../../scrapers/eligibility.js';
import { computeDuplicateGroupKey } from './dedupe.js';

const DEFAULT_LIMIT = 50;
/** Hard cap per request — agents can ask for up to 200, no more. */
const MAX_LIMIT = 200;

/**
 * Agent-facing job search.
 *
 * Mirrors the dashboard `listJobs()` filter set (minus the new-since-visit
 * badge, which is UI-only) and adds:
 *   • cursor-based pagination (preferred over page/pageSize for stable
 *     iteration across inserts)
 *   • an `includeDescription` flag so callers can keep payloads small until
 *     they actually need the description body
 *   • an `active` flag (default true) so callers can include stale rows
 *
 * Auth is enforced at the route layer (`requireAgentApiKey`), so this function
 * assumes the caller is trusted.
 */
export async function listAgentJobs(filters: AgentJobFilters = {}): Promise<AgentJobListResponse> {
  // Conditions that apply BOTH to the page query and the total count.
  // Kept separate from the cursor predicate, which only narrows the page.
  const conditions = [];

  // active filter — default true (still seen in the latest scan). Pass
  // `active=false` to include closed/stale rows; no value = active only.
  const includeActive = filters.active ?? true;
  if (includeActive === true) {
    conditions.push(eq(schema.jobs.active, true));
  } else if (includeActive === false) {
    conditions.push(eq(schema.jobs.active, false));
  }

  // visibility — 'active' (default) excludes hidden; 'hidden' shows only
  // hidden rows; 'all' returns everything the agent can see.
  const visibility = filters.visibility ?? 'active';
  if (visibility === 'hidden') {
    conditions.push(sql`${schema.jobs.hiddenAt} IS NOT NULL`);
  } else if (visibility === 'active') {
    conditions.push(sql`${schema.jobs.hiddenAt} IS NULL`);
  }
  // 'all' → no hidden filter.

  if (filters.search) {
    const like = `%${filters.search}%`;
    const searchTerms = [
      sql`${schema.jobs.title} ILIKE ${like}`,
      sql`${schema.jobs.company} ILIKE ${like}`,
      // Also allow searching the description body when present, but only
      // when descriptions are requested (avoid double-costing when caller
      // asked for a light payload).
      ...(filters.includeDescription ? [sql`${schema.jobs.descriptionText} ILIKE ${like}`] : []),
    ];
    conditions.push(or(...searchTerms)!);
  }
  if (filters.sources?.length) {
    conditions.push(inArray(schema.jobs.source, filters.sources as JobSource[]));
  }
  if (filters.workModes?.length) {
    conditions.push(inArray(schema.jobs.workMode, filters.workModes as WorkMode[]));
  }
  if (filters.companyScope === 'target') {
    conditions.push(eq(schema.jobs.isTargetCompany, true));
  } else if (filters.companyScope === 'other') {
    conditions.push(eq(schema.jobs.isTargetCompany, false));
  }
  if (filters.postedWithinDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.postedWithinDays);
    conditions.push(or(isNull(schema.jobs.postedAt), gte(schema.jobs.postedAt, cutoff))!);
  }
  if (filters.statuses?.length) {
    // Same semantics as the dashboard: 'to_apply' includes untouched jobs.
    conditions.push(buildStatusCondition(filters.statuses));
  }
  if (filters.seniorities?.length) {
    conditions.push(inArray(schema.jobs.seniority, filters.seniorities as Seniority[]));
  }
  if (filters.countries?.length) {
    conditions.push(inArray(schema.jobs.country, filters.countries));
  }
  // Eligibility — derived from the `country` column.
  //   • eligible=true                       ⇒ countries in ELIGIBLE_COUNTRIES only
  //   • eligible=true + includeUnknownEligibility=true
  //                                         ⇒ eligible OR country IS NULL
  //   • eligible=false (rare)               ⇒ jobs whose country is NOT eligible
  // The default (eligible undefined) leaves the filter off so existing callers
  // see every row — agent contract is additive.
  if (filters.eligible === true) {
    const eligibleCodes = Array.from(ELIGIBLE_COUNTRIES);
    if (filters.includeUnknownEligibility) {
      conditions.push(
        or(inArray(schema.jobs.country, eligibleCodes), isNull(schema.jobs.country))!,
      );
    } else {
      conditions.push(inArray(schema.jobs.country, eligibleCodes));
    }
  } else if (filters.eligible === false) {
    // Anything NOT in the eligible set, excluding nulls so we don't surface
    // every unknown-eligibility row.
    const usableCodes = Array.from(ELIGIBLE_COUNTRIES);
    conditions.push(
      and(
        isNotNull(schema.jobs.country),
        not(inArray(schema.jobs.country, usableCodes)),
      ),
    );
  }

  const where = and(...conditions);
  const hasTrackerJoin = Boolean(filters.statuses?.length);

  // --- page query (with cursor predicate) ---
  // Order deterministically by firstSeenAt DESC, id DESC so inserts during a
  // paginated walk don't shift rows. The cursor simply continues after the
  // last row of the previous page.
  let cursorCondition: ReturnType<typeof or> | undefined;
  if (filters.cursor) {
    const cursorTuple = decodeCursor(filters.cursor);
    if (cursorTuple) {
      cursorCondition = or(
        lt(schema.jobs.firstSeenAt, cursorTuple.firstSeenAt),
        and(
          eq(schema.jobs.firstSeenAt, cursorTuple.firstSeenAt),
          lt(schema.jobs.id, cursorTuple.id),
        ),
      )!;
    }
    // Malformed cursor → ignore it (caller restarts from page 1).
  }

  const pageWhere = cursorCondition ? and(where, cursorCondition) : where;

  // Request one extra row so we can tell whether another page exists.
  const requestedLimit = clamp(filters.limit ?? filters.pageSize ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const fetchLimit = requestedLimit + 1;

  // Build the page + count queries together — share the join, differ on the
  // where clause (count omits the cursor predicate so total reflects the
  // full match set across all pages).
  const pageQuery = db
    .select({
      job: schema.jobs,
      tracker: schema.applicationTrackers,
    })
    .from(schema.jobs)
    .leftJoin(schema.applicationTrackers, eq(schema.applicationTrackers.jobId, schema.jobs.id))
    .where(pageWhere)
    .orderBy(desc(schema.jobs.firstSeenAt), desc(schema.jobs.id))
    .limit(fetchLimit);

  const countQuery = hasTrackerJoin
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.jobs)
        .leftJoin(schema.applicationTrackers, eq(schema.applicationTrackers.jobId, schema.jobs.id))
        .where(where)
    : db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.jobs)
        .where(where);

  const [pageRows, [totalRow]] = await Promise.all([pageQuery, countQuery]);

  const hasNextPage = pageRows.length > requestedLimit;
  const pageRowsSlice = pageRows.slice(0, requestedLimit);

  // Compute the per-row duplicate-group keys for this page (used both to fold
  // siblings when collapseDuplicates=true AND to populate the
  // `dataQuality.possibleDuplicate` flag). We persist `duplicate_group_key`
  // at insert time so this lookup is a single cheap `WHERE IN (...) GROUP BY`
  // instead of an O(N) full-table scan per request.
  const groupKeys = new Map<string, string>(); // jobId → groupKey
  for (const r of pageRowsSlice) {
    groupKeys.set(r.job.id, r.job.duplicateGroupKey ?? computeDuplicateGroupKey({
      company: r.job.company,
      title: r.job.title,
      location: r.job.location,
      country: r.job.country,
      requisitionId: r.job.requisitionId,
    }));
  }

  // One grouped count lookup across the whole jobs table — restricted to the
  // group keys present on this page. Returns only keys that occur more than
  // once in the global sibling set (so `possibleDuplicate` reflects ALL known
  // rows, not just the visible page).
  const groupOccurrences = new Map<string, number>();
  if (groupKeys.size > 0) {
    const keyList = Array.from(new Set(groupKeys.values()));
    const rows = await db
      .select({ key: schema.jobs.duplicateGroupKey, count: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(inArray(schema.jobs.duplicateGroupKey, keyList))
      .groupBy(schema.jobs.duplicateGroupKey);
    for (const r of rows) {
      if (r.key && r.count > 1) groupOccurrences.set(r.key, r.count);
    }
  }

  const collapsed =
    filters.collapseDuplicates && pageRowsSlice.length > 0
      ? collapseRows(pageRowsSlice, groupKeys)
      : pageRowsSlice;

  const jobs = collapsed.map((r) => {
    const groupKey = groupKeys.get(r.job.id) ?? '';
    const possibleDuplicate = (groupOccurrences.get(groupKey) ?? 0) > 1;
    return serializeAgentJob(r.job, r.tracker ?? null, filters.includeDescription, {
      duplicateGroupKey: groupKey,
      possibleDuplicate,
    });
  });

  let nextCursor: string | null = null;
  if (hasNextPage && pageRowsSlice.length > 0) {
    const last = pageRowsSlice[pageRowsSlice.length - 1]!.job;
    nextCursor = encodeCursor(last.firstSeenAt, last.id);
  }

  return {
    jobs,
    total: Number(totalRow?.count ?? 0),
    nextCursor,
  };
}

/** Collapse rows sharing a duplicate-group key to a single representative
 *  (the most recently seen per group). Preserves the row order from the page
 *  query so the existing ordering stays stable in the response. */
function collapseRows(
  rows: { job: typeof schema.jobs.$inferSelect; tracker: typeof schema.applicationTrackers.$inferSelect | null }[],
  groupKeys: Map<string, string>,
): { job: typeof schema.jobs.$inferSelect; tracker: typeof schema.applicationTrackers.$inferSelect | null }[] {
  const seen = new Set<string>();
  const out: typeof rows = [];
  for (const r of rows) {
    const key = groupKeys.get(r.job.id) ?? r.job.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Build the SQL condition for the `statuses` filter. 'to_apply' is treated as
 *  the implicit default for every job — a job with no tracker row is therefore
 *  included when 'to_apply' is requested. */
function buildStatusCondition(statuses: ApplicationStatus[]) {
  const kind = classifyStatusFilter(statuses);
  switch (kind) {
    case 'untouched_or_to_apply':
      return or(
        isNull(schema.applicationTrackers.jobId),
        eq(schema.applicationTrackers.status, 'to_apply'),
      )!;
    case 'untouched_or_any':
      return or(
        isNull(schema.applicationTrackers.jobId),
        inArray(schema.applicationTrackers.status, statuses),
      )!;
    case 'explicit_only':
      return inArray(
        schema.applicationTrackers.status,
        statuses.filter((s) => s !== 'to_apply'),
      );
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Pure decision function for the status filter — exported so tests can verify
 *  branching without standing up a database. Returns a tag describing which
 *  SQL shape the filter will emit. */
export type StatusFilterKind = 'untouched_or_to_apply' | 'untouched_or_any' | 'explicit_only';
export function classifyStatusFilter(statuses: ApplicationStatus[]): StatusFilterKind {
  const includeUntouched = statuses.includes('to_apply');
  const explicitStatuses = statuses.filter((s) => s !== 'to_apply');
  if (includeUntouched && explicitStatuses.length === 0) {
    return 'untouched_or_to_apply';
  }
  if (includeUntouched) {
    return 'untouched_or_any';
  }
  return 'explicit_only';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Encode (firstSeenAt, id) into an opaque base64 cursor. The contents are not
 *  secret — they're just a pagination bookmark — but wrapping them keeps the
 *  API contract plausibly stable if we later change the ordering key. */
export function encodeCursor(firstSeenAt: Date, id: string): string {
  const payload = JSON.stringify({
    t: firstSeenAt.toISOString(),
    i: id,
    v: 1,
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/** Decode a cursor produced by {@link encodeCursor}. Returns null on a
 *  malformed/expired value so the caller can simply start over from page 1. */
export function decodeCursor(cursor: string): { firstSeenAt: Date; id: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: string;
      i?: string;
      v?: number;
    };
    if (!payload?.t || !payload?.i) return null;
    const d = new Date(payload.t);
    if (Number.isNaN(d.getTime())) return null;
    return { firstSeenAt: d, id: payload.i };
  } catch {
    return null;
  }
}

/** Fetch a single job by id with joined tracker + detail fields. Returns
 *  null when the row doesn't exist (so the route can emit a 404). */
export async function getAgentJob(
  jobId: string,
  opts: { includeDescription?: boolean } = {},
): Promise<AgentJob | null> {
  const [row] = await db
    .select({
      job: schema.jobs,
      tracker: schema.applicationTrackers,
    })
    .from(schema.jobs)
    .leftJoin(schema.applicationTrackers, eq(schema.applicationTrackers.jobId, schema.jobs.id))
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  if (!row) return null;
  return serializeAgentJob(row.job, row.tracker ?? null, opts.includeDescription ?? true, {
    duplicateGroupKey: row.job.duplicateGroupKey ?? '',
    possibleDuplicate: false, // getAgentJob doesn't run the group-occurrence lookup
  });
}

/** Per-job extra metadata computed at query time. Used by serializeAgentJob
 *  so the single-item and list endpoints share the same code path. */
interface AgentJobExtras {
  duplicateGroupKey: string;
  possibleDuplicate: boolean;
}

/** Serialise a DB row to the AgentJob shape. Description fields are stripped
 *  unless `includeDescription` is true (callers who don't need the body keep
 *  their payloads small). All other detail fields (applyUrl, companyDomain)
 *  are always included because they're cheap and useful for routing. */
function serializeAgentJob(
  row: typeof schema.jobs.$inferSelect,
  tracker: typeof schema.applicationTrackers.$inferSelect | null,
  includeDescription?: boolean,
  extras?: AgentJobExtras,
): AgentJob {
  const duplicateGroupKey = extras?.duplicateGroupKey ?? row.duplicateGroupKey ?? '';
  const possibleDuplicate = extras?.possibleDuplicate ?? false;
  const country = row.country ?? null;
  const dataQuality: AgentJobDataQuality = {
    hasDescription: Boolean(row.descriptionText && row.descriptionText.trim().length > 0),
    hasApplyUrl: Boolean((row.applyUrl ?? '').trim().length > 0 || (row.url ?? '').trim().length > 0),
    hasPostedAt: row.postedAt != null,
    locationEligibility: computeLocationEligibility(country, row.location, row.workMode),
    country,
    possibleDuplicate,
  };
  return {
    id: row.id,
    externalId: row.externalId,
    source: row.source,
    company: row.company,
    companySlug: row.companySlug ?? null,
    title: row.title,
    url: row.url,
    location: row.location ?? null,
    workMode: row.workMode,
    salaryMin: row.salaryMin ?? null,
    salaryMax: row.salaryMax ?? null,
    salaryCurrency: row.salaryCurrency ?? null,
    salaryPeriod: row.salaryPeriod ?? null,
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    tags: row.tags ?? [],
    isTargetCompany: row.isTargetCompany,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
    active: row.active,
    // Detail fields.
    descriptionText: includeDescription ? (row.descriptionText ?? null) : null,
    descriptionHtml: includeDescription ? (row.descriptionHtml ?? null) : null,
    applyUrl: row.applyUrl ?? null,
    companyDomain: row.companyDomain ?? null,
    country,
    requisitionId: row.requisitionId ?? null,
    seniority: row.seniority ?? null,
    duplicateGroupKey,
    dataQuality,
    tracker: tracker
      ? {
          id: tracker.id,
          jobId: tracker.jobId,
          status: tracker.status,
          appliedAt: tracker.appliedAt ? tracker.appliedAt.toISOString() : null,
          notes: tracker.notes ?? null,
          updatedAt: tracker.updatedAt.toISOString(),
        }
      : null,
  };
}

/** Helper for route handlers — parse the agent filter query string.
 *  Kept here so it shares the source/workMode/status string set with the
 *  query layer rather than being duplicated at the route. */
export function parseAgentFilters(query: Record<string, unknown>): AgentJobFilters {
  return {
    search: typeof query.search === 'string' ? query.search : undefined,
    statuses: parseStatusList(query.statuses),
    sources: parseList(query.sources) as JobSource[] | undefined,
    workModes: parseList(query.workModes) as WorkMode[] | undefined,
    companyScope: parseCompanyScope(query.companyScope),
    visibility: parseAgentVisibility(query.visibility),
    postedWithinDays: parseNumber(query.postedWithinDays),
    active: parseBool(query.active),
    limit: parseNumber(query.limit),
    pageSize: parseNumber(query.pageSize),
    page: parseNumber(query.page),
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
    includeDescription: parseBool(query.includeDescription) ?? false,
    eligible: parseBool(query.eligible),
    includeUnknownEligibility: parseBool(query.includeUnknownEligibility),
    countries: parseList(query.countries)?.map((c) => c.toUpperCase()),
    seniorities: parseList(query.seniorities) as Seniority[] | undefined,
    collapseDuplicates: parseBool(query.collapseDuplicates),
  };
}

function parseList(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

const STATUSES: ReadonlySet<ApplicationStatus> = new Set(['to_apply', 'applied', 'interviewing']);
function parseStatusList(value: unknown): ApplicationStatus[] | undefined {
  const list = parseList(value);
  if (!list?.length) return undefined;
  const filtered = list.filter((s): s is ApplicationStatus => STATUSES.has(s as ApplicationStatus));
  return filtered.length ? filtered : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return undefined;
}

function parseCompanyScope(value: unknown): CompanyScope | undefined {
  if (value === 'all' || value === 'target' || value === 'other') return value;
  return undefined;
}

function parseAgentVisibility(value: unknown): Visibility | 'all' | undefined {
  if (value === 'active' || value === 'hidden' || value === 'all') return value;
  return undefined;
}
