import type { StatsResponse } from '@jobhunt/shared';

interface Props {
  stats: StatsResponse | null;
  loading: boolean;
}

/** Header strip showing total/new/by-status counts. */
export function StatsHeader({ stats, loading }: Props) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Open Roles',
      value: stats.total,
      tone: 'bg-white',
    },
    {
      label: 'New Since Visit',
      value: stats.newSinceLastVisit,
      tone: stats.newSinceLastVisit > 0 ? 'bg-new_badge-bg text-new_badge-text' : 'bg-white',
    },
    {
      label: 'Target Companies',
      value: stats.targetCompanyCount,
      tone: 'bg-white',
    },
    {
      label: 'Interviewing',
      value: stats.byStatus.interviewing,
      tone: 'bg-interviewing-bg text-interviewing-text',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl p-4 shadow-sm ring-1 ring-slate-200 ${c.tone}`}>
          <div className="text-2xl font-bold tabular-nums">{c.value}</div>
          <div className="mt-0.5 text-xs font-medium uppercase tracking-wide opacity-75">
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
