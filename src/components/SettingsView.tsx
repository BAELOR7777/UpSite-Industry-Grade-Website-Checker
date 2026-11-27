import {
  Bell,
  BellOff,
  Check,
  Command,
  Loader2,
  Minimize2,
  Moon,
  Plus,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AuthUser,
  FeaturePreferences,
  IntegrationChannel,
  IntegrationProvider,
  UserSettings,
} from '../types/upsite';
import {
  AUTO_REFRESH_PRESETS,
  formatIntervalLabel,
  parseCustomIntervalSeconds,
} from '../utils/intervals';
import { CheckWindowPicker } from './CheckWindowPicker';

interface SettingsViewProps {
  user: AuthUser;
  settings: UserSettings;
  isSaving: boolean;
  savedNotice: boolean;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onTestIntegration: (channel: {
    provider: IntegrationProvider;
    webhookUrl: string;
    name: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onSendDigestNow?: () => Promise<{ ok: boolean; message: string }>;
  onOpenCommandPalette?: () => void;
}

const PROVIDER_META: Record<
  IntegrationProvider,
  { label: string; placeholder: string; hint: string }
> = {
  teams: {
    label: 'Microsoft Teams',
    placeholder: 'https://prod-xx.westus.logic.azure.com:443/workflows/...',
    hint: 'Create a Workflows "Post to a channel when a webhook request is received" URL or Incoming Webhook in Microsoft Teams.',
  },
  slack: {
    label: 'Slack',
    placeholder: 'https://hooks.slack.com/services/T000/B000/...',
    hint: 'Create an Incoming Webhook in your Slack App settings.',
  },
  discord: {
    label: 'Discord',
    placeholder: 'https://discord.com/api/webhooks/...',
    hint: 'Open Channel Settings -> Integrations -> Webhooks in Discord.',
  },
  webhook: {
    label: 'Custom Webhook',
    placeholder: 'https://hooks.example.com/upsite-reports',
    hint: 'Receives structured JSON report payloads via HTTPS POST.',
  },
};

function maskWebhookUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const tail = raw.length > 26 ? `...${raw.slice(-8)}` : '';
    return `${u.protocol}//${u.hostname}${u.pathname.slice(0, 14)}${tail}`;
  } catch {
    return raw.slice(0, 32);
  }
}

export function SettingsView({
  user,
  settings,
  isSaving,
  savedNotice,
  onUpdateSettings,
  onTestIntegration,
  onSendDigestNow,
  onOpenCommandPalette,
}: SettingsViewProps) {
  const [customValue, setCustomValue] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<'min' | 'hr'>('min');
  const [customError, setCustomError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported',
  );

  const [channelName, setChannelName] = useState('');
  const [channelProvider, setChannelProvider] = useState<IntegrationProvider>('teams');
  const [channelWebhookUrl, setChannelWebhookUrl] = useState('');
  const [channelAutoSend, setChannelAutoSend] = useState(true);
  const [channelOnlyIssues, setChannelOnlyIssues] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const [sendingDigest, setSendingDigest] = useState(false);
  const [digestFeedback, setDigestFeedback] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const isDesktopBridge =
    typeof window !== 'undefined' && Boolean(window.upsiteDesktop?.showNotification);
  const hasTrayBridge =
    typeof window !== 'undefined' && Boolean(window.upsiteDesktop?.minimizeToTrayNow);
  const hasStartupBridge =
    typeof window !== 'undefined' && Boolean(window.upsiteDesktop?.setLaunchAtStartup);

  const integrations = settings.integrations || [];
  const features: FeaturePreferences = {
    analyticsEnabled: settings.features?.analyticsEnabled !== false,
    incidentTrackingEnabled: settings.features?.incidentTrackingEnabled !== false,
    sslExpiryAlertsEnabled: settings.features?.sslExpiryAlertsEnabled !== false,
    keywordChecksEnabled: settings.features?.keywordChecksEnabled !== false,
    customCheckRulesEnabled: settings.features?.customCheckRulesEnabled !== false,
    maintenanceWindowsEnabled: settings.features?.maintenanceWindowsEnabled !== false,
    digestReportsEnabled: Boolean(settings.features?.digestReportsEnabled),
    commandPaletteEnabled: settings.features?.commandPaletteEnabled !== false,
  };

  const handleToggleFeature = (key: keyof FeaturePreferences) => {
    onUpdateSettings({
      features: {
        ...features,
        [key]: !features[key],
      },
    });
  };

  const globalMaintenanceActive = Boolean(
    settings.workspaceMaintenanceUntil &&
      Date.parse(settings.workspaceMaintenanceUntil) > Date.now(),
  );

  const handleTriggerDigestNow = async () => {
    if (!onSendDigestNow || sendingDigest) return;
    setSendingDigest(true);
    setDigestFeedback(null);
    try {
      const result = await onSendDigestNow();
      setDigestFeedback(result);
    } catch (err: unknown) {
      setDigestFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to send digest.',
      });
    } finally {
      setSendingDigest(false);
    }
  };

  const handleAddIntegration = (e: FormEvent) => {
    e.preventDefault();
    setChannelError(null);
    const trimmedUrl = channelWebhookUrl.trim();
    if (!trimmedUrl) {
      setChannelError('Enter an HTTPS webhook URL.');
      return;
    }
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'https:') {
        setChannelError('Webhook URL must use https:// for secure delivery.');
        return;
      }
    } catch {
      setChannelError('Enter a valid webhook URL.');
      return;
    }

    const newChannel: IntegrationChannel = {
      id: crypto.randomUUID(),
      name: channelName.trim() || PROVIDER_META[channelProvider].label,
      provider: channelProvider,
      webhookUrl: trimmedUrl,
      enabled: true,
      autoSendOnOrgRun: channelAutoSend,
      onlyOnIssues: channelOnlyIssues,
    };

    onUpdateSettings({
      integrations: [...integrations, newChannel],
    });
    setChannelName('');
    setChannelWebhookUrl('');
  };

  const handleUpdateChannel = (
    id: string,
    patch: Partial<IntegrationChannel>,
  ) => {
    onUpdateSettings({
      integrations: integrations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const handleDeleteChannel = (id: string) => {
    onUpdateSettings({
      integrations: integrations.filter((c) => c.id !== id),
    });
  };

  const handleRunChannelTest = async (channel: IntegrationChannel) => {
    setTestingId(channel.id);
    try {
      const res = await onTestIntegration({
        provider: channel.provider,
        webhookUrl: channel.webhookUrl,
        name: channel.name,
      });
      setTestFeedback((prev) => ({
        ...prev,
        [channel.id]: {
          ok: res.ok,
          message: res.ok ? 'Test card delivered.' : res.error || 'Delivery failed.',
        },
      }));
    } catch (err: unknown) {
      setTestFeedback((prev) => ({
        ...prev,
        [channel.id]: {
          ok: false,
          message: err instanceof Error ? err.message : 'Unable to reach webhook.',
        },
      }));
    } finally {
      setTestingId((prev) => (prev === channel.id ? null : prev));
    }
  };

  const handleApplyCustomPeriod = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseCustomIntervalSeconds(customValue, customUnit);
    if (!parsed) {
      setCustomError('Enter a timer between 1 min and 24 hr.');
      return;
    }
    setCustomError(null);
    onUpdateSettings({ autoRefreshSec: parsed });
    setCustomValue('');
  };

  const handleRequestDesktopPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const next = await window.Notification.requestPermission();
      setPermissionState(next);
      if (next === 'granted' && !settings.desktopNotifications) {
        onUpdateSettings({ desktopNotifications: true });
      }
    } catch {
      // Ignore permission rejection
    }
  };

  const handleToggleAlerts = () => {
    const nextEnabled = settings.desktopNotifications === false;
    onUpdateSettings({ desktopNotifications: nextEnabled });
    if (nextEnabled && !isDesktopBridge && permissionState === 'default') {
      void handleRequestDesktopPermission();
    }
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-7">
      <div className="max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Workspace & Productivity Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Preferences are saved to your account and directly control how checks execute and display.
            </p>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
              <Check className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Saved</span>
            </span>
          )}
          {isSaving && !savedNotice && (
            <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">Saving...</span>
          )}
        </div>

        {/* Account & Bonded Workspace */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] px-4 sm:px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {user.username}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  All organisations, projects, check history, URLs, and preferences are saved and bonded to this account.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
              {user.authType === 'account' ? 'Saved Account' : 'Token Session'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-white/[0.06] text-xs">
            <div>
              <span className="text-slate-400 dark:text-slate-500 block">Username</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{user.username}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 block">Bound Access Token</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">{user.tokenMask}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 block">Account Created</span>
              <span className="tabular-nums text-slate-800 dark:text-slate-200">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Active'}
              </span>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Color Theme
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch between Light and Dark interface modes.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'dark' })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.theme === 'dark'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Moon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'light' })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.theme === 'light'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sun className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Light</span>
              </button>
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Result Row Density
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use compact rows when scanning large bulk lists or organisation projects.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { id: 'comfortable', label: 'Comfortable' },
                  { id: 'compact', label: 'Compact' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateSettings({ density: opt.id })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    settings.density === opt.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Productivity & Checking Behaviour */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Request Timeout
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Maximum time to wait per URL before marking a site as timed out.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { value: 5000, label: '5s Fast' },
                  { value: 8500, label: '8.5s Balanced' },
                  { value: 15000, label: '15s Slow' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ timeoutMs: opt.value })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                    settings.timeoutMs === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Slow Response Warning
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Flag online sites that exceed this latency threshold so performance drops stand out.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { value: 0, label: 'Off' },
                  { value: 500, label: '500 ms' },
                  { value: 1000, label: '1000 ms' },
                  { value: 2000, label: '2000 ms' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ slowThresholdMs: opt.value })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                    settings.slowThresholdMs === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Simplified Timer & Time Period Bar */}
          <div className="px-4 sm:px-5 py-4 space-y-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Timer ({formatIntervalLabel(settings.autoRefreshSec)})
                </p>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · How frequently Checker re-runs
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08] px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  {AUTO_REFRESH_PRESETS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setCustomError(null);
                        onUpdateSettings({ autoRefreshSec: opt.value });
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        settings.autoRefreshSec === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/70 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleApplyCustomPeriod} className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={customUnit === 'hr' ? 24 : 1440}
                    value={customValue}
                    onChange={(e) => {
                      setCustomValue(e.target.value);
                      setCustomError(null);
                    }}
                    placeholder="Custom"
                    aria-label="Custom timer frequency value"
                    className="w-20 rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <select
                    aria-label="Custom timer frequency unit"
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value as 'min' | 'hr')}
                    className="rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="min">min</option>
                    <option value="hr">hr</option>
                  </select>
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.12] dark:hover:bg-white/[0.18] text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    Set
                  </button>
                </form>
              </div>

              {customError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{customError}</p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06]">
              <CheckWindowPicker
                title="Time Period"
                value={settings.checkWindow}
                onChange={(checkWindow) => onUpdateSettings({ checkWindow })}
              />
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Default URL Protocol
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scheme automatically prepended when entering bare domains like example.com.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(['https', 'http'] as const).map((proto) => (
                <button
                  key={proto}
                  type="button"
                  onClick={() => onUpdateSettings({ defaultProtocol: proto })}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                    settings.defaultProtocol === proto
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {proto}://
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                SSL & Deep Inspection
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspect TLS certificate issuer and expiry, or skip for faster HTTP-only Up/Down sweeps.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => onUpdateSettings({ deepInspect: true })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.deepInspect
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Full Diagnostics
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ deepInspect: false })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  !settings.deepInspect
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Fast Up/Down
              </button>
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Auto-Inspect First Issue
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatically open the diagnostics drawer on the first Offline or Error site after a check run.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoInspectFirstIssue}
              onClick={() =>
                onUpdateSettings({
                  autoInspectFirstIssue: !settings.autoInspectFirstIssue,
                })
              }
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                settings.autoInspectFirstIssue
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {settings.autoInspectFirstIssue ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Organisation Check Alerts & Notifications
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scheduled Organisation timer checks send native alerts even when minimized or using another app.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.desktopNotifications !== false}
              onClick={handleToggleAlerts}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                settings.desktopNotifications !== false
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {settings.desktopNotifications !== false ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Desktop System Alerts
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isDesktopBridge
                  ? 'Native desktop notifications active — alerts work even when minimized or outside upsite.'
                  : permissionState === 'granted'
                    ? 'Desktop notifications are permitted on this device.'
                    : permissionState === 'denied'
                      ? 'Desktop notifications are blocked in browser/OS settings.'
                      : permissionState === 'unsupported'
                        ? 'In-app notifications remain active.'
                        : 'Allow OS notifications so alerts still appear when minimized or in another app.'}
              </p>
            </div>
            {!isDesktopBridge && permissionState === 'default' && (
              <button
                type="button"
                onClick={() => void handleRequestDesktopPermission()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Bell className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Enable OS Alerts</span>
              </button>
            )}
            {(isDesktopBridge || permissionState !== 'default') && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
                {isDesktopBridge || permissionState === 'granted'
                  ? 'Active'
                  : permissionState === 'denied'
                    ? 'Blocked'
                    : 'In-app only'}
              </span>
            )}
          </div>

          {/* System Tray & Background Mode */}
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Minimize to System Tray
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {hasTrayBridge
                  ? 'Keep upsite running in the system tray when minimized or closed so Organisation checks continue quietly.'
                  : 'Available when running the upsite Windows desktop app — keeps scheduled monitors running in the system tray.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasTrayBridge && (
                <button
                  type="button"
                  onClick={() => void window.upsiteDesktop?.minimizeToTrayNow?.()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
                >
                  <Minimize2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  <span>Minimize Now</span>
                </button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={settings.minimizeToTray !== false}
                onClick={() =>
                  onUpdateSettings({
                    minimizeToTray: settings.minimizeToTray === false,
                  })
                }
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  settings.minimizeToTray !== false
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
                }`}
              >
                {settings.minimizeToTray !== false ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          {/* Launch at Windows Startup */}
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Launch at Windows Startup
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {hasStartupBridge
                  ? 'Automatically start upsite minimized to the system tray when you sign in to Windows.'
                  : 'Available when running the upsite Windows desktop app — starts quietly in the tray at login.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(settings.launchAtStartup)}
              onClick={() =>
                onUpdateSettings({
                  launchAtStartup: !settings.launchAtStartup,
                })
              }
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                settings.launchAtStartup
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {settings.launchAtStartup ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </section>

        {/* Alert Thresholds, SSL Expiry & Maintenance */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 space-y-1">
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Alert Filtering, SSL Warnings & Maintenance
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reduce false-positive noise on scheduled Organisation runs, tune SSL expiry lead time, or pause alerts globally.
            </p>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Consecutive Failures Before Alerting
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Require repeated failed scheduled runs for an endpoint before firing a downtime alert.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { value: 1, label: '1 (Immediate)' },
                  { value: 2, label: '2 runs' },
                  { value: 3, label: '3 runs' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ alertConsecutiveFailures: opt.value })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                    (settings.alertConsecutiveFailures ?? 1) === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Alert Cooldown Period
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Minimum wait between repeat alerts for the same Organisation during ongoing downtime.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { value: 0, label: 'Off' },
                  { value: 5, label: '5m' },
                  { value: 15, label: '15m' },
                  { value: 30, label: '30m' },
                  { value: 60, label: '60m' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ alertCooldownMin: opt.value })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                    (settings.alertCooldownMin ?? 0) === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {features.sslExpiryAlertsEnabled && (
            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  SSL Expiry Warning Lead Time
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Highlight and alert on HTTPS certificates expiring within this many days.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
                {(
                  [
                    { value: 7, label: '7 days' },
                    { value: 14, label: '14 days' },
                    { value: 30, label: '30 days' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateSettings({ sslWarningDays: opt.value })}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                      (settings.sslWarningDays ?? 14) === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {features.maintenanceWindowsEnabled && (
            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" strokeWidth={1.75} />
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Global Maintenance Mute (All Organisations)
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {globalMaintenanceActive && settings.workspaceMaintenanceUntil
                    ? `All workspace alerts muted until ${new Date(settings.workspaceMaintenanceUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
                    : 'Temporarily silence notifications and webhook dispatches across all organisations.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {globalMaintenanceActive ? (
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ workspaceMaintenanceUntil: undefined })}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    Resume All Alerts
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          workspaceMaintenanceUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
                        })
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
                    >
                      Mute 1h
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          workspaceMaintenanceUntil: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
                        })
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
                    >
                      Mute 4h
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Connected Apps & Integrations (Teams, Slack, Discord, Webhook) */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 space-y-1">
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Connected Apps & Report Channels
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Connect Microsoft Teams, Slack, Discord, or custom HTTPS webhooks to send availability reports manually or automatically after scheduled Organisation runs.
            </p>
          </div>

          {integrations.length > 0 && (
            <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
              {integrations.map((channel) => {
                const feedback = testFeedback[channel.id];
                const isTesting = testingId === channel.id;
                return (
                  <div key={channel.id} className="px-4 sm:px-5 py-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {channel.name}
                          </span>
                          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                            · {PROVIDER_META[channel.provider].label}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {maskWebhookUrl(channel.webhookUrl)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isTesting}
                          onClick={() => void handleRunChannelTest(channel)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
                        >
                          {isTesting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
                          ) : (
                            <Send className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                          )}
                          <span>{isTesting ? 'Testing...' : 'Test'}</span>
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={channel.enabled}
                          onClick={() =>
                            handleUpdateChannel(channel.id, { enabled: !channel.enabled })
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                            channel.enabled
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
                          }`}
                        >
                          {channel.enabled ? 'Enabled' : 'Paused'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteChannel(channel.id)}
                          aria-label={`Remove ${channel.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={channel.autoSendOnOrgRun}
                          onChange={(e) =>
                            handleUpdateChannel(channel.id, {
                              autoSendOnOrgRun: e.target.checked,
                            })
                          }
                          className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/[0.2] accent-blue-600 cursor-pointer"
                        />
                        <span>Auto-send after scheduled Organisation runs</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={channel.onlyOnIssues}
                          onChange={(e) =>
                            handleUpdateChannel(channel.id, {
                              onlyOnIssues: e.target.checked,
                            })
                          }
                          className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/[0.2] accent-blue-600 cursor-pointer"
                        />
                        <span>Only auto-send when sites are down</span>
                      </label>
                    </div>

                    {feedback && (
                      <p
                        className={`text-xs font-medium ${
                          feedback.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {feedback.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleAddIntegration} className="px-4 sm:px-5 py-4 space-y-3">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Add App Channel
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="integration-provider"
                  className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  App / Service
                </label>
                <select
                  id="integration-provider"
                  value={channelProvider}
                  onChange={(e) => setChannelProvider(e.target.value as IntegrationProvider)}
                  className="w-full rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="teams">Microsoft Teams</option>
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="webhook">Custom Webhook</option>
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label
                  htmlFor="integration-name"
                  className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
                >
                  Channel Label
                </label>
                <input
                  id="integration-name"
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder={`e.g. ${PROVIDER_META[channelProvider].label} — Ops Alerts`}
                  className="w-full rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="integration-webhook-url"
                className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
              >
                Webhook URL (HTTPS)
              </label>
              <input
                id="integration-webhook-url"
                type="url"
                value={channelWebhookUrl}
                onChange={(e) => {
                  setChannelWebhookUrl(e.target.value);
                  setChannelError(null);
                }}
                placeholder={PROVIDER_META[channelProvider].placeholder}
                className="w-full rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {PROVIDER_META[channelProvider].hint}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={channelAutoSend}
                    onChange={(e) => setChannelAutoSend(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/[0.2] accent-blue-600 cursor-pointer"
                  />
                  <span>Auto-send on scheduled Org runs</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={channelOnlyIssues}
                    onChange={(e) => setChannelOnlyIssues(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-white/[0.2] accent-blue-600 cursor-pointer"
                  />
                  <span>Only when issues exist</span>
                </label>
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                <span>Add Channel</span>
              </button>
            </div>

            {channelError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{channelError}</p>
            )}
          </form>
        </section>

        {/* Scheduled Digest Reports */}
        {features.digestReportsEnabled && (
          <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Scheduled Digest Reports
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Send an automated availability summary across all Organisations to your enabled app channels.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.07]">
                {(
                  [
                    { value: 'off', label: 'Off' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateSettings({ digestSchedule: opt.value })}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      (settings.digestSchedule ?? 'off') === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {settings.lastDigestSentAt
                    ? `Last digest sent: ${new Date(settings.lastDigestSentAt).toLocaleString()}`
                    : 'No digest summary sent yet.'}
                </p>
                {digestFeedback && (
                  <p
                    className={`text-xs font-medium ${
                      digestFeedback.ok
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {digestFeedback.message}
                  </p>
                )}
              </div>

              {onSendDigestNow && (
                <button
                  type="button"
                  disabled={sendingDigest}
                  onClick={() => void handleTriggerDigestNow()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
                >
                  {sendingDigest ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={2} />
                  ) : (
                    <Send className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{sendingDigest ? 'Sending...' : 'Send Digest Now'}</span>
                </button>
              )}
            </div>
          </section>
        )}

        {/* Optional Features & Modules */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#1B1F28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" strokeWidth={1.8} />
                <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Optional Features & Modules
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keep only the tools you use. Turning any module off hides its controls without deleting your saved data.
              </p>
            </div>
            {features.commandPaletteEnabled && onOpenCommandPalette && (
              <button
                type="button"
                onClick={onOpenCommandPalette}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.12] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
              >
                <Command className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Open Quick Search</span>
              </button>
            )}
          </div>

          {(
            [
              {
                key: 'analyticsEnabled',
                label: 'Analytics Dashboard & HTML Status Page',
                description:
                  'Show uptime %, latency trend charts, slowest endpoints, and shareable HTML Status Page export.',
              },
              {
                key: 'incidentTrackingEnabled',
                label: 'Incident Timeline & Downtime Tracking',
                description:
                  'Automatically log outages and recovery times in History -> Incidents.',
              },
              {
                key: 'sslExpiryAlertsEnabled',
                label: 'Proactive SSL Expiry Alerts',
                description:
                  'Warn ahead of time when monitored HTTPS certificates approach expiration.',
              },
              {
                key: 'keywordChecksEnabled',
                label: 'Keyword & Content Verification',
                description:
                  'Verify expected or forbidden text inside response bodies on Checker and Project rules.',
              },
              {
                key: 'customCheckRulesEnabled',
                label: 'Custom Project Check Rules (Method / Status / Headers)',
                description:
                  'Configure GET/HEAD/POST methods, accepted status codes, and custom headers per Project.',
              },
              {
                key: 'maintenanceWindowsEnabled',
                label: 'Maintenance Windows (Mute Alerts)',
                description:
                  'Allow muting downtime notifications for an Organisation or the whole workspace.',
              },
              {
                key: 'digestReportsEnabled',
                label: 'Scheduled Digest Reports',
                description:
                  'Enable daily or weekly workspace summary dispatches to Teams, Slack, Discord, or webhooks.',
              },
              {
                key: 'commandPaletteEnabled',
                label: 'Quick Command Search (Ctrl+K / ⌘K)',
                description:
                  'Jump to any Organisation, Project, URL, or action from anywhere in the app.',
              },
            ] as Array<{ key: keyof FeaturePreferences; label: string; description: string }>
          ).map((item) => {
            const enabled = features[item.key];
            return (
              <div
                key={item.key}
                className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-0.5 min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {item.description}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => handleToggleFeature(item.key)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    enabled
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-[#F3F5F8] dark:bg-[#12151C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
                  }`}
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
