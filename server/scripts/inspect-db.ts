import '../src/config.js';
import { db, schema } from '../src/db/client.js';
import { count } from 'drizzle-orm';

const summary = await db
  .select({ source: schema.jobs.source, n: count() })
  .from(schema.jobs)
  .groupBy(schema.jobs.source);
console.log('Jobs in DB by source:');
for (const r of summary) console.log(`  ${r.source}: ${r.n}`);

const [total] = await db.select({ n: count() }).from(schema.jobs);
console.log(`Total: ${total?.n ?? 0}`);

// Inspect any Stripe row to see what we actually got
const samples = await db
  .select({
    title: schema.jobs.title,
    location: schema.jobs.location,
    tags: schema.jobs.tags,
    url: schema.jobs.url,
  })
  .from(schema.jobs)
  .limit(5);
console.log('\nSample rows:');
for (const s of samples) console.log(s);
