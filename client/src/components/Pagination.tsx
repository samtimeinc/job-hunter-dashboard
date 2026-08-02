interface Props {
  /** 1-based current page index. */
  page: number;
  /** Total number of rows across all pages. */
  total: number;
  /** Number of rows per page. */
  pageSize: number;
  /** Called with the new 1-based page index when the user navigates. */
  onChange: (page: number) => void;
}

/** Slim, reusable pager. Renders Previous / page numbers (with ellipses) / Next.
 *  Designed so the same instance can sit above and below the table.
 *  Functional component only, per agents.md. */
export function Pagination({ page, total, pageSize, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);

  // Don't render a pager at all when there's nothing to page.
  if (total <= pageSize && totalPages === 1) {
    return (
      <div className="rounded-xl bg-white px-4 py-2 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200">
        Showing {total} role{total === 1 ? '' : 's'}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-2 text-sm shadow-sm ring-1 ring-slate-200">
      <span className="text-xs text-slate-500">
        Showing {firstShown}–{lastShown} of {total}
      </span>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onChange(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          ← Previous
        </button>

        {buildPageList(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400" aria-hidden>
              …
            </span>
          ) : (
            <PageButton key={p} page={p} active={p === page} onClick={onChange} />
          ),
        )}

        <button
          type="button"
          className="btn-secondary"
          onClick={() => onChange(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function PageButton({
  page,
  active,
  onClick,
}: {
  page: number;
  active: boolean;
  onClick: (page: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(page)}
      aria-current={active ? 'page' : undefined}
      className={`min-w-[2rem] rounded-lg border px-2 py-1 text-sm transition-colors ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {page}
    </button>
  );
}

/**
 * Produce a compact page list like 1 … 4 5 6 … 20.
 * Always shows first and last, plus a window around the current page.
 * Returns numbers as-is, gaps as the literal '…'.
 */
function buildPageList(current: number, total: number): Array<number | '…'> {
  const window = 1; // pages either side of the current page
  const pages = new Set<number>([1, total]);
  for (let p = current - window; p <= current + window; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | '…'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}
