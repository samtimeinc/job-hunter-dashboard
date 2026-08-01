import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Job, JobFilters, JobListResponse, JobSource, WorkMode } from '@jobhunt/shared';
import { db, schema } from '../client.js';
import { getDashboardSettings } from './settings.js';
import { newId } from './helpers.js';

const DEFAULT_LIMIT = 100;

/** One-shot fetch for the dashboard: filtered jobs joined with trackers,
 *  plus count of new-since-last-visit for the badge. */
export async function listJobs(filters: JobFilters = {}): Promise<JobListResponse> {
  const settings = await getDashboardSettings();
  const conditions = [eq(schema.jobs.active, true)];

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
  if (filters.targetCompaniesOnly) {
    conditions.push(eq(schema.jobs.isTargetCompany, true));
  }
  if (filters.postedWithinDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.postedWithinDays);
    // posted_at may be null for sources without it; treat null as "recent enough"
    conditions.push(or(isNull(schema.jobs.postedAt), gte(schema.jobs.postedAt, cutoff))!);
  }

  const rows = await db
    .select({
      job: schema.jobs,
      tracker: schema.applicationTrackers,
    })
    .from(schema.jobs)
    .leftJoin(
      schema.applicationTrackers,
      eq(schema.applicationTrackers.jobId, schema.jobs.id),
    )
    .where(and(...conditions))
    .orderBy(
      // Unacknowledged jobs first (the "new" badge), then newest postings
      asc(schema.jobs.acknowledgedAt),
      desc(schema.jobs.postedAt),
      desc(schema.jobs.firstSeenAt),
    )
    .limit(DEFAULT_LIMIT);

  const jobs = rows.map((r) => serializeJob(r.job, r.tracker ?? null));

  const [newCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.active, true), isNull(schema.jobs.acknowledgedAt)));

  return {
    jobs,
    total: jobs.length,
    newSinceLastVisit: Number(newCount?.count ?? 0),
  };
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
