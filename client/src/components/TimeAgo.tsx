import { formatDistanceToNow, isValid } from 'date-fns';

interface Props {
  value: string | null | undefined;
}

/** "3 days ago" style label; renders "—" for unknown dates. */
export function TimeAgo({ value }: Props) {
  if (!value) return <span className="text-slate-400">—</span>;
  const date = new Date(value);
  if (!isValid(date)) return <span className="text-slate-400">—</span>;
  return (
    <span className="text-slate-600" title={date.toLocaleString()}>
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  );
}
