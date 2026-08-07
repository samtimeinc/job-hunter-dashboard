import { Router } from 'express';
import type {
  AgentTrackerResponse,
  ApplicationStatus,
  UpdateTrackerRequest,
} from '@jobhunt/shared';
import { getAgentJob, listAgentJobs, parseAgentFilters } from '../db/queries/agent.js';
import { upsertTracker } from '../db/queries/trackers.js';
import { AGENT_OPENAPI, AGENT_API_INFO } from './agent-openapi.js';
import { asyncHandler, HttpError, requireAgentApiKey } from './middleware.js';

export const agentRouter = Router();

/** Every route under /api/agent requires the AGENT_API_KEY — including the
 *  OpenAPI document, so the schema is not leaked to anonymous callers. The one
 *  exception is /openapi.json itself serving the doc to authenticated agents
 *  who already hold the key. */
agentRouter.use(requireAgentApiKey);

/** GET /api/agent/openapi.json — machine-readable API description. */
agentRouter.get('/openapi.json', (_req, res) => {
  res.json(AGENT_OPENAPI);
});

/** GET /api/agent — quick capability summary + link to the spec. */
agentRouter.get('/', (_req, res) => {
  res.json(AGENT_API_INFO);
});

/** GET /api/agent/jobs — authenticated, cursor-paginated job search.
 *
 *  Reuses the same query layer the dashboard uses. Supports the full filter
 *  set plus `includeDescription=true` to opt into description bodies. */
agentRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const filters = parseAgentFilters(req.query as Record<string, unknown>);
    const result = await listAgentJobs(filters);
    res.json(result);
  }),
);

/** GET /api/agent/jobs/:id — fetch one complete job record.
 *
 *  Always includes description fields and the tracker row. 404 when unknown. */
agentRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await getAgentJob(req.params.id ?? '', { includeDescription: true });
    if (!job) throw new HttpError(404, 'Job not found');
    res.json({ job });
  }),
);

/** POST /api/agent/jobs/:id/tracker — update application-tracker status.
 *
 *  Mirrors the dashboard tracker endpoint but returns the updated record
 *  instead of 204 (so an agent can confirm the write). */
agentRouter.post(
  '/jobs/:id/tracker',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<UpdateTrackerRequest>;
    const status = body.status as ApplicationStatus | undefined;
    if (status !== 'to_apply' && status !== 'applied' && status !== 'interviewing') {
      throw new HttpError(400, 'Invalid status');
    }
    const jobId = req.params.id ?? '';
    // Verify the job exists first so we can return a precise 404 rather than
    // creating a dangling tracker for an unknown id.
    const existing = await getAgentJob(jobId);
    if (!existing) throw new HttpError(404, 'Job not found');

    const tracker = await upsertTracker(jobId, {
      status,
      appliedAt: body.appliedAt ?? null,
      notes: body.notes ?? null,
    });
    const payload: AgentTrackerResponse = { tracker };
    res.json(payload);
  }),
);
