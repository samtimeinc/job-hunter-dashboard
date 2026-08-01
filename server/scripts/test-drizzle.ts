import '../src/config.js';
import { db } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

try {
  const r = await db
    .select({ ok: sql`1` })
    .from(sql`(SELECT 1) AS t`);
  console.log('OK:', JSON.stringify(r));
} catch (e) {
  console.log('ERR:', e.message);
  console.log('STACK:', e.stack?.split('\n').slice(0, 3).join('\n'));
}
