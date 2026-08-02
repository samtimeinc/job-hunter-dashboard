import { Router } from 'express';
import type {
  CompanyScope,
  JobFilters,
  JobSource,
  Visibility,
  WorkMode,
} from '@jobhunt/shared';
import { acknowledgeAll, hideJob, listJobs, unhideJob } from '../db/queries/jobs.js';
import { upsertTracker } from '../db/queries/trackers.js';
import { getStats } from '../db/queries/stats.js';
import { asyncHandler, HttpError } from './middleware.js';

export const jobsRouter = Router();

/** GET /api/jobs — list jobs with optional filters (query string). */
jobsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters: JobFilters = {
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sources: parseArray(req.query.sources) as JobSource[] | undefined,
      workModes: parseArray(req.query.workModes) as WorkMode[] | undefined,
      postedWithinDays: parseNumber(req.query.postedWithinDays),
      companyScope: parseCompanyScope(req.query.companyScope),
      visibility: parseVisibility(req.query.visibility),
      page: parseNumber(req.query.page),
      pageSize: parseNumber(req.query.pageSize),
    };
    const result = await listJobs(filters);
    res.json(result);
  }),
);

/** POST /api/jobs/acknowledge — clear the new badge. */
jobsRouter.post(
  '/acknowledge',
  asyncHandler(async (_req, res) => {
    res.json(await acknowledgeAll());
  }),
);

/** POST /api/jobs/:id/hide — hide a job from the default view. */
jobsRouter.post(
  '/:id/hide',
  asyncHandler(async (req, res) => {
    await hideJob(req.params.id ?? '');
    res.status(204).end();
  }),
);

/** DELETE /api/jobs/:id/hide — unhide a previously hidden job. */
jobsRouter.delete(
  '/:id/hide',
  asyncHandler(async (req, res) => {
    await unhideJob(req.params.id ?? '');
    res.status(204).end();
  }),
);

/** POST /api/jobs/:id/tracker — upsert tracker for a job. */
jobsRouter.post(
  '/:id/tracker',
  asyncHandler(async (req, res) => {
    const { status, appliedAt, notes } = req.body ?? {};
    if (!['to_apply', 'applied', 'interviewing'].includes(status)) {
      throw new HttpError(400, 'Invalid status');
    }
    await upsertTracker(req.params.id ?? '', { status, appliedAt, notes });
    res.status(204).end();
  }),
);

/** GET /api/stats — dashboard header counts. */
jobsRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json(await getStats());
  }),
);

function parseArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function parseCompanyScope(value: unknown): CompanyScope | undefined {
  if (value === 'all' || value === 'target' || value === 'other') return value;
  return undefined;
}

function parseVisibility(value: unknown): Visibility | undefined {
  if (value === 'active' || value === 'hidden') return value;
  return undefined;
}
