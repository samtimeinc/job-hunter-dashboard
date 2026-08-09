/**
 * Shared types between client and server.
 * Kept dependency-free so both bundles can import safely.
 */

export type JobSource =
  | 'remotive'
  | 'adzuna'
  | 'active-jobs-db'
  | 'hackernews'
  | 'themuse'
  | 'usajobs'
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'playwright'
  | 'workday';

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type ApplicationStatus = 'to_apply' | 'applied' | 'interviewing';

/** Heuristic seniority band inferred from a job title. Mirrors the server
 *  `Seniority` type — kept in shared so the dashboard can type-tag filters
 *  without importing server internals. */
export type Seniority =
  | 'intern'
  | 'entry'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'manager'
  | 'director';

/** Eligibility bucket an agent can route on. */
export type LocationEligibility = 'eligible' | 'ineligible' | 'unknown';

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
  /** Normalised ISO-2 country code parsed from the location/structured
   *  source payload ("US"/"CA"/"IN"/…). Null when no confident signal. */
  country?: string | null;
  /** Source-provided stable requisition ID (Workday "JR11114", Greenhouse
   *  numeric job id, …). Null when not exposed by the source. */
  requisitionId?: string | null;
  /** Heuristic seniority band inferred from the title at insert time. Null
   *  when the title gave no usable signal. */
  seniority?: Seniority | null;
  /** Canonical duplicate-group key (stable hash of company+title+location+
   *  requisition id when present). Two rows that share this key are
   *  candidates for de-duplication display — they are NOT auto-collapsed. */
  duplicateGroupKey?: string | null;
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
  /** Per-record data-quality summary so an agent can rank the listing
   *  for actionability without inspecting every nullable field individually.
   *  Always present on agent responses (low-cost, high-signal). */
  dataQuality: AgentJobDataQuality;
  /** Canonical duplicate-group key for sibling records that may describe the
   *  same position. Same company + normalised title + normalised location
   *  + stable requisition id (when available) ⇒ shared key. Two jobs with
   *  the same key are candidates for de-duplication display; they are NOT
   *  automatically collapsed — the original rows stay addressable. */
  duplicateGroupKey: string;
}

/** Data-quality summary attached to every agent job. Pure structural read of
 *  which key fields are populated + an eligibility bucket. The agent can use
 *  this to filter "only jobs with descriptions + apply URLs" etc. */
export interface AgentJobDataQuality {
  /** True when descriptionText is non-empty. */
  hasDescription: boolean;
  /** True when applyUrl OR url is non-empty (applyUrl preferred when set). */
  hasApplyUrl: boolean;
  /** True when postedAt is non-null. */
  hasPostedAt: boolean;
  /** Eligibility bucket from computeLocationEligibility(). */
  locationEligibility: LocationEligibility;
  /** Resolved ISO-2 country code (debug aid for eligibility decisions). */
  country: string | null;
  /** True when this job shares a group key with at least one other row in the
   *  DB. False when this row is the unique occupant of its group. Populated
   *  at query time by a single per-page `IN (group_key, …)` lookup. */
  possibleDuplicate: boolean;
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
  /** When true, restrict results to jobs whose country is in the eligible
   *  set with a confident signal (`locationEligibility = 'eligible'`).
   *  DOES NOT change what was inserted by the dashboard — the dashboard keeps
   *  using passesLocationFilter for browsing. This is a stricter,
   *  agent-facing gate so an automated workflow only acts on in-target
   *  postings. */
  eligible?: boolean;
  /** When true, also include roles with eligibility = 'unknown' (i.e. not
   *  confirmed-out-of-target). Combined with `eligible` this lets an agent
   *  request "eligible + review-needed" without the ineligible noise. */
  includeUnknownEligibility?: boolean;
  /** Filter by ISO-2 country code(s) — e.g. `countries=US`. */
  countries?: string[];
  /** Filter by inferred seniority bands. */
  seniorities?: Seniority[];
  /** Optional grouping fold: when true, collapse sibling jobs sharing a
   *  duplicateGroupKey to a single representative row per group (the newest).
   *  Default false — every row stays addressable. Useful when an agent wants
   *  a unique-company/title/location view without manual dedup. */
  collapseDuplicates?: boolean;
}

/** Returned by the agent tracker endpoint after an upsert. */
export interface AgentTrackerResponse {
  tracker: ApplicationTracker;
}
