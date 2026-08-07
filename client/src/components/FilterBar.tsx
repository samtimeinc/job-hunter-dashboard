import type { JobSource, Visibility, WorkMode } from '@jobhunt/shared';

export type CompanyScope = 'all' | 'target' | 'other';

export interface FilterState {
  search: string;
  sources: JobSource[];
  workModes: WorkMode[];
  companyScope: CompanyScope;
  visibility: Visibility;
  postedWithinDays?: number;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
}

const SOURCE_OPTIONS: { value: JobSource; label: string }[] = [
  { value: 'remotive', label: 'Remotive' },
  { value: 'adzuna', label: 'Adzuna' },
  { value: 'jsearch', label: 'JSearch' },
  { value: 'dice', label: 'Dice' },
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'playwright', label: 'In-house portals' },
  { value: 'workday', label: 'Workday' },
  { value: 'github', label: 'GitHub (iCIMS)' },
];

const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

const POSTED_WINDOWS = [
  { value: undefined, label: 'Anytime' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
];

export function FilterBar({ value, onChange }: Props) {
  const toggleSource = (s: JobSource) => {
    const has = value.sources.includes(s);
    onChange({
      ...value,
      sources: has ? value.sources.filter((x) => x !== s) : [...value.sources, s],
    });
  };
  const toggleMode = (m: WorkMode) => {
    const has = value.workModes.includes(m);
    onChange({
      ...value,
      workModes: has ? value.workModes.filter((x) => x !== m) : [...value.workModes, m],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="min-w-[240px] flex-1">
        <input
          type="search"
          className="input"
          placeholder="Search role or company…"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-1">
        {WORK_MODES.map((m) => (
          <ToggleChip
            key={m.value}
            label={m.label}
            active={value.workModes.includes(m.value)}
            onClick={() => toggleMode(m.value)}
          />
        ))}
      </div>

      <select
        className="input w-auto"
        value={value.postedWithinDays ?? ''}
        onChange={(e) =>
          onChange({
            ...value,
            postedWithinDays: e.target.value ? Number(e.target.value) : undefined,
          })
        }
      >
        {POSTED_WINDOWS.map((w) => (
          <option key={w.label} value={w.value ?? ''}>
            {w.label}
          </option>
        ))}
      </select>

      <details className="group relative">
        <summary className="btn-secondary cursor-pointer select-none list-none">
          Source {value.sources.length ? `(${value.sources.length})` : ''}
        </summary>
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {SOURCE_OPTIONS.map((s) => (
            <label
              key={s.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={value.sources.includes(s.value)}
                onChange={() => toggleSource(s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </details>

      <CompanyScopeToggle
        value={value.companyScope}
        onChange={(companyScope) => onChange({ ...value, companyScope })}
      />

      <VisibilityToggle
        value={value.visibility}
        onChange={(visibility) => onChange({ ...value, visibility })}
      />
    </div>
  );
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; activeClass: string }[] = [
  { value: 'active', label: 'Active', activeClass: 'bg-slate-900 text-white' },
  { value: 'hidden', label: 'Hidden', activeClass: 'bg-rose-600 text-white' },
];

function VisibilityToggle({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  const currentIndex = Math.max(
    0,
    VISIBILITY_OPTIONS.findIndex((opt) => opt.value === value),
  );
  const current = VISIBILITY_OPTIONS[currentIndex]!;
  const next = VISIBILITY_OPTIONS[(currentIndex + 1) % VISIBILITY_OPTIONS.length]!;
  const nextLabel = next.value === 'hidden' ? 'Show hidden' : 'Show active only';

  return (
    <button
      type="button"
      title={`Click to: ${nextLabel}`}
      onClick={() => onChange(next.value)}
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ring-1 transition-colors ${
        current.activeClass
      } ring-inherit/30 hover:brightness-110`}
    >
      {current.label}
    </button>
  );
}

const COMPANY_SCOPE_OPTIONS: { value: CompanyScope; label: string; activeClass: string }[] = [
  { value: 'all', label: 'All companies', activeClass: 'bg-slate-900 text-white' },
  { value: 'target', label: 'Target companies', activeClass: 'bg-emerald-600 text-white' },
  { value: 'other', label: 'Other companies', activeClass: 'bg-amber-500 text-white' },
];

function CompanyScopeToggle({
  value,
  onChange,
}: {
  value: CompanyScope;
  onChange: (next: CompanyScope) => void;
}) {
  const currentIndex = Math.max(
    0,
    COMPANY_SCOPE_OPTIONS.findIndex((opt) => opt.value === value),
  );
  const current = COMPANY_SCOPE_OPTIONS[currentIndex]!;
  const next = COMPANY_SCOPE_OPTIONS[(currentIndex + 1) % COMPANY_SCOPE_OPTIONS.length]!;

  return (
    <button
      type="button"
      title={`Click to show: ${next.label}`}
      onClick={() => onChange(next.value)}
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ring-1 transition-colors ${
        current.activeClass
      } ring-inherit/30 hover:brightness-110`}
    >
      {current.label}
    </button>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip cursor-pointer border ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}
