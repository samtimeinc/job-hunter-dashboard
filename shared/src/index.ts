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
  | 'workday';

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

export interface JobFilters {
  search?: string;
  sources?: JobSource[];
  statuses?: ApplicationStatus[];
  workModes?: WorkMode[];
  targetCompaniesOnly?: boolean;
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
