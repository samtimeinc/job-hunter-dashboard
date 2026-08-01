import { useCallback, useEffect, useState } from 'react';
import type { DashboardSettings } from '@jobhunt/shared';
import { api } from '../api/client.js';

/** Target-company / keyword / location settings. */
export function useSettings() {
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: DashboardSettings) => {
    const saved = await api.saveSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, loading, save, refresh };
}
