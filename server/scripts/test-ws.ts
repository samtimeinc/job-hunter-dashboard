// Raw neon-serverless WS test, no drizzle, runs through tsx.
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\//, '') });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

console.log('URL:', (process.env.DATABASE_URL ?? '').slice(0, 35) + '…');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query('SELECT 1 AS ok');
  console.log('OK:', JSON.stringify(r.rows));
} catch (e) {
  console.log('ERR_NAME:', e.name);
  console.log('ERR_MSG:', JSON.stringify(e.message));
  console.log('CAUSE_MSG:', e.cause?.message);
  console.log('STACK:', e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await pool.end();
}
