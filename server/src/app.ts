import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { config } from './config.js';
import { jobsRouter } from './api/jobs.js';
import { scanRouter } from './api/scan.js';
import { settingsRouter } from './api/settings.js';
import { HttpError } from './api/middleware.js';

/** Build the Express app. Called from both the standalone server (src/index.ts)
 *  and the Vercel serverless entrypoint (api/index.ts). */
export function createApp(): express.Express {
  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/jobs', jobsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/scan', scanRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (status >= 500) console.error('[api] error:', err);
    res.status(status).json({ status, message });
  };
  app.use(errorHandler);
  return app;
}
