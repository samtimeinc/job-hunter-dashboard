interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Controlled search input updated instantly via local state for snappy UX. */
export function SearchInput({ value, onChange, placeholder }: Props) {
  return (
    <input
      type="search"
      className="input"
      placeholder={placeholder ?? 'Search by role or company…'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
