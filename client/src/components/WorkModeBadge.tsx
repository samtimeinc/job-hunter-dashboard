import type { WorkMode } from '@jobhunt/shared';

interface Props {
  mode: WorkMode;
}

const LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'Onsite',
  unknown: '—',
};

const COLORS: Record<WorkMode, string> = {
  remote: 'bg-emerald-100 text-emerald-800',
  hybrid: 'bg-violet-100 text-violet-800',
  onsite: 'bg-amber-100 text-amber-800',
  unknown: 'bg-slate-100 text-slate-600',
};

export function WorkModeBadge({ mode }: Props) {
  return <span className={`chip ${COLORS[mode]}`}>{LABELS[mode]}</span>;
}
