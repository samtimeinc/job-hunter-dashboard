import { runScan } from '../../server/src/scrapers/orchestrator.js';

/**
 * Vercel cron endpoint — invoked at 08:00 and 20:00 PT per vercel.json.
 * Vercel signs these calls with a CRON_SECRET header, which is checked against
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
  const results = await runScan();
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
