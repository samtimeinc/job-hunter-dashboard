import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import path from 'node:path';

// .env lives at the monorepo root — load it before reading DATABASE_URL.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/jobhunt',
  },
  verbose: true,
  strict: false,
});
