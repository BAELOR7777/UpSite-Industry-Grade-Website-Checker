import { Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { CheckerView, parseUrlsFromInput } from './components/CheckerView';
import { CommandPalette } from './components/CommandPalette';
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
  IncidentRecord,
  IntegrationProvider,
  Organisation,
  ProjectCheckRules,
  ReportDispatchPayload,
  SiteCheckResult,
  SiteStatus,
  UserSettings,
} from './types/upsite';
import {
  buildReportDispatchPayloadFromOrgRows,
  exportStatusPageHtml,
} from './utils/exporters';
import type { SimpleOrgSiteRow } from './utils/exporters';
import { DEFAULT_CHECK_WINDOW, isWithinCheckWindow } from './utils/intervals';
import {
  normalizeOrganisationsProjectOrder,
  sortProjectsByName,
} from './utils/organisations';

const SESSION_TOKEN_KEY = 'upsite_session_token';
const SIDEBAR_WIDTH_KEY = 'upsite_sidebar_width';
const SIDEBAR_COLLAPSED_KEY = 'upsite_sidebar_collapsed';
const DEFAULT_TITLE = 'upsite — Website Availability & Diagnostics';

function readStoredSidebarWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= 172 && raw <= 360) return raw;
  } catch {
    // Ignore storage errors
  }
  return 236;
}

function readStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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
  minimizeToTray: true,
  launchAtStartup: false,
  integrations: [],
  features: {
    analyticsEnabled: true,
    incidentTrackingEnabled: true,
    sslExpiryAlertsEnabled: true,
    keywordChecksEnabled: true,
    customCheckRulesEnabled: true,
    maintenanceWindowsEnabled: true,
    digestReportsEnabled: false,
    commandPaletteEnabled: true,
  },
  sslWarningDays: 14,
  alertConsecutiveFailures: 1,
  alertCooldownMin: 0,
  digestSchedule: 'off',
};

function mergeWorkspaceSettings(incoming?: Partial<UserSettings>): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(incoming || {}),
    features: {
      ...DEFAULT_SETTINGS.features,
      ...(incoming?.features || {}),
    },
  };
}

function isOrgAlertMuted(org: Organisation, s: UserSettings, now = Date.now()): boolean {
  if (s.features?.maintenanceWindowsEnabled === false) return false;
  if (s.workspaceMaintenanceUntil && Date.parse(s.workspaceMaintenanceUntil) > now) {
    return true;
  }
  if (org.maintenanceUntil && Date.parse(org.maintenanceUntil) > now) {
    return true;
  }
  return false;
}

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);

  const [activeView, setActiveView] = useState<ActiveView>('checker');
  const [urlInput, setUrlInput] = useState<string>('');
  const [latestResults, setLatestResults] = useState<SiteCheckResult[]>([]);
  const [history, setHistory] = useState<SiteCheckResult[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readStoredSidebarCollapsed(),
  );
  const skipCheckerSyncRef = useRef<boolean>(true);
  const notificationsRef = useRef<AppNotification[]>([]);
  const incidentsRef = useRef<IncidentRecord[]>(incidents);
  useEffect(() => {
    incidentsRef.current = incidents;
  }, [incidents]);
  const failureStreakRef = useRef<Map<string, number>>(new Map());
  const lastAlertedAtRef = useRef<Map<string, number>>(new Map());
  const sslWarnedCertsRef = useRef<Set<string>>(new Set());
  const digestInFlightRef = useRef<boolean>(false);
  const settingsRef = useRef<UserSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const handleResizeSidebar = useCallback((nextWidth: number) => {
    setSidebarWidth(nextWidth);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleToggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

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
            setIncidents(data.workspace.incidents || []);
            setOrganisations(
              normalizeOrganisationsProjectOrder(data.workspace.organisations || []),
            );
            setSettings(mergeWorkspaceSettings(data.workspace.settings));
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
    setCommandPaletteOpen(false);
    skipCheckerSyncRef.current = true;
    setUrlInput('');
    setLatestResults([]);
    setHistory([]);
    setIncidents([]);
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
    failureStreakRef.current.clear();
    lastAlertedAtRef.current.clear();
    sslWarnedCertsRef.current.clear();
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
    async (
      urls: string[],
      updateCheckerState: boolean,
      rulesOverride?: ProjectCheckRules,
    ): Promise<SiteCheckResult[]> => {
      if (!currentUser || urls.length === 0) return [];
      const activeSettings = settingsRef.current;
      const customRulesEnabled = activeSettings.features?.customCheckRulesEnabled !== false;
      const keywordChecksEnabled = activeSettings.features?.keywordChecksEnabled !== false;

      const filteredRules: ProjectCheckRules | undefined = rulesOverride
        ? {
            ...(customRulesEnabled
              ? {
                  method: rulesOverride.method,
                  expectedStatuses: rulesOverride.expectedStatuses,
                  customHeaders: rulesOverride.customHeaders,
                }
              : {}),
            ...(keywordChecksEnabled
              ? {
                  expectedKeyword: rulesOverride.expectedKeyword,
                  forbiddenKeyword: rulesOverride.forbiddenKeyword,
                }
              : {}),
          }
        : undefined;

      const hasFilteredRules = Boolean(
        filteredRules &&
          (filteredRules.method ||
            (filteredRules.expectedStatuses && filteredRules.expectedStatuses.length > 0) ||
            (filteredRules.customHeaders && filteredRules.customHeaders.length > 0) ||
            filteredRules.expectedKeyword ||
            filteredRules.forbiddenKeyword),
      );

      const endpoint = urls.length === 1 ? '/api/check' : '/api/check-bulk';
      const bodyPayload = {
        ...(urls.length === 1 ? { url: urls[0] } : { urls }),
        options: {
          timeoutMs: activeSettings.timeoutMs,
          defaultProtocol: activeSettings.defaultProtocol,
          deepInspect: activeSettings.deepInspect,
          sslWarningDays: activeSettings.sslWarningDays ?? 14,
          ...(hasFilteredRules ? { rules: filteredRules } : {}),
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
        if (activeSettings.autoInspectFirstIssue) {
          const firstIssue = items.find((item) => item.status !== 'online');
          if (firstIssue) {
            setSelectedResult(firstIssue);
          } else if (items.length === 1) {
            setSelectedResult(items[0]);
          }
        } else if (items.length === 1) {
          setSelectedResult(items[0]);
        }
      } else if (activeSettings.autoInspectFirstIssue) {
        const firstIssue = items.find((item) => item.status !== 'online');
        if (firstIssue) {
          setSelectedResult(firstIssue);
        }
      }

      return items;
    },
    [authHeaders, currentUser, handleSignOut],
  );

  const handleViewNotification = useCallback((notification: AppNotification) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item)),
    );
    setToasts((prev) => prev.filter((item) => item.id !== notification.id));

    if (notification.targetView === 'analytics') {
      if (settingsRef.current.features?.analyticsEnabled !== false) {
        setActiveView('analytics');
      } else {
        setActiveView('organisation');
      }
      if (notification.firstIssueResult) {
        setSelectedResult(notification.firstIssueResult);
      }
      return;
    }

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

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Restore window title once user returns to the app
  useEffect(() => {
    const resetTitle = () => {
      if (!document.hidden) {
        document.title = DEFAULT_TITLE;
      }
    };
    window.addEventListener('focus', resetTitle);
    document.addEventListener('visibilitychange', resetTitle);
    return () => {
      window.removeEventListener('focus', resetTitle);
      document.removeEventListener('visibilitychange', resetTitle);
    };
  }, []);

  // Handle clicks on native Electron desktop notifications
  useEffect(() => {
    const unsubscribe = window.upsiteDesktop?.onNotificationClick?.((notifId) => {
      const match = notificationsRef.current.find((item) => item.id === notifId);
      if (match) {
        handleViewNotification(match);
      } else {
        setActiveView('organisation');
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleViewNotification]);

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

      if (typeof document !== 'undefined' && document.hidden) {
        document.title = `[Alert] ${entry.title} — upsite`;
      }

      const bodyText = `${entry.message} — Click to view now.`;
      if (typeof window !== 'undefined' && window.upsiteDesktop?.showNotification) {
        void window.upsiteDesktop
          .showNotification({
            id: entry.id,
            title: entry.title,
            body: bodyText,
          })
          .catch(() => {});
        return;
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        try {
          const nativeAlert = new window.Notification(entry.title, {
            body: bodyText,
            requireInteraction: entry.downCount > 0 || (entry.newErrorCount ?? 0) > 0,
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
    async (urls: string[], rules?: ProjectCheckRules) => {
      setIsChecking(true);
      setErrorMessage(null);
      try {
        await runCheckBatch(urls, true, rules);
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

  const handleSaveIncidents = useCallback(
    async (nextIncidents: IncidentRecord[]) => {
      const capped = nextIncidents.slice(0, 300);
      incidentsRef.current = capped;
      setIncidents(capped);
      if (!currentUser) return;
      try {
        const res = await fetch('/api/incidents', {
          method: 'PUT',
          credentials: 'include',
          headers: authHeaders(),
          body: JSON.stringify({ incidents: capped }),
        });
        if (res.status === 401) {
          handleSignOut();
        }
      } catch {
        // Keep optimistic incident timeline
      }
    },
    [authHeaders, currentUser, handleSignOut],
  );

  const handleClearIncidents = useCallback(async () => {
    incidentsRef.current = [];
    setIncidents([]);
    if (!currentUser) return;
    await fetch('/api/incidents', {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    }).catch(() => {});
  }, [authHeaders, currentUser]);

  const handleSendReportToApps = useCallback(
    async (
      report: ReportDispatchPayload,
      channelIds: string[],
    ): Promise<{
      sentCount: number;
      results: Array<{ id: string; name: string; ok: boolean; error?: string }>;
    }> => {
      if (!currentUser || channelIds.length === 0) {
        return { sentCount: 0, results: [] };
      }
      const res = await fetch('/api/integrations/send', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ channelIds, report }),
      });
      if (res.status === 401) {
        handleSignOut();
        throw new Error('Session expired. Please sign in again.');
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to deliver report to connected apps.');
      }
      return {
        sentCount: Number(data?.sentCount) || 0,
        results: Array.isArray(data?.results) ? data.results : [],
      };
    },
    [authHeaders, currentUser, handleSignOut],
  );

  const handleTestIntegration = useCallback(
    async (channel: {
      provider: IntegrationProvider;
      webhookUrl: string;
      name: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!currentUser) return { ok: false, error: 'Sign in required.' };
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify(channel),
      });
      if (res.status === 401) {
        handleSignOut();
        return { ok: false, error: 'Session expired. Please sign in again.' };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error || 'Webhook test failed.' };
      }
      return { ok: Boolean(data?.ok), error: data?.error };
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
      const hasAnyUrls = targetProjects.some((p) => p.urls.length > 0);
      if (!hasAnyUrls) return;

      const prevStatusByUrl = new Map<string, SiteStatus>();
      for (const p of org.projects) {
        for (const r of p.lastResults || []) {
          prevStatusByUrl.set(r.inputUrl, r.status);
        }
      }

      setRunningOrgScope((prev) => ({ ...prev, [orgId]: scope }));

      try {
        // Group projects by their checkRules so projects with identical rules batch cleanly
        const groups = new Map<
          string,
          { rules: ProjectCheckRules | undefined; urlSet: Set<string> }
        >();
        for (const proj of targetProjects) {
          const key = JSON.stringify(proj.checkRules || {});
          const entry = groups.get(key) || { rules: proj.checkRules, urlSet: new Set<string>() };
          for (const u of proj.urls) {
            if (u) entry.urlSet.add(u);
          }
          groups.set(key, entry);
        }

        const resultsByRuleKey = new Map<string, Map<string, SiteCheckResult>>();
        const allExecutedResults: SiteCheckResult[] = [];

        for (const [ruleKey, group] of groups.entries()) {
          const urls = Array.from(group.urlSet);
          if (urls.length === 0) continue;
          const byInput = new Map<string, SiteCheckResult>();
          for (let i = 0; i < urls.length; i += 60) {
            const chunk = urls.slice(i, i + 60);
            const batch = await runCheckBatch(chunk, false, group.rules);
            for (const item of batch) {
              byInput.set(item.inputUrl, item);
              allExecutedResults.push(item);
            }
          }
          resultsByRuleKey.set(ruleKey, byInput);
        }

        const checkedAt = new Date().toISOString();
        const latestOrgs = organisationsRef.current;
        const nextOrgs = latestOrgs.map((o) =>
          o.id === orgId
            ? {
                ...o,
                projects: o.projects.map((p) => {
                  if (scope !== 'all' && p.id !== scope) return p;
                  const key = JSON.stringify(p.checkRules || {});
                  const mapForProj = resultsByRuleKey.get(key);
                  return {
                    ...p,
                    lastCheckedAt: checkedAt,
                    lastResults: p.urls
                      .map((u) => mapForProj?.get(u))
                      .filter((item): item is SiteCheckResult => Boolean(item)),
                  };
                }),
              }
            : o,
        );
        await handleSaveOrganisations(nextOrgs);

        // Update Incident Timeline when enabled
        const updatedOrgObj = nextOrgs.find((o) => o.id === orgId);
        if (
          updatedOrgObj &&
          settingsRef.current.features?.incidentTrackingEnabled !== false
        ) {
          const nextIncidents = [...incidentsRef.current];
          let incidentsChanged = false;
          const scopedProjects =
            scope === 'all'
              ? updatedOrgObj.projects
              : updatedOrgObj.projects.filter((p) => p.id === scope);

          for (const proj of scopedProjects) {
            for (const res of proj.lastResults || []) {
              const openIdx = nextIncidents.findIndex(
                (inc) =>
                  inc.orgId === orgId &&
                  inc.url === res.inputUrl &&
                  inc.status === 'open',
              );

              if (res.status !== 'online') {
                if (openIdx === -1) {
                  nextIncidents.unshift({
                    id: crypto.randomUUID(),
                    orgId,
                    orgName: updatedOrgObj.name,
                    projectId: proj.id,
                    projectName: proj.name,
                    url: res.inputUrl,
                    status: 'open',
                    startedAt: res.checkedAt || checkedAt,
                    errorCode: res.diagnosis.errorCode,
                    reason: res.diagnosis.likelyReason,
                  });
                  incidentsChanged = true;
                }
              } else if (openIdx !== -1) {
                const openInc = nextIncidents[openIdx];
                const resolvedIso = res.checkedAt || checkedAt;
                const startedMs = Date.parse(openInc.startedAt);
                const resolvedMs = Date.parse(resolvedIso);
                nextIncidents[openIdx] = {
                  ...openInc,
                  status: 'resolved',
                  resolvedAt: resolvedIso,
                  durationMs:
                    Number.isFinite(startedMs) && Number.isFinite(resolvedMs)
                      ? Math.max(0, resolvedMs - startedMs)
                      : undefined,
                };
                incidentsChanged = true;
              }
            }
          }

          if (incidentsChanged) {
            void handleSaveIncidents(nextIncidents);
          }
        }

        const downResults = allExecutedResults.filter((r) => r.status !== 'online');
        const onlineCount = allExecutedResults.length - downResults.length;

        // Track consecutive failure streaks per endpoint
        const failureThreshold = Math.max(
          1,
          settingsRef.current.alertConsecutiveFailures ?? 1,
        );
        const confirmedDownUrls = new Set<string>();
        const newlyConfirmedDownUrls = new Set<string>();
        for (const item of allExecutedResults) {
          const streakKey = `${orgId}:${item.inputUrl}`;
          if (item.status === 'online') {
            failureStreakRef.current.set(streakKey, 0);
          } else {
            const nextStreak = (failureStreakRef.current.get(streakKey) || 0) + 1;
            failureStreakRef.current.set(streakKey, nextStreak);
            if (nextStreak >= failureThreshold) {
              confirmedDownUrls.add(item.inputUrl);
              if (nextStreak === failureThreshold) {
                newlyConfirmedDownUrls.add(item.inputUrl);
              }
            }
          }
        }
        const confirmedDownResults = downResults.filter((r) =>
          confirmedDownUrls.has(r.inputUrl),
        );

        if (source === 'timer') {
          let backOnlineCount = 0;
          let newErrorCount = 0;
          for (const item of allExecutedResults) {
            const prev = prevStatusByUrl.get(item.inputUrl);
            if ((prev === 'offline' || prev === 'error') && item.status === 'online') {
              backOnlineCount += 1;
            } else if (newlyConfirmedDownUrls.has(item.inputUrl)) {
              newErrorCount += 1;
            }
          }

          const muted = isOrgAlertMuted(org, settingsRef.current);
          const cooldownMs = (settingsRef.current.alertCooldownMin ?? 0) * 60_000;
          const lastAlertTs = lastAlertedAtRef.current.get(orgId) || 0;
          const inCooldown =
            cooldownMs > 0 &&
            confirmedDownResults.length > 0 &&
            backOnlineCount === 0 &&
            Date.now() - lastAlertTs < cooldownMs;

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
              : `No status changes (${onlineCount} online, ${confirmedDownResults.length} down)`;

          if (!muted && !inCooldown && (downResults.length === 0 || confirmedDownResults.length > 0 || backOnlineCount > 0)) {
            if (confirmedDownResults.length > 0) {
              lastAlertedAtRef.current.set(orgId, Date.now());
            }

            pushNotification({
              kind: 'org-changes',
              title: `${org.name} · Scheduled Check`,
              message: changeMessage,
              targetView: 'organisation',
              orgId: org.id,
              downCount: confirmedDownResults.length,
              backOnlineCount,
              newErrorCount,
              firstIssueResult: confirmedDownResults[0],
            });

            pushNotification({
              kind: 'results-ready',
              title: 'Site results are ready',
              message:
                confirmedDownResults.length > 0
                  ? `${org.name}: ${confirmedDownResults.length} ${confirmedDownResults.length === 1 ? 'site' : 'sites'} down`
                  : `${org.name}: All ${onlineCount} ${onlineCount === 1 ? 'site' : 'sites'} online`,
              targetView: 'organisation',
              orgId: org.id,
              downCount: confirmedDownResults.length,
              firstIssueResult: confirmedDownResults[0],
            });

            const autoChannels = (settingsRef.current.integrations || []).filter(
              (c) =>
                c.enabled &&
                c.autoSendOnOrgRun &&
                (!c.onlyOnIssues || confirmedDownResults.length > 0),
            );
            if (updatedOrgObj && autoChannels.length > 0) {
              const autoRows: SimpleOrgSiteRow[] = [];
              for (const proj of sortProjectsByName(updatedOrgObj.projects)) {
                for (const res of proj.lastResults || []) {
                  autoRows.push({ projectName: proj.name, result: res });
                }
              }
              if (autoRows.length > 0) {
                const autoPayload = buildReportDispatchPayloadFromOrgRows(
                  updatedOrgObj.name,
                  autoRows,
                  changeMessage,
                );
                void handleSendReportToApps(
                  autoPayload,
                  autoChannels.map((c) => c.id),
                ).catch(() => {});
              }
            }
          }

          // Proactive SSL Expiry Alerts
          if (
            !muted &&
            settingsRef.current.features?.sslExpiryAlertsEnabled !== false
          ) {
            const warnDays = settingsRef.current.sslWarningDays ?? 14;
            const expiringItems = allExecutedResults.filter(
              (item) =>
                item.ssl.checked &&
                item.ssl.valid &&
                typeof item.ssl.daysRemaining === 'number' &&
                item.ssl.daysRemaining <= warnDays,
            );
            const unseenExpiring = expiringItems.filter((item) => {
              const key = `${item.normalizedUrl}:${item.ssl.validTo || item.ssl.daysRemaining}`;
              return !sslWarnedCertsRef.current.has(key);
            });
            if (unseenExpiring.length > 0) {
              for (const item of unseenExpiring) {
                const key = `${item.normalizedUrl}:${item.ssl.validTo || item.ssl.daysRemaining}`;
                sslWarnedCertsRef.current.add(key);
              }
              const soonest = [...unseenExpiring].sort(
                (a, b) => (a.ssl.daysRemaining ?? 999) - (b.ssl.daysRemaining ?? 999),
              )[0];
              pushNotification({
                kind: 'ssl-expiry',
                title: `SSL Certificate Expiring Soon`,
                message:
                  unseenExpiring.length === 1
                    ? `${soonest.normalizedUrl} expires in ${soonest.ssl.daysRemaining}d`
                    : `${unseenExpiring.length} certificates expire within ${warnDays} days (soonest: ${soonest.ssl.daysRemaining}d)`,
                targetView: 'analytics',
                orgId: org.id,
                downCount: 0,
                firstIssueResult: soonest,
              });
            }
          }
        }

        if (
          updatedOrgObj &&
          (source === 'manual' || activeViewRef.current === 'organisation')
        ) {
          const reportRows: SimpleOrgSiteRow[] = [];
          const scopedProjects = sortProjectsByName(
            scope === 'all'
              ? updatedOrgObj.projects
              : updatedOrgObj.projects.filter((p) => p.id === scope),
          );
          for (const proj of scopedProjects) {
            for (const res of proj.lastResults || []) {
              reportRows.push({ projectName: proj.name, result: res });
            }
          }
          if (reportRows.length > 0) {
            const reportOnline = reportRows.filter(
              (r) => r.result.status === 'online',
            ).length;
            setPendingOrgReport({
              orgName: updatedOrgObj.name,
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
    [
      handleSaveIncidents,
      handleSaveOrganisations,
      handleSendReportToApps,
      pushNotification,
      runCheckBatch,
    ],
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

  // Sync Desktop System Tray settings, status summary, and tray Run command
  useEffect(() => {
    void window.upsiteDesktop?.setTraySettings?.({
      minimizeToTray: currentUser ? settings.minimizeToTray !== false : false,
    });
  }, [currentUser, settings.minimizeToTray]);

  useEffect(() => {
    if (!currentUser) {
      void window.upsiteDesktop?.updateTrayStatus?.({
        summary: 'Signed out',
        downCount: 0,
      });
      return;
    }

    let orgOnline = 0;
    let orgDown = 0;
    for (const org of organisations) {
      for (const proj of org.projects) {
        for (const res of proj.lastResults || []) {
          if (res.status === 'online') orgOnline += 1;
          else orgDown += 1;
        }
      }
    }

    const totalTracked = orgOnline + orgDown;
    const summary =
      totalTracked > 0
        ? orgDown > 0
          ? `${orgDown} down · ${orgOnline} online`
          : `All ${orgOnline} monitored sites online`
        : `${organisations.length} ${organisations.length === 1 ? 'organisation' : 'organisations'} ready`;

    void window.upsiteDesktop?.updateTrayStatus?.({
      summary,
      downCount: orgDown,
    });
  }, [currentUser, organisations]);

  useEffect(() => {
    const unsubscribe = window.upsiteDesktop?.onTrayRunOrg?.(() => {
      const orgs = organisationsRef.current.filter((o) =>
        o.projects.some((p) => p.urls.length > 0),
      );
      for (const org of orgs) {
        void executeOrgRunRef.current(org.id, 'all', 'manual');
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleUpdateSettings = useCallback(
    async (partial: Partial<UserSettings>) => {
      const optimistic: UserSettings = {
        ...settingsRef.current,
        ...partial,
        features: {
          ...settingsRef.current.features,
          ...(partial.features || {}),
        },
      };
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
          if (data.settings) setSettings(mergeWorkspaceSettings(data.settings));
          setSettingsSavedNotice(true);
          setTimeout(() => setSettingsSavedNotice(false), 1800);
        }
      } finally {
        setIsSavingSettings(false);
      }
    },
    [authHeaders, currentUser, handleSignOut],
  );

  // Sync Windows Launch-at-Startup preference with Electron desktop shell
  useEffect(() => {
    void window.upsiteDesktop?.setLaunchAtStartup?.(Boolean(settings.launchAtStartup));
  }, [settings.launchAtStartup]);

  // Redirect off Analytics if user disables the Analytics module in Settings
  useEffect(() => {
    if (settings.features?.analyticsEnabled === false && activeView === 'analytics') {
      setActiveView('checker');
    }
  }, [activeView, settings.features?.analyticsEnabled]);

  // Global Quick Command Search shortcut (Ctrl+K / Cmd+K)
  useEffect(() => {
    if (!currentUser || settings.features?.commandPaletteEnabled === false) {
      setCommandPaletteOpen(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUser, settings.features?.commandPaletteEnabled]);

  // Scheduled Digest Reports (manual & daily/weekly automated trigger)
  const handleSendDigestNow = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    const enabledChannels = (settingsRef.current.integrations || []).filter((c) => c.enabled);
    if (enabledChannels.length === 0) {
      return {
        ok: false,
        message: 'Enable at least one Connected App channel above first.',
      };
    }

    const digestRows: SimpleOrgSiteRow[] = [];
    for (const org of organisationsRef.current) {
      for (const proj of sortProjectsByName(org.projects)) {
        for (const res of proj.lastResults || []) {
          digestRows.push({ projectName: `${org.name} / ${proj.name}`, result: res });
        }
      }
    }

    if (digestRows.length === 0) {
      return {
        ok: false,
        message: 'Run at least one Organisation check first so the digest has live results.',
      };
    }

    const openIncidents = incidentsRef.current.filter((i) => i.status === 'open').length;
    const summaryLabel = `${organisationsRef.current.length} orgs · ${digestRows.length} sites · ${openIncidents} open ${openIncidents === 1 ? 'incident' : 'incidents'}`;
    const payload = buildReportDispatchPayloadFromOrgRows(
      'upsite Scheduled Digest',
      digestRows,
      summaryLabel,
    );

    const res = await handleSendReportToApps(
      payload,
      enabledChannels.map((c) => c.id),
    );
    if (res.sentCount > 0) {
      await handleUpdateSettings({ lastDigestSentAt: new Date().toISOString() });
      return {
        ok: true,
        message: `Digest delivered to ${res.sentCount} ${res.sentCount === 1 ? 'app' : 'apps'}.`,
      };
    }
    const firstErr = res.results.find((r) => !r.ok)?.error;
    return {
      ok: false,
      message: firstErr || 'No connected channels accepted the digest.',
    };
  }, [handleSendReportToApps, handleUpdateSettings]);

  useEffect(() => {
    if (
      !currentUser ||
      !settings.features?.digestReportsEnabled ||
      settings.digestSchedule === 'off'
    ) {
      return;
    }

    const periodMs =
      settings.digestSchedule === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    const checkAndSend = () => {
      if (digestInFlightRef.current) return;
      const lastTs = settingsRef.current.lastDigestSentAt
        ? Date.parse(settingsRef.current.lastDigestSentAt)
        : 0;
      if (lastTs && Date.now() - lastTs < periodMs) return;
      digestInFlightRef.current = true;
      void handleSendDigestNow()
        .catch(() => {})
        .finally(() => {
          digestInFlightRef.current = false;
        });
    };

    const timer = window.setInterval(checkAndSend, 60_000);
    return () => window.clearInterval(timer);
  }, [
    currentUser,
    handleSendDigestNow,
    settings.digestSchedule,
    settings.features?.digestReportsEnabled,
  ]);

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

  const handleDeduplicateHistory = async () => {
    setHistory((prev) => {
      const seen = new Set<string>();
      const ordered = [...prev].sort(
        (a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0),
      );
      const deduped: SiteCheckResult[] = [];
      for (const item of ordered) {
        const key = (item.normalizedUrl || item.inputUrl).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      return deduped;
    });
    if (!currentUser) return;
    try {
      const res = await fetch('/api/history/deduplicate', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.history)) {
          setHistory(data.history);
        }
      }
    } catch {
      // Optimistic state already updated
    }
  };

  if (isRestoringSession) {
    return (
      <div className="min-h-screen w-full bg-[#F3F5F8] dark:bg-[#111318] text-slate-600 dark:text-slate-400 flex items-center justify-center p-6">
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
            setIncidents(payload.workspace.incidents || []);
            setOrganisations(
              normalizeOrganisationsProjectOrder(payload.workspace.organisations || []),
            );
            setSettings(mergeWorkspaceSettings(payload.workspace.settings));
            skipCheckerSyncRef.current = true;
            setUrlInput(payload.workspace.checkerInput || '');
          }
        }}
      />
    );
  }

  const showAnalytics = settings.features?.analyticsEnabled !== false;
  const showCommandPalette = settings.features?.commandPaletteEnabled !== false;
  const openIncidentCount =
    settings.features?.incidentTrackingEnabled !== false
      ? incidents.filter((inc) => inc.status === 'open').length
      : 0;

  const pageTitle =
    activeView === 'checker'
      ? 'Website Checker'
      : activeView === 'organisation'
        ? 'Organisation Projects'
        : activeView === 'history'
          ? 'Check History'
          : activeView === 'analytics'
            ? 'Uptime & Latency Analytics'
            : 'Settings';

  const pageSubtitle =
    activeView === 'checker'
      ? 'Check single or multiple URLs for availability and inspect diagnostics'
      : activeView === 'organisation'
        ? 'Manage company organisations, multi-URL project records, and batch runs'
        : activeView === 'history'
          ? 'Review past website checks, outage incidents, and export reports'
          : activeView === 'analytics'
            ? 'Track uptime percentages, latency trends, expiring SSL certificates, and export a public status page'
            : 'Configure appearance, alert thresholds, optional features, and connected apps';

  const handleExportWorkspaceStatusPage = () => {
    const hasOrgResults = organisations.some((o) =>
      o.projects.some((p) => (p.lastResults || []).length > 0),
    );
    const fallbackResults =
      !hasOrgResults
        ? latestResults.length > 0
          ? latestResults
          : history.slice(0, 50)
        : undefined;
    exportStatusPageHtml({
      title: `${currentUser.username} — Service Status`,
      subtitle: `${organisations.length} organisations · Live availability & incident summary`,
      organisations,
      results: fallbackResults,
      incidents:
        settings.features?.incidentTrackingEnabled !== false ? incidents.slice(0, 20) : [],
    });
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-[#F3F5F8] dark:bg-[#111318] text-slate-900 dark:text-slate-100 flex flex-col md:flex-row">
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
        openIncidentCount={openIncidentCount}
        showAnalytics={showAnalytics}
        user={currentUser}
        onSignOut={() => setConfirmSignOutOpen(true)}
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        onResizeWidth={handleResizeSidebar}
        onToggleCollapse={handleToggleSidebarCollapse}
      />

      {/* Main Desktop Frame */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#F8FAFC] dark:bg-[#14171F]">
        {/* Top Bar */}
        <header className="h-14 px-4 sm:px-6 lg:px-8 border-b border-slate-200/90 dark:border-white/[0.06] bg-white/80 dark:bg-[#161920]/70 backdrop-blur-md flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {pageTitle}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
              {pageSubtitle}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {showCommandPalette && (
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Quick command search (Ctrl+K)"
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 bg-[#F3F5F8] dark:bg-white/[0.05] hover:bg-slate-200/80 dark:hover:bg-white/[0.1] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Search className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden md:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 px-1 rounded bg-white/80 dark:bg-black/30 border border-slate-200 dark:border-white/[0.08]">
                  Ctrl+K
                </kbd>
              </button>
            )}

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
          </div>
        </header>

        {/* Content + Optional Secondary Details Inspector */}
        <main className="relative flex-1 flex flex-row min-h-0 min-w-0 overflow-hidden">
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
              integrations={settings.integrations || []}
              onChangeStatusFilter={setCheckerStatusFilter}
              onRunCheck={handleRunChecker}
              onSelectResult={(item) => setSelectedResult(item)}
              onClearResults={handleClearResults}
              onSendToApps={handleSendReportToApps}
              onOpenIntegrationsSettings={() => setActiveView('settings')}
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
              integrations={settings.integrations || []}
              onChangeOpenedOrgId={setOpenedOrgId}
              onChangeStatusFilter={setOrgStatusFilter}
              onSaveOrganisations={handleSaveOrganisations}
              onRunOrgAll={(orgId) => executeOrgRun(orgId, 'all', 'manual')}
              onRunOrgProject={(orgId, projectId) => executeOrgRun(orgId, projectId, 'manual')}
              onSelectResult={(item) => setSelectedResult(item)}
              onDismissPendingReport={() => setPendingOrgReport(null)}
              onSendToApps={handleSendReportToApps}
              onOpenIntegrationsSettings={() => setActiveView('settings')}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              history={history}
              incidents={incidents}
              selectedId={selectedResult?.id ?? null}
              settings={settings}
              integrations={settings.integrations || []}
              onSelectResult={(item) => setSelectedResult(item)}
              onClearHistory={handleClearHistory}
              onClearIncidents={handleClearIncidents}
              onDeduplicateHistory={handleDeduplicateHistory}
              onSendToApps={handleSendReportToApps}
              onOpenIntegrationsSettings={() => setActiveView('settings')}
            />
          )}

          {activeView === 'analytics' && showAnalytics && (
            <AnalyticsView
              history={history}
              organisations={organisations}
              incidents={incidents}
              settings={settings}
              integrations={settings.integrations || []}
              onSelectResult={(item) => setSelectedResult(item)}
              onOpenOrganisation={(orgId) => {
                setActiveView('organisation');
                setOpenedOrgId(orgId);
              }}
              onOpenIncidentsTab={() => setActiveView('history')}
              onSendToApps={handleSendReportToApps}
              onOpenIntegrationsSettings={() => setActiveView('settings')}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              user={currentUser}
              settings={settings}
              isSaving={isSavingSettings}
              savedNotice={settingsSavedNotice}
              onUpdateSettings={handleUpdateSettings}
              onTestIntegration={handleTestIntegration}
              onSendDigestNow={handleSendDigestNow}
              onOpenCommandPalette={() => setCommandPaletteOpen(true)}
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

      {showCommandPalette && (
        <CommandPalette
          open={commandPaletteOpen}
          organisations={organisations}
          history={history}
          showAnalytics={showAnalytics}
          theme={settings.theme}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigateView={(view) => {
            if (view === 'organisation') setOpenedOrgId(null);
            setActiveView(view);
          }}
          onOpenOrganisation={(orgId) => {
            setActiveView('organisation');
            setOpenedOrgId(orgId);
          }}
          onInspectResult={(result) => setSelectedResult(result)}
          onRunAllOrganisations={() => {
            const orgs = organisationsRef.current.filter((o) =>
              o.projects.some((p) => p.urls.length > 0),
            );
            for (const org of orgs) {
              void executeOrgRun(org.id, 'all', 'manual');
            }
          }}
          onToggleTheme={() =>
            void handleUpdateSettings({
              theme: settings.theme === 'dark' ? 'light' : 'dark',
            })
          }
          onExportStatusPage={handleExportWorkspaceStatusPage}
        />
      )}

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
