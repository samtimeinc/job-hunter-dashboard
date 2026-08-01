import type { ApplicationStatus } from '@jobhunt/shared';

interface Props {
  status: ApplicationStatus;
}

const STYLES: Record<ApplicationStatus, { label: string; classes: string }> = {
  to_apply: {
    label: 'To Apply',
    classes: 'bg-to_apply-bg text-to_apply-text',
  },
  applied: {
    label: 'Applied',
    classes: 'bg-applied-bg text-applied-text',
  },
  interviewing: {
    label: 'Interviewing',
    classes: 'bg-interviewing-bg text-interviewing-text',
  },
};

export function StatusBadge({ status }: Props) {
  const style = STYLES[status];
  return (
    <span className={`chip ${style.classes}`}>
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: 'currentColor' }}
      />
      {style.label}
    </span>
  );
}

export const STATUS_OPTIONS = Object.entries(STYLES).map(([value, { label }]) => ({
  value: value as ApplicationStatus,
  label,
}));
