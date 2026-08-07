import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  unique,
  primaryKey,
  pgEnum,
} from 'drizzle-orm/pg-core';

export type ApplicationStatus = 'to_apply' | 'applied' | 'interviewing';

export const applicationStatusEnum = pgEnum('application_status', [
  'to_apply',
  'applied',
  'interviewing',
]);

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export const workModeEnum = pgEnum('work_mode', ['remote', 'hybrid', 'onsite', 'unknown']);

/** Available sources. Kept as plain text rather than enum so new scrapers
 *  can be added without a migration. */
export type JobSource =
  | 'remotive'
  | 'adzuna'
  | 'jsearch'
  | 'dice'
  | 'hackernews'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'playwright'
  | 'workday'
  | 'github';

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    /** Stable hash of source + external id, used to dedupe across scans. */
    externalId: text('external_id').notNull(),
    source: text('source').notNull().$type<JobSource>(),
    company: text('company').notNull(),
    companySlug: text('company_slug'),
    title: text('title').notNull(),
    url: text('url').notNull(),
    location: text('location'),
    workMode: workModeEnum('work_mode').notNull().default('unknown'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: text('salary_period').$type<'year' | 'hour'>(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Job still appeared in the most recent scan. False = stale/closed. */
    active: boolean('active').notNull().default(true),
    tags: text('tags').array().notNull(),
    isTargetCompany: boolean('is_target_company').notNull().default(false),
    /** Becomes null the first time a user "visits" after the job appeared. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    /** Set when the user manually hides a job — excluded from default views. */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    /** Plain-text job description as normalised by the scraper. Null when the
     *  source exposes no description (Remotive, Workday list-endpoint, GitHub,
     *  Playwright). Never fabricated. */
    descriptionText: text('description_text'),
    /** Original HTML description when the scraper received HTML (Greenhouse
     *  `content`, Adzuna `description` if it ships HTML). Null otherwise. */
    descriptionHtml: text('description_html'),
    /** Direct application URL from the source (e.g. iCIMS `apply_url`, Ashby
     *  `applyUrl`). Null when not provided. Distinct from the canonical `url`
     *  which may point at a stable details page. */
    applyUrl: text('apply_url'),
    /** Normalised company domain (e.g. "stripe.com") used to reconstruct
     *  careers links. Null when not derivable from the source payload. */
    companyDomain: text('company_domain'),
  },
  (t) => ({
    uniqExternal: unique('jobs_external_unique').on(t.source, t.externalId),
  }),
);

export const applicationTrackers = pgTable(
  'application_trackers',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: applicationStatusEnum('status').notNull().default('to_apply'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqJob: unique('application_trackers_job_unique').on(t.jobId),
  }),
);

/** Tiny key/value table for dashboard-level settings (target companies,
 *  keywords, locations). Single row keyed by 'global'. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type JobRow = typeof jobs.$inferSelect;
export type ApplicationTrackerRow = typeof applicationTrackers.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;

/** Convention from agents.md: never hand-edit migrations, this just declares them. */
void primaryKey;
