import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  Search,
  Share2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SiteCheckResult, SiteStatus, UserSettings } from '../types/upsite';
import {
  copyResultsReport,
  exportResultsToCsv,
  exportResultsToPdf,
  shareResultsPdf,
} from '../utils/exporters';
import { ConfirmModal } from './ConfirmModal';

interface HistoryViewProps {
  history: SiteCheckResult[];
  selectedId: string | null;
  settings: UserSettings;
  onSelectResult: (result: SiteCheckResult) => void;
  onClearHistory: () => void;
}

type DateSortOrder = 'newest' | 'oldest';
type DateRangeFilter = 'all' | 'today' | 'week';

export function HistoryView({
  history,
  selectedId,
  settings,
  onSelectResult,
  onClearHistory,
}: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [dateSort, setDateSort] = useState<DateSortOrder>('newest');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const showShareNotice = (msg: string) => {
    setShareNotice(msg);
    window.setTimeout(() => {
      setShareNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const matching = history.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;

      if (dateRange !== 'all') {
        const ts = Date.parse(item.checkedAt);
        if (Number.isNaN(ts)) return false;
        if (dateRange === 'today' && ts < startOfToday) return false;
        if (dateRange === 'week' && ts < sevenDaysAgo) return false;
      }

      if (!q) return true;
      return (
        item.normalizedUrl.toLowerCase().includes(q) ||
        item.diagnosis.errorCode.toLowerCase().includes(q) ||
        String(item.httpStatusCode ?? '').includes(q)
      );
    });

    return [...matching].sort((a, b) => {
      const ta = Date.parse(a.checkedAt) || 0;
      const tb = Date.parse(b.checkedAt) || 0;
      return dateSort === 'newest' ? tb - ta : ta - tb;
    });
  }, [history, searchQuery, statusFilter, dateSort, dateRange]);

  const isCompact = settings.density === 'compact';

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 lg:p-8 space-y-5">
      {/* Search & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by URL, HTTP code, or error..."
            className="w-full rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.08] pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500/70"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Date Sort Button */}
          <button
            type="button"
            onClick={() => setDateSort((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>{dateSort === 'newest' ? 'Date: Newest' : 'Date: Oldest'}</span>
          </button>

          {/* Date Range Filter */}
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.07]">
            {(
              [
                { id: 'all', label: 'All Dates' },
                { id: 'today', label: 'Today' },
                { id: 'week', label: '7 Days' },
              ] as const
            ).map((range) => (
              <button
                key={range.id}
                type="button"
                onClick={() => setDateRange(range.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  dateRange === range.id
                    ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.07]">
            {(['all', 'online', 'offline', 'error'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {filtered.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => exportResultsToCsv(filtered, 'upsite-history')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() => exportResultsToPdf(filtered, 'upsite-history')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void shareResultsPdf(filtered, 'upsite-history', 'upsite Check History Report')
                    .then(showShareNotice)
                    .catch(() => showShareNotice('Unable to share PDF.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Share PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyResultsReport(filtered, 'upsite-history', 'upsite Check History Report')
                    .then(showShareNotice)
                    .catch(() => showShareNotice('Clipboard copy unavailable.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Copy Report</span>
              </button>
            </>
          )}

          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 bg-white dark:bg-[#171A28] hover:bg-rose-500/10 border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {shareNotice && (
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {shareNotice}
        </p>
      )}

      {/* History List */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((item) => {
            const isSelected = selectedId === item.id;
            const StatusIcon =
              item.status === 'online'
                ? CheckCircle2
                : item.status === 'offline'
                  ? XCircle
                  : AlertTriangle;

            const statusColorClass =
              item.status === 'online'
                ? 'text-emerald-600 dark:text-emerald-400'
                : item.status === 'offline'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400';

            const statusSurfaceClass =
              item.status === 'online'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                : item.status === 'offline'
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20';

            const dateObj = new Date(item.checkedAt);
            const timestamp = Number.isNaN(dateObj.getTime())
              ? item.checkedAt
              : dateObj.toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectResult(item)}
                className={`w-full text-left rounded-xl border px-5 ${
                  isCompact ? 'py-2.5' : 'py-3.5'
                } flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  isSelected
                    ? 'bg-rose-50/70 border-rose-500/50 dark:bg-[#1F2437] dark:border-rose-500/40'
                    : 'bg-white hover:bg-slate-50 border-slate-200 dark:bg-[#171A28] dark:hover:bg-[#1C2032] dark:border-white/[0.07]'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <StatusIcon className={`w-4 h-4 shrink-0 ${statusColorClass}`} strokeWidth={2} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                      {item.normalizedUrl}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate mt-0.5">
                      {timestamp} · {item.diagnosis.errorCode === 'NONE' ? 'Healthy' : item.diagnosis.errorCode}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap shrink-0 ${statusSurfaceClass}`}
                  >
                    {item.statusLabel}
                  </span>

                  <span className="hidden sm:inline-block w-16 text-right text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
                    {item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
                  </span>

                  <span className="hidden md:inline-block w-10 text-right text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                    {item.httpStatusCode !== null ? item.httpStatusCode : '—'}
                  </span>

                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/70 dark:bg-[#171A28]/60 px-6 py-14 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-500 dark:text-slate-400">
            <Clock className="w-5 h-5" strokeWidth={1.6} />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
              {history.length === 0 ? 'No check history yet' : 'No matching history entries'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {history.length === 0
                ? 'Run a website check in Checker or Organisation and results will be saved here sorted by date.'
                : 'Try adjusting your search text, date range, or status filter.'}
            </p>
          </div>
        </div>
      )}
      <ConfirmModal
        open={confirmClearOpen}
        title="Clear All Check History?"
        description={`This will permanently delete all ${history.length} saved check history ${
          history.length === 1 ? 'record' : 'records'
        } from your account.`}
        confirmLabel="Clear History"
        tone="danger"
        onConfirm={() => {
          onClearHistory();
          setConfirmClearOpen(false);
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
