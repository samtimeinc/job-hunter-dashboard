import type {
  AcknowledgeResponse,
  DashboardSettings,
  JobFilters,
  JobListResponse,
  ScanResult,
  StatsResponse,
  UpdateTrackerRequest,
} from '@jobhunt/shared';

/** Thin fetch wrapper that throws on non-2xx. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `${res.status} ${res.statusText}` + (body?.message ? `: ${body.message}` : ''),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function toQuery(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.sources?.length) params.set('sources', filters.sources.join(','));
  if (filters.workModes?.length) params.set('workModes', filters.workModes.join(','));
  if (filters.postedWithinDays) params.set('postedWithinDays', String(filters.postedWithinDays));
  if (filters.companyScope) params.set('companyScope', filters.companyScope);
  if (filters.visibility) params.set('visibility', filters.visibility);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  listJobs: (filters: JobFilters = {}) =>
    request<JobListResponse>(`/api/jobs${toQuery(filters)}`),
  getStats: () => request<StatsResponse>('/api/jobs/stats'),
  acknowledge: () =>
    request<AcknowledgeResponse>('/api/jobs/acknowledge', { method: 'POST' }),
  updateTracker: (jobId: string, body: UpdateTrackerRequest) =>
    request<void>(`/api/jobs/${jobId}/tracker`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  hideJob: (jobId: string) =>
    request<void>(`/api/jobs/${jobId}/hide`, { method: 'POST' }),
  unhideJob: (jobId: string) =>
    request<void>(`/api/jobs/${jobId}/hide`, { method: 'DELETE' }),
  getSettings: () => request<DashboardSettings>('/api/settings'),
  saveSettings: (body: DashboardSettings) =>
    request<DashboardSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Scan secret is read from VITE_SCAN_SECRET — only set in single-user deploys. */
  scanNow: () =>
    request<ScanResult[]>('/api/scan', {
      method: 'POST',
      headers: { 'X-Scan-Secret': import.meta.env.VITE_SCAN_SECRET ?? '' },
    }),
};
