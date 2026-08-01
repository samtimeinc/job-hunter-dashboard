import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const r = await fetch(
  'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true',
);
const j = (await r.json()) as any;
console.log('total jobs:', j.meta?.total);

// Try matching against first 30 jobs with various haystacks
const keywords = ['React', 'Node', 'TypeScript'];
let titleOnly = 0;
let titlePlusDept = 0;
let all = 0; // title + dept + description

for (const job of j.jobs.slice(0, 200)) {
  const title = (job.title ?? '').toLowerCase();
  const dept = (job.departments?.map((d: any) => d.name) ?? []).join(' ');
  const desc = job.content ?? '';

  const has = (s: string) => keywords.some((k) => s.includes(k.toLowerCase()));
  if (has(title)) titleOnly++;
  if (has(`${title} ${dept}`)) titlePlusDept++;
  if (has(`${title} ${dept} ${desc}`)) all++;

  // Show a sample that ONLY matches via description
  if (all && (!has(title) && !has(`${title} ${dept}`))) {
    console.log('\nSample desc-only match:');
    console.log('  title:', job.title, '/ dept:', dept);
    break;
  }
}
console.log(`title-only: ${titleOnly}/200`);
console.log(`title+dept: ${titlePlusDept}/200`);
console.log(`incl desc: ${all}/200`);
