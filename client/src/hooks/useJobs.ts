import { useCallback, useEffect, useState } from 'react';
import type { JobFilters, JobListResponse } from '@jobhunt/shared';
import { api } from '../api/client.js';

interface UseJobsState {
  data: JobListResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Fetches the job list whenever filters (incl. page) change. */
export function useJobs(filters: JobFilters): UseJobsState {
  const [data, setData] = useState<JobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key for `filters` so the callback is recreated only when the
  // filter *values* change — not on every parent render that creates a new
  // filter object reference. We intentionally depend on `filtersKey`, not
  // `filters`, to avoid a refetch loop.
  const filtersKey = JSON.stringify(filters);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listJobs(filters);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
