import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  List,
  Minimize2,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  IncidentRecord,
  IntegrationChannel,
  ReportDispatchPayload,
  SiteCheckResult,
  SiteStatus,
  UserSettings,
} from '../types/upsite';
import {
  buildReportDispatchPayloadFromResults,
  copyResultsReport,
  exportResultsToCsv,
  exportResultsToPdf,
  shareResultsPdf,
} from '../utils/exporters';
import { ConfirmModal } from './ConfirmModal';
import { ReportActionBar } from './ReportActionBar';

interface HistoryViewProps {
  history: SiteCheckResult[];
  incidents?: IncidentRecord[];
  selectedId: string | null;
  settings: UserSettings;
  integrations?: IntegrationChannel[];
  onSelectResult: (result: SiteCheckResult) => void;
  onClearHistory: () => void;
  onClearIncidents?: () => void;
  onDeduplicateHistory: () => void;
  onSendToApps?: (
    report: ReportDispatchPayload,
    channelIds: string[],
  ) => Promise<{
    sentCount: number;
    results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
  }>;
  onOpenIntegrationsSettings?: () => void;
}

type DateSortOrder = 'newest' | 'oldest';
type DateRangeFilter = 'all' | 'today' | 'week';
type HistoryViewMode = 'by-site' | 'by-run' | 'timeline' | 'incidents';

interface SiteHistoryGroup {
  key: string;
  normalizedUrl: string;
  latest: SiteCheckResult;
  items: SiteCheckResult[];
  onlineCount: number;
  issueCount: number;
}

interface RunBatchGroup {
  id: string;
  startedAt: string;
  items: SiteCheckResult[];
  onlineCount: number;
  issueCount: number;
  avgLatencyMs: number | null;
}

const PAGE_SIZE = 30;
const RUN_GAP_MS = 25000;

function formatCompactTimestamp(iso: string): string {
  const dateObj = new Date(iso);
  if (Number.isNaN(dateObj.getTime())) return iso;
  const now = new Date();
  const sameDay =
    dateObj.getFullYear() === now.getFullYear() &&
    dateObj.getMonth() === now.getMonth() &&
    dateObj.getDate() === now.getDate();

  const timePart = dateObj.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay) {
    return `Today, ${timePart}`;
  }
  const datePart = dateObj.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${datePart}, ${timePart}`;
}

function formatIncidentDuration(inc: IncidentRecord): string {
  const startMs = Date.parse(inc.startedAt);
  const endMs = inc.resolvedAt ? Date.parse(inc.resolvedAt) : Date.now();
  const diffMs =
    typeof inc.durationMs === 'number'
      ? inc.durationMs
      : Number.isNaN(startMs) || Number.isNaN(endMs)
        ? 0
        : Math.max(0, endMs - startMs);
  const totalSec = Math.max(1, Math.round(diffMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m ${totalSec % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function HistoryView({
  history,
  incidents = [],
  selectedId,
  settings,
  integrations = [],
  onSelectResult,
  onClearHistory,
  onClearIncidents,
  onDeduplicateHistory,
  onSendToApps,
  onOpenIntegrationsSettings,
}: HistoryViewProps) {
  const incidentsEnabled = settings.features?.incidentTrackingEnabled !== false;
  const [viewMode, setViewMode] = useState<HistoryViewMode>('by-site');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [dateSort, setDateSort] = useState<DateSortOrder>('newest');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [expandedSiteKeys, setExpandedSiteKeys] = useState<Record<string, boolean>>({});
  const [expandedRunIds, setExpandedRunIds] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState<number>(PAGE_SIZE);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmTrimOpen, setConfirmTrimOpen] = useState(false);
  const [confirmClearIncidentsOpen, setConfirmClearIncidentsOpen] = useState(false);

  useEffect(() => {
    if (!incidentsEnabled && viewMode === 'incidents') {
      setViewMode('by-site');
    }
  }, [incidentsEnabled, viewMode]);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [viewMode, searchQuery, statusFilter, dateSort, dateRange]);

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

  // Unique sites across all saved history (for trim-duplicates indicator)
  const totalUniqueSitesCount = useMemo(() => {
    const set = new Set<string>();
    for (const item of history) {
      set.add((item.normalizedUrl || item.inputUrl).toLowerCase());
    }
    return set.size;
  }, [history]);

  const duplicateCount = Math.max(0, history.length - totalUniqueSitesCount);

  // Group filtered records by unique URL so repeated checks never bloat the list
  const siteGroups = useMemo<SiteHistoryGroup[]>(() => {
    const map = new Map<string, SiteCheckResult[]>();
    for (const item of filtered) {
      const key = (item.normalizedUrl || item.inputUrl).toLowerCase();
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(key, [item]);
      }
    }

    const groups: SiteHistoryGroup[] = [];
    for (const [key, items] of map.entries()) {
      const sortedChrono = [...items].sort(
        (a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0),
      );
      const orderedItems = dateSort === 'newest' ? sortedChrono : [...sortedChrono].reverse();
      const onlineCount = sortedChrono.filter((r) => r.status === 'online').length;
      groups.push({
        key,
        normalizedUrl: sortedChrono[0].normalizedUrl,
        latest: sortedChrono[0],
        items: orderedItems,
        onlineCount,
        issueCount: sortedChrono.length - onlineCount,
      });
    }

    return groups.sort((a, b) => {
      const ta = Date.parse(a.latest.checkedAt) || 0;
      const tb = Date.parse(b.latest.checkedAt) || 0;
      return dateSort === 'newest' ? tb - ta : ta - tb;
    });
  }, [filtered, dateSort]);

  // Group filtered records into batch Check Runs (checks made within 25s of each other)
  const runGroups = useMemo<RunBatchGroup[]>(() => {
    if (filtered.length === 0) return [];
    const chronological = [...filtered].sort(
      (a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0),
    );
    const batches: SiteCheckResult[][] = [];
    let currentBatch: SiteCheckResult[] = [];
    let lastTs = 0;

    for (const item of chronological) {
      const ts = Date.parse(item.checkedAt) || 0;
      if (currentBatch.length === 0 || Math.abs(lastTs - ts) <= RUN_GAP_MS) {
        currentBatch.push(item);
      } else {
        batches.push(currentBatch);
        currentBatch = [item];
      }
      lastTs = ts;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const built = batches.map((items, index) => {
      const onlineCount = items.filter((r) => r.status === 'online').length;
      const latencies = items
        .map((r) => r.responseTimeMs)
        .filter((ms): ms is number => typeof ms === 'number');
      const avgLatencyMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
          : null;

      return {
        id: `${items[0].checkedAt}-${index}`,
        startedAt: items[0].checkedAt,
        items,
        onlineCount,
        issueCount: items.length - onlineCount,
        avgLatencyMs,
      };
    });

    return dateSort === 'newest' ? built : [...built].reverse();
  }, [filtered, dateSort]);

  const filteredIncidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    const matching = incidents.filter((inc) => {
      if (dateRange !== 'all') {
        const ts = Date.parse(inc.startedAt);
        if (Number.isNaN(ts)) return false;
        if (dateRange === 'today' && ts < startOfToday) return false;
        if (dateRange === 'week' && ts < sevenDaysAgo) return false;
      }
      if (!q) return true;
      return (
        inc.url.toLowerCase().includes(q) ||
        inc.orgName.toLowerCase().includes(q) ||
        (inc.projectName || '').toLowerCase().includes(q) ||
        inc.errorCode.toLowerCase().includes(q) ||
        inc.reason.toLowerCase().includes(q)
      );
    });

    return [...matching].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      const ta = Date.parse(a.startedAt) || 0;
      const tb = Date.parse(b.startedAt) || 0;
      return dateSort === 'newest' ? tb - ta : ta - tb;
    });
  }, [incidents, searchQuery, dateRange, dateSort]);

  const isCompact = settings.density === 'compact';

  const activeTotalCount =
    viewMode === 'by-site'
      ? siteGroups.length
      : viewMode === 'by-run'
        ? runGroups.length
        : viewMode === 'incidents'
          ? filteredIncidents.length
          : filtered.length;

  const visibleSiteGroups = siteGroups.slice(0, visibleLimit);
  const visibleRunGroups = runGroups.slice(0, visibleLimit);
  const visibleTimeline = filtered.slice(0, visibleLimit);
  const visibleIncidents = filteredIncidents.slice(0, visibleLimit);
  const hasMore = activeTotalCount > visibleLimit;

  const renderStatusBadge = (item: SiteCheckResult) => {
    const surface =
      item.status === 'online'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
        : item.status === 'offline'
          ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
          : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20';
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap shrink-0 ${surface}`}
      >
        {item.statusLabel}
      </span>
    );
  };

  const renderStatusIcon = (status: SiteStatus) => {
    if (status === 'online') {
      return <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />;
    }
    if (status === 'offline') {
      return <XCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" strokeWidth={2} />;
    }
    return <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-7 space-y-4">
      {/* Row 1: Search + View Mode Switcher + Export / Cleanup Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by URL, HTTP code, or error..."
            className="w-full rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] pl-10 pr-4 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Anti-Bulk View Switcher */}
          <div
            role="tablist"
            aria-label="History view mode"
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-site'}
              onClick={() => setViewMode('by-site')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'by-site'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>By Site</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-run'}
              onClick={() => setViewMode('by-run')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'by-run'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>By Run</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'timeline'}
              onClick={() => setViewMode('timeline')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'timeline'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <List className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Timeline</span>
            </button>
            {incidentsEnabled && (
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'incidents'}
                onClick={() => setViewMode('incidents')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'incidents'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Incidents ({incidents.filter((i) => i.status === 'open').length || incidents.length})</span>
              </button>
            )}
          </div>

          {viewMode !== 'incidents' && duplicateCount > 0 && (
            <button
              type="button"
              onClick={() => setConfirmTrimOpen(true)}
              title="Remove older repeated checks and keep only the latest check per site"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-white dark:bg-[#1B1F28] hover:bg-blue-50 dark:hover:bg-blue-500/10 border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Minimize2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Keep Latest Only</span>
            </button>
          )}

          {viewMode === 'incidents' && incidents.length > 0 && onClearIncidents && (
            <button
              type="button"
              onClick={() => setConfirmClearIncidentsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 bg-white dark:bg-[#1B1F28] hover:bg-rose-500/10 border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Clear Incidents</span>
            </button>
          )}

          {viewMode !== 'incidents' && history.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 bg-white dark:bg-[#1B1F28] hover:bg-rose-500/10 border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Filters & Dynamic Report Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDateSort((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#1B1F28] hover:bg-slate-50 dark:hover:bg-[#222734] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>{dateSort === 'newest' ? 'Newest' : 'Oldest'}</span>
          </button>

          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.07]">
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
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  dateRange === range.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.07]">
            {(['all', 'online', 'offline', 'error'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {filtered.length > 0 && (
          <div className="flex-1 min-w-[200px] flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
              {siteGroups.length} {siteGroups.length === 1 ? 'site' : 'sites'} · {runGroups.length}{' '}
              {runGroups.length === 1 ? 'run' : 'runs'} · {filtered.length} checks
            </span>
            <div className="flex-1 min-w-[180px]">
              <ReportActionBar
                hasReportData={filtered.length > 0}
                onExportCsv={() => exportResultsToCsv(filtered, 'upsite-history')}
                onExportPdf={() => exportResultsToPdf(filtered, 'upsite-history')}
                onSharePdf={() =>
                  shareResultsPdf(filtered, 'upsite-history', 'upsite Check History Report')
                }
                onCopyReport={() =>
                  copyResultsReport(filtered, 'upsite-history', 'upsite Check History Report')
                }
                onBuildReportPayload={() =>
                  buildReportDispatchPayloadFromResults(
                    filtered,
                    'upsite Check History Report',
                    `${siteGroups.length} sites · ${filtered.length} checks`,
                  )
                }
                integrations={integrations}
                onSendToApps={onSendToApps}
                onOpenIntegrationsSettings={onOpenIntegrationsSettings}
              />
            </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      {viewMode === 'incidents' ? (
        filteredIncidents.length > 0 ? (
          <div className="space-y-2.5">
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06] overflow-hidden">
              {visibleIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className={`px-4 ${isCompact ? 'py-2.5' : 'py-3.5'} flex flex-wrap items-center justify-between gap-3`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {inc.status === 'open' ? (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" strokeWidth={2} />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" strokeWidth={2} />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs sm:text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                        {inc.url}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {inc.orgName}
                        {inc.projectName ? ` / ${inc.projectName}` : ''} · {inc.errorCode} — {inc.reason}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                        Started: {formatCompactTimestamp(inc.startedAt)}
                        {inc.resolvedAt ? ` · Resolved: ${formatCompactTimestamp(inc.resolvedAt)}` : ' · Currently ongoing'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap ${
                        inc.status === 'open'
                          ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                      }`}
                    >
                      {inc.status === 'open' ? 'Open Outage' : 'Resolved'}
                    </span>
                    <span className="w-16 text-right text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatIncidentDuration(inc)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#1B1F28] hover:bg-slate-50 dark:hover:bg-[#222734] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap"
                >
                  Show {Math.min(PAGE_SIZE, activeTotalCount - visibleLimit)} more ({activeTotalCount - visibleLimit} remaining)
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/80 dark:bg-[#1B1F28]/70 px-6 py-14 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#F3F5F8] dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
              <Activity className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                {incidents.length === 0 ? 'No outages recorded' : 'No matching incidents'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {incidents.length === 0
                  ? 'When an Organisation endpoint goes down and later recovers, upsite automatically logs the outage start, recovery time, and total downtime duration here.'
                  : 'Try adjusting your search text or date filter.'}
              </p>
            </div>
          </div>
        )
      ) : filtered.length > 0 ? (
        <div className="space-y-2.5">
          {/* VIEW MODE 1: BY SITE (Deduplicated compact cards with expandable check timeline) */}
          {viewMode === 'by-site' && (
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06] overflow-hidden">
              {visibleSiteGroups.map((group) => {
                const latest = group.latest;
                const isSelected = selectedId === latest.id;
                const isExpanded = Boolean(expandedSiteKeys[group.key]);
                const hasMultiple = group.items.length > 1;

                return (
                  <div key={group.key}>
                    <div
                      className={`px-4 ${isCompact ? 'py-2' : 'py-3'} flex items-center justify-between gap-3 transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-500/[0.08]'
                          : 'hover:bg-slate-50 dark:hover:bg-[#222734]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectResult(latest)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none"
                      >
                        {renderStatusIcon(latest.status)}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                            {group.normalizedUrl}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate mt-0.5">
                            Last: {formatCompactTimestamp(latest.checkedAt)}
                            {hasMultiple
                              ? ` · ${group.items.length} checks (${group.onlineCount} up, ${group.issueCount} down)`
                              : latest.diagnosis.errorCode === 'NONE'
                                ? ' · Healthy'
                                : ` · ${latest.diagnosis.errorCode}`}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
                        {renderStatusBadge(latest)}

                        <span className="hidden sm:inline-block w-14 text-right text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
                          {latest.responseTimeMs !== null ? `${latest.responseTimeMs} ms` : '—'}
                        </span>

                        <span className="hidden md:inline-block w-9 text-right text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                          {latest.httpStatusCode !== null ? latest.httpStatusCode : '—'}
                        </span>

                        {hasMultiple ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSiteKeys((prev) => ({
                                ...prev,
                                [group.key]: !prev[group.key],
                              }))
                            }
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors whitespace-nowrap shrink-0"
                          >
                            <span className="tabular-nums">{group.items.length}</span>
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3 shrink-0" strokeWidth={1.8} />
                            ) : (
                              <ChevronRight className="w-3 h-3 shrink-0" strokeWidth={1.8} />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectResult(latest)}
                            aria-label={`Inspect ${group.normalizedUrl}`}
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                          >
                            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Per-Site Compact History */}
                    {isExpanded && hasMultiple && (
                      <div className="bg-[#F3F5F8]/80 dark:bg-[#12151C]/90 border-t border-slate-200/80 dark:border-white/[0.06] divide-y divide-slate-200/60 dark:divide-white/[0.05] max-h-56 overflow-y-auto">
                        {group.items.map((entry) => {
                          const entrySelected = selectedId === entry.id;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => onSelectResult(entry)}
                              className={`w-full text-left pl-11 pr-4 py-2 flex items-center justify-between gap-3 text-xs transition-colors ${
                                entrySelected
                                  ? 'bg-blue-50/80 dark:bg-blue-500/[0.1]'
                                  : 'hover:bg-slate-200/50 dark:hover:bg-white/[0.04]'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {renderStatusIcon(entry.status)}
                                <span className="tabular-nums text-slate-700 dark:text-slate-300 truncate">
                                  {formatCompactTimestamp(entry.checkedAt)}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400 truncate hidden sm:inline">
                                  {entry.diagnosis.errorCode === 'NONE'
                                    ? 'Healthy'
                                    : entry.diagnosis.errorCode}
                                </span>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {renderStatusBadge(entry)}
                                <span className="w-14 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                  {entry.responseTimeMs !== null ? `${entry.responseTimeMs} ms` : '—'}
                                </span>
                                <span className="hidden md:inline-block w-9 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                  {entry.httpStatusCode !== null ? entry.httpStatusCode : '—'}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* VIEW MODE 2: BY RUN (Bulk sessions grouped into collapsible batch cards) */}
          {viewMode === 'by-run' && (
            <div className="space-y-2.5">
              {visibleRunGroups.map((run, idx) => {
                const isExpanded =
                  run.id in expandedRunIds ? expandedRunIds[run.id] : idx === 0 && run.items.length <= 20;
                return (
                  <section
                    key={run.id}
                    className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] overflow-hidden"
                  >
                    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRunIds((prev) => ({
                            ...prev,
                            [run.id]: !isExpanded,
                          }))
                        }
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {formatCompactTimestamp(run.startedAt)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                            {run.items.length} {run.items.length === 1 ? 'site' : 'sites'} ·{' '}
                            {run.onlineCount} up · {run.issueCount} down
                            {run.avgLatencyMs !== null ? ` · Avg ${run.avgLatencyMs} ms` : ''}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => exportResultsToCsv(run.items, 'upsite-run')}
                          className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors whitespace-nowrap"
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => exportResultsToPdf(run.items, 'upsite-run')}
                          className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors whitespace-nowrap"
                        >
                          PDF
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-200 dark:border-white/[0.06] divide-y divide-slate-200 dark:divide-white/[0.06] max-h-80 overflow-y-auto">
                        {run.items.map((item) => {
                          const isSelected = selectedId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => onSelectResult(item)}
                              className={`w-full text-left px-4 ${
                                isCompact ? 'py-2' : 'py-2.5'
                              } flex items-center justify-between gap-3 transition-colors ${
                                isSelected
                                  ? 'bg-blue-50/70 dark:bg-blue-500/[0.08]'
                                  : 'hover:bg-slate-50 dark:hover:bg-[#222734]'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                {renderStatusIcon(item.status)}
                                <span className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                                  {item.normalizedUrl}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                {renderStatusBadge(item)}
                                <span className="hidden sm:inline-block w-14 text-right text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                  {item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
                                </span>
                                <span className="hidden md:inline-block w-9 text-right text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                  {item.httpStatusCode !== null ? item.httpStatusCode : '—'}
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={1.75} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* VIEW MODE 3: TIMELINE (Compact flat log with pagination) */}
          {viewMode === 'timeline' && (
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06] overflow-hidden">
              {visibleTimeline.map((item) => {
                const isSelected = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectResult(item)}
                    className={`w-full text-left px-4 ${
                      isCompact ? 'py-2' : 'py-2.5'
                    } flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-500/[0.08]'
                        : 'hover:bg-slate-50 dark:hover:bg-[#222734]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {renderStatusIcon(item.status)}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                          {item.normalizedUrl}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                          {formatCompactTimestamp(item.checkedAt)} ·{' '}
                          {item.diagnosis.errorCode === 'NONE'
                            ? 'Healthy'
                            : item.diagnosis.errorCode}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                      {renderStatusBadge(item)}
                      <span className="hidden sm:inline-block w-14 text-right text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—'}
                      </span>
                      <span className="hidden md:inline-block w-9 text-right text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {item.httpStatusCode !== null ? item.httpStatusCode : '—'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#1B1F28] hover:bg-slate-50 dark:hover:bg-[#222734] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap"
              >
                Show {Math.min(PAGE_SIZE, activeTotalCount - visibleLimit)} more ({activeTotalCount - visibleLimit} remaining)
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/80 dark:bg-[#1B1F28]/70 px-6 py-14 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#F3F5F8] dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
            <Clock className="w-5 h-5" strokeWidth={1.6} />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
              {history.length === 0 ? 'No check history yet' : 'No matching history entries'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {history.length === 0
                ? 'Run a website check in Checker or Organisation and results will be saved here grouped cleanly by site.'
                : 'Try adjusting your search text, date range, or status filter.'}
            </p>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmTrimOpen}
        title="Keep Only Latest Check Per Site?"
        description={`This will remove ${duplicateCount} older repeated check ${
          duplicateCount === 1 ? 'entry' : 'entries'
        } and keep only the newest check for each of your ${totalUniqueSitesCount} unique ${
          totalUniqueSitesCount === 1 ? 'site' : 'sites'
        }.`}
        confirmLabel="Keep Latest Only"
        tone="neutral"
        onConfirm={() => {
          onDeduplicateHistory();
          setConfirmTrimOpen(false);
        }}
        onCancel={() => setConfirmTrimOpen(false)}
      />

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

      <ConfirmModal
        open={confirmClearIncidentsOpen}
        title="Clear Incident Timeline?"
        description={`This will permanently clear all ${incidents.length} recorded outage ${
          incidents.length === 1 ? 'incident' : 'incidents'
        } from your account.`}
        confirmLabel="Clear Incidents"
        tone="danger"
        onConfirm={() => {
          onClearIncidents?.();
          setConfirmClearIncidentsOpen(false);
        }}
        onCancel={() => setConfirmClearIncidentsOpen(false)}
      />
    </div>
  );
}
