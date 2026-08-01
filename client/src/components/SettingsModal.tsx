import { useEffect, useState } from 'react';
import type { DashboardSettings } from '@jobhunt/shared';
import { useSettings } from '../hooks/useSettings.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Modal for editing target companies / keywords / locations as comma lists. */
export function SettingsModal({ open, onClose }: Props) {
  const { settings, save } = useSettings();
  const [draft, setDraft] = useState<DashboardSettings>({
    targetCompanies: [],
    keywords: [],
    locations: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        targetCompanies: settings.targetCompanies,
        keywords: settings.keywords,
        locations: settings.locations,
      });
    }
  }, [settings]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Dashboard Settings</h2>

        <label className="mb-1 block text-sm font-medium text-slate-700">
          Target Companies
        </label>
        <input
          className="input mb-4"
          value={draft.targetCompanies.join(', ')}
          onChange={(e) =>
            setDraft({ ...draft, targetCompanies: splitList(e.target.value) })
          }
          placeholder="Stripe, Slack, OpenAI, Smartsheet, Redfin"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Keywords</label>
        <input
          className="input mb-4"
          value={draft.keywords.join(', ')}
          onChange={(e) => setDraft({ ...draft, keywords: splitList(e.target.value) })}
          placeholder="React, Node, TypeScript"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Locations</label>
        <input
          className="input mb-6"
          value={draft.locations.join(', ')}
          onChange={(e) => setDraft({ ...draft, locations: splitList(e.target.value) })}
          placeholder="Seattle, Remote"
        />

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
