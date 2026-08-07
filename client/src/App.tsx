import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApplicationStatus, Job } from '@jobhunt/shared';
import { api } from './api/client.js';
import { FilterBar, type FilterState } from './components/FilterBar.js';
import { JobTable } from './components/JobTable.js';
import { SettingsModal } from './components/SettingsModal.js';
import { StatsHeader } from './components/StatsHeader.js';
import { useJobs } from './hooks/useJobs.js';
import { useStats } from './hooks/useStats.js';

export default function App() {
  const [filters, setFiltersRaw] = useState<FilterState>({
    search: '',
    sources: [],
    workModes: [],
    companyScope: 'all',
    visibility: 'active',
    postedWithinDays: undefined,
  });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const setFilters = useCallback((next: FilterState) => {
    setFiltersRaw(next);
    setPage(1); // any filter change resets to the first page
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  /** Optimistic status overrides keyed by jobId so the UI updates instantly. */
  const [statusOverrides, setStatusOverrides] = useState<Record<string, ApplicationStatus>>({});
  /** Job IDs whose view membership changed after a hide/unhide click — removed
   *  locally so the row disappears immediately while the request is in flight. */
  const [hiddenOptimisticIds, setHiddenOptimisticIds] = useState<Set<string>>(new Set());

  const { stats, loading: statsLoading, refresh: refreshStats } = useStats();
  const {
    data,
    loading,
    error,
    refresh: refreshJobs,
  } = useJobs({
    search: filters.search || undefined,
    sources: filters.sources.length ? filters.sources : undefined,
    workModes: filters.workModes.length ? filters.workModes : undefined,
    postedWithinDays: filters.postedWithinDays,
    companyScope: filters.companyScope === 'all' ? undefined : filters.companyScope,
    visibility: filters.visibility,
    page,
    pageSize: PAGE_SIZE,
  });

  const jobsWithOverrides = useMemo<Job[]>(() => {
    return (data?.jobs ?? [])
      .map((j) =>
        statusOverrides[j.id]
          ? {
              ...j,
              tracker: {
                ...(j.tracker ?? {
                  id: j.id,
                  jobId: j.id,
                  status: statusOverrides[j.id]!,
                  appliedAt: null,
                  notes: null,
                  updatedAt: new Date().toISOString(),
                }),
                status: statusOverrides[j.id]!,
              },
            }
          : j,
      )
      .filter((j) => !hiddenOptimisticIds.has(j.id));
  }, [data, statusOverrides, hiddenOptimisticIds]);

  // Clamp page back into range if data shrinks (e.g. after a prune/scan).
  const totalJobs = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
  const safePage = Math.min(page, maxPage);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  const acknowledgeNew = useCallback(async () => {
    try {
      await api.acknowledge();
      await Promise.all([refreshJobs(), refreshStats()]);
    } catch {
      /* surface in next render */
    }
  }, [refreshJobs, refreshStats]);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    setScanMessage(null);
    try {
      const results = await api.scanNow();
      const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
      const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
      const errorCount = results.filter((r) => r.errors.length).length;
      setScanMessage(
        `Fetched ${totalFetched}, added ${totalInserted} new. ` +
          (errorCount ? `${errorCount} source(s) reported errors.` : ''),
      );
      await Promise.all([refreshJobs(), refreshStats()]);
    } catch (err) {
      setScanMessage(`Scan failed: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, [refreshJobs, refreshStats]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Job Hunt Dashboard</h1>
            <p className="text-sm text-slate-500">
              React · Node · TypeScript — Seattle &amp; Remote
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(true)}>
              ⚙ Settings
            </button>
            <button type="button" className="btn-primary" onClick={triggerScan} disabled={scanning}>
              {scanning ? 'Scanning…' : '↻ Refresh now'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
        {scanMessage && (
          <div className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">{scanMessage}</div>
        )}

        <StatsHeader stats={stats} loading={statsLoading} />

        {stats && stats.newSinceLastVisit > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-new_badge-bg px-4 py-2 text-new_badge-text">
            <span className="font-medium">
              {stats.newSinceLastVisit} new role{stats.newSinceLastVisit === 1 ? '' : 's'} since
              your last visit
            </span>
            <button type="button" className="btn-primary text-xs" onClick={acknowledgeNew}>
              Mark all seen
            </button>
          </div>
        )}

        <FilterBar value={filters} onChange={setFilters} />

        <JobTable
          jobs={jobsWithOverrides}
          loading={loading}
          error={error}
          total={Math.max(0, totalJobs - hiddenOptimisticIds.size)}
          page={safePage}
          pageSize={PAGE_SIZE}
          visibility={filters.visibility}
          onPageChange={setPage}
          onStatusOptimistic={(jobId, status) =>
            setStatusOverrides((prev) => ({ ...prev, [jobId]: status }))
          }
          onHideOptimistic={(jobId) =>
            setHiddenOptimisticIds((prev) => {
              const next = new Set(prev);
              next.add(jobId);
              return next;
            })
          }
        />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
