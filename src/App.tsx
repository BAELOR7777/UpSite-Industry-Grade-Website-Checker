import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckerView, parseUrlsFromInput } from './components/CheckerView';
import { HistoryView } from './components/HistoryView';
import { LoginView } from './components/LoginView';
import { OrganisationView } from './components/OrganisationView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { SiteInspector } from './components/SiteInspector';
import type {
  ActiveView,
  AuthUser,
  Organisation,
  SiteCheckResult,
  UserSettings,
} from './types/upsite';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeoutMs: 8500,
  defaultProtocol: 'https',
  slowThresholdMs: 1000,
  autoInspectFirstIssue: false,
  autoRefreshSec: 0,
  density: 'comfortable',
  deepInspect: true,
};

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('checker');
  const [urlInput, setUrlInput] = useState<string>('');
  const [latestResults, setLatestResults] = useState<SiteCheckResult[]>([]);
  const [history, setHistory] = useState<SiteCheckResult[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  const [selectedResult, setSelectedResult] = useState<SiteCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [settingsSavedNotice, setSettingsSavedNotice] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefreshRemaining, setAutoRefreshRemaining] = useState<number | null>(null);

  const authHeaders = useCallback(
    (tokenOverride?: string): Record<string, string> => {
      const tok = tokenOverride ?? sessionToken;
      return tok
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }
        : { 'Content-Type': 'application/json' };
    },
    [sessionToken],
  );

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const handleSignOut = useCallback(() => {
    setSessionToken(null);
    setCurrentUser(null);
    setLatestResults([]);
    setHistory([]);
    setOrganisations([]);
    setSelectedResult(null);
    setErrorMessage(null);
    setAutoRefreshRemaining(null);
    setActiveView('checker');
  }, []);

  const runCheckBatch = useCallback(
    async (urls: string[], updateCheckerState: boolean): Promise<SiteCheckResult[]> => {
      if (!sessionToken || urls.length === 0) return [];
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
      handleSignOut,
      sessionToken,
      settings.autoInspectFirstIssue,
      settings.deepInspect,
      settings.defaultProtocol,
      settings.timeoutMs,
    ],
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
      !sessionToken ||
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
        if (!isChecking && latestUrlsRef.current.length > 0) {
          void handleRunChecker(latestUrlsRef.current);
        }
      }
      setAutoRefreshRemaining(remaining);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    activeView,
    handleRunChecker,
    isChecking,
    latestResults.length,
    sessionToken,
    settings.autoRefreshSec,
  ]);

  const handleRecheckSingle = async (url: string) => {
    if (!sessionToken) return;
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

  const handleSaveOrganisations = async (nextOrgs: Organisation[]) => {
    setOrganisations(nextOrgs);
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/organisations', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ organisations: nextOrgs }),
      });
      if (res.status === 401) {
        handleSignOut();
      }
    } catch {
      // Keep local state updated
    }
  };

  const handleUpdateSettings = async (partial: Partial<UserSettings>) => {
    const optimistic = { ...settings, ...partial };
    setSettings(optimistic);
    if (!sessionToken) return;

    setIsSavingSettings(true);
    setSettingsSavedNotice(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
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
    if (!sessionToken) return;
    await fetch('/api/history', {
      method: 'DELETE',
      headers: authHeaders(),
    }).catch(() => {});
  };

  if (!sessionToken || !currentUser) {
    return (
      <LoginView
        onAuthenticated={(payload) => {
          setSessionToken(payload.sessionToken);
          setCurrentUser(payload.user);
          if (payload.workspace) {
            setHistory(payload.workspace.history || []);
            setOrganisations(payload.workspace.organisations || []);
            setSettings({ ...DEFAULT_SETTINGS, ...(payload.workspace.settings || {}) });
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
          setActiveView(view);
          if (view === 'settings') setSelectedResult(null);
        }}
        latestResults={latestResults}
        historyCount={history.length}
        organisationCount={organisations.length}
        user={currentUser}
        onSignOut={handleSignOut}
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
        </header>

        {/* Content + Optional Secondary Details Inspector */}
        <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {activeView === 'checker' && (
            <CheckerView
              urlInput={urlInput}
              onChangeUrlInput={setUrlInput}
              results={latestResults}
              selectedId={selectedResult?.id ?? null}
              isChecking={isChecking}
              errorMessage={errorMessage}
              settings={settings}
              autoRefreshRemaining={autoRefreshRemaining}
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
              onSaveOrganisations={handleSaveOrganisations}
              onRunBatchUrls={(urls) => runCheckBatch(urls, false)}
              onSelectResult={(item) => setSelectedResult(item)}
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
    </div>
  );
}
