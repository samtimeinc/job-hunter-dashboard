import { eq } from 'drizzle-orm';
import type { ApplicationStatus, UpdateTrackerRequest } from '@jobhunt/shared';
import { db, schema } from '../client.js';
import { newId } from './helpers.js';

/** Upsert a tracker row for a job. On conflict, update status/notes/appliedAt. */
export async function upsertTracker(
  jobId: string,
  input: UpdateTrackerRequest,
): Promise<void> {
  const appliedAt =
    input.status !== 'to_apply'
      ? (input.appliedAt ? new Date(input.appliedAt) : new Date())
      : null;

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
    return;
  }

  await db.insert(schema.applicationTrackers).values({
    id: newId(),
    jobId,
    status: input.status as ApplicationStatus,
    appliedAt,
    notes: input.notes ?? null,
    updatedAt: new Date(),
  });
}
