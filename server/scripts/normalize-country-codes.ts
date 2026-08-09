/** One-shot normalize of full-name country values to ISO-2 codes. Run once. */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';

async function main() {
  const updates: Array<[string, string[]]> = [
    ['US', ['United States', 'United States of America', 'USA', 'U.S.A.', 'U.S.']],
    ['CA', ['Canada']],
    ['GB', ['United Kingdom', 'UK', 'U.K.', 'England', 'Scotland', 'Wales']],
    ['IN', ['India', 'Bharat']],
    ['DE', ['Germany', 'Deutschland']],
    ['FR', ['France']],
    ['NL', ['Netherlands', 'Holland']],
    ['IE', ['Ireland']],
    ['AU', ['Australia']],
    ['NZ', ['New Zealand']],
    ['SG', ['Singapore']],
    ['JP', ['Japan']],
    ['MX', ['Mexico', 'México']],
    ['BR', ['Brazil', 'Brasil']],
    ['ES', ['Spain', 'España']],
    ['PT', ['Portugal']],
  ];

  let total = 0;
  for (const [code, names] of updates) {
    // Build an IN (…) literal — names are tiny fixed strings so escaping is
    // trivial. Quoting each with single-quote doubling is safe here.
    const list = names
      .map((n) => `'${n.replace(/'/g, "''")}'`)
      .join(',');
    const r = await db.execute(
      sql.raw(`UPDATE jobs SET country = '${code}' WHERE country IN (${list})`),
    );
    const n = 'rowCount' in r ? (r.rowCount ?? 0) : 0;
    if (n > 0) console.log(`[normalize] ${code}: ${n} rows`);
    total += n;
  }
  console.log(`[normalize] total updated: ${total}`);

  const summary = await db.execute(
    sql`SELECT country, count(*)::int AS n FROM jobs WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 20`,
  );
  console.log('[normalize] top countries:', summary.rows);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
