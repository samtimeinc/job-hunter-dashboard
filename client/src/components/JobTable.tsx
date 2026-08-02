import type { ApplicationStatus, Job } from '@jobhunt/shared';
import { api } from '../api/client.js';
import { NewBadge } from './NewBadge.js';
import { Pagination } from './Pagination.js';
import { Salary } from './Salary.js';
import { StatusBadge, STATUS_OPTIONS } from './StatusBadge.js';
import { StatusPicker } from './StatusPicker.js';
import { TimeAgo } from './TimeAgo.js';
import { WorkModeBadge } from './WorkModeBadge.js';

interface Props {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  /** Total jobs across all pages (from the API, not jobs.length). */
  total: number;
  /** 1-based current page index. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Navigate to a new page. */
  onPageChange: (page: number) => void;
  /** Bumps the row's local status immediately for snappy UX. */
  onStatusOptimistic: (jobId: string, status: ApplicationStatus) => void;
}

/** Main dashboard table — all the columns from agents.md plus status tracker. */
export function JobTable({
  jobs,
  loading,
  error,
  total,
  page,
  pageSize,
  onPageChange,
  onStatusOptimistic,
}: Props) {
  if (loading && jobs.length === 0) {
    return <div className="rounded-xl bg-white p-8 text-center text-slate-500">Loading…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl bg-new_badge-bg p-4 text-new_badge-text">
        Could not load jobs: {error}
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-slate-500">
        No roles match your filters. Try widening the search or hit “Refresh now”.
      </div>
    );
  }

  const handleStatusChange = async (job: Job, status: ApplicationStatus) => {
    onStatusOptimistic(job.id, status);
    try {
      await api.updateTracker(job.id, {
        status,
        appliedAt: status !== 'to_apply' ? new Date().toISOString() : null,
      });
    } catch {
      // User can retry; refresh path will reconcile.
    }
  };

  // Shared pager config so both controls stay identical.
  const pager = (
    <Pagination page={page} total={total} pageSize={pageSize} onChange={onPageChange} />
  );

  return (
    <div className="space-y-3">
      {pager}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Mode</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">Salary</th>
              <th className="px-4 py-2 font-medium">Posted</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Apply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <tr
                key={job.id}
                className={`group ${job.acknowledgedAt ? '' : 'bg-amber-50/40'} hover:bg-slate-50`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{job.company}</span>
                    {job.isTargetCompany && (
                      <span className="chip bg-slate-900 text-white">Watchlist</span>
                    )}
                    {!job.acknowledgedAt && <NewBadge />}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-800">{job.title}</td>
                <td className="px-4 py-3">
                  <WorkModeBadge mode={job.workMode} />
                </td>
                <td className="px-4 py-3 text-slate-600">{job.location ?? '—'}</td>
                <td className="px-4 py-3">
                  <Salary
                    min={job.salaryMin}
                    max={job.salaryMax}
                    currency={job.salaryCurrency}
                    period={job.salaryPeriod ?? null}
                  />
                </td>
                <td className="px-4 py-3">
                  <TimeAgo value={job.postedAt} />
                </td>
                <td className="px-4 py-3">
                  {job.tracker ? (
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={job.tracker.status} />
                      <StatusPicker
                        value={job.tracker.status}
                        onChange={(s) => handleStatusChange(job, s)}
                      />
                    </div>
                  ) : (
                    <StatusPicker
                      value={undefined}
                      onChange={(s) => handleStatusChange(job, s)}
                    />
                  )}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-xs"
                  >
                    Apply
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          {STATUS_OPTIONS.length ? '' : ''}
          Updates: Awaiting By — On-demand + Vercel cron 8AM/8PM PT.
        </div>
      </div>

      {pager}
    </div>
  );
}
