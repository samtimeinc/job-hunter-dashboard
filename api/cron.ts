import { runScan } from '../server/src/scrapers/orchestrator.js';

/**
 * Scan endpoint invoked by an external scheduler (GitHub Actions) —
 * Vercel Hobby's free tier only allows one cron/day, so scheduling moved to
 * .github/workflows/scan.yml. Invoked twice daily at 08:00 and 20:00 UTC.
 *
 * The caller must send `Authorization: Bearer <SCAN_SECRET>`, which is checked
 * against the SCAN_SECRET env var. The in-app "Refresh now" button hits the
 * separate /api/scan route with the same secret via X-Scan-Secret.
 */
export default async function handler(req: { headers: Record<string, string | undefined> }) {
  const secret = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (process.env.SCAN_SECRET && secret !== process.env.SCAN_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const results = await runScan();
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
