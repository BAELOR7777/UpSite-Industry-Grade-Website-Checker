import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  Globe,
  Lock,
  Search,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  IncidentRecord,
  IntegrationChannel,
  Organisation,
  ReportDispatchPayload,
  SiteCheckResult,
  UserSettings,
} from '../types/upsite';
import {
  buildReportDispatchPayloadFromResults,
  copyResultsReport,
  exportResultsToCsv,
  exportResultsToPdf,
  exportStatusPageHtml,
  shareResultsPdf,
} from '../utils/exporters';
import { ReportActionBar } from './ReportActionBar';
import { computeUrlSmartThresholdMap } from '../utils/smartThreshold';

interface AnalyticsViewProps {
  history: SiteCheckResult[];
  organisations: Organisation[];
  incidents: IncidentRecord[];
  settings: UserSettings;
  integrations?: IntegrationChannel[];
  onSelectResult: (result: SiteCheckResult) => void;
  onOpenOrganisation: (orgId: string) => void;
  onOpenIncidentsTab: () => void;
  onSendToApps?: (
    report: ReportDispatchPayload,
    channelIds: string[],
  ) => Promise<{
    sentCount: number;
    results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
  }>;
  onOpenIntegrationsSettings?: () => void;
}

type RangeKey = '24h' | '7d' | '30d' | 'all';
type EndpointSortKey = 'uptime-asc' | 'latency-desc' | 'checks-desc' | 'url-asc';
type EndpointFilterKey = 'all' | 'issues' | 'slow';

interface EndpointStat {
  key: string;
  url: string;
  latest: SiteCheckResult;
  total: number;
  online: number;
  issues: number;
  uptimePct: number;
  avgMs: number | null;
  p95Ms: number | null;
  recentStatuses: Array<'online' | 'offline' | 'error'>;
}

function formatDurationShort(ms?: number, startedAt?: string, resolvedAt?: string): string {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const end = resolvedAt ? Date.parse(resolvedAt) : Date.now();
  const safeMs =
    typeof ms === 'number'
      ? ms
      : !Number.isNaN(start) && !Number.isNaN(end)
        ? Math.max(0, end - start)
        : 0;
  const totalSec = Math.max(1, Math.round(safeMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m ${totalSec % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function computePercentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

export function AnalyticsView({
  history,
  organisations,
  incidents,
  settings,
  integrations = [],
  onSelectResult,
  onOpenOrganisation,
  onOpenIncidentsTab,
  onSendToApps,
  onOpenIntegrationsSettings,
}: AnalyticsViewProps) {
  const [range, setRange] = useState<RangeKey>('7d');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [hoveredBucketIdx, setHoveredBucketIdx] = useState<number | null>(null);
  const [endpointSearch, setEndpointSearch] = useState('');
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilterKey>('all');
  const [endpointSort, setEndpointSort] = useState<EndpointSortKey>('uptime-asc');
  const [showAllEndpoints, setShowAllEndpoints] = useState(false);

  const selectedOrg = useMemo(
    () =>
      selectedOrgId === 'all'
        ? null
        : organisations.find((o) => o.id === selectedOrgId) || null,
    [organisations, selectedOrgId],
  );

  // Pre-compute URL set for selected organisation scope
  const scopedOrgUrlSet = useMemo(() => {
    if (!selectedOrg) return null;
    const set = new Set<string>();
    for (const proj of selectedOrg.projects) {
      for (const u of proj.urls) {
        if (u) set.add(u.toLowerCase());
      }
      for (const r of proj.lastResults || []) {
        set.add((r.normalizedUrl || r.inputUrl).toLowerCase());
        set.add(r.inputUrl.toLowerCase());
      }
    }
    return set;
  }, [selectedOrg]);

  // Single time-range + org-scope filter pass
  const rangedHistory = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === '24h'
        ? now - 24 * 60 * 60 * 1000
        : range === '7d'
          ? now - 7 * 24 * 60 * 60 * 1000
          : range === '30d'
            ? now - 30 * 24 * 60 * 60 * 1000
            : 0;

    return history.filter((item) => {
      if (cutoff > 0) {
        const ts = Date.parse(item.checkedAt);
        if (Number.isNaN(ts) || ts < cutoff) return false;
      }
      if (scopedOrgUrlSet) {
        const inputKey = item.inputUrl.toLowerCase();
        const normKey = (item.normalizedUrl || '').toLowerCase();
        if (!scopedOrgUrlSet.has(inputKey) && !scopedOrgUrlSet.has(normKey)) {
          return false;
        }
      }
      return true;
    });
  }, [history, range, scopedOrgUrlSet]);

  const scopedIncidents = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === '24h'
        ? now - 24 * 60 * 60 * 1000
        : range === '7d'
          ? now - 7 * 24 * 60 * 60 * 1000
          : range === '30d'
            ? now - 30 * 24 * 60 * 60 * 1000
            : 0;

    return incidents.filter((inc) => {
      if (selectedOrg && inc.orgId !== selectedOrg.id) return false;
      if (cutoff > 0) {
        const ts = Date.parse(inc.startedAt);
        if (Number.isNaN(ts) || ts < cutoff) return false;
      }
      return true;
    });
  }, [incidents, range, selectedOrg]);

  const urlThresholdMap = useMemo(
    () => computeUrlSmartThresholdMap(organisations, history, settings),
    [organisations, history, settings],
  );

  // Single-pass core KPIs, percentiles, latency distribution, error breakdown & endpoint leaderboard
  const {
    metrics,
    chartBuckets,
    maxBucketTotal,
    maxBucketLatency,
    endpointStats,
    slowestSites,
    errorBreakdown,
    speedDistribution,
    mttrMs,
  } = useMemo(() => {
    let online = 0;
    let offline = 0;
    let error = 0;
    const latencies: number[] = [];

    let fastCount = 0;
    let moderateCount = 0;
    let slowCount = 0;
    const slowThresh = settings.slowThresholdMs > 0 ? settings.slowThresholdMs : 1000;
    const fastCutoff = Math.min(350, Math.round(slowThresh * 0.4));

    const errorMap = new Map<
      string,
      { code: string; count: number; sample: SiteCheckResult }
    >();
    const endpointMap = new Map<
      string,
      {
        url: string;
        latest: SiteCheckResult;
        latestTs: number;
        online: number;
        issues: number;
        latencies: number[];
        timeline: Array<{ ts: number; status: 'online' | 'offline' | 'error' }>;
      }
    >();

    for (const item of rangedHistory) {
      if (item.status === 'online') online += 1;
      else if (item.status === 'offline') offline += 1;
      else error += 1;

      const key = (item.normalizedUrl || item.inputUrl).toLowerCase();
      if (typeof item.responseTimeMs === 'number') {
        latencies.push(item.responseTimeMs);
        const smartInfo = settings.smartThresholdEnabled
          ? urlThresholdMap.get(key) || urlThresholdMap.get(item.inputUrl.toLowerCase())
          : undefined;
        const itemSlowThresh = smartInfo ? smartInfo.thresholdMs : slowThresh;
        const itemFastCutoff = Math.min(350, Math.round(itemSlowThresh * 0.4));
        if (item.responseTimeMs <= itemFastCutoff) fastCount += 1;
        else if (item.responseTimeMs <= itemSlowThresh) moderateCount += 1;
        else slowCount += 1;
      }

      if (item.status !== 'online') {
        const errCode = item.diagnosis.errorCode || 'UNKNOWN';
        const existingErr = errorMap.get(errCode);
        if (existingErr) {
          existingErr.count += 1;
        } else {
          errorMap.set(errCode, { code: errCode, count: 1, sample: item });
        }
      }

      const ts = Date.parse(item.checkedAt) || 0;
      let ep = endpointMap.get(key);
      if (!ep) {
        ep = {
          url: item.normalizedUrl || item.inputUrl,
          latest: item,
          latestTs: ts,
          online: 0,
          issues: 0,
          latencies: [],
          timeline: [],
        };
        endpointMap.set(key, ep);
      } else if (ts > ep.latestTs) {
        ep.latest = item;
        ep.latestTs = ts;
      }

      if (item.status === 'online') ep.online += 1;
      else ep.issues += 1;
      if (typeof item.responseTimeMs === 'number') ep.latencies.push(item.responseTimeMs);
      ep.timeline.push({ ts, status: item.status });
    }

    const total = rangedHistory.length;
    const uptimePct = total > 0 ? ((online / total) * 100).toFixed(1) : '—';

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((s, ms) => s + ms, 0) / latencies.length)
        : null;
    const p50LatencyMs = computePercentile(sortedLatencies, 50);
    const p95LatencyMs = computePercentile(sortedLatencies, 95);

    const orgList = selectedOrg ? [selectedOrg] : organisations;
    const orgUrlSet = new Set<string>();
    const orgLatestResults: SiteCheckResult[] = [];
    for (const org of orgList) {
      for (const proj of org.projects) {
        for (const u of proj.urls) orgUrlSet.add(u);
        for (const res of proj.lastResults || []) orgLatestResults.push(res);
      }
    }

    const openIncidents = scopedIncidents.filter((i) => i.status === 'open').length;
    const resolvedDurations = scopedIncidents
      .filter((i) => i.status === 'resolved' && typeof i.durationMs === 'number')
      .map((i) => i.durationMs as number);
    const computedMttr =
      resolvedDurations.length > 0
        ? Math.round(resolvedDurations.reduce((s, d) => s + d, 0) / resolvedDurations.length)
        : null;

    // 14 chronological buckets for crisp chart density
    let buckets: Array<{
      index: number;
      label: string;
      online: number;
      issues: number;
      total: number;
      avgLatency: number;
      p95Latency: number;
    }> = [];

    if (rangedHistory.length > 0) {
      const sortedChecks = [...rangedHistory].sort(
        (a, b) => (Date.parse(a.checkedAt) || 0) - (Date.parse(b.checkedAt) || 0),
      );
      const minTs = Date.parse(sortedChecks[0].checkedAt) || Date.now();
      const maxTs = Date.parse(sortedChecks[sortedChecks.length - 1].checkedAt) || minTs;
      const bucketCount = 14;
      const span = Math.max(60_000, maxTs - minTs);
      const step = span / bucketCount;
      const showDateInLabel = span > 24 * 60 * 60 * 1000;

      const rawBuckets = Array.from({ length: bucketCount }, (_, i) => {
        const d = new Date(minTs + step * i);
        const label = showDateInLabel
          ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return {
          index: i,
          label,
          online: 0,
          issues: 0,
          latencies: [] as number[],
        };
      });

      for (const item of sortedChecks) {
        const ts = Date.parse(item.checkedAt) || minTs;
        const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - minTs) / step)));
        if (item.status === 'online') rawBuckets[idx].online += 1;
        else rawBuckets[idx].issues += 1;
        if (typeof item.responseTimeMs === 'number') {
          rawBuckets[idx].latencies.push(item.responseTimeMs);
        }
      }

      buckets = rawBuckets.map((b) => {
        const sortedB = [...b.latencies].sort((x, y) => x - y);
        return {
          index: b.index,
          label: b.label,
          online: b.online,
          issues: b.issues,
          total: b.online + b.issues,
          avgLatency:
            b.latencies.length > 0
              ? Math.round(b.latencies.reduce((s, n) => s + n, 0) / b.latencies.length)
              : 0,
          p95Latency: computePercentile(sortedB, 95) ?? 0,
        };
      });
    }

    const builtEndpoints: EndpointStat[] = [];
    for (const [key, ep] of endpointMap.entries()) {
      const epTotal = ep.online + ep.issues;
      const sortedEpLat = [...ep.latencies].sort((a, b) => a - b);
      const avgMs =
        ep.latencies.length > 0
          ? Math.round(ep.latencies.reduce((s, m) => s + m, 0) / ep.latencies.length)
          : null;
      const p95Ms = computePercentile(sortedEpLat, 95);
      const recentStatuses = [...ep.timeline]
        .sort((a, b) => a.ts - b.ts)
        .slice(-10)
        .map((t) => t.status);

      builtEndpoints.push({
        key,
        url: ep.url,
        latest: ep.latest,
        total: epTotal,
        online: ep.online,
        issues: ep.issues,
        uptimePct: epTotal > 0 ? (ep.online / epTotal) * 100 : 100,
        avgMs,
        p95Ms,
        recentStatuses,
      });
    }

    const slowest = builtEndpoints
      .filter((e) => e.latest.responseTimeMs !== null)
      .sort((a, b) => (b.latest.responseTimeMs || 0) - (a.latest.responseTimeMs || 0))
      .slice(0, 5)
      .map((e) => e.latest);

    const errorsList = Array.from(errorMap.values()).sort((a, b) => b.count - a.count);

    return {
      metrics: {
        total,
        online,
        offline,
        error,
        uptimePct,
        avgLatencyMs,
        p50LatencyMs,
        p95LatencyMs,
        monitoredCount: orgUrlSet.size,
        orgLatestResults,
        openIncidents,
      },
      chartBuckets: buckets,
      maxBucketTotal: Math.max(1, ...buckets.map((b) => b.total)),
      maxBucketLatency: Math.max(100, ...buckets.map((b) => b.avgLatency)),
      endpointStats: builtEndpoints,
      slowestSites: slowest,
      errorBreakdown: errorsList,
      speedDistribution: {
        total: latencies.length,
        fast: fastCount,
        moderate: moderateCount,
        slow: slowCount,
        fastCutoff,
        slowThresh,
      },
      mttrMs: computedMttr,
    };
  }, [rangedHistory, organisations, selectedOrg, scopedIncidents, settings.slowThresholdMs, settings.smartThresholdEnabled, urlThresholdMap]);

  // Filtered & sorted endpoint leaderboard (single memo pass)
  const { visibleEndpoints, totalMatchingEndpoints } = useMemo(() => {
    const q = endpointSearch.trim().toLowerCase();
    const slowThresh = settings.slowThresholdMs > 0 ? settings.slowThresholdMs : 1000;

    const filtered = endpointStats.filter((ep) => {
      if (q && !ep.url.toLowerCase().includes(q)) return false;
      if (endpointFilter === 'issues' && ep.issues === 0) return false;
      if (endpointFilter === 'slow') {
        const smartInfo = settings.smartThresholdEnabled
          ? urlThresholdMap.get(ep.key) || urlThresholdMap.get(ep.latest.inputUrl.toLowerCase())
          : undefined;
        const epSlowThresh = smartInfo ? smartInfo.thresholdMs : slowThresh;
        if (ep.avgMs === null || ep.avgMs <= epSlowThresh) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (endpointSort === 'uptime-asc') {
        if (a.uptimePct !== b.uptimePct) return a.uptimePct - b.uptimePct;
        return (b.avgMs ?? 0) - (a.avgMs ?? 0);
      }
      if (endpointSort === 'latency-desc') {
        return (b.avgMs ?? -1) - (a.avgMs ?? -1);
      }
      if (endpointSort === 'checks-desc') {
        return b.total - a.total;
      }
      return a.url.localeCompare(b.url);
    });

    return {
      visibleEndpoints: showAllEndpoints ? filtered : filtered.slice(0, 12),
      totalMatchingEndpoints: filtered.length,
    };
  }, [endpointStats, endpointSearch, endpointFilter, endpointSort, showAllEndpoints, settings.slowThresholdMs, settings.smartThresholdEnabled, urlThresholdMap]);

  // Expiring SSL certificates across latest monitored endpoints
  const expiringSslSites = useMemo(() => {
    const warnDays = settings.sslWarningDays || 14;
    const seen = new Set<string>();
    const list: SiteCheckResult[] = [];
    const orgList = selectedOrg ? [selectedOrg] : organisations;
    for (const org of orgList) {
      for (const proj of org.projects) {
        for (const res of proj.lastResults || []) {
          const key = (res.normalizedUrl || res.inputUrl).toLowerCase();
          if (seen.has(key)) continue;
          if (
            res.ssl.checked &&
            typeof res.ssl.daysRemaining === 'number' &&
            res.ssl.daysRemaining <= warnDays
          ) {
            seen.add(key);
            list.push(res);
          }
        }
      }
    }
    return list.sort((a, b) => (a.ssl.daysRemaining ?? 999) - (b.ssl.daysRemaining ?? 999));
  }, [organisations, selectedOrg, settings.sslWarningDays]);

  const orgHealthSummaries = useMemo(() => {
    return organisations.map((org) => {
      const latest: SiteCheckResult[] = [];
      for (const p of org.projects) {
        for (const r of p.lastResults || []) {
          latest.push(r);
        }
      }
      const online = latest.filter((r) => r.status === 'online').length;
      const issues = latest.length - online;
      const latencies = latest
        .map((r) => r.responseTimeMs)
        .filter((ms): ms is number => typeof ms === 'number');
      const avgMs =
        latencies.length > 0
          ? Math.round(latencies.reduce((s, m) => s + m, 0) / latencies.length)
          : null;
      const pct = latest.length > 0 ? Math.round((online / latest.length) * 100) : null;
      return {
        org,
        totalChecked: latest.length,
        online,
        issues,
        avgMs,
        pct,
      };
    });
  }, [organisations]);

  const activeBucket =
    hoveredBucketIdx !== null && chartBuckets[hoveredBucketIdx]
      ? chartBuckets[hoveredBucketIdx]
      : null;

  const statusExportData =
    metrics.orgLatestResults.length > 0 ? metrics.orgLatestResults : rangedHistory.slice(0, 60);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-7 space-y-5">
      {/* Header Controls: Time Window, Organisation Filter & Report Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Analytics time range"
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08]"
          >
            {(
              [
                { id: '24h', label: '24 Hours' },
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: 'all', label: 'All Time' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={range === tab.id}
                onClick={() => {
                  setRange(tab.id);
                  setHoveredBucketIdx(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  range === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {organisations.length > 0 && (
            <select
              aria-label="Filter analytics by organisation"
              value={selectedOrgId}
              onChange={(e) => {
                setSelectedOrgId(e.target.value);
                setHoveredBucketIdx(null);
              }}
              className="rounded-lg bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Sources ({organisations.length} Orgs)</option>
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 min-w-[200px]">
          <ReportActionBar
            hasReportData={statusExportData.length > 0}
            onExportCsv={() => exportResultsToCsv(statusExportData, 'upsite-analytics')}
            onExportPdf={() => exportResultsToPdf(statusExportData, 'upsite-analytics')}
            onExportStatusPage={() =>
              exportStatusPageHtml({
                title: selectedOrg
                  ? `${selectedOrg.name} — Service Status`
                  : 'upsite Workspace Status',
                subtitle: `${selectedOrg ? selectedOrg.projects.length + ' projects' : organisations.length + ' organisations'} · ${metrics.monitoredCount} monitored URLs`,
                organisations: selectedOrg ? [selectedOrg] : organisations,
                results: metrics.orgLatestResults.length > 0 ? undefined : statusExportData,
                incidents:
                  settings.features?.incidentTrackingEnabled !== false
                    ? scopedIncidents
                    : undefined,
              })
            }
            onSharePdf={() =>
              shareResultsPdf(statusExportData, 'upsite-analytics', 'upsite Analytics Report')
            }
            onCopyReport={() =>
              copyResultsReport(statusExportData, 'upsite-analytics', 'upsite Analytics Report')
            }
            onBuildReportPayload={() =>
              buildReportDispatchPayloadFromResults(
                statusExportData,
                selectedOrg
                  ? `${selectedOrg.name} — Analytics Summary`
                  : 'upsite Analytics & Uptime Summary',
                `Range: ${range.toUpperCase()} · Uptime ${metrics.uptimePct}%`,
              )
            }
            integrations={integrations}
            onSendToApps={onSendToApps}
            onOpenIntegrationsSettings={onOpenIntegrationsSettings}
          />
        </div>
      </div>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Check Success Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" strokeWidth={1.8} />
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.uptimePct === '—' ? '—' : `${metrics.uptimePct}%`}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {metrics.online} healthy · {metrics.offline + metrics.error} issues · {metrics.total} checks
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Response Latency</span>
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" strokeWidth={1.8} />
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.avgLatencyMs !== null ? `${metrics.avgLatencyMs} ms` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {metrics.p50LatencyMs !== null && metrics.p95LatencyMs !== null
              ? `P50 ${metrics.p50LatencyMs} ms · P95 ${metrics.p95LatencyMs} ms${settings.smartThresholdEnabled ? ' · Smart 7d' : ''}`
              : settings.smartThresholdEnabled
                ? `Smart 7d auto (${settings.smartThresholdSensitivity || 'balanced'})`
                : `Slow limit: ${settings.slowThresholdMs > 0 ? `${settings.slowThresholdMs} ms` : 'Off'}`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Monitored Endpoints</span>
            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" strokeWidth={1.8} />
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.monitoredCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {selectedOrg
              ? `${selectedOrg.name} · ${selectedOrg.projects.length} projects`
              : `Across ${organisations.length} ${organisations.length === 1 ? 'organisation' : 'organisations'}`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {settings.features?.incidentTrackingEnabled !== false
                ? 'Open Incidents'
                : 'Unique Sites Checked'}
            </span>
            <Activity
              className={`w-4 h-4 ${
                metrics.openIncidents > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
              strokeWidth={1.8}
            />
          </div>
          <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {settings.features?.incidentTrackingEnabled !== false
              ? metrics.openIncidents
              : endpointStats.length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {settings.features?.incidentTrackingEnabled !== false
              ? mttrMs !== null
                ? `${scopedIncidents.length} logged · Avg recovery ${formatDurationShort(mttrMs)}`
                : `${scopedIncidents.length} total incidents in window`
              : `In selected ${range === 'all' ? 'all-time' : range} window`}
          </p>
        </div>
      </section>

      {/* Latency & Availability Interactive Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Latency Trend (ms)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {activeBucket
                  ? `${activeBucket.label} · Avg ${activeBucket.avgLatency} ms · P95 ${activeBucket.p95Latency} ms (${activeBucket.total} checks)`
                  : 'Hover a bar to inspect interval response time'}
              </p>
            </div>
            <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" strokeWidth={1.75} />
          </div>

          {chartBuckets.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-slate-400">
              Run checks to populate latency trend bars.
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className="h-36 flex items-end gap-1.5 pt-2"
                onMouseLeave={() => setHoveredBucketIdx(null)}
              >
                {chartBuckets.map((b) => {
                  const pct =
                    b.avgLatency > 0
                      ? Math.max(8, Math.round((b.avgLatency / maxBucketLatency) * 100))
                      : 4;
                  const isSlow =
                    settings.slowThresholdMs > 0 && b.avgLatency > settings.slowThresholdMs;
                  const isHovered = hoveredBucketIdx === b.index;
                  return (
                    <button
                      key={b.index}
                      type="button"
                      onMouseEnter={() => setHoveredBucketIdx(b.index)}
                      onFocus={() => setHoveredBucketIdx(b.index)}
                      aria-label={`${b.label}: ${b.avgLatency} ms average`}
                      className="flex-1 h-full flex flex-col justify-end items-center focus:outline-none"
                    >
                      <div
                        style={{ height: `${pct}%` }}
                        className={`w-full rounded-t-md transition-opacity ${
                          b.avgLatency === 0
                            ? 'bg-slate-200 dark:bg-white/[0.06]'
                            : isSlow
                              ? 'bg-amber-500'
                              : 'bg-blue-600 dark:bg-blue-500'
                        } ${hoveredBucketIdx !== null && !isHovered ? 'opacity-50' : 'opacity-100'}`}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
                <span>{chartBuckets[0]?.label}</span>
                <span>{chartBuckets[Math.floor(chartBuckets.length / 2)]?.label}</span>
                <span>{chartBuckets[chartBuckets.length - 1]?.label}</span>
              </div>
            </div>
          )}

          {/* Speed Distribution Summary Strip */}
          {speedDistribution.total > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                <span>Speed Mix ({speedDistribution.total} timed)</span>
                <span>
                  Fast &le;{speedDistribution.fastCutoff}ms: {speedDistribution.fast} · Normal:{' '}
                  {speedDistribution.moderate} · Slow &gt;
                  {settings.smartThresholdEnabled && urlThresholdMap.size > 0
                    ? 'Smart 7d'
                    : `${speedDistribution.slowThresh}ms`}
                  : {speedDistribution.slow}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden flex bg-slate-100 dark:bg-white/[0.06]">
                {speedDistribution.fast > 0 && (
                  <div
                    style={{
                      width: `${(speedDistribution.fast / speedDistribution.total) * 100}%`,
                    }}
                    className="bg-emerald-500"
                  />
                )}
                {speedDistribution.moderate > 0 && (
                  <div
                    style={{
                      width: `${(speedDistribution.moderate / speedDistribution.total) * 100}%`,
                    }}
                    className="bg-blue-500"
                  />
                )}
                {speedDistribution.slow > 0 && (
                  <div
                    style={{
                      width: `${(speedDistribution.slow / speedDistribution.total) * 100}%`,
                    }}
                    className="bg-amber-500"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Availability Distribution
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {activeBucket
                  ? `${activeBucket.label} · ${activeBucket.online} online · ${activeBucket.issues} issues`
                  : 'Healthy vs Offline / Error checks per interval'}
              </p>
            </div>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} />
          </div>

          {chartBuckets.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-slate-400">
              Run checks to populate availability bars.
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className="h-36 flex items-end gap-1.5 pt-2"
                onMouseLeave={() => setHoveredBucketIdx(null)}
              >
                {chartBuckets.map((b) => {
                  const totalPct =
                    b.total > 0 ? Math.max(10, Math.round((b.total / maxBucketTotal) * 100)) : 4;
                  const issueShare = b.total > 0 ? Math.round((b.issues / b.total) * 100) : 0;
                  const onlineShare = b.total > 0 ? 100 - issueShare : 0;
                  const isHovered = hoveredBucketIdx === b.index;
                  return (
                    <button
                      key={b.index}
                      type="button"
                      onMouseEnter={() => setHoveredBucketIdx(b.index)}
                      onFocus={() => setHoveredBucketIdx(b.index)}
                      aria-label={`${b.label}: ${b.online} online, ${b.issues} issues`}
                      className="flex-1 h-full flex flex-col justify-end focus:outline-none"
                    >
                      <div
                        style={{ height: `${totalPct}%` }}
                        className={`w-full rounded-t-md overflow-hidden flex flex-col justify-end bg-slate-200 dark:bg-white/[0.06] transition-opacity ${
                          hoveredBucketIdx !== null && !isHovered ? 'opacity-50' : 'opacity-100'
                        }`}
                      >
                        {b.issues > 0 && (
                          <div style={{ height: `${issueShare}%` }} className="w-full bg-rose-500" />
                        )}
                        {b.online > 0 && (
                          <div
                            style={{ height: `${onlineShare}%` }}
                            className="w-full bg-emerald-500"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
                <span>{chartBuckets[0]?.label}</span>
                <span>{chartBuckets[Math.floor(chartBuckets.length / 2)]?.label}</span>
                <span>{chartBuckets[chartBuckets.length - 1]?.label}</span>
              </div>
            </div>
          )}

          {/* Top Failure Reasons Summary */}
          <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06]">
            {errorBreakdown.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Zero failed checks recorded in this period.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">Top Failure Causes</span>
                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                  {errorBreakdown.slice(0, 3).map((err) => (
                    <button
                      key={err.code}
                      type="button"
                      onClick={() => onSelectResult(err.sample)}
                      className="text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                    >
                      {err.code} ({err.count})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Endpoint Reliability & Speed Leaderboard */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Endpoint Reliability & Speed ({totalMatchingEndpoints})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Per-URL uptime %, average/P95 response times, and recent check streak — click any row to inspect
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                type="search"
                value={endpointSearch}
                onChange={(e) => setEndpointSearch(e.target.value)}
                placeholder="Filter URL..."
                aria-label="Filter analytics endpoints"
                className="w-40 sm:w-48 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08] pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'issues', label: 'Issues' },
                  { id: 'slow', label: 'Slow' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setEndpointFilter(f.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                    endpointFilter === f.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1">
              <ArrowUpDown className="w-3 h-3 text-slate-400 shrink-0" strokeWidth={1.75} />
              <select
                aria-label="Sort analytics endpoints"
                value={endpointSort}
                onChange={(e) => setEndpointSort(e.target.value as EndpointSortKey)}
                className="bg-transparent text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="uptime-asc">Lowest Uptime</option>
                <option value="latency-desc">Slowest Avg</option>
                <option value="checks-desc">Most Checked</option>
                <option value="url-asc">URL A–Z</option>
              </select>
            </div>
          </div>
        </div>

        {visibleEndpoints.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {endpointStats.length === 0
              ? 'Run website checks to build per-endpoint uptime and latency stats.'
              : 'No endpoints match the current search or filter.'}
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {visibleEndpoints.map((ep) => {
                const uptimeLabel = `${ep.uptimePct.toFixed(1)}%`;
                const uptimeColor =
                  ep.uptimePct >= 99
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : ep.uptimePct >= 90
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400';

                return (
                  <button
                    key={ep.key}
                    type="button"
                    onClick={() => onSelectResult(ep.latest)}
                    className="w-full text-left px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#222734] transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                        {ep.url}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        {ep.online} ok · {ep.issues} fail · {ep.total} checks
                        {ep.latest.httpStatusCode !== null
                          ? ` · Latest HTTP ${ep.latest.httpStatusCode}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      {/* Micro Check Streak */}
                      <div
                        className="hidden sm:flex items-center gap-0.5"
                        aria-label="Recent check streak"
                      >
                        {ep.recentStatuses.map((st, idx) => (
                          <span
                            key={idx}
                            className={`w-1.5 h-3.5 rounded-xs ${
                              st === 'online'
                                ? 'bg-emerald-500'
                                : st === 'error'
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                            }`}
                          />
                        ))}
                      </div>

                      <div className="w-28 text-right font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {ep.avgMs !== null ? `${ep.avgMs} ms avg` : '—'}
                        {ep.p95Ms !== null ? ` · P95 ${ep.p95Ms}` : ''}
                      </div>

                      <span
                        className={`w-14 text-right font-mono tabular-nums text-xs font-semibold whitespace-nowrap ${uptimeColor}`}
                      >
                        {uptimeLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {totalMatchingEndpoints > 12 && (
              <div className="px-5 py-2.5 border-t border-slate-200 dark:border-white/[0.06] flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllEndpoints((prev) => !prev)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 whitespace-nowrap"
                >
                  {showAllEndpoints
                    ? 'Show Top 12 Endpoints'
                    : `Show All ${totalMatchingEndpoints} Endpoints`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Expiring SSL Certificates (if enabled and any found) */}
      {settings.features?.sslExpiryAlertsEnabled !== false && expiringSslSites.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <Lock className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              <span>
                SSL Certificates Expiring Within {settings.sslWarningDays || 14} Days (
                {expiringSslSites.length})
              </span>
            </div>
          </div>
          <div className="divide-y divide-amber-500/20 rounded-lg border border-amber-500/20 bg-white/80 dark:bg-[#1B1F28]/90 overflow-hidden">
            {expiringSslSites.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => onSelectResult(site)}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-amber-50/70 dark:hover:bg-white/[0.04] transition-colors"
              >
                <span className="font-mono text-slate-900 dark:text-slate-100 truncate">
                  {site.normalizedUrl}
                </span>
                <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">
                  {site.ssl.daysRemaining !== undefined && site.ssl.daysRemaining < 0
                    ? 'Expired'
                    : `${site.ssl.daysRemaining}d left`}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Organisation Breakdown & Slowest Endpoints */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" strokeWidth={1.75} />
              <span>Organisation Health</span>
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {orgHealthSummaries.length} {orgHealthSummaries.length === 1 ? 'org' : 'orgs'}
            </span>
          </div>

          {orgHealthSummaries.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Create an Organisation to monitor grouped projects here.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {orgHealthSummaries.map(({ org, totalChecked, online, issues, avgMs, pct }) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => onOpenOrganisation(org.id)}
                  className="w-full text-left px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#222734] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {org.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                      {totalChecked > 0
                        ? `${online} online · ${issues} issues${avgMs !== null ? ` · Avg ${avgMs} ms` : ''}`
                        : `${org.projects.length} projects · Not checked yet`}
                    </p>
                  </div>
                  <span
                    className={`font-mono tabular-nums text-xs font-semibold whitespace-nowrap shrink-0 ${
                      pct === null
                        ? 'text-slate-400'
                        : pct === 100
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {pct === null ? '—' : `${pct}%`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <AlertTriangle className="w-4 h-4 text-amber-500" strokeWidth={1.75} />
              <span>Slowest Current Endpoints</span>
            </div>
            <span className="text-[11px] text-slate-400">Top response times</span>
          </div>

          {slowestSites.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No latency readings recorded in this time window.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {slowestSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => onSelectResult(site)}
                  className="w-full text-left px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#222734] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                      {site.normalizedUrl}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {site.statusLabel}
                      {site.httpStatusCode !== null ? ` · HTTP ${site.httpStatusCode}` : ''}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0">
                    {site.responseTimeMs} ms
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recent Incident Log Preview */}
      {settings.features?.incidentTrackingEnabled !== false && (
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Activity className="w-4 h-4 text-rose-500" strokeWidth={1.75} />
              <span>Recent Incidents & Downtime</span>
              {mttrMs !== null && (
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                  · Mean recovery {formatDurationShort(mttrMs)}
                </span>
              )}
            </div>
            {scopedIncidents.length > 0 && (
              <button
                type="button"
                onClick={onOpenIncidentsTab}
                className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 whitespace-nowrap"
              >
                View All ({scopedIncidents.length})
              </button>
            )}
          </div>

          {scopedIncidents.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No downtime incidents recorded in this scope. Scheduled and manual Organisation checks automatically track outage durations here.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {scopedIncidents.slice(0, 6).map((inc) => (
                <div
                  key={inc.id}
                  className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {inc.status === 'open' ? (
                      <XCircle className="w-4 h-4 text-rose-500 shrink-0" strokeWidth={2} />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={2} />
                    )}
                    <div className="min-w-0">
                      <p className="font-mono text-slate-900 dark:text-slate-100 truncate">
                        {inc.url}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {inc.orgName}
                        {inc.projectName ? ` / ${inc.projectName}` : ''} · {inc.errorCode}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-[11px] font-semibold whitespace-nowrap ${
                        inc.status === 'open'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {inc.status === 'open' ? 'Open' : 'Resolved'}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatDurationShort(inc.durationMs, inc.startedAt, inc.resolvedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
