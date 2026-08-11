import { eq } from 'drizzle-orm';
import { db, schema } from '../client.js';

/** Settings singleton — target companies, keywords, locations. */
export async function getDashboardSettings(): Promise<{
  targetCompanies: string[];
  keywords: string[];
  locations: string[];
}> {
  const row = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'global'))
    .limit(1);
  const fallback = { targetCompanies: [], keywords: [], locations: [] };
  if (!row.length) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row[0]!.value) as object) };
  } catch {
    return fallback;
  }
}

export async function setDashboardSettings(value: {
  targetCompanies: string[];
  keywords: string[];
  locations: string[];
}): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insert(schema.settings)
    .values({ key: 'global', value: json })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json } });
}
