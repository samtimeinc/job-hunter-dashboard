import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Job, JobFilters, JobListResponse, JobSource, WorkMode } from '@jobhunt/shared';
import { db, schema } from '../client.js';
import { newId } from './helpers.js';

const DEFAULT_LIMIT = 100;
/** Guard against absurd values coming from the client. */
const MAX_LIMIT = 200;

/** One-shot fetch for the dashboard: filtered jobs joined with trackers,
 *  plus count of new-since-last-visit for the badge. */
export async function listJobs(filters: JobFilters = {}): Promise<JobListResponse> {
  const conditions = [eq(schema.jobs.active, true)];

  // Visibility filter: default 'active' excludes hidden jobs; 'hidden' shows only them.
  if (filters.visibility === 'hidden') {
    conditions.push(sql`${schema.jobs.hiddenAt} IS NOT NULL`);
  } else {
    conditions.push(sql`${schema.jobs.hiddenAt} IS NULL`);
  }

  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(
      or(
        sql`${schema.jobs.title} ILIKE ${like}`,
        sql`${schema.jobs.company} ILIKE ${like}`,
      )!,
    );
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
    // posted_at may be null for sources without it; treat null as "recent enough"
    conditions.push(or(isNull(schema.jobs.postedAt), gte(schema.jobs.postedAt, cutoff))!);
  }

  const where = and(...conditions);

  // Run the page query and the total-count query in parallel — both apply the
  // same filters, so the count reflects what would be returned across all pages.
  const requestedLimit = clamp(filters.pageSize ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * requestedLimit;

  const [rows, [totalRow], [newCount]] = await Promise.all([
    db
      .select({
        job: schema.jobs,
        tracker: schema.applicationTrackers,
      })
      .from(schema.jobs)
      .leftJoin(
        schema.applicationTrackers,
        eq(schema.applicationTrackers.jobId, schema.jobs.id),
      )
      .where(where)
      .orderBy(
        // Unacknowledged jobs first (the "new" badge), then newest postings
        asc(schema.jobs.acknowledgedAt),
        desc(schema.jobs.postedAt),
        desc(schema.jobs.firstSeenAt),
      )
      .limit(requestedLimit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(where),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.active, true),
          isNull(schema.jobs.acknowledgedAt),
          sql`${schema.jobs.hiddenAt} IS NULL`,
        ),
      ),
  ]);

  const jobs = rows.map((r) => serializeJob(r.job, r.tracker ?? null));

  return {
    jobs,
    total: Number(totalRow?.count ?? 0),
    newSinceLastVisit: Number(newCount?.count ?? 0),
    page,
    pageSize: requestedLimit,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Mark all currently-unacknowledged jobs as seen. Clears the badge. */
export async function acknowledgeAll(): Promise<{ acknowledgedAt: string }> {
  const now = new Date();
  await db
    .update(schema.jobs)
    .set({ acknowledgedAt: now })
    .where(isNull(schema.jobs.acknowledgedAt));
  return { acknowledgedAt: now.toISOString() };
}

/** Hide a job — sets hiddenAt, removing it from default views. */
export async function hideJob(jobId: string): Promise<{ hiddenAt: string | null }> {
  const now = new Date();
  await db
    .update(schema.jobs)
    .set({ hiddenAt: now })
    .where(eq(schema.jobs.id, jobId));
  return { hiddenAt: now.toISOString() };
}

/** Restore a hidden job — clears hiddenAt. */
export async function unhideJob(jobId: string): Promise<{ hiddenAt: string | null }> {
  await db
    .update(schema.jobs)
    .set({ hiddenAt: null })
    .where(eq(schema.jobs.id, jobId));
  return { hiddenAt: null };
}

/**************************** INSERT PATH (used by scanners) ****************************/

export interface UpsertJobInput {
  externalId: string;
  source: JobSource;
  company: string;
  companySlug?: string | null;
  title: string;
  url: string;
  location?: string | null;
  workMode: WorkMode;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: 'year' | 'hour' | null;
  postedAt?: Date | null;
  tags?: string[];
  isTargetCompany: boolean;
}

/** Idempotent insert used by scanners.
 *  - On conflict (source + externalId): bump lastSeenAt, re-mark active, keep acked status.
 *  - Returns true if this was a NEW row (used for scan stats). */
export async function upsertJob(input: UpsertJobInput): Promise<boolean> {
  const existing = await db
    .select({ id: schema.jobs.id, active: schema.jobs.active })
    .from(schema.jobs)
    .where(
      and(eq(schema.jobs.source, input.source), eq(schema.jobs.externalId, input.externalId)),
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(schema.jobs)
      .set({
        lastSeenAt: new Date(),
        active: true,
        title: input.title,
        url: input.url,
        location: input.location ?? null,
        workMode: input.workMode,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        salaryCurrency: input.salaryCurrency ?? null,
        salaryPeriod: input.salaryPeriod ?? null,
        postedAt: input.postedAt ?? null,
      })
      .where(eq(schema.jobs.id, existing[0]!.id));
    return false;
  }

  await db.insert(schema.jobs).values({
    id: newId(),
    externalId: input.externalId,
    source: input.source,
    company: input.company,
    companySlug: input.companySlug ?? null,
    title: input.title,
    url: input.url,
    location: input.location ?? null,
    workMode: input.workMode,
    salaryMin: input.salaryMin ?? null,
    salaryMax: input.salaryMax ?? null,
    salaryCurrency: input.salaryCurrency ?? null,
    salaryPeriod: input.salaryPeriod ?? null,
    postedAt: input.postedAt ?? null,
    tags: input.tags ?? [],
    isTargetCompany: input.isTargetCompany,
    active: true,
  });
  return true;
}

/** Convert DB row (Date-typed timestamps) to JSON-safe shape that matches
 *  the shared Job type (ISO strings). */
function serializeJob(
  row: typeof schema.jobs.$inferSelect,
  tracker: typeof schema.applicationTrackers.$inferSelect | null,
): Job {
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
