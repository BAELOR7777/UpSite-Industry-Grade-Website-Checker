import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SiteCheckResult, UserSettings } from '../types/upsite';

interface QuickTestModalProps {
  open: boolean;
  settings: UserSettings;
  onClose: () => void;
  onRunQuickTest: (url: string) => Promise<SiteCheckResult>;
  onInspectResult: (result: SiteCheckResult) => void;
}

export function QuickTestModal({
  open,
  settings,
  onClose,
  onRunQuickTest,
  onInspectResult,
}: QuickTestModalProps) {
  const [urlInput, setUrlInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const firstToken = urlInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .find(Boolean);

    if (!firstToken) {
      setErrorMessage('Enter a URL or domain to verify.');
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);
    try {
      const checked = await onRunQuickTest(firstToken);
      setResult(checked);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to verify website right now.',
      );
    } finally {
      setIsRunning(false);
    }
  };

  const StatusIcon =
    result?.status === 'online'
      ? CheckCircle2
      : result?.status === 'offline'
        ? XCircle
        : AlertTriangle;

  const statusColorClass =
    result?.status === 'online'
      ? 'text-emerald-600 dark:text-emerald-400'
      : result?.status === 'offline'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-amber-600 dark:text-amber-400';

  const statusSurfaceClass =
    result?.status === 'online'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
      : result?.status === 'offline'
        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
        : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20';

  const isSlow =
    Boolean(result) &&
    settings.slowThresholdMs > 0 &&
    result?.responseTimeMs !== null &&
    (result?.responseTimeMs ?? 0) > settings.slowThresholdMs;

  const redirected =
    Boolean(result) &&
    (result?.redirects.length ?? 0) > 1 &&
    result?.finalUrl !== result?.normalizedUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsite-quick-test-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.07] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4" strokeWidth={1.9} />
            </div>
            <div className="min-w-0 space-y-0.5">
              <h3
                id="upsite-quick-test-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Quick URL Test
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verify a single URL immediately without adding it to your project list.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick test dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="upsite-quick-test-url"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Website URL or Domain
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                ref={inputRef}
                id="upsite-quick-test-url"
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={`e.g. ${settings.defaultProtocol}://example.com`}
                className="flex-1 min-w-0 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
              />
              <button
                type="submit"
                disabled={isRunning || !urlInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
                ) : (
                  <Play className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                )}
                <span>{isRunning ? 'Testing...' : 'Test Now'}</span>
              </button>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              {errorMessage}
            </div>
          )}

          {/* Immediate Verification Result */}
          {isRunning && !result && (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Checking DNS, TLS, and HTTP response...
            </div>
          )}

          {result && (
            <div className="pt-2 space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <StatusIcon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${statusColorClass}`}
                    strokeWidth={2}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                      {result.normalizedUrl}
                    </p>
                    {redirected && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Redirected ({result.redirects.length} hops) · {result.finalUrl}
                      </p>
                    )}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap shrink-0 ${statusSurfaceClass}`}
                >
                  {result.statusLabel}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-slate-200 dark:border-white/[0.07] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-white/[0.07]">
                <div className="py-2.5 pr-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Response</p>
                  <p className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—'}
                    {isSlow && (
                      <span className="ml-1.5 font-sans font-medium text-amber-600 dark:text-amber-400">
                        Slow
                      </span>
                    )}
                  </p>
                </div>

                <div className="py-2.5 sm:px-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">HTTP</p>
                  <p className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                    {result.httpStatusCode !== null
                      ? `${result.httpStatusCode}${result.httpStatusText ? ` ${result.httpStatusText}` : ''}`
                      : '—'}
                  </p>
                </div>

                <div className="py-2.5 sm:px-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">SSL</p>
                  <p className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                    {result.ssl.checked
                      ? result.ssl.valid
                        ? typeof result.ssl.daysRemaining === 'number'
                          ? `Valid · ${result.ssl.daysRemaining}d`
                          : 'Valid'
                        : 'Invalid'
                      : 'Not checked'}
                  </p>
                </div>

                <div className="py-2.5 sm:pl-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">IP</p>
                  <p className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                    {result.dns.addresses[0] || '—'}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {result.diagnosis.likelyReason}
                </p>
                {result.status !== 'online' && result.diagnosis.possibleFix && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {result.diagnosis.possibleFix}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {result ? (
              <button
                type="button"
                onClick={() => {
                  onInspectResult(result);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Inspect Full Details</span>
              </button>
            ) : (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Uses your current timeout &amp; protocol settings
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors whitespace-nowrap shrink-0 ml-auto"
            >
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
