/**
 * Shared types between client and server.
 * Kept dependency-free so both bundles can import safely.
 */

export type JobSource =
  | 'remotive'
  | 'adzuna'
  | 'jsearch'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'playwright'
  | 'workday'
  | 'github';

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type ApplicationStatus = 'to_apply' | 'applied' | 'interviewing';

/** Canonical job record as stored in the DB and returned by the API. */
export interface Job {
  id: string;
  externalId: string;
  source: JobSource;
  company: string;
  companySlug?: string | null;
  title: string;
  url: string;
  location: string | null;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod?: 'year' | 'hour' | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Tags/categories pulled from the source (e.g. ["React", "TypeScript"]). */
  tags: string[];
  isTargetCompany: boolean;
  /** Null until the user clicks "Mark all seen" — null = "New". */
  acknowledgedAt?: string | null;
  /** Timestamp when the user hid this job, or null if it's still visible. */
  hiddenAt?: string | null;
  /** Plain-text job description. Null when the source provides none. */
  descriptionText?: string | null;
  /** Original HTML description (Greenhouse content, Adzuna HTML). Null otherwise. */
  descriptionHtml?: string | null;
  /** Direct application URL from the source, if distinct from `url`. */
  applyUrl?: string | null;
  /** Normalised company domain (e.g. "stripe.com"). Null when unknown. */
  companyDomain?: string | null;
  active?: boolean;
  /** Application tracker row linked to this job, if any. */
  tracker?: ApplicationTracker | null;
}

export interface ApplicationTracker {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface JobListResponse {
  jobs: Job[];
  /** Total number of jobs matching the current filters (across all pages). */
  total: number;
  newSinceLastVisit: number;
  /** 1-based index of the page represented by `jobs` (1 if unpaginated). */
  page: number;
  /** Page size used for the request (number of jobs requested per page). */
  pageSize: number;
}

export type CompanyScope = 'all' | 'target' | 'other';

/** Which jobs to show based on their hidden flag. */
export type Visibility = 'active' | 'hidden';

export interface JobFilters {
  search?: string;
  sources?: JobSource[];
  statuses?: ApplicationStatus[];
  workModes?: WorkMode[];
  companyScope?: CompanyScope;
  /** Controls whether hidden jobs are returned. Defaults to 'active'. */
  visibility?: Visibility;
  postedWithinDays?: number;
  /** 1-based page index. */
  page?: number;
  /** Number of jobs per page. */
  pageSize?: number;
}

export interface StatsResponse {
  total: number;
  newSinceLastVisit: number;
  byStatus: Record<ApplicationStatus, number>;
  bySource: Record<string, number>;
  targetCompanyCount: number;
}

export interface ScanResult {
  startedAt: string;
  finishedAt: string;
  source: string;
  fetched: number;
  inserted: number;
  errors: { source: string; message: string }[];
}

/** Mark jobs as acknowledged so the "new" badge clears. */
export interface AcknowledgeResponse {
  acknowledgedAt: string;
}

/** Empty body for hide/unhide endpoints — status conveyed via the HTTP code. */
export interface VisibilityUpdateResponse {
  hiddenAt: string | null;
}

export interface UpdateTrackerRequest {
  status: ApplicationStatus;
  appliedAt?: string | null;
  notes?: string | null;
}

/** Target-company + keyword config managed via /api/settings. */
export interface DashboardSettings {
  targetCompanies: string[];
  keywords: string[];
  locations: string[];
}

/** Agent-facing job. Same as {@link Job} but with `active` and the detail
 *  fields always present (description fields only when requested by the
 *  query — otherwise null to keep payloads small). */
export interface AgentJob extends Job {
  active: boolean;
}

/** Response shape for the cursor-paginated agent search endpoint. */
export interface AgentJobListResponse {
  jobs: AgentJob[];
  total: number;
  /** Opaque cursor to pass back as `cursor` for the next page, or null when
   *  the end of the result set has been reached. */
  nextCursor: string | null;
}

/** Filters accepted by the agent job search. Mirrors the dashboard filters
 *  (minus new-since-visit) plus a cursor pagination mode and a description
 *  inclusion flag. */
export interface AgentJobFilters {
  search?: string;
  statuses?: ApplicationStatus[];
  sources?: JobSource[];
  workModes?: WorkMode[];
  companyScope?: CompanyScope;
  visibility?: Visibility | 'all';
  postedWithinDays?: number;
  /** When false, includes only jobs still seen in the last scan (default). */
  active?: boolean;
  limit?: number;
  /** Explicit page size override (alias for `limit`). */
  pageSize?: number;
  /** 1-based page index — only used when `cursor`/`page` is requested. */
  page?: number;
  /** Opaque cursor string returned from a previous response. Preferred over
   *  `page` for stable iteration. */
  cursor?: string;
  /** When true, include descriptionText/descriptionHtml on each job. */
  includeDescription?: boolean;
}

/** Returned by the agent tracker endpoint after an upsert. */
export interface AgentTrackerResponse {
  tracker: ApplicationTracker;
}
