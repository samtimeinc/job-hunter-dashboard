import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

/** Wrap async route handlers so rejected promises hit the error middleware. */
export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Shared error shape sent to the client. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Constant-time string comparison. Safe against timing-attack oracles for
 *  secret comparison. Supports differing lengths by returning false early
 *  (length is not secret for randomly generated API keys). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireScanSecret(req: Request, _res: Response, next: NextFunction) {
  const provided =
    req.headers['x-scan-secret'] ??
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ??
    (req.query?.secret as string | undefined);
  // Read at call-time so tests + runtime env changes are picked up without a
  // restart (config.ts snapshots env at module load — fine for prod, but the
  // middleware needs to honour the live value).
  const expected = process.env.SCAN_SECRET ?? '';
  if (!expected) {
    return next(new HttpError(503, 'SCAN_SECRET not configured on the server'));
  }
  if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
    return next(new HttpError(401, 'Unauthorized'));
  }
  next();
}

/** Authenticate /api/agent requests against AGENT_API_KEY.
 *
 * Accepts the key from either:
 *   - `Authorization: Bearer <AGENT_API_KEY>`
 *   - `X-Agent-Key: <AGENT_API_KEY>`
 *
 * Rejects with HTTP 401 when the key is missing, malformed, or wrong. Also
 * rejects (503) when AGENT_API_KEY is not configured on the server, so a
 * misconfigured deploy fails closed rather than open.
 *
 * SECURITY: this MUST remain server-only. Do NOT read process.env.AGENT_API_KEY
 * into anything prefixed with VITE_ — Vite inlines VITE_* vars into the client
 * bundle and would leak the secret into the browser. */
export function requireAgentApiKey(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.AGENT_API_KEY ?? '';
  if (!expected) {
    return next(new HttpError(503, 'AGENT_API_KEY not configured on the server'));
  }
  const fromBearer = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const fromHeader = req.headers['x-agent-key'];
  const provided =
    (typeof fromBearer === 'string' && fromBearer) ||
    (typeof fromHeader === 'string' && fromHeader) ||
    '';
  if (!provided || !safeEqual(provided, expected)) {
    return next(new HttpError(401, 'Unauthorized'));
  }
  next();
}

/** Authenticate dashboard write endpoints (settings PUT). Backward-compatible:
 *  - If AGENT_API_KEY is not set, the route stays open (preserves the current
 *    single-user behaviour).
 *  - If AGENT_API_KEY IS set, the request must carry either the dashboard
 *    token (DASHBOARD_TOKEN, legacy) OR the agent key.
 *
 * This keeps the existing frontend working (which never sent a header on the
 * settings PUT) when no secret is configured, while hardening the route the
 * moment an operator opts into agent auth. No secret is exposed client-side. */
export function requireDashboardWrite(req: Request, _res: Response, next: NextFunction) {
  const agentKey = process.env.AGENT_API_KEY ?? '';
  const dashToken = process.env.DASHBOARD_TOKEN ?? '';
  if (!agentKey && !dashToken) {
    // No secret configured → preserve current open behaviour.
    return next();
  }
  const fromBearer = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const fromAgentHeader = req.headers['x-agent-key'];
  const fromDashHeader = req.headers['x-dashboard-token'];

  const candidates = [fromBearer, fromAgentHeader, fromDashHeader].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  const ok =
    (agentKey !== '' && candidates.some((c) => safeEqual(c, agentKey))) ||
    (dashToken !== '' && candidates.some((c) => safeEqual(c, dashToken)));
  if (!ok) {
    return next(new HttpError(401, 'Unauthorized'));
  }
  next();
}
