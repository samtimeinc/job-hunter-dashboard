import { useCallback, useEffect, useState } from 'react';
import type { JobFilters, JobListResponse } from '@jobhunt/shared';
import { api } from '../api/client.js';

interface UseJobsState {
  data: JobListResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Fetches the job list whenever filters change. */
export function useJobs(filters: JobFilters): UseJobsState {
  const [data, setData] = useState<JobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
