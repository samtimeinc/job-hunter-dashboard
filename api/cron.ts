import { runScan } from '../server/src/scrapers/orchestrator.js';

/**
 * Scan endpoint — DEPRECATED as the scheduled entry point.
 *
 * Scheduling now lives entirely in `.github/workflows/scan.yml`, which runs
 * `npm run scan` directly on the Actions runner and writes to Neon. That path
 * has no gateway timeout. Calling this endpoint worked *on average* but
 * intermittently returned a bare 504: Vercel Hobby clamps Node serverless
 * `maxDuration` to ~60s (the 120 in vercel.json is ignored) and the gateway
 * hard-cuts the connection there, killing the function before its try/catch
 * can return a diagnostic body.
 *
 * This handler is kept for ad-hoc curl/Postman use, but it is no longer on
 * the scheduled hot path. The in-app "Refresh now" button uses the separate
 * `/api/scan` Express route (same SCAN_SECRET via X-Scan-Secret), not this one.
 *
 * The caller must send `Authorization: Bearer <SCAN_SECRET>`, checked against
 * the SCAN_SECRET env var.
 */
export default async function handler(req: { headers: Record<string, string | undefined> }) {
  const secret = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (process.env.SCAN_SECRET && secret !== process.env.SCAN_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  try {
    const results = await runScan();
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    // Surface the failure as a readable JSON body (status 500) so the GitHub
    // Actions scheduler log shows what broke instead of a bare 504 gateway
    // timeout. The scan paths are all error-swallowing, so reaching here means
    // something unexpected (e.g. DB connectivity at boot).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron] scan failed:', err);
    return new Response(JSON.stringify({ error: 'scan_failed', message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
