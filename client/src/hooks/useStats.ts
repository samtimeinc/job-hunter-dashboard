import { useCallback, useEffect, useState } from 'react';
import type { StatsResponse } from '@jobhunt/shared';
import { api } from '../api/client.js';

/** Dashboard header counts. Refreshable so the new-since-visit badge stays live. */
export function useStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStats(await api.getStats());
    } catch {
      /* surface-level; the jobs hook reports network errors too */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stats, loading, refresh };
}
