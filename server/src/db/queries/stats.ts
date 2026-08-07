import { and, count, eq, isNull } from 'drizzle-orm';
import type { ApplicationStatus, StatsResponse } from '@jobhunt/shared';
import { db, schema } from '../client.js';

/** Aggregate counts powering the dashboard header.
 *  Hidden jobs are excluded from every count — they're effectively off-dashboard. */
export async function getStats(): Promise<StatsResponse> {
  const visible = and(eq(schema.jobs.active, true), isNull(schema.jobs.hiddenAt));

  const [totalRow] = await db.select({ total: count() }).from(schema.jobs).where(visible);

  const [newRow] = await db
    .select({ count: count() })
    .from(schema.jobs)
    .where(and(visible, isNull(schema.jobs.acknowledgedAt)));

  const [targetRow] = await db
    .select({ count: count() })
    .from(schema.jobs)
    .where(and(visible, eq(schema.jobs.isTargetCompany, true)));

  const statusRows = await db
    .select({
      status: schema.applicationTrackers.status,
      count: count(),
    })
    .from(schema.applicationTrackers)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.applicationTrackers.jobId))
    .where(visible)
    .groupBy(schema.applicationTrackers.status);

  const sourceRows = await db
    .select({
      source: schema.jobs.source,
      count: count(),
    })
    .from(schema.jobs)
    .where(visible)
    .groupBy(schema.jobs.source);

  return {
    total: Number(totalRow?.total ?? 0),
    newSinceLastVisit: Number(newRow?.count ?? 0),
    targetCompanyCount: Number(targetRow?.count ?? 0),
    byStatus: {
      to_apply: 0,
      applied: 0,
      interviewing: 0,
      ...Object.fromEntries(statusRows.map((r) => [r.status, Number(r.count)])),
    } as Record<ApplicationStatus, number>,
    bySource: Object.fromEntries(sourceRows.map((r) => [r.source, Number(r.count)])),
  };
}
