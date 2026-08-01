import dotenv from 'dotenv';
dotenv.config();
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
console.log('DATABASE_URL prefix:', url?.slice(0, 35), '…');
console.log('Length:', url?.length);

const sql = neon(url);
try {
  const r = await sql`SELECT 1 AS ok`;
  console.log('CONNECTED:', JSON.stringify(r));
} catch (e) {
  console.log('ERR:', e.message);
  console.log('CAUSE:', e.cause?.message ?? e.cause);
}
