import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckerView, parseUrlsFromInput } from './components/CheckerView';
import { ConfirmModal } from './components/ConfirmModal';
import { HistoryView } from './components/HistoryView';
import { LoginView } from './components/LoginView';
import {
  NotificationBellButton,
  NotificationToastStack,
} from './components/NotificationCenter';
import { OrganisationView } from './components/OrganisationView';
import type { PendingOrgReport } from './components/OrganisationView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { SiteInspector } from './components/SiteInspector';
import type {
  ActiveView,
  AppNotification,
  AuthUser,
  Organisation,
  SiteCheckResult,
  SiteStatus,
  UserSettings,
} from './types/upsite';
import type { SimpleOrgSiteRow } from './utils/exporters';
import { DEFAULT_CHECK_WINDOW, isWithinCheckWindow } from './utils/intervals';
import {
  normalizeOrganisationsProjectOrder,
  sortProjectsByName,
} from './utils/organisations';

const SESSION_TOKEN_KEY = 'upsite_session_token';

function readStoredSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredSessionToken(token: string): void {
  try {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredSessionToken(): void {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore storage errors
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeoutMs: 8500,
  defaultProtocol: 'https',
  slowThresholdMs: 1000,
  autoInspectFirstIssue: false,
  autoRefreshSec: 0,
  checkWindow: { ...DEFAULT_CHECK_WINDOW },
  density: 'comfortable',
  deepInspect: true,
  desktopNotifications: true,
};

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);

  const [activeView, setActiveView] = useState<ActiveView>('checker');
  const [urlInput, setUrlInput] = useState<string>('');
  const [latestResults, setLatestResults] = useState<SiteCheckResult[]>([]);
  const [history, setHistory] = useState<SiteCheckResult[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  const [selectedResult, setSelectedResult] = useState<SiteCheckResult | null>(null);
  const [checkerStatusFilter, setCheckerStatusFilter] = useState<'all' | 'issues' | SiteStatus>('all');
  const [openedOrgId, setOpenedOrgId] = useState<string | null>(null);
  const [orgStatusFilter, setOrgStatusFilter] = useState<'all' | 'issues' | SiteStatus>('all');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [settingsSavedNotice, setSettingsSavedNotice] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefreshRemaining, setAutoRefreshRemaining] = useState<number | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [orgNextRunAt, setOrgNextRunAt] = useState<Record<string, number>>({});
  const [runningOrgScope, setRunningOrgScope] = useState<Record<string, string>>({});
  const [pendingOrgReport, setPendingOrgReport] = useState<PendingOrgReport | null>(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState<boolean>(false);
  const skipCheckerSyncRef = useRef<boolean>(true);

  const authHeaders = useCallback(
    (tokenOverride?: string): Record<string, string> => {
      const tok = tokenOverride ?? sessionToken;
      const base: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'upsite-app',
      };
      if (tok) {
        base.Authorization = `Bearer ${tok}`;
      }
      return base;
    },
    [sessionToken],
  );

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  // Restore remembered session (HttpOnly cookie or saved token) on launch/refresh
  useEffect(() => {
    let active = true;
    (async () => {
      const storedToken = readStoredSessionToken();
      try {
        const headers: Record<string, string> = { 'X-Requested-With': 'upsite-app' };
        if (storedToken) {
          headers.Authorization = `Bearer ${storedToken}`;
        }
        const res = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          headers,
        });
        if (!active) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 404) {
            clearStoredSessionToken();
          }
          return;
        }
        const data = await res.json();
        if (active && data?.user) {
          if (storedToken) {
            setSessionToken(storedToken);
          }
          setCurrentUser(data.user);
          if (data.workspace) {
            setHistory(data.workspace.history || []);
            setOrganisations(
              normalizeOrganisationsProjectOrder(data.workspace.organisations || []),
            );
            setSettings({ ...DEFAULT_SETTINGS, ...(data.workspace.settings || {}) });
            skipCheckerSyncRef.current = true;
            setUrlInput(data.workspace.checkerInput || '');
          }
        }
      } catch {
        // Proceed to login portal if no active session
      } finally {
        if (active) {
          setIsRestoringSession(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = useCallback(() => {
    clearStoredSessionToken();
    void fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'upsite-app' },
    }).catch(() => {});
    setSessionToken(null);
    setCurrentUser(null);
    setConfirmSignOutOpen(false);
    skipCheckerSyncRef.current = true;
    setUrlInput('');
    setLatestResults([]);
    setHistory([]);
    setOrganisations([]);
    setSelectedResult(null);
    setOpenedOrgId(null);
    setNotifications([]);
    setToasts([]);
    setOrgNextRunAt({});
    setRunningOrgScope({});
    setPendingOrgReport(null);
    setErrorMessage(null);
    setAutoRefreshRemaining(null);
    setActiveView('checker');
  }, []);

  // Persist Checker target URLs per signed-in account
  useEffect(() => {
    if (!currentUser || isRestoringSession) return;
    if (skipCheckerSyncRef.current) {
      skipCheckerSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch('/api/checker-input', {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ checkerInput: urlInput }),
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [authHeaders, currentUser, isRestoringSession, urlInput]);

  const runCheckBatch = useCallback(
    async (urls: string[], updateCheckerState: boolean): Promise<SiteCheckResult[]> => {
      if (!currentUser || urls.length === 0) return [];
      const endpoint = urls.length === 1 ? '/api/check' : '/api/check-bulk';
      const bodyPayload = {
        ...(urls.length === 1 ? { url: urls[0] } : { urls }),
        options: {
          timeoutMs: settings.timeoutMs,
          defaultProtocol: settings.defaultProtocol,
          deepInspect: settings.deepInspect,
        },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify(bodyPayload),
      });

      if (response.status === 401) {
        handleSignOut();
        throw new Error('Session expired. Please sign in again.');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to check website availability.');
      }

      const items: SiteCheckResult[] =
        urls.length === 1 && data.result ? [data.result] : data.results || [];

      if (Array.isArray(data.history)) {
        setHistory(data.history);
      } else {
        setHistory((prev) => [...items, ...prev].slice(0, 300));
      }

      if (updateCheckerState) {
        setLatestResults(items);
        if (settings.autoInspectFirstIssue) {
          const firstIssue = items.find((item) => item.status !== 'online');
          if (firstIssue) {
            setSelectedResult(firstIssue);
          } else if (items.length === 1) {
            setSelectedResult(items[0]);
          }
        } else if (items.length === 1) {
          setSelectedResult(items[0]);
        }
      } else if (settings.autoInspectFirstIssue) {
        const firstIssue = items.find((item) => item.status !== 'online');
        if (firstIssue) {
          setSelectedResult(firstIssue);
        }
      }

      return items;
    },
    [
      authHeaders,
      currentUser,
      handleSignOut,
      settings.autoInspectFirstIssue,
      settings.deepInspect,
      settings.defaultProtocol,
      settings.timeoutMs,
    ],
  );

  const handleViewNotification = useCallback((notification: AppNotification) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item)),
    );
    setToasts((prev) => prev.filter((item) => item.id !== notification.id));

    if (notification.targetView === 'organisation' && notification.orgId) {
      setActiveView('organisation');
      setOpenedOrgId(notification.orgId);
      setOrgStatusFilter(notification.downCount > 0 ? 'issues' : 'all');
      if (notification.firstIssueResult) {
        setSelectedResult(notification.firstIssueResult);
      }
    } else {
      setActiveView('checker');
      if (notification.downCount > 0) {
        setCheckerStatusFilter('issues');
      }
      if (notification.firstIssueResult) {
        setSelectedResult(notification.firstIssueResult);
      }
    }
  }, []);

  const pushNotification = useCallback(
    (payload: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
      if (settings.desktopNotifications === false) return;
      const entry: AppNotification = {
        ...payload,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [entry, ...prev].slice(0, 40));
      setToasts((prev) => [entry, ...prev].slice(0, 4));

      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== entry.id));
      }, 14000);

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        try {
          const nativeAlert = new window.Notification(entry.title, {
            body: `${entry.message} — Click to view now.`,
          });
          nativeAlert.onclick = () => {
            window.focus();
            handleViewNotification(entry);
            nativeAlert.close();
          };
        } catch {
          // Ignore native OS notification error
        }
      }
    },
    [handleViewNotification, settings.desktopNotifications],
  );

  const handleRunChecker = useCallback(
    async (urls: string[]) => {
      setIsChecking(true);
      setErrorMessage(null);
      try {
        await runCheckBatch(urls, true);
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Unable to reach checking service.',
        );
      } finally {
        setIsChecking(false);
      }
    },
    [runCheckBatch],
  );

  // Auto-Refresh Monitor Timer for active Checker batch
  const latestUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    latestUrlsRef.current = parseUrlsFromInput(urlInput);
  }, [urlInput]);

  useEffect(() => {
    if (
      !currentUser ||
      settings.autoRefreshSec <= 0 ||
      activeView !== 'checker' ||
      latestResults.length === 0 ||
      latestUrlsRef.current.length === 0
    ) {
      setAutoRefreshRemaining(null);
      return;
    }

    let remaining = settings.autoRefreshSec;
    setAutoRefreshRemaining(remaining);

    const interval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = settings.autoRefreshSec;
        if (
          !isChecking &&
          latestUrlsRef.current.length > 0 &&
          isWithinCheckWindow(settings.checkWindow)
        ) {
          void handleRunChecker(latestUrlsRef.current);
        }
      }
      setAutoRefreshRemaining(remaining);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    activeView,
    currentUser,
    handleRunChecker,
    isChecking,
    latestResults.length,
    settings.autoRefreshSec,
    settings.checkWindow,
  ]);

  const handleRecheckSingle = async (url: string) => {
    if (!currentUser) return;
    setIsRechecking(true);
    try {
      const items = await runCheckBatch([url], false);
      if (items[0]) {
        const updated = items[0];
        setSelectedResult(updated);
        setLatestResults((prev) =>
          prev.some((r) => r.inputUrl === updated.inputUrl)
            ? prev.map((r) => (r.inputUrl === updated.inputUrl ? updated : r))
            : prev,
        );
      }
    } catch {
      // Preserve existing inspector view on transient error
    } finally {
      setIsRechecking(false);
    }
  };

  const handleSaveOrganisations = useCallback(
    async (nextOrgs: Organisation[]) => {
      const normalizedOrgs = normalizeOrganisationsProjectOrder(nextOrgs);
      setOrganisations(normalizedOrgs);
      if (!currentUser) return;
      try {
        const res = await fetch('/api/organisations', {
          method: 'PUT',
          credentials: 'include',
          headers: authHeaders(),
          body: JSON.stringify({ organisations: normalizedOrgs }),
        });
        if (res.status === 401) {
          handleSignOut();
        }
      } catch {
        // Keep local state updated
      }
    },
    [authHeaders, currentUser, handleSignOut],
  );

  // Refs for background Organisation timer runs
  const organisationsRef = useRef<Organisation[]>(organisations);
  useEffect(() => {
    organisationsRef.current = organisations;
  }, [organisations]);

  const runningOrgScopeRef = useRef<Record<string, string>>(runningOrgScope);
  useEffect(() => {
    runningOrgScopeRef.current = runningOrgScope;
  }, [runningOrgScope]);

  const activeViewRef = useRef<ActiveView>(activeView);
  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  const executeOrgRun = useCallback(
    async (orgId: string, scope: 'all' | string, source: 'manual' | 'timer') => {
      const org = organisationsRef.current.find((o) => o.id === orgId);
      if (!org || runningOrgScopeRef.current[orgId]) return;

      const targetProjects =
        scope === 'all' ? org.projects : org.projects.filter((p) => p.id === scope);
      const uniqueUrls = Array.from(
        new Set(targetProjects.flatMap((p) => p.urls).filter(Boolean)),
      );
      if (uniqueUrls.length === 0) return;

      const prevStatusByUrl = new Map<string, SiteStatus>();
      for (const p of org.projects) {
        for (const r of p.lastResults || []) {
          prevStatusByUrl.set(r.inputUrl, r.status);
        }
      }

      setRunningOrgScope((prev) => ({ ...prev, [orgId]: scope }));

      try {
        const chunkResults: SiteCheckResult[] = [];
        for (let i = 0; i < uniqueUrls.length; i += 60) {
          const chunk = uniqueUrls.slice(i, i + 60);
          const batch = await runCheckBatch(chunk, false);
          chunkResults.push(...batch);
        }

        const byInput = new Map<string, SiteCheckResult>();
        for (const r of chunkResults) {
          byInput.set(r.inputUrl, r);
        }

        const checkedAt = new Date().toISOString();
        const latestOrgs = organisationsRef.current;
        const nextOrgs = latestOrgs.map((o) =>
          o.id === orgId
            ? {
                ...o,
                projects: o.projects.map((p) => {
                  if (scope !== 'all' && p.id !== scope) return p;
                  return {
                    ...p,
                    lastCheckedAt: checkedAt,
                    lastResults: p.urls
                      .map((u) => byInput.get(u))
                      .filter((item): item is SiteCheckResult => Boolean(item)),
                  };
                }),
              }
            : o,
        );
        await handleSaveOrganisations(nextOrgs);

        const downResults = chunkResults.filter((r) => r.status !== 'online');
        const onlineCount = chunkResults.length - downResults.length;

        if (source === 'timer') {
          let backOnlineCount = 0;
          let newErrorCount = 0;
          for (const item of chunkResults) {
            const prev = prevStatusByUrl.get(item.inputUrl);
            if ((prev === 'offline' || prev === 'error') && item.status === 'online') {
              backOnlineCount += 1;
            } else if ((!prev || prev === 'online') && item.status !== 'online') {
              newErrorCount += 1;
            }
          }

          const changeParts: string[] = [];
          if (backOnlineCount > 0) {
            changeParts.push(
              `${backOnlineCount} ${backOnlineCount === 1 ? 'site' : 'sites'} back online`,
            );
          }
          if (newErrorCount > 0) {
            changeParts.push(
              `${newErrorCount} new ${newErrorCount === 1 ? 'site has' : 'sites have'} error`,
            );
          }
          const changeMessage =
            changeParts.length > 0
              ? changeParts.join(', ')
              : `No status changes (${onlineCount} online, ${downResults.length} down)`;

          pushNotification({
            kind: 'org-changes',
            title: `${org.name} · Scheduled Check`,
            message: changeMessage,
            targetView: 'organisation',
            orgId: org.id,
            downCount: downResults.length,
            backOnlineCount,
            newErrorCount,
            firstIssueResult: downResults[0],
          });

          pushNotification({
            kind: 'results-ready',
            title: 'Site results are ready',
            message:
              downResults.length > 0
                ? `${org.name}: ${downResults.length} ${downResults.length === 1 ? 'site' : 'sites'} down`
                : `${org.name}: All ${onlineCount} ${onlineCount === 1 ? 'site' : 'sites'} online`,
            targetView: 'organisation',
            orgId: org.id,
            downCount: downResults.length,
            firstIssueResult: downResults[0],
          });
        }

        const updatedOrg = nextOrgs.find((o) => o.id === orgId);
        if (updatedOrg && (source === 'manual' || activeViewRef.current === 'organisation')) {
          const reportRows: SimpleOrgSiteRow[] = [];
          const scopedProjects = sortProjectsByName(
            scope === 'all'
              ? updatedOrg.projects
              : updatedOrg.projects.filter((p) => p.id === scope),
          );
          for (const proj of scopedProjects) {
            for (const res of proj.lastResults || []) {
              reportRows.push({ projectName: proj.name, result: res });
            }
          }
          if (reportRows.length > 0) {
            const reportOnline = reportRows.filter((r) => r.result.status === 'online').length;
            setPendingOrgReport({
              orgName: updatedOrg.name,
              scopeLabel:
                scope === 'all'
                  ? `All projects (${scopedProjects.length})`
                  : scopedProjects[0]?.name || 'Project run',
              rows: reportRows,
              onlineCount: reportOnline,
              downCount: reportRows.length - reportOnline,
            });
          }
        }
      } finally {
        setRunningOrgScope((prev) => {
          const copy = { ...prev };
          delete copy[orgId];
          return copy;
        });
      }
    },
    [handleSaveOrganisations, pushNotification, runCheckBatch],
  );

  const executeOrgRunRef = useRef(executeOrgRun);
  useEffect(() => {
    executeOrgRunRef.current = executeOrgRun;
  }, [executeOrgRun]);

  // Background scheduler across all Organisations with an active check time period
  const orgScheduleTrackerRef = useRef<
    Record<string, { intervalSec: number; targetMs: number }>
  >({});

  const scheduleFingerprint = organisations
    .map((o) => `${o.id}:${o.autoRefreshSec ?? 0}:${o.projects.reduce((s, p) => s + p.urls.length, 0)}`)
    .join('|');

  useEffect(() => {
    if (!currentUser) {
      orgScheduleTrackerRef.current = {};
      setOrgNextRunAt({});
      return;
    }

    const nextTracker: Record<string, { intervalSec: number; targetMs: number }> = {};
    const nextTargets: Record<string, number> = {};
    let hasActiveSchedule = false;

    for (const org of organisationsRef.current) {
      const intervalSec = org.autoRefreshSec ?? 0;
      const urlCount = org.projects.reduce((sum, p) => sum + p.urls.length, 0);
      if (intervalSec > 0 && urlCount > 0) {
        hasActiveSchedule = true;
        const existing = orgScheduleTrackerRef.current[org.id];
        const targetMs =
          existing && existing.intervalSec === intervalSec
            ? existing.targetMs
            : Date.now() + intervalSec * 1000;
        nextTracker[org.id] = { intervalSec, targetMs };
        nextTargets[org.id] = targetMs;
      }
    }

    orgScheduleTrackerRef.current = nextTracker;
    setOrgNextRunAt(nextTargets);

    if (!hasActiveSchedule) return;

    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const nowDate = new Date(nowMs);
      let updatedTargets = false;
      const snapshot: Record<string, number> = {};

      for (const [orgId, entry] of Object.entries(orgScheduleTrackerRef.current)) {
        if (nowMs >= entry.targetMs) {
          entry.targetMs = nowMs + entry.intervalSec * 1000;
          updatedTargets = true;
          const orgObj = organisationsRef.current.find((o) => o.id === orgId);
          if (orgObj && isWithinCheckWindow(orgObj.checkWindow, nowDate)) {
            void executeOrgRunRef.current(orgId, 'all', 'timer');
          }
        }
        snapshot[orgId] = entry.targetMs;
      }

      if (updatedTargets) {
        setOrgNextRunAt(snapshot);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [currentUser, scheduleFingerprint]);

  const handleUpdateSettings = async (partial: Partial<UserSettings>) => {
    const optimistic = { ...settings, ...partial };
    setSettings(optimistic);
    if (!currentUser) return;

    setIsSavingSettings(true);
    setSettingsSavedNotice(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ settings: partial }),
      });
      if (res.status === 401) {
        handleSignOut();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
        setSettingsSavedNotice(true);
        setTimeout(() => setSettingsSavedNotice(false), 1800);
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleClearResults = () => {
    setLatestResults([]);
    setSelectedResult(null);
    setErrorMessage(null);
  };

  const handleClearHistory = async () => {
    setHistory([]);
    if (activeView === 'history') {
      setSelectedResult(null);
    }
    if (!currentUser) return;
    await fetch('/api/history', {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    }).catch(() => {});
  };

  if (isRestoringSession) {
    return (
      <div className="min-h-screen w-full bg-slate-100 dark:bg-[#0F111A] text-slate-600 dark:text-slate-400 flex items-center justify-center p-6">
        <span className="text-xs font-medium tracking-wide">Restoring session...</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onAuthenticated={(payload) => {
          if (payload.rememberMe && payload.sessionToken) {
            writeStoredSessionToken(payload.sessionToken);
          } else {
            clearStoredSessionToken();
          }
          setSessionToken(payload.sessionToken);
          setCurrentUser(payload.user);
          if (payload.workspace) {
            setHistory(payload.workspace.history || []);
            setOrganisations(
              normalizeOrganisationsProjectOrder(payload.workspace.organisations || []),
            );
            setSettings({ ...DEFAULT_SETTINGS, ...(payload.workspace.settings || {}) });
            skipCheckerSyncRef.current = true;
            setUrlInput(payload.workspace.checkerInput || '');
          }
        }}
      />
    );
  }

  const pageTitle =
    activeView === 'checker'
      ? 'Website Checker'
      : activeView === 'organisation'
        ? 'Organisation Projects'
        : activeView === 'history'
          ? 'Check History'
          : 'Settings';

  const pageSubtitle =
    activeView === 'checker'
      ? 'Check single or multiple URLs for availability and inspect diagnostics'
      : activeView === 'organisation'
        ? 'Manage company organisations, multi-URL project records, and batch runs'
        : activeView === 'history'
          ? 'Review past website checks, status codes, and export reports'
          : 'Configure light/dark appearance and availability checking behavior';

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-100 dark:bg-[#0F111A] text-slate-900 dark:text-slate-100 flex flex-col md:flex-row">
      {/* Left Navigation Sidebar */}
      <Sidebar
        activeView={activeView}
        onChangeView={(view) => {
          if (view === 'organisation') {
            setOpenedOrgId(null);
          }
          setActiveView(view);
          if (view === 'settings') setSelectedResult(null);
        }}
        latestResults={latestResults}
        historyCount={history.length}
        organisationCount={organisations.length}
        user={currentUser}
        onSignOut={() => setConfirmSignOutOpen(true)}
      />

      {/* Main Desktop Frame */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-50 dark:bg-[#121420]">
        {/* Top Bar */}
        <header className="h-16 px-6 lg:px-8 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-6 shrink-0">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {pageTitle}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
              {pageSubtitle}
            </p>
          </div>

          <NotificationBellButton
            notifications={notifications}
            onViewNotification={handleViewNotification}
            onMarkAllRead={() =>
              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
            }
            onClearAll={() => {
              setNotifications([]);
              setToasts([]);
            }}
          />
        </header>

        {/* Content + Optional Secondary Details Inspector */}
        <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {activeView === 'checker' && (
            <CheckerView
              urlInput={urlInput}
              onChangeUrlInput={setUrlInput}
              results={latestResults}
              selectedId={selectedResult?.id ?? null}
              statusFilter={checkerStatusFilter}
              isChecking={isChecking}
              errorMessage={errorMessage}
              settings={settings}
              autoRefreshRemaining={autoRefreshRemaining}
              onChangeStatusFilter={setCheckerStatusFilter}
              onRunCheck={handleRunChecker}
              onSelectResult={(item) => setSelectedResult(item)}
              onClearResults={handleClearResults}
            />
          )}

          {activeView === 'organisation' && (
            <OrganisationView
              organisations={organisations}
              settings={settings}
              selectedResultId={selectedResult?.id ?? null}
              openedOrgId={openedOrgId}
              statusFilter={orgStatusFilter}
              orgNextRunAt={orgNextRunAt}
              runningOrgScope={runningOrgScope}
              pendingReport={pendingOrgReport}
              onChangeOpenedOrgId={setOpenedOrgId}
              onChangeStatusFilter={setOrgStatusFilter}
              onSaveOrganisations={handleSaveOrganisations}
              onRunOrgAll={(orgId) => executeOrgRun(orgId, 'all', 'manual')}
              onRunOrgProject={(orgId, projectId) => executeOrgRun(orgId, projectId, 'manual')}
              onSelectResult={(item) => setSelectedResult(item)}
              onDismissPendingReport={() => setPendingOrgReport(null)}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              history={history}
              selectedId={selectedResult?.id ?? null}
              settings={settings}
              onSelectResult={(item) => setSelectedResult(item)}
              onClearHistory={handleClearHistory}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              user={currentUser}
              settings={settings}
              isSaving={isSavingSettings}
              savedNotice={settingsSavedNotice}
              onUpdateSettings={handleUpdateSettings}
            />
          )}

          {activeView !== 'settings' && selectedResult && (
            <SiteInspector
              result={selectedResult}
              isRechecking={isRechecking}
              onClose={() => setSelectedResult(null)}
              onRecheck={handleRecheckSingle}
            />
          )}
        </main>
      </div>

      <NotificationToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))}
        onViewNow={handleViewNotification}
      />

      <ConfirmModal
        open={confirmSignOutOpen}
        title="Sign out of upsite?"
        description="Your saved organisations, projects, check history, and preferences remain bonded to your account. You will need to sign in again to reopen them."
        confirmLabel="Sign Out"
        tone="neutral"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOutOpen(false)}
      />
    </div>
  );
}
