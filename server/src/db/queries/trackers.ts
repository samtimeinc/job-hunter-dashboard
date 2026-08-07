import { eq } from 'drizzle-orm';
import type { ApplicationStatus, ApplicationTracker, UpdateTrackerRequest } from '@jobhunt/shared';
import { db, schema } from '../client.js';
import { newId } from './helpers.js';

/** Upsert a tracker row for a job. On conflict, update status/notes/appliedAt.
 *  Returns the resulting tracker row (serialised to the shared shape). */
export async function upsertTracker(
  jobId: string,
  input: UpdateTrackerRequest,
): Promise<ApplicationTracker> {
  const appliedAt =
    input.status !== 'to_apply' ? (input.appliedAt ? new Date(input.appliedAt) : new Date()) : null;

  const existing = await db
    .select({ id: schema.applicationTrackers.id })
    .from(schema.applicationTrackers)
    .where(eq(schema.applicationTrackers.jobId, jobId))
    .limit(1);

  if (existing.length) {
    await db
      .update(schema.applicationTrackers)
      .set({
        status: input.status,
        appliedAt,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.applicationTrackers.id, existing[0]!.id));
  } else {
    await db.insert(schema.applicationTrackers).values({
      id: newId(),
      jobId,
      status: input.status as ApplicationStatus,
      appliedAt,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    });
  }

  const [row] = await db
    .select()
    .from(schema.applicationTrackers)
    .where(eq(schema.applicationTrackers.jobId, jobId))
    .limit(1);
  if (!row) {
    // Should be unreachable after the insert/update above — surface a clear
    // error rather than returning a fabricated record.
    throw new Error(`tracker upsert produced no row for job ${jobId}`);
  }
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
