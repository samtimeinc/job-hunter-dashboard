import { Router } from 'express';
import { runScan } from '../scrapers/orchestrator.js';
import { asyncHandler } from './middleware.js';
import { requireScanSecret } from './middleware.js';

export const scanRouter = Router();

/** POST /api/scan — manually trigger a scan. Protected by SCAN_SECRET. */
scanRouter.post(
  '/',
  requireScanSecret,
  asyncHandler(async (_req, res) => {
    const results = await runScan();
    res.json(results);
  }),
);
