import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAgentApiKey, requireDashboardWrite } from '../middleware.js';

/** Build a tiny app with just the middleware under test and a dummy route.
 *  No DB, no other middleware — isolates the auth behaviour. */
function buildApp() {
  const app = express();
  app.get('/agent/jobs', requireAgentApiKey, (_req, res) => res.json({ ok: true }));
  app.put('/settings', requireDashboardWrite, (_req, res) => res.json({ ok: true }));
  // Express error handler so HttpError → status JSON.
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

const KEY = 'test-agent-key-1234567890';

describe('requireAgentApiKey', () => {
  beforeEach(() => {
    process.env.AGENT_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.AGENT_API_KEY;
  });

  it('accepts Authorization: Bearer <key>', async () => {
    const res = await request(buildApp()).get('/agent/jobs').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('accepts X-Agent-Key: <key>', async () => {
    const res = await request(buildApp()).get('/agent/jobs').set('X-Agent-Key', KEY);
    expect(res.status).toBe(200);
  });

  it('rejects with 401 when no key is supplied', async () => {
    const res = await request(buildApp()).get('/agent/jobs');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ status: 401 });
  });

  it('rejects with 401 for a wrong key', async () => {
    const res = await request(buildApp())
      .get('/agent/jobs')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 503 when AGENT_API_KEY is not configured', async () => {
    delete process.env.AGENT_API_KEY;
    const res = await request(buildApp()).get('/agent/jobs').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(503);
  });

  it('does not accept keys of a different length (timing-safe equality)', async () => {
    // A prefix-only substring should NOT authenticate.
    const res = await request(buildApp())
      .get('/agent/jobs')
      .set('Authorization', `Bearer ${KEY.slice(0, 5)}`);
    expect(res.status).toBe(401);
  });
});

describe('requireDashboardWrite (settings PUT)', () => {
  beforeEach(() => {
    process.env.AGENT_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.AGENT_API_KEY;
    delete process.env.DASHBOARD_TOKEN;
  });

  it('accepts the agent key via Authorization header when configured', async () => {
    const res = await request(buildApp()).put('/settings').set('Authorization', `Bearer ${KEY}`);
    expect(res.status).toBe(200);
  });

  it('accepts DASHBOARD_TOKEN via X-Dashboard-Token header (legacy)', async () => {
    delete process.env.AGENT_API_KEY;
    process.env.DASHBOARD_TOKEN = 'legacy-dashboard-token';
    const res = await request(buildApp())
      .put('/settings')
      .set('X-Dashboard-Token', 'legacy-dashboard-token');
    expect(res.status).toBe(200);
  });

  it('stays OPEN (200) when neither secret is configured — backward compat', async () => {
    delete process.env.AGENT_API_KEY;
    delete process.env.DASHBOARD_TOKEN;
    const res = await request(buildApp()).put('/settings');
    expect(res.status).toBe(200);
  });

  it('rejects with 401 when configured but no valid header', async () => {
    const res = await request(buildApp()).put('/settings');
    expect(res.status).toBe(401);
  });
});
