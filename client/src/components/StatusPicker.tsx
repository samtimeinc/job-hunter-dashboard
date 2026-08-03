import type { ApplicationStatus } from '@jobhunt/shared';
import { STATUS_OPTIONS } from './StatusBadge.js';

interface Props {
  value: ApplicationStatus | undefined;
  onChange: (status: ApplicationStatus) => void;
  disabled?: boolean;
}

/** Compact inline status picker for each job row. */
export function StatusPicker({ value, onChange, disabled }: Props) {
  return (
    <select
      className="input py-1 text-xs"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
    >
      <option value="">Status…</option>
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
