import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Globe,
  Loader2,
  Play,
  Share2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SiteCheckResult, SiteStatus, UserSettings } from '../types/upsite';
import {
  copyResultsReport,
  exportResultsToCsv,
  exportResultsToPdf,
  shareResultsPdf,
} from '../utils/exporters';
import { isWithinCheckWindow } from '../utils/intervals';
import { ConfirmModal } from './ConfirmModal';

interface CheckerViewProps {
  urlInput: string;
  onChangeUrlInput: (val: string) => void;
  results: SiteCheckResult[];
  selectedId: string | null;
  statusFilter: 'all' | 'issues' | SiteStatus;
  isChecking: boolean;
  errorMessage: string | null;
  settings: UserSettings;
  autoRefreshRemaining: number | null;
  onChangeStatusFilter: (filter: 'all' | 'issues' | SiteStatus) => void;
  onRunCheck: (urls: string[]) => void;
  onSelectResult: (result: SiteCheckResult) => void;
  onClearResults: () => void;
}

const SAMPLE_URLS = [
  'https://example.com',
  'https://github.com',
  'https://httpstat.us/404',
  'https://httpstat.us/503',
  'https://nonexistent-domain-check.invalid',
].join('\n');

export function parseUrlsFromInput(raw: string): string[] {
  const tokens = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 60);
}

export function CheckerView({
  urlInput,
  onChangeUrlInput,
  results,
  selectedId,
  statusFilter,
  isChecking,
  errorMessage,
  settings,
  autoRefreshRemaining,
  onChangeStatusFilter,
  onRunCheck,
  onSelectResult,
  onClearResults,
}: CheckerViewProps) {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const parsedUrls = useMemo(() => parseUrlsFromInput(urlInput), [urlInput]);

  const showShareNotice = (msg: string) => {
    setShareNotice(msg);
    window.setTimeout(() => {
      setShareNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const counts = useMemo(() => {
    const online = results.filter((r) => r.status === 'online').length;
    const offline = results.filter((r) => r.status === 'offline').length;
    const error = results.filter((r) => r.status === 'error').length;
    return {
      all: results.length,
      issues: offline + error,
      online,
      offline,
      error,
    };
  }, [results]);

  const filteredResults = useMemo(() => {
    if (statusFilter === 'all') return results;
    if (statusFilter === 'issues') return results.filter((r) => r.status !== 'online');
    return results.filter((r) => r.status === statusFilter);
  }, [results, statusFilter]);

  const handleSubmit = () => {
    if (parsedUrls.length === 0 || isChecking) return;
    onChangeStatusFilter('all');
    onRunCheck(parsedUrls);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const hasNewline = urlInput.includes('\n');
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!hasNewline && !e.shiftKey))) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isCompact = settings.density === 'compact';

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 lg:p-8 space-y-6">
      {/* URL Input Card */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label
            htmlFor="upsite-url-input"
            className="text-sm font-medium text-slate-800 dark:text-slate-200"
          >
            Target URLs
          </label>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
            {parsedUrls.length} {parsedUrls.length === 1 ? 'URL' : 'URLs'} ready · Max 60
            {autoRefreshRemaining !== null
              ? !isWithinCheckWindow(settings.checkWindow)
                ? ' · Paused outside time period'
                : ` · Next run in ${
                    autoRefreshRemaining >= 3600
                      ? `${String(Math.floor(autoRefreshRemaining / 3600)).padStart(2, '0')}:${String(
                          Math.floor((autoRefreshRemaining % 3600) / 60),
                        ).padStart(2, '0')}:${String(autoRefreshRemaining % 60).padStart(2, '0')}`
                      : `${String(Math.floor(autoRefreshRemaining / 60)).padStart(2, '0')}:${String(
                          autoRefreshRemaining % 60,
                        ).padStart(2, '0')}`
                  }`
              : ''}
          </span>
        </div>

        <textarea
          id="upsite-url-input"
          rows={3}
          value={urlInput}
          onChange={(e) => onChangeUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Enter a URL (e.g. ${settings.defaultProtocol}://example.com) or paste multiple URLs — one per line or comma-separated`}
          className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-4 py-3 text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500/70 focus:ring-1 focus:ring-rose-500/50 resize-y min-h-[84px]"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeUrlInput(SAMPLE_URLS)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.09] border border-slate-200 dark:border-white/[0.07] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <span>Load Samples</span>
            </button>
            {(urlInput.trim().length > 0 || results.length > 0) && (
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-transparent hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Clear</span>
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={parsedUrls.length === 0 || isChecking}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            {isChecking ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={2} />
            ) : (
              <Play className="w-4 h-4 shrink-0" strokeWidth={2} />
            )}
            <span>
              {isChecking ? 'Checking...' : parsedUrls.length > 1 ? 'Check All Sites' : 'Check Site'}
            </span>
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300"
          >
            {errorMessage}
          </div>
        )}
      </section>

      {/* Results Area — Primary Up / Down Visibility */}
      {isChecking && results.length === 0 && (
        <section className="space-y-2.5" aria-label="Checking websites">
          {Array.from({ length: Math.min(parsedUrls.length || 3, 5) }).map((_, idx) => (
            <div
              key={idx}
              className="h-16 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#171A28] px-5 flex items-center justify-between animate-pulse"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-white/[0.08]" />
                <div className="w-48 h-3.5 rounded bg-slate-200 dark:bg-white/[0.08]" />
              </div>
              <div className="flex items-center gap-6">
                <div className="w-16 h-3.5 rounded bg-slate-200 dark:bg-white/[0.08]" />
                <div className="w-12 h-3.5 rounded bg-slate-200 dark:bg-white/[0.08]" />
              </div>
            </div>
          ))}
        </section>
      )}

      {results.length > 0 && (
        <section className="space-y-4">
          {/* Toolbar: Filter Tabs + Export Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div
              role="tablist"
              aria-label="Filter results by status"
              className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.07]"
            >
              {(
                [
                  { id: 'all', label: 'All', count: counts.all },
                  { id: 'issues', label: 'Issues', count: counts.issues },
                  { id: 'online', label: 'Online', count: counts.online },
                  { id: 'offline', label: 'Offline', count: counts.offline },
                  { id: 'error', label: 'Error', count: counts.error },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === tab.id}
                  onClick={() => onChangeStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                    statusFilter === tab.id
                      ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {shareNotice && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                  {shareNotice}
                </span>
              )}
              <button
                type="button"
                onClick={() => exportResultsToCsv(filteredResults, 'upsite-results')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() => exportResultsToPdf(filteredResults, 'upsite-results')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void shareResultsPdf(filteredResults, 'upsite-results')
                    .then(showShareNotice)
                    .catch(() => showShareNotice('Unable to share PDF.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Share PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyResultsReport(filteredResults, 'upsite-results')
                    .then(showShareNotice)
                    .catch(() => showShareNotice('Clipboard copy unavailable.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Copy Report</span>
              </button>
            </div>
          </div>

          {/* Results List */}
          <div className="space-y-2">
            {filteredResults.map((item) => {
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

              const redirected =
                item.redirects.length > 1 && item.finalUrl !== item.normalizedUrl;

              const isSlow =
                settings.slowThresholdMs > 0 &&
                item.responseTimeMs !== null &&
                item.responseTimeMs > settings.slowThresholdMs;

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
                  {/* Primary Left: Status Icon + URL */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <StatusIcon
                      className={`w-4 h-4 shrink-0 ${statusColorClass}`}
                      strokeWidth={2}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                        {item.normalizedUrl}
                      </p>
                      {!isCompact && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {redirected
                            ? `Redirected (${item.redirects.length} hops) · ${item.finalUrl}`
                            : item.diagnosis.errorCode !== 'NONE'
                              ? `${item.diagnosis.errorCode} · Click for fix details`
                              : 'Click for SSL, DNS, and response details'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Primary Right: Status + Latency + HTTP Code + Details Affordance */}
                  <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                    {isSlow && (
                      <span className="hidden sm:inline text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                        Slow
                      </span>
                    )}

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

                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                      <span className="hidden sm:inline">Details</span>
                      <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                    </span>
                  </div>
                </button>
              );
            })}

            {filteredResults.length === 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#171A28] px-6 py-10 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No sites match the selected status filter.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Clean Empty State */}
      {!isChecking && results.length === 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/70 dark:bg-[#171A28]/60 px-6 py-14 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-500 dark:text-slate-300">
            <Globe className="w-5 h-5" strokeWidth={1.6} />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
              Check if any website is up or down
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Enter one URL or paste a list of URLs above to verify availability simultaneously. Click any result row to inspect HTTP codes, SSL certificates, DNS records, redirects, and error fixes.
            </p>
          </div>
        </section>
      )}
      <ConfirmModal
        open={confirmClearOpen}
        title="Clear Checker URLs & Results?"
        description="This will clear all entered target URLs and the current check results from the Checker view."
        confirmLabel="Clear All"
        tone="danger"
        onConfirm={() => {
          onChangeUrlInput('');
          onClearResults();
          setConfirmClearOpen(false);
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
