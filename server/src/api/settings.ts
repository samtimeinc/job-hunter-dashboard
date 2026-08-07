import { Router } from 'express';
import type { DashboardSettings } from '@jobhunt/shared';
import { getDashboardSettings, setDashboardSettings } from '../db/queries/settings.js';
import { asyncHandler, requireDashboardWrite } from './middleware.js';

export const settingsRouter = Router();

/** GET /api/settings — current target companies/keywords/locations. */
settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getDashboardSettings());
  }),
);

/** PUT /api/settings — replace settings.
 *
 *  Protected when AGENT_API_KEY (or DASHBOARD_TOKEN) is configured; otherwise
 *  preserves the existing single-user open behaviour so the dashboard UI keeps
 *  working without changes. No secret is shipped to the client bundle. */
settingsRouter.put(
  '/',
  requireDashboardWrite,
  asyncHandler(async (req, res) => {
    const incoming = req.body ?? {};
    const settings: DashboardSettings = {
      targetCompanies: toStringArray(incoming.targetCompanies),
      keywords: toStringArray(incoming.keywords),
      locations: toStringArray(incoming.locations),
    };
    await setDashboardSettings(settings);
    res.json(settings);
  }),
);

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}
