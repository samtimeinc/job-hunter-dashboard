import type { NextFunction, Request, Response } from 'express';

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

/** Validates the SCAN_SECRET for write/scan endpoints.
 *  And DASHBOARD_TOKEN for everything else (if configured). */
export function requireScanSecret(req: Request, _res: Response, next: NextFunction) {
  const provided =
    req.headers['x-scan-secret'] ??
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ??
    (req.query?.secret as string | undefined);
  const expected = process.env.SCAN_SECRET ?? '';
  if (!expected) {
    return next(new HttpError(503, 'SCAN_SECRET not configured on the server'));
  }
  if (provided !== expected) {
    return next(new HttpError(401, 'Unauthorized'));
  }
  next();
}
