import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  FolderPlus,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AutoRefreshInterval,
  Organisation,
  ProjectRecord,
  SiteCheckResult,
  SiteStatus,
  UserSettings,
} from '../types/upsite';
import { parseUrlsFromInput } from './CheckerView';
import { exportResultsToCsv, exportResultsToPdf } from '../utils/exporters';

interface OrganisationViewProps {
  organisations: Organisation[];
  settings: UserSettings;
  selectedResultId: string | null;
  onSaveOrganisations: (orgs: Organisation[]) => void;
  onRunBatchUrls: (urls: string[]) => Promise<SiteCheckResult[]>;
  onSelectResult: (result: SiteCheckResult) => void;
}

const AUTO_REFRESH_OPTIONS: Array<{ value: AutoRefreshInterval; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 3600, label: '1 hr' },
  { value: 14400, label: '4 hr' },
];

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

export function OrganisationView({
  organisations,
  settings,
  selectedResultId,
  onSaveOrganisations,
  onRunBatchUrls,
  onSelectResult,
}: OrganisationViewProps) {
  const [openedOrgId, setOpenedOrgId] = useState<string | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Record<string, boolean>>({});
  const [newOrgName, setNewOrgName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectUrlsInput, setProjectUrlsInput] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [runningScope, setRunningScope] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [nextCycleAt, setNextCycleAt] = useState<string | null>(null);

  const activeOrg = useMemo(() => {
    if (!openedOrgId) return null;
    return organisations.find((o) => o.id === openedOrgId) || null;
  }, [organisations, openedOrgId]);

  const allOrgUrls = useMemo(() => {
    if (!activeOrg) return [];
    const list: string[] = [];
    for (const p of activeOrg.projects) {
      for (const u of p.urls) {
        list.push(u);
      }
    }
    return Array.from(new Set(list));
  }, [activeOrg]);

  const allLatestOrgResults = useMemo(() => {
    if (!activeOrg) return [];
    const results: SiteCheckResult[] = [];
    for (const project of activeOrg.projects) {
      if (project.lastResults) {
        results.push(...project.lastResults);
      }
    }
    return results;
  }, [activeOrg]);

  const handleCreateOrg = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newOrgName.trim();
    if (!trimmed) return;
    const created: Organisation = {
      id: crypto.randomUUID(),
      name: trimmed,
      projects: [],
      autoRefreshSec: 0,
      createdAt: new Date().toISOString(),
    };
    const next = [created, ...organisations];
    onSaveOrganisations(next);
    setNewOrgName('');
    setErrorMessage(null);
    setOpenedOrgId(created.id);
  };

  const handleDeleteOrg = (orgId: string) => {
    const next = organisations.filter((o) => o.id !== orgId);
    onSaveOrganisations(next);
    if (openedOrgId === orgId) {
      setOpenedOrgId(null);
    }
  };

  const handleSetOrgAutoRefresh = (intervalSec: AutoRefreshInterval) => {
    if (!activeOrg) return;
    const nextOrgs = organisations.map((o) =>
      o.id === activeOrg.id ? { ...o, autoRefreshSec: intervalSec } : o,
    );
    onSaveOrganisations(nextOrgs);
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

    const updatedProjects: ProjectRecord[] = editingProjectId
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
        ];

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
    setRunningScope(project.id);
    setErrorMessage(null);
    try {
      const results = await onRunBatchUrls(project.urls);
      const checkedAt = new Date().toISOString();
      const nextOrgs = organisations.map((o) =>
        o.id === activeOrg.id
          ? {
              ...o,
              projects: o.projects.map((p) =>
                p.id === project.id ? { ...p, lastResults: results, lastCheckedAt: checkedAt } : p,
              ),
            }
          : o,
      );
      onSaveOrganisations(nextOrgs);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to run project check.');
    } finally {
      setRunningScope(null);
    }
  };

  const handleRunAllInOrg = useCallback(async () => {
    if (!activeOrg || allOrgUrls.length === 0 || runningScope) return;
    setRunningScope('all');
    setErrorMessage(null);

    try {
      const chunkResults: SiteCheckResult[] = [];
      for (let i = 0; i < allOrgUrls.length; i += 60) {
        const chunk = allOrgUrls.slice(i, i + 60);
        const batch = await onRunBatchUrls(chunk);
        chunkResults.push(...batch);
      }

      const byInput = new Map<string, SiteCheckResult>();
      for (const r of chunkResults) {
        byInput.set(r.inputUrl, r);
      }

      const checkedAt = new Date().toISOString();
      const nextOrgs = organisations.map((o) =>
        o.id === activeOrg.id
          ? {
              ...o,
              projects: o.projects.map((p) => ({
                ...p,
                lastCheckedAt: checkedAt,
                lastResults: p.urls
                  .map((u) => byInput.get(u))
                  .filter((item): item is SiteCheckResult => Boolean(item)),
              })),
            }
          : o,
      );
      onSaveOrganisations(nextOrgs);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to run all organisation URLs.');
    } finally {
      setRunningScope(null);
    }
  }, [activeOrg, allOrgUrls, onRunBatchUrls, onSaveOrganisations, organisations, runningScope]);

  // Organisation Auto-Refresh Countdown & Next Cycle Timer
  const runAllRef = useRef(handleRunAllInOrg);
  useEffect(() => {
    runAllRef.current = handleRunAllInOrg;
  }, [handleRunAllInOrg]);

  const activeIntervalSec = activeOrg?.autoRefreshSec ?? 0;

  useEffect(() => {
    if (!activeOrg || activeIntervalSec <= 0 || allOrgUrls.length === 0) {
      setCountdownSec(null);
      setNextCycleAt(null);
      return;
    }

    let targetTimeMs = Date.now() + activeIntervalSec * 1000;
    const formatNextTime = (ms: number) =>
      new Date(ms).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

    setCountdownSec(activeIntervalSec);
    setNextCycleAt(formatNextTime(targetTimeMs));

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((targetTimeMs - Date.now()) / 1000));
      if (remaining <= 0) {
        targetTimeMs = Date.now() + activeIntervalSec * 1000;
        setCountdownSec(activeIntervalSec);
        setNextCycleAt(formatNextTime(targetTimeMs));
        void runAllRef.current();
      } else {
        setCountdownSec(remaining);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeOrg?.id, activeIntervalSec, allOrgUrls.length]);

  const isCompact = settings.density === 'compact';

  // LEVEL 1: Organisation Directory View (click an org to open its projects & URLs)
  if (!activeOrg) {
    return (
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 lg:p-8 space-y-6">
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Company Organisations
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Create an organisation or select one below to manage its projects, URLs, and auto-refresh schedule.
            </p>
          </div>

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

              const scheduleLabel =
                AUTO_REFRESH_OPTIONS.find((o) => o.value === (org.autoRefreshSec ?? 0))?.label ||
                'Off';

              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => {
                    setOpenedOrgId(org.id);
                    setStatusFilter('all');
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
                        {org.projects.length} {org.projects.length === 1 ? 'project' : 'projects'} · {uniqueUrls.size} {uniqueUrls.size === 1 ? 'URL' : 'URLs'} · Auto-refresh: {scheduleLabel}
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
              setOpenedOrgId(null);
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
              onClick={() => handleDeleteOrg(activeOrg.id)}
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

      {/* Auto-Refresh Schedule & Live Countdown / Next Cycle */}
      <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Auto-Refresh Schedule
            </p>
            {activeIntervalSec > 0 && allOrgUrls.length > 0 && countdownSec !== null ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                Countdown: {formatCountdown(countdownSec)} · Next cycle: {nextCycleAt}
              </p>
            ) : activeIntervalSec > 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Add at least one project URL to start the auto-refresh countdown.
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Automatically re-run all projects in {activeOrg.name} on a fixed cycle.
              </p>
            )}
          </div>
        </div>

        <div
          role="group"
          aria-label="Organisation auto-refresh interval"
          className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]"
        >
          {AUTO_REFRESH_OPTIONS.map((opt) => (
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
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.07]">
            {(['all', 'online', 'offline', 'error'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab
                    ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab}
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
          {activeOrg.projects.map((project) => {
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
              return res ? res.status === statusFilter : false;
            });

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
                      onClick={() => handleDeleteProject(project.id)}
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
    </div>
  );
}
