import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileOutput,
  FileText,
  FolderInput,
  Globe,
  Loader2,
  Play,
  Send,
  Settings,
  Share2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  IntegrationChannel,
  IntegrationProvider,
  ReportDispatchPayload,
} from '../types/upsite';

export interface PrimaryBarAction {
  label: string;
  runningLabel?: string;
  countBadge?: number;
  disabled?: boolean;
  isRunning?: boolean;
  onClick: () => void;
}

export interface ReportActionBarProps {
  hasReportData: boolean;
  onExportCsv: () => void;
  onExportPdf: () => void;
  onSharePdf: () => Promise<string>;
  onCopyReport: () => Promise<string>;
  onExportStatusPage?: () => void;
  onBuildReportPayload?: () => ReportDispatchPayload | null;
  integrations?: IntegrationChannel[];
  onSendToApps?: (
    report: ReportDispatchPayload,
    channelIds: string[],
  ) => Promise<{
    sentCount: number;
    results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
  }>;
  onOpenIntegrationsSettings?: () => void;
  onBulkImport?: () => void;
  onExportProjects?: () => void;
  primaryAction?: PrimaryBarAction;
  align?: 'left' | 'right';
}

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  teams: 'Microsoft Teams',
  slack: 'Slack',
  discord: 'Discord',
  webhook: 'Webhook',
};

interface SendReportModalProps {
  open: boolean;
  report: ReportDispatchPayload | null;
  integrations: IntegrationChannel[];
  onClose: () => void;
  onSend: (
    report: ReportDispatchPayload,
    channelIds: string[],
  ) => Promise<{
    sentCount: number;
    results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
  }>;
  onOpenSettings?: () => void;
}

export function SendReportModal({
  open,
  report,
  integrations,
  onClose,
  onSend,
  onOpenSettings,
}: SendReportModalProps) {
  const enabledChannels = useMemo(
    () => integrations.filter((c) => c.enabled),
    [integrations],
  );
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState<Array<{
    id: string;
    name: string;
    ok: boolean;
    error?: string;
  }> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const c of enabledChannels) {
      next[c.id] = true;
    }
    setSelectedIds(next);
    setSendResults(null);
    setErrorMessage(null);
  }, [open, enabledChannels]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !report) return null;

  const chosenIds = enabledChannels.filter((c) => selectedIds[c.id]).map((c) => c.id);

  const handleDispatch = async () => {
    if (chosenIds.length === 0 || isSending) return;
    setIsSending(true);
    setErrorMessage(null);
    setSendResults(null);
    try {
      const outcome = await onSend(report, chosenIds);
      setSendResults(outcome.results);
      if (outcome.sentCount === outcome.results.length && outcome.sentCount > 0) {
        window.setTimeout(() => {
          onClose();
        }, 900);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to send report to selected apps.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-report-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.07] flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h3
              id="send-report-modal-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              Send Report to Connected Apps
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {report.title} · {report.totalCount} sites ({report.onlineCount} up,{' '}
              {report.offlineCount + report.errorCount} down)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close send report dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {enabledChannels.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-[#F3F5F8] dark:bg-[#12151C] p-4 space-y-3 text-center">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                No Microsoft Teams, Slack, Discord, or Webhook channels are enabled yet. Connect an app channel in Settings to send live availability reports with one click.
              </p>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Configure Connected Apps</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {enabledChannels.map((channel) => {
                const checked = Boolean(selectedIds[channel.id]);
                const result = sendResults?.find((r) => r.id === channel.id);
                return (
                  <label
                    key={channel.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 cursor-pointer transition-colors ${
                      checked
                        ? 'border-blue-500/40 bg-blue-50/40 dark:bg-blue-500/[0.06]'
                        : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#151821]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedIds((prev) => ({
                            ...prev,
                            [channel.id]: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 rounded border-slate-300 dark:border-white/[0.2] accent-blue-600 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {channel.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {PROVIDER_LABELS[channel.provider]}
                        </p>
                      </div>
                    </div>
                    {result && (
                      <span
                        className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${
                          result.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {result.ok ? 'Sent' : result.error || 'Failed'}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {errorMessage && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{errorMessage}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.07] flex items-center justify-between gap-2">
          {onOpenSettings && enabledChannels.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
            >
              Manage Apps
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap"
            >
              Close
            </button>
            {enabledChannels.length > 0 && (
              <button
                type="button"
                disabled={chosenIds.length === 0 || isSending}
                onClick={() => void handleDispatch()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap disabled:opacity-45"
              >
                {isSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
                ) : (
                  <Send className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                )}
                <span>{isSending ? 'Sending...' : `Send to ${chosenIds.length}`}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReportActionBar({
  hasReportData,
  onExportCsv,
  onExportPdf,
  onSharePdf,
  onCopyReport,
  onExportStatusPage,
  onBuildReportPayload,
  integrations = [],
  onSendToApps,
  onOpenIntegrationsSettings,
  onBulkImport,
  onExportProjects,
  primaryAction,
  align = 'right',
}: ReportActionBarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState<number>(800);
  const [openMenu, setOpenMenu] = useState<'report' | 'projects' | null>(null);
  const [feedbackKey, setFeedbackKey] = useState<
    'csv' | 'pdf' | 'html' | 'share' | 'copy' | 'send' | null
  >(null);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      setBarWidth(el.getBoundingClientRect().width || 800);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [openMenu]);

  const showTimedFeedback = (
    key: 'csv' | 'pdf' | 'html' | 'share' | 'copy' | 'send',
    text: string,
  ) => {
    setFeedbackKey(key);
    setFeedbackText(text);
    window.setTimeout(() => {
      setFeedbackKey((prev) => (prev === key ? null : prev));
      setFeedbackText((prev) => (prev === text ? null : prev));
    }, 2600);
  };

  const hasProjectTools = Boolean(onBulkImport || onExportProjects);
  const hasSendCapability = Boolean(onBuildReportPayload && onSendToApps);
  const enabledAppCount = integrations.filter((c) => c.enabled).length;

  // Dynamic layout thresholds based on actual toolbar container width (not just window width)
  const itemCount =
    (onBulkImport ? 1 : 0) +
    (onExportProjects ? 1 : 0) +
    (hasReportData ? (hasSendCapability ? 5 : 4) + (onExportStatusPage ? 1 : 0) : 0) +
    (primaryAction ? 1 : 0);

  const isWide = barWidth >= Math.max(540, itemCount * 110);
  const isCompact = barWidth < 430;

  const secondaryBtnCls =
    'inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#1B1F28] hover:bg-slate-50 dark:hover:bg-[#222734] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

  const dropdownItemCls =
    'w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap';

  const triggerShare = () => {
    setOpenMenu(null);
    void onSharePdf()
      .then((msg) => showTimedFeedback('share', msg))
      .catch(() => showTimedFeedback('share', 'Unable to share PDF.'));
  };

  const triggerCopy = () => {
    setOpenMenu(null);
    void onCopyReport()
      .then((msg) => showTimedFeedback('copy', msg))
      .catch(() => showTimedFeedback('copy', 'Clipboard copy unavailable.'));
  };

  const triggerCsv = () => {
    setOpenMenu(null);
    onExportCsv();
    showTimedFeedback('csv', 'CSV downloaded.');
  };

  const triggerPdf = () => {
    setOpenMenu(null);
    onExportPdf();
    showTimedFeedback('pdf', 'PDF downloaded.');
  };

  const triggerStatusPage = () => {
    if (!onExportStatusPage) return;
    setOpenMenu(null);
    onExportStatusPage();
    showTimedFeedback('html', 'Status HTML exported.');
  };

  const openSendModal = () => {
    setOpenMenu(null);
    setSendModalOpen(true);
  };

  const reportPayload = useMemo(
    () => (sendModalOpen && onBuildReportPayload ? onBuildReportPayload() : null),
    [sendModalOpen, onBuildReportPayload],
  );

  return (
    <>
      <div
        ref={containerRef}
        className={`w-full flex flex-wrap items-center gap-2 min-w-0 ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
      >
        <div
          ref={menuWrapRef}
          className={`flex flex-wrap items-center gap-2 min-w-0 ${
            align === 'right' ? 'justify-end' : 'justify-start'
          }`}
        >
          {feedbackText && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              <span>{feedbackText}</span>
            </span>
          )}

          {/* Project Import / Export buttons */}
          {hasProjectTools &&
            (isWide ? (
              <>
                {onBulkImport && (
                  <button type="button" onClick={onBulkImport} className={secondaryBtnCls}>
                    <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                    <span>Bulk Import</span>
                  </button>
                )}
                {onExportProjects && (
                  <button type="button" onClick={onExportProjects} className={secondaryBtnCls}>
                    <FileOutput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                    <span>Export Projects</span>
                  </button>
                )}
              </>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={openMenu === 'projects'}
                  onClick={() =>
                    setOpenMenu((prev) => (prev === 'projects' ? null : 'projects'))
                  }
                  className={secondaryBtnCls}
                >
                  <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{isCompact ? 'Transfer' : 'Import / Export'}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" strokeWidth={1.75} />
                </button>

                {openMenu === 'projects' && (
                  <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-xl py-1 z-30">
                    {onBulkImport && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onBulkImport();
                        }}
                        className={dropdownItemCls}
                      >
                        <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Bulk Import Projects</span>
                      </button>
                    )}
                    {onExportProjects && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onExportProjects();
                        }}
                        className={dropdownItemCls}
                      >
                        <FileOutput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Export Projects</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

          {/* Report Export / Share / Copy / Send Actions */}
          {hasReportData &&
            (isWide ? (
              <>
                <button type="button" onClick={triggerCsv} className={secondaryBtnCls}>
                  {feedbackKey === 'csv' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
                  ) : (
                    <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{feedbackKey === 'csv' ? 'Saved CSV' : 'Export CSV'}</span>
                </button>
                <button type="button" onClick={triggerPdf} className={secondaryBtnCls}>
                  {feedbackKey === 'pdf' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
                  ) : (
                    <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{feedbackKey === 'pdf' ? 'Saved PDF' : 'Export PDF'}</span>
                </button>
                {onExportStatusPage && (
                  <button type="button" onClick={triggerStatusPage} className={secondaryBtnCls}>
                    {feedbackKey === 'html' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
                    ) : (
                      <Globe className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                    )}
                    <span>{feedbackKey === 'html' ? 'Saved HTML' : 'Status HTML'}</span>
                  </button>
                )}
                <button type="button" onClick={triggerShare} className={secondaryBtnCls}>
                  <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{feedbackKey === 'share' ? 'Shared' : 'Share PDF'}</span>
                </button>
                <button type="button" onClick={triggerCopy} className={secondaryBtnCls}>
                  {feedbackKey === 'copy' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
                  ) : (
                    <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{feedbackKey === 'copy' ? 'Copied' : 'Copy Report'}</span>
                </button>
                {hasSendCapability && (
                  <button type="button" onClick={openSendModal} className={secondaryBtnCls}>
                    <Send className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" strokeWidth={1.75} />
                    <span>
                      Send to App{enabledAppCount > 0 ? ` (${enabledAppCount})` : ''}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
                {!isCompact && (
                  <button type="button" onClick={triggerCopy} className={secondaryBtnCls}>
                    {feedbackKey === 'copy' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
                    ) : (
                      <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                    )}
                    <span>{feedbackKey === 'copy' ? 'Copied' : 'Copy'}</span>
                  </button>
                )}

                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={openMenu === 'report'}
                    onClick={() =>
                      setOpenMenu((prev) => (prev === 'report' ? null : 'report'))
                    }
                    className={secondaryBtnCls}
                  >
                    <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                    <span>{isCompact ? 'Report' : 'Export & Share'}</span>
                    <ChevronDown
                      className="w-3.5 h-3.5 text-slate-400 shrink-0"
                      strokeWidth={1.75}
                    />
                  </button>

                  {openMenu === 'report' && (
                    <div className="absolute right-0 mt-1.5 w-52 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-xl py-1 z-30">
                      <button type="button" onClick={triggerCsv} className={dropdownItemCls}>
                        <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Export CSV</span>
                      </button>
                      <button type="button" onClick={triggerPdf} className={dropdownItemCls}>
                        <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Export PDF</span>
                      </button>
                      {onExportStatusPage && (
                        <button type="button" onClick={triggerStatusPage} className={dropdownItemCls}>
                          <Globe className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                          <span>Status Page (HTML)</span>
                        </button>
                      )}
                      <button type="button" onClick={triggerShare} className={dropdownItemCls}>
                        <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Share PDF</span>
                      </button>
                      <button type="button" onClick={triggerCopy} className={dropdownItemCls}>
                        <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                        <span>Copy Report</span>
                      </button>
                      {hasSendCapability && (
                        <>
                          <div className="my-1 border-t border-slate-200 dark:border-white/[0.07]" />
                          <button type="button" onClick={openSendModal} className={dropdownItemCls}>
                            <Send
                              className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0"
                              strokeWidth={1.75}
                            />
                            <span>
                              Send to App{enabledAppCount > 0 ? ` (${enabledAppCount})` : ''}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            ))}

          {/* Primary Action (e.g. Run All At Once) */}
          {primaryAction && (
            <button
              type="button"
              disabled={primaryAction.disabled}
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-2 px-4 py-1.5 sm:py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 tabular-nums"
            >
              {primaryAction.isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
              ) : (
                <Play className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              )}
              <span>
                {primaryAction.isRunning
                  ? primaryAction.runningLabel || 'Running...'
                  : primaryAction.label}
              </span>
              {typeof primaryAction.countBadge === 'number' && primaryAction.countBadge > 0 && !primaryAction.isRunning && (
                <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-mono tabular-nums">
                  {primaryAction.countBadge}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {hasSendCapability && onSendToApps && (
        <SendReportModal
          open={sendModalOpen}
          report={reportPayload}
          integrations={integrations}
          onClose={() => setSendModalOpen(false)}
          onSend={async (payload, channelIds) => {
            const res = await onSendToApps(payload, channelIds);
            if (res.sentCount > 0) {
              showTimedFeedback(
                'send',
                `Sent to ${res.sentCount} ${res.sentCount === 1 ? 'app' : 'apps'}.`,
              );
            }
            return res;
          }}
          onOpenSettings={onOpenIntegrationsSettings}
        />
      )}
    </>
  );
}
