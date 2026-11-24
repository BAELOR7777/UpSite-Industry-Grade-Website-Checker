import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileOutput,
  FileText,
  FolderInput,
  FolderPlus,
  Loader2,
  Pencil,
  Play,
  Plus,
  Share2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AutoRefreshInterval,
  CheckTimeWindow,
  Organisation,
  ProjectRecord,
  SiteCheckResult,
  SiteStatus,
  UserSettings,
} from '../types/upsite';
import { CheckWindowPicker } from './CheckWindowPicker';
import { parseUrlsFromInput } from './CheckerView';
import { ConfirmModal } from './ConfirmModal';
import {
  copyResultsReport,
  copySimpleOrgReport,
  exportResultsToCsv,
  exportResultsToPdf,
  exportSimpleOrgReportCsv,
  exportSimpleOrgReportPdf,
  shareResultsPdf,
  shareSimpleOrgReportPdf,
} from '../utils/exporters';
import type { SimpleOrgSiteRow } from '../utils/exporters';
import {
  AUTO_REFRESH_PRESETS,
  DEFAULT_CHECK_WINDOW,
  formatCheckWindowLabel,
  formatIntervalLabel,
  isWithinCheckWindow,
  parseCustomIntervalSeconds,
} from '../utils/intervals';
import { sortProjectsByName } from '../utils/organisations';
import { mergeImportedProjects } from '../utils/projectTransfer';
import type { ImportedProjectDraft } from '../utils/projectTransfer';
import { BulkImportModal, ExportProjectsModal } from './ProjectTransferModals';

export interface PendingOrgReport {
  orgName: string;
  scopeLabel: string;
  rows: SimpleOrgSiteRow[];
  onlineCount: number;
  downCount: number;
}

interface OrganisationViewProps {
  organisations: Organisation[];
  settings: UserSettings;
  selectedResultId: string | null;
  openedOrgId: string | null;
  statusFilter: 'all' | 'issues' | SiteStatus;
  orgNextRunAt: Record<string, number>;
  runningOrgScope: Record<string, string>;
  pendingReport: PendingOrgReport | null;
  onChangeOpenedOrgId: (orgId: string | null) => void;
  onChangeStatusFilter: (filter: 'all' | 'issues' | SiteStatus) => void;
  onSaveOrganisations: (orgs: Organisation[]) => void;
  onRunOrgAll: (orgId: string) => Promise<void>;
  onRunOrgProject: (orgId: string, projectId: string) => Promise<void>;
  onSelectResult: (result: SiteCheckResult) => void;
  onDismissPendingReport: () => void;
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

function formatLastCheckedAt(iso?: string): string | null {
  if (!iso) return null;
  const dateObj = new Date(iso);
  if (Number.isNaN(dateObj.getTime())) return null;
  const now = new Date();
  const isSameDay =
    dateObj.getFullYear() === now.getFullYear() &&
    dateObj.getMonth() === now.getMonth() &&
    dateObj.getDate() === now.getDate();
  const timePart = dateObj.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (isSameDay) {
    return `Today, ${timePart}`;
  }
  const datePart = dateObj.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${datePart}, ${timePart}`;
}

export function OrganisationView({
  organisations,
  settings,
  selectedResultId,
  openedOrgId,
  statusFilter,
  orgNextRunAt,
  runningOrgScope,
  pendingReport,
  onChangeOpenedOrgId,
  onChangeStatusFilter,
  onSaveOrganisations,
  onRunOrgAll,
  onRunOrgProject,
  onSelectResult,
  onDismissPendingReport,
}: OrganisationViewProps) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>({});
  const [newOrgName, setNewOrgName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectUrlsInput, setProjectUrlsInput] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customPeriodVal, setCustomPeriodVal] = useState('');
  const [customPeriodUnit, setCustomPeriodUnit] = useState<'min' | 'hr'>('min');
  const [customPeriodError, setCustomPeriodError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [modalShareNotice, setModalShareNotice] = useState<string | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [exportProjectsOpen, setExportProjectsOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'delete-project'; project: ProjectRecord }
    | { kind: 'delete-org'; org: Organisation }
    | null
  >(null);

  const showShareNotice = (msg: string) => {
    setShareNotice(msg);
    window.setTimeout(() => {
      setShareNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const showModalShareNotice = (msg: string) => {
    setModalShareNotice(msg);
    window.setTimeout(() => {
      setModalShareNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const activeOrg = useMemo(() => {
    if (!openedOrgId) return null;
    return organisations.find((o) => o.id === openedOrgId) || null;
  }, [organisations, openedOrgId]);

  const sortedProjects = useMemo(
    () => (activeOrg ? sortProjectsByName(activeOrg.projects) : []),
    [activeOrg],
  );

  const runningScope = activeOrg ? runningOrgScope[activeOrg.id] ?? null : null;

  const allOrgUrls = useMemo(() => {
    const list: string[] = [];
    for (const p of sortedProjects) {
      for (const u of p.urls) {
        list.push(u);
      }
    }
    return Array.from(new Set(list));
  }, [sortedProjects]);

  const allLatestOrgResults = useMemo(() => {
    const results: SiteCheckResult[] = [];
    for (const project of sortedProjects) {
      if (project.lastResults) {
        results.push(...project.lastResults);
      }
    }
    return results;
  }, [sortedProjects]);

  const handleCreateOrg = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newOrgName.trim();
    if (!trimmed) return;
    const created: Organisation = {
      id: crypto.randomUUID(),
      name: trimmed,
      projects: [],
      autoRefreshSec: 0,
      checkWindow: { ...DEFAULT_CHECK_WINDOW },
      createdAt: new Date().toISOString(),
    };
    const next = [created, ...organisations];
    onSaveOrganisations(next);
    setNewOrgName('');
    setErrorMessage(null);
    onChangeOpenedOrgId(created.id);
  };

  const handleDeleteOrg = (orgId: string) => {
    const next = organisations.filter((o) => o.id !== orgId);
    onSaveOrganisations(next);
    if (openedOrgId === orgId) {
      onChangeOpenedOrgId(null);
    }
  };

  const handleSetOrgAutoRefresh = (intervalSec: AutoRefreshInterval) => {
    if (!activeOrg) return;
    setCustomPeriodError(null);
    const nextOrgs = organisations.map((o) =>
      o.id === activeOrg.id ? { ...o, autoRefreshSec: intervalSec } : o,
    );
    onSaveOrganisations(nextOrgs);
  };

  const handleSetOrgCheckWindow = (checkWindow: CheckTimeWindow) => {
    if (!activeOrg) return;
    const nextOrgs = organisations.map((o) =>
      o.id === activeOrg.id ? { ...o, checkWindow } : o,
    );
    onSaveOrganisations(nextOrgs);
  };

  const handleApplyCustomOrgPeriod = (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    const parsed = parseCustomIntervalSeconds(customPeriodVal, customPeriodUnit);
    if (!parsed) {
      setCustomPeriodError('Enter a timer between 1 min and 24 hr.');
      return;
    }
    setCustomPeriodError(null);
    handleSetOrgAutoRefresh(parsed);
    setCustomPeriodVal('');
  };

  const handleSaveProject = (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    const trimmedName = projectName.trim();
    const parsedUrls = parseUrlsFromInput(projectUrlsInput);
    if (!trimmedName || parsedUrls.length === 0) {
      setErrorMessage('Provide a project name and at least one URL.');
      return;
    }
    setErrorMessage(null);

    const updatedProjects: ProjectRecord[] = sortProjectsByName(
      editingProjectId
        ? activeOrg.projects.map((p) =>
            p.id === editingProjectId ? { ...p, name: trimmedName, urls: parsedUrls } : p,
          )
        : [
            {
              id: crypto.randomUUID(),
              name: trimmedName,
              urls: parsedUrls,
              createdAt: new Date().toISOString(),
            },
            ...activeOrg.projects,
          ],
    );

    const nextOrgs = organisations.map((o) =>
      o.id === activeOrg.id ? { ...o, projects: updatedProjects } : o,
    );
    onSaveOrganisations(nextOrgs);
    setProjectName('');
    setProjectUrlsInput('');
    setEditingProjectId(null);
  };

  const handleEditProject = (project: ProjectRecord) => {
    setEditingProjectId(project.id);
    setProjectName(project.name);
    setProjectUrlsInput(project.urls.join('\n'));
    setErrorMessage(null);
  };

  const handleDeleteProject = (projectId: string) => {
    if (!activeOrg) return;
    const nextOrgs = organisations.map((o) =>
      o.id === activeOrg.id
        ? { ...o, projects: o.projects.filter((p) => p.id !== projectId) }
        : o,
    );
    onSaveOrganisations(nextOrgs);
    if (editingProjectId === projectId) {
      setEditingProjectId(null);
      setProjectName('');
      setProjectUrlsInput('');
    }
  };

  const handleRunProject = async (project: ProjectRecord) => {
    if (!activeOrg || project.urls.length === 0 || runningScope) return;
    setErrorMessage(null);
    try {
      await onRunOrgProject(activeOrg.id, project.id);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to run project check.');
    }
  };

  const handleRunAllInOrg = async () => {
    if (!activeOrg || allOrgUrls.length === 0 || runningScope) return;
    setErrorMessage(null);
    try {
      await onRunOrgAll(activeOrg.id);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to run all organisation URLs.');
    }
  };

  const activeIntervalSec = activeOrg?.autoRefreshSec ?? 0;
  const activeWindow = activeOrg?.checkWindow ?? DEFAULT_CHECK_WINDOW;
  const inActiveWindow = isWithinCheckWindow(activeWindow, new Date(nowMs));
  const activeTargetMs = activeOrg ? orgNextRunAt[activeOrg.id] : undefined;

  useEffect(() => {
    if (!activeOrg || activeIntervalSec <= 0 || allOrgUrls.length === 0 || !activeTargetMs) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeOrg?.id, activeIntervalSec, allOrgUrls.length, activeTargetMs]);

  const countdownSec =
    activeOrg && activeIntervalSec > 0 && allOrgUrls.length > 0 && activeTargetMs
      ? Math.max(0, Math.ceil((activeTargetMs - nowMs) / 1000))
      : null;

  const nextCycleAt =
    activeTargetMs && activeIntervalSec > 0 && allOrgUrls.length > 0
      ? new Date(activeTargetMs).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : null;

  const isPresetInterval = AUTO_REFRESH_PRESETS.some((p) => p.value === activeIntervalSec);

  const isCompact = settings.density === 'compact';

  const handleBulkImportProjects = (payload: {
    targetOrgId: string | null;
    newOrgName: string;
    drafts: ImportedProjectDraft[];
    mergeMatchingNames: boolean;
  }) => {
    if (payload.drafts.length === 0) return;

    if (payload.targetOrgId) {
      const nextOrgs = organisations.map((org) =>
        org.id === payload.targetOrgId
          ? {
              ...org,
              projects: mergeImportedProjects(
                org.projects,
                payload.drafts,
                payload.mergeMatchingNames,
              ),
            }
          : org,
      );
      onSaveOrganisations(nextOrgs);
      if (openedOrgId !== payload.targetOrgId) {
        onChangeOpenedOrgId(payload.targetOrgId);
      }
      showShareNotice(
        `Imported ${payload.drafts.length} ${
          payload.drafts.length === 1 ? 'project' : 'projects'
        }.`,
      );
      return;
    }

    const newOrgId = crypto.randomUUID();
    const createdOrg: Organisation = {
      id: newOrgId,
      name: payload.newOrgName.trim() || 'Imported Organisation',
      projects: mergeImportedProjects([], payload.drafts, payload.mergeMatchingNames),
      autoRefreshSec: 0,
      checkWindow: { ...DEFAULT_CHECK_WINDOW },
      createdAt: new Date().toISOString(),
    };
    onSaveOrganisations([createdOrg, ...organisations]);
    onChangeOpenedOrgId(newOrgId);
  };

  // LEVEL 1: Organisation Directory View (click an org to open its projects & URLs)
  if (!activeOrg) {
    return (
      <>
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 lg:p-8 space-y-6">
          <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Company Organisations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create an organisation, bulk import projects, or select an organisation below to manage its projects and URLs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkImportOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Bulk Import</span>
              </button>

              <form onSubmit={handleCreateOrg} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="New organisation name"
                  className="w-48 sm:w-56 rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  disabled={!newOrgName.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                  <span>Create Org</span>
                </button>
              </form>
            </div>
          </section>

        {organisations.length === 0 ? (
          <section className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/70 dark:bg-[#171A28]/60 px-6 py-14 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-500 dark:text-slate-300">
              <Building2 className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                No organisations created yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Enter a company or team name above to create an organisation. Click any organisation to open its project records and run all URLs together.
              </p>
            </div>
          </section>
        ) : (
          <section className="space-y-2.5" aria-label="Organisations list">
            {organisations.map((org) => {
              const uniqueUrls = new Set<string>();
              let latestOnline = 0;
              let latestIssues = 0;
              for (const p of org.projects) {
                for (const u of p.urls) uniqueUrls.add(u);
                for (const r of p.lastResults || []) {
                  if (r.status === 'online') latestOnline += 1;
                  else latestIssues += 1;
                }
              }

              const scheduleLabel = formatIntervalLabel(org.autoRefreshSec ?? 0);
              const windowLabel = formatCheckWindowLabel(org.checkWindow);

              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => {
                    onChangeOpenedOrgId(org.id);
                    onChangeStatusFilter('all');
                    setErrorMessage(null);
                  }}
                  className="w-full text-left rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1C2032] px-5 py-4 flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0">
                      <Building2 className="w-4 h-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {org.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 truncate">
                        {org.projects.length} {org.projects.length === 1 ? 'project' : 'projects'} · {uniqueUrls.size} {uniqueUrls.size === 1 ? 'URL' : 'URLs'} · Timer: {scheduleLabel} · {windowLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 shrink-0">
                    {(latestOnline > 0 || latestIssues > 0) && (
                      <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {latestOnline} up
                        </span>
                        <span className="text-rose-600 dark:text-rose-400">
                          {latestIssues} down
                        </span>
                      </div>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-300 whitespace-nowrap shrink-0">
                      <span>Open</span>
                      <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                    </span>
                  </div>
                </button>
              );
            })}
          </section>
        )}
        </div>
        <BulkImportModal
          open={bulkImportOpen}
          organisations={organisations}
          initialTargetOrgId={null}
          defaultProtocol={settings.defaultProtocol}
          onClose={() => setBulkImportOpen(false)}
          onConfirmImport={handleBulkImportProjects}
        />
      </>
    );
  }

  // LEVEL 2: Opened Organisation -> Projects & URLs under it
  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 lg:p-8 space-y-6">
      {/* Breadcrumb + Run All Actions */}
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => {
              onChangeOpenedOrgId(null);
              setEditingProjectId(null);
              setProjectName('');
              setProjectUrlsInput('');
              setErrorMessage(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Back to Organisations</span>
          </button>

          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {activeOrg.name}
            </h2>
            <button
              type="button"
              onClick={() => setPendingConfirm({ kind: 'delete-org', org: activeOrg })}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Delete Org</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {activeOrg.projects.length} {activeOrg.projects.length === 1 ? 'project' : 'projects'} · {allOrgUrls.length} unique {allOrgUrls.length === 1 ? 'URL' : 'URLs'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {shareNotice && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              {shareNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => setBulkImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
          >
            <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Bulk Import</span>
          </button>
          {sortedProjects.length > 0 && (
            <button
              type="button"
              onClick={() => setExportProjectsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <FileOutput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Export Projects</span>
            </button>
          )}
          {allLatestOrgResults.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  exportResultsToCsv(
                    allLatestOrgResults,
                    `upsite-${activeOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportResultsToPdf(
                    allLatestOrgResults,
                    `upsite-${activeOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#171A28] hover:bg-slate-50 dark:hover:bg-[#1E2235] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const slug = activeOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  void shareResultsPdf(
                    allLatestOrgResults,
                    `upsite-${slug}`,
                    `${activeOrg.name} — Availability Report`,
                  )
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
                  const slug = activeOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  void copyResultsReport(
                    allLatestOrgResults,
                    `upsite-${slug}`,
                    `${activeOrg.name} — Availability Report`,
                  )
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

          <button
            type="button"
            disabled={allOrgUrls.length === 0 || Boolean(runningScope)}
            onClick={() => void handleRunAllInOrg()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            {runningScope === 'all' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            )}
            <span>{runningScope === 'all' ? 'Running All...' : 'Run All At Once'}</span>
          </button>
        </div>
      </section>

      {/* Check Timer (Frequency) & Active Time Period (Day & Time Range) */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" strokeWidth={1.75} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Check Timer ({formatIntervalLabel(activeIntervalSec)})
              </p>
              {activeIntervalSec > 0 && allOrgUrls.length > 0 && countdownSec !== null && nextCycleAt ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  {inActiveWindow
                    ? `Countdown: ${formatCountdown(countdownSec)} · Next cycle: ${nextCycleAt}`
                    : `Paused outside time period (${formatCheckWindowLabel(activeWindow)})`}
                </p>
              ) : activeIntervalSec > 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Add at least one project URL to start the check timer.
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Set how frequently {activeOrg.name} should check all projects automatically.
                </p>
              )}
            </div>
          </div>

          <div
            role="group"
            aria-label="Organisation check timer presets"
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]"
          >
            {AUTO_REFRESH_PRESETS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSetOrgAutoRefresh(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                  activeIntervalSec === opt.value
                    ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={handleApplyCustomOrgPeriod}
          className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-white/[0.06]"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {!isPresetInterval && activeIntervalSec > 0
              ? `Custom timer active: Every ${formatIntervalLabel(activeIntervalSec)}`
              : 'Custom timer frequency (1 min – 24 hr)'}
          </span>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={customPeriodUnit === 'hr' ? 24 : 1440}
              value={customPeriodVal}
              onChange={(e) => {
                setCustomPeriodVal(e.target.value);
                setCustomPeriodError(null);
              }}
              placeholder="e.g. 15"
              aria-label="Organisation custom timer frequency value"
              className="w-24 rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
            />
            <select
              aria-label="Organisation custom timer frequency unit"
              value={customPeriodUnit}
              onChange={(e) => setCustomPeriodUnit(e.target.value as 'min' | 'hr')}
              className="rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
            >
              <option value="min">min</option>
              <option value="hr">hr</option>
            </select>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.1] dark:hover:bg-white/[0.16] text-white transition-colors whitespace-nowrap shrink-0"
            >
              Set Timer
            </button>
          </div>
        </form>

        {customPeriodError && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{customPeriodError}</p>
        )}

        <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06]">
          <CheckWindowPicker
            title="Check Time Period"
            description="Select start and end day and time (e.g. Monday 12:00 AM to Sunday 11:59 PM) for when timer checks execute."
            value={activeOrg.checkWindow}
            onChange={handleSetOrgCheckWindow}
          />
        </div>
      </section>

      {/* Add / Edit Project Record Form */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] p-5">
        <form onSubmit={handleSaveProject} className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {editingProjectId ? 'Edit Project Record' : 'Add Project Record'}
            </h3>
            {editingProjectId && (
              <button
                type="button"
                onClick={() => {
                  setEditingProjectId(null);
                  setProjectName('');
                  setProjectUrlsInput('');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="org-project-name"
                className="text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Project Name
              </label>
              <input
                id="org-project-name"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Client Storefront"
                className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label
                htmlFor="org-project-urls"
                className="text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Project URLs (1 or more, separated by new lines or commas)
              </label>
              <textarea
                id="org-project-urls"
                rows={2}
                value={projectUrlsInput}
                onChange={(e) => setProjectUrlsInput(e.target.value)}
                placeholder="https://example.com&#10;https://api.example.com"
                className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500 resize-y"
              />
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-700 dark:text-rose-300"
            >
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.09] dark:hover:bg-white/[0.15] text-white transition-colors whitespace-nowrap shrink-0"
            >
              <FolderPlus className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>{editingProjectId ? 'Save Project' : 'Add Project'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Filter Bar */}
      {allLatestOrgResults.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.07]">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'issues', label: 'Issues' },
                { id: 'online', label: 'Online' },
                { id: 'offline', label: 'Offline' },
                { id: 'error', label: 'Error' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Projects & URLs under Active Organisation */}
      {activeOrg.projects.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-white/60 dark:bg-[#171A28]/60 px-6 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
          No projects added to {activeOrg.name} yet. Fill in a project name and URLs above.
        </div>
      ) : (
        <div className="space-y-3">
          {sortedProjects.map((project) => {
            const isCollapsed = Boolean(collapsedProjectIds[project.id]);
            const resultsByInput = new Map<string, SiteCheckResult>();
            for (const r of project.lastResults || []) {
              resultsByInput.set(r.inputUrl, r);
            }

            const onlineCount = (project.lastResults || []).filter(
              (r) => r.status === 'online',
            ).length;
            const issueCount = (project.lastResults || []).filter(
              (r) => r.status !== 'online',
            ).length;

            const visibleUrls = project.urls.filter((u) => {
              if (statusFilter === 'all') return true;
              const res = resultsByInput.get(u);
              if (!res) return false;
              if (statusFilter === 'issues') return res.status !== 'online';
              return res.status === statusFilter;
            });

            const lastCheckedLabel = formatLastCheckedAt(
              project.lastCheckedAt || project.lastResults?.[0]?.checkedAt,
            );

            return (
              <section
                key={project.id}
                className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] overflow-hidden"
              >
                <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedProjectIds((prev) => ({
                        ...prev,
                        [project.id]: !prev[project.id],
                      }))
                    }
                    className="flex items-center gap-2.5 min-w-0 text-left flex-1"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                    )}
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {project.name}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        {project.urls.length} {project.urls.length === 1 ? 'URL' : 'URLs'}
                        {project.lastResults && project.lastResults.length > 0
                          ? ` · ${onlineCount} Online · ${issueCount} Issue`
                          : ''}
                        {lastCheckedLabel
                          ? ` · Last checked: ${lastCheckedLabel}`
                          : ' · Not checked yet'}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(runningScope)}
                      onClick={() => void handleRunProject(project)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.07] dark:hover:bg-white/[0.12] text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
                    >
                      {runningScope === project.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
                      ) : (
                        <Play className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                      )}
                      <span>Run Project</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditProject(project)}
                      aria-label={`Edit ${project.name}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingConfirm({ kind: 'delete-project', project })}
                      aria-label={`Delete ${project.name}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="border-t border-slate-200 dark:border-white/[0.06] divide-y divide-slate-200 dark:divide-white/[0.06]">
                    {visibleUrls.map((url) => {
                      const result = resultsByInput.get(url);
                      if (!result) {
                        return (
                          <div
                            key={url}
                            className={`px-5 ${isCompact ? 'py-2.5' : 'py-3'} flex items-center justify-between gap-4 text-xs`}
                          >
                            <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                              {url}
                            </span>
                            <span className="text-slate-400 whitespace-nowrap shrink-0">
                              Pending check
                            </span>
                          </div>
                        );
                      }

                      const isSelected = selectedResultId === result.id;
                      const StatusIcon =
                        result.status === 'online'
                          ? CheckCircle2
                          : result.status === 'offline'
                            ? XCircle
                            : AlertTriangle;

                      const statusColorClass =
                        result.status === 'online'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : result.status === 'offline'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400';

                      const statusSurfaceClass =
                        result.status === 'online'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                          : result.status === 'offline'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20'
                            : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20';

                      const isSlow =
                        settings.slowThresholdMs > 0 &&
                        result.responseTimeMs !== null &&
                        result.responseTimeMs > settings.slowThresholdMs;

                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => onSelectResult(result)}
                          className={`w-full text-left px-5 ${isCompact ? 'py-2.5' : 'py-3.5'} flex items-center justify-between gap-4 transition-colors ${
                            isSelected
                              ? 'bg-rose-50/70 dark:bg-[#1F2437]'
                              : 'hover:bg-slate-50 dark:hover:bg-[#1C2032]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <StatusIcon
                              className={`w-4 h-4 shrink-0 ${statusColorClass}`}
                              strokeWidth={2}
                            />
                            <span className="text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100 truncate">
                              {result.normalizedUrl}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            {isSlow && (
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                                Slow
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap shrink-0 ${statusSurfaceClass}`}
                            >
                              {result.statusLabel}
                            </span>
                            <span className="hidden sm:inline-block w-16 text-right text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
                              {result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—'}
                            </span>
                            <span className="hidden md:inline-block w-10 text-right text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                              {result.httpStatusCode !== null ? result.httpStatusCode : '—'}
                            </span>
                            <ChevronRight
                              className="w-4 h-4 text-slate-400 shrink-0"
                              strokeWidth={1.75}
                            />
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

      {/* Post-Run Simple Report Download Prompt */}
      {pendingReport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="org-report-prompt-title"
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#171A28] shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3
                  id="org-report-prompt-title"
                  className="text-sm font-semibold text-slate-900 dark:text-slate-100"
                >
                  Check Complete — Download Simple Report
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {pendingReport.orgName} · {pendingReport.scopeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={onDismissPendingReport}
                aria-label="Cancel report download"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-[#10121C] px-4 py-3 flex items-center justify-between gap-4 text-xs font-mono tabular-nums">
              <span className="text-slate-600 dark:text-slate-300">
                Total: {pendingReport.rows.length}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                Online: {pendingReport.onlineCount}
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                Down: {pendingReport.downCount}
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Would you like to download, share, or copy a simple report covering all {pendingReport.rows.length} checked {pendingReport.rows.length === 1 ? 'site' : 'sites'} now?
            </p>

            {modalShareNotice && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {modalShareNotice}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onDismissPendingReport}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void copySimpleOrgReport(pendingReport.orgName, pendingReport.rows)
                    .then(showModalShareNotice)
                    .catch(() => showModalShareNotice('Clipboard copy unavailable.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0"
              >
                <Copy className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Copy Report</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void shareSimpleOrgReportPdf(pendingReport.orgName, pendingReport.rows)
                    .then(showModalShareNotice)
                    .catch(() => showModalShareNotice('Unable to share PDF.'));
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0"
              >
                <Share2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Share PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  exportSimpleOrgReportPdf(pendingReport.orgName, pendingReport.rows);
                  onDismissPendingReport();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  exportSimpleOrgReportCsv(pendingReport.orgName, pendingReport.rows);
                  onDismissPendingReport();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Download CSV</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingConfirm !== null}
        title={
          pendingConfirm?.kind === 'delete-org'
            ? `Delete Organisation "${pendingConfirm.org.name}"?`
            : pendingConfirm?.kind === 'delete-project'
              ? `Delete Project "${pendingConfirm.project.name}"?`
              : ''
        }
        description={
          pendingConfirm?.kind === 'delete-org'
            ? `This will permanently delete "${pendingConfirm.org.name}" along with its ${
                pendingConfirm.org.projects.length
              } ${pendingConfirm.org.projects.length === 1 ? 'project' : 'projects'} and all saved URLs.`
            : pendingConfirm?.kind === 'delete-project'
              ? `This will permanently remove "${pendingConfirm.project.name}" and its ${
                  pendingConfirm.project.urls.length
                } ${pendingConfirm.project.urls.length === 1 ? 'URL' : 'URLs'} from ${
                  activeOrg?.name || 'this organisation'
                }.`
              : ''
        }
        confirmLabel={pendingConfirm?.kind === 'delete-org' ? 'Delete Organisation' : 'Delete Project'}
        tone="danger"
        onConfirm={() => {
          if (pendingConfirm?.kind === 'delete-org') {
            handleDeleteOrg(pendingConfirm.org.id);
          } else if (pendingConfirm?.kind === 'delete-project') {
            handleDeleteProject(pendingConfirm.project.id);
          }
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />

      <BulkImportModal
        open={bulkImportOpen}
        organisations={organisations}
        initialTargetOrgId={activeOrg.id}
        defaultProtocol={settings.defaultProtocol}
        onClose={() => setBulkImportOpen(false)}
        onConfirmImport={handleBulkImportProjects}
      />

      <ExportProjectsModal
        open={exportProjectsOpen}
        orgName={activeOrg.name}
        projects={sortedProjects}
        onClose={() => setExportProjectsOpen(false)}
      />
    </div>
  );
}
