interface Props {
  min: number | null | undefined;
  max: number | null | undefined;
  currency?: string | null;
  period?: 'year' | 'hour' | null;
}

const FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Shows the posted salary band or "N/A" per the agreed rule. */
export function Salary({ min, max, currency, period }: Props) {
  if (min == null && max == null) {
    return <span className="text-slate-400">N/A</span>;
  }
  const suffix = period === 'hour' ? '/hr' : period === 'year' ? '/yr' : '';
  const converted = currency && currency !== 'USD' ? `${currency} ` : '';
  const range = [min, max]
    .filter((v): v is number => v != null)
    .map((v) => FORMATTER.format(v))
    .join(' – ');
  return (
    <span className="font-mono text-xs text-slate-700">
      {converted}
      {range}
      {suffix}
    </span>
  );
}
