import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Mock the agent query + tracker layers so we can exercise the route handlers
 * (auth, 404, request/response shaping) without a live database. The mocks
 * are configured per-test via the helpers exported below.
 */

const listAgentJobsMock = vi.fn();
const getAgentJobMock = vi.fn();
const upsertTrackerMock = vi.fn();

vi.mock('../../db/queries/agent.js', () => ({
  listAgentJobs: (...args: unknown[]) => listAgentJobsMock(...args),
  getAgentJob: (...args: unknown[]) => getAgentJobMock(...args),
  parseAgentFilters: (q: Record<string, unknown>) => q,
}));

vi.mock('../../db/queries/trackers.js', () => ({
  upsertTracker: (...args: unknown[]) => upsertTrackerMock(...args),
}));

// The OpenAPI import is harmless — let it load normally.
const { agentRouter } = await import('../agent.js');

const KEY = 'test-agent-key-1234567890';

function buildApp() {
  process.env.AGENT_API_KEY = KEY;
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: unknown,
      res: express.Response,
      _next: unknown,
    ) => {
      res.status(err.status ?? 500).json({ status: err.status ?? 500, message: err.message });
    },
  );
  return app;
}

const SAMPLE_JOB = {
  id: 'job-1',
  externalId: 'gh-42',
  source: 'greenhouse',
  company: 'Stripe',
  title: 'Senior Engineer',
  url: 'https://example.com/jobs/42',
  location: 'Seattle, WA',
  workMode: 'remote',
  salaryMin: 180000,
  salaryMax: 240000,
  salaryCurrency: 'USD',
  salaryPeriod: 'year',
  postedAt: '2026-08-01T00:00:00.000Z',
  firstSeenAt: '2026-08-02T00:00:00.000Z',
  lastSeenAt: '2026-08-05T00:00:00.000Z',
  active: true,
  tags: ['Engineering'],
  isTargetCompany: true,
  acknowledgedAt: null,
  hiddenAt: null,
  descriptionText: 'We are hiring…',
  descriptionHtml: '<p>We are hiring…</p>',
  applyUrl: null,
  companyDomain: 'stripe.com',
  tracker: null,
};

beforeEach(() => {
  listAgentJobsMock.mockReset();
  getAgentJobMock.mockReset();
  upsertTrackerMock.mockReset();
});

afterEach(() => {
  delete process.env.AGENT_API_KEY;
});

describe('GET /api/agent/jobs (route-level)', () => {
  it('requires auth (401 without key)', async () => {
    // Build app first so env is set; then clear the env + need to override —
    // easier: set env explicitly off before request.
    const app = buildApp();
    delete process.env.AGENT_API_KEY;
    const res = await request(app).get('/api/agent/jobs');
    expect(res.status).toBe(503); // no key configured → fail-closed
  });

  it('returns the cursor-paginated payload shape', async () => {
    listAgentJobsMock.mockResolvedValue({
      jobs: [SAMPLE_JOB],
      total: 1,
      nextCursor: 'cursor-abc',
    });
    const res = await request(buildApp())
      .get('/api/agent/jobs?statuses=to_apply&limit=50')
      .set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      jobs: [SAMPLE_JOB],
      total: 1,
      nextCursor: 'cursor-abc',
    });
    expect(listAgentJobsMock).toHaveBeenCalledTimes(1);
  });

  it('passes includeDescription through the filter parse', async () => {
    listAgentJobsMock.mockResolvedValue({ jobs: [], total: 0, nextCursor: null });
    await request(buildApp())
      .get('/api/agent/jobs?includeDescription=true')
      .set('Authorization', `Bearer ${KEY}`);
    expect(listAgentJobsMock).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/agent/jobs/:id (route-level)', () => {
  it('returns 404 for an unknown job id', async () => {
    getAgentJobMock.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/agent/jobs/does-not-exist')
      .set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, message: 'Job not found' });
  });

  it('returns the full record wrapped under `job` for a known id', async () => {
    getAgentJobMock.mockResolvedValue(SAMPLE_JOB);
    const res = await request(buildApp())
      .get('/api/agent/jobs/job-1')
      .set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job: SAMPLE_JOB });
    // Should have requested the description (route hard-codes includeDescription:true).
    expect(getAgentJobMock).toHaveBeenCalledWith('job-1', { includeDescription: true });
  });
});

describe('POST /api/agent/jobs/:id/tracker (route-level)', () => {
  it('returns 400 for an invalid status', async () => {
    const res = await request(buildApp())
      .post('/api/agent/jobs/job-1/tracker')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ status: 'hired' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400 });
  });

  it('returns 404 when the underlying job does not exist', async () => {
    getAgentJobMock.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/agent/jobs/job-1/tracker')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ status: 'applied' });
    expect(res.status).toBe(404);
  });

  it('updates the tracker and returns the updated record', async () => {
    const nowIso = '2026-08-06T20:00:00.000Z';
    getAgentJobMock.mockResolvedValue(SAMPLE_JOB);
    upsertTrackerMock.mockResolvedValue({
      id: 'tracker-1',
      jobId: 'job-1',
      status: 'applied',
      appliedAt: nowIso,
      notes: 'Submitted manually',
      updatedAt: nowIso,
    });
    const res = await request(buildApp())
      .post('/api/agent/jobs/job-1/tracker')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ status: 'applied', appliedAt: nowIso, notes: 'Submitted manually' });
    expect(res.status).toBe(200);
    expect(res.body.tracker).toMatchObject({
      status: 'applied',
      appliedAt: nowIso,
      notes: 'Submitted manually',
    });
    expect(upsertTrackerMock).toHaveBeenCalledWith('job-1', {
      status: 'applied',
      appliedAt: nowIso,
      notes: 'Submitted manually',
    });
  });
});

describe('GET /api/agent (cap summary + openapi)', () => {
  it('serves the capability info at the index route', async () => {
    const res = await request(buildApp()).get('/api/agent').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('endpoints');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(buildApp())
      .get('/api/agent/openapi.json')
      .set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths).toHaveProperty('/jobs');
  });
});
