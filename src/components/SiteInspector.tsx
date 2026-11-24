import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  Lock,
  RefreshCw,
  Server,
  X,
  XCircle,
} from 'lucide-react';
import type { SiteCheckResult } from '../types/upsite';

interface SiteInspectorProps {
  result: SiteCheckResult | null;
  isRechecking?: boolean;
  onClose: () => void;
  onRecheck: (url: string) => void;
}

export function SiteInspector({
  result,
  isRechecking = false,
  onClose,
  onRecheck,
}: SiteInspectorProps) {
  if (!result) {
    return null;
  }

  const StatusIcon =
    result.status === 'online'
      ? CheckCircle2
      : result.status === 'offline'
        ? XCircle
        : AlertTriangle;

  const statusTone =
    result.status === 'online'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20'
      : result.status === 'offline'
        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20'
        : 'bg-amber-50 text-amber-800 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20';

  const checkedDate = new Date(result.checkedAt);
  const formattedTime = Number.isNaN(checkedDate.getTime())
    ? result.checkedAt
    : checkedDate.toLocaleString();

  const safeHref = /^https?:\/\//i.test(result.finalUrl) ? result.finalUrl : undefined;

  return (
    <aside
      aria-label="Website diagnostic details"
      className="w-full lg:w-[420px] xl:w-[460px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-white/[0.07] bg-white dark:bg-[#151824] flex flex-col h-full overflow-y-auto"
    >
      {/* Inspector Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Site Diagnostics
          </p>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
            {result.normalizedUrl}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isRechecking}
            onClick={() => onRecheck(result.inputUrl)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.11] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 shrink-0 ${isRechecking ? 'animate-spin' : ''}`}
              strokeWidth={1.75}
            />
            <span>Re-check</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details panel"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Inspector Body */}
      <div className="p-6 space-y-6">
        {/* Status Summary */}
        <div className="flex items-center justify-between gap-4">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${statusTone}`}
          >
            <StatusIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            <span>{result.statusLabel}</span>
          </span>

          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
            {formattedTime}
          </span>
        </div>

        {/* Key Metrics Strip */}
        <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-white/[0.06] rounded-xl overflow-hidden border border-slate-200 dark:border-white/[0.07]">
          <div className="bg-slate-50 dark:bg-[#181C2B] p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Response Time</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—'}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-[#181C2B] p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">HTTP Status</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
              {result.httpStatusCode !== null ? result.httpStatusCode : 'No Reply'}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-[#181C2B] p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">SSL Certificate</p>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1.5">
              {!result.ssl.checked
                ? 'Skipped / HTTP'
                : result.ssl.valid
                  ? 'Valid'
                  : 'Invalid'}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-[#181C2B] p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">DNS Resolution</p>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1.5">
              {result.dns.resolved ? 'Resolved' : 'Failed'}
            </p>
          </div>
        </div>

        {/* Diagnosis: Error Code, Likely Reason, Possible Fix */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Diagnosis & Resolution
            </h3>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {result.diagnosis.errorCode}
            </span>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div>
              <p className="text-slate-500 dark:text-slate-400 font-medium mb-1">
                Likely Reason
              </p>
              <p className="text-slate-800 dark:text-slate-200">
                {result.diagnosis.likelyReason}
              </p>
            </div>
            <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06]">
              <p className="text-slate-500 dark:text-slate-400 font-medium mb-1">
                Possible Fix
              </p>
              <p className="text-slate-800 dark:text-slate-200">
                {result.diagnosis.possibleFix}
              </p>
            </div>
          </div>
        </section>

        {/* SSL Details */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Lock className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} />
            <span>SSL / TLS Certificate</span>
          </div>
          {result.ssl.checked ? (
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] divide-y divide-slate-200 dark:divide-white/[0.06] text-xs">
              <div className="px-4 py-2.5 flex items-center justify-between gap-4">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span className="text-slate-900 dark:text-slate-100 font-medium">
                  {result.ssl.valid ? 'Valid Certificate' : result.ssl.error || 'Invalid'}
                </span>
              </div>
              {result.ssl.issuer && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">Issuer</span>
                  <span className="text-slate-800 dark:text-slate-200 truncate text-right">
                    {result.ssl.issuer}
                  </span>
                </div>
              )}
              {result.ssl.protocol && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500 dark:text-slate-400">Protocol</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {result.ssl.protocol}
                  </span>
                </div>
              )}
              {typeof result.ssl.daysRemaining === 'number' && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500 dark:text-slate-400">Expires In</span>
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {result.ssl.daysRemaining} day(s)
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] px-4 py-3">
              No TLS certificate inspected (plain HTTP, host unreachable, or fast mode enabled).
            </p>
          )}
        </section>

        {/* DNS Details */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Server className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} />
            <span>DNS Resolution</span>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] divide-y divide-slate-200 dark:divide-white/[0.06] text-xs">
            <div className="px-4 py-2.5 flex items-center justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Hostname</span>
              <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                {result.dns.hostname}
              </span>
            </div>
            <div className="px-4 py-2.5 flex items-start justify-between gap-4">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Addresses</span>
              <span className="font-mono text-slate-800 dark:text-slate-200 text-right break-all">
                {result.dns.addresses.length > 0
                  ? result.dns.addresses.join(', ')
                  : result.dns.error || 'None'}
              </span>
            </div>
          </div>
        </section>

        {/* Redirect Chain */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Globe className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.75} />
              <span>Redirect Chain</span>
            </div>
            {safeHref && (
              <a
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
              >
                <span>Open Final URL</span>
                <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
              </a>
            )}
          </div>

          {result.redirects.length > 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] divide-y divide-slate-200 dark:divide-white/[0.06]">
              {result.redirects.map((hop) => (
                <div key={hop.step} className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Hop {hop.step}
                    </span>
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      HTTP {hop.statusCode}
                    </span>
                  </div>
                  <p className="font-mono text-slate-700 dark:text-slate-300 break-all">
                    {hop.url}
                  </p>
                  {hop.location && (
                    <p className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 break-all pt-0.5">
                      <ArrowRight className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                      <span className="font-mono">{hop.location}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#181C2B] px-4 py-3">
              No HTTP hops recorded.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
