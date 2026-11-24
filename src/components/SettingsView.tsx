import { Bell, Check, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthUser, UserSettings } from '../types/upsite';
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
}

export function SettingsView({
  user,
  settings,
  isSaving,
  savedNotice,
  onUpdateSettings,
}: SettingsViewProps) {
  const [customValue, setCustomValue] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<'min' | 'hr'>('min');
  const [customError, setCustomError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported',
  );

  const isPreset = AUTO_REFRESH_PRESETS.some((p) => p.value === settings.autoRefreshSec);

  const handleApplyCustomPeriod = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseCustomIntervalSeconds(customValue, customUnit);
    if (!parsed) {
      setCustomError('Enter a time period between 1 min and 24 hr.');
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

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-3xl space-y-6">
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
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] px-5 py-4 space-y-3">
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
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Color Theme
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch between Light and Dark interface modes.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: 'dark' })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.theme === 'dark'
                    ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
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
                    ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sun className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Light</span>
              </button>
            </div>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Result Row Density
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use compact rows when scanning large bulk lists or organisation projects.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
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
                      ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
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
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Request Timeout
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Maximum time to wait per URL before marking a site as timed out.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
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
                      ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Slow Response Warning
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Flag online sites that exceed this latency threshold so performance drops stand out.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
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
                      ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Check Timer (Frequency)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Active timer: {formatIntervalLabel(settings.autoRefreshSec)} · How frequently the active Checker batch re-runs.
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
                {AUTO_REFRESH_PRESETS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setCustomError(null);
                      onUpdateSettings({ autoRefreshSec: opt.value });
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                      settings.autoRefreshSec === opt.value
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
              onSubmit={handleApplyCustomPeriod}
              className="flex flex-wrap items-center justify-between gap-3 pt-1"
            >
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {!isPreset && settings.autoRefreshSec > 0
                  ? `Custom timer active: Every ${formatIntervalLabel(settings.autoRefreshSec)}`
                  : 'Custom timer frequency (1 min – 24 hr)'}
              </span>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={customUnit === 'hr' ? 24 : 1440}
                  value={customValue}
                  onChange={(e) => {
                    setCustomValue(e.target.value);
                    setCustomError(null);
                  }}
                  placeholder="e.g. 15"
                  aria-label="Custom timer frequency value"
                  className="w-24 rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                />
                <select
                  aria-label="Custom timer frequency unit"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as 'min' | 'hr')}
                  className="rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                >
                  <option value="min">min</option>
                  <option value="hr">hr</option>
                </select>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.1] dark:hover:bg-white/[0.16] text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Apply
                </button>
              </div>
            </form>

            {customError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{customError}</p>
            )}

            <div className="pt-3 border-t border-slate-200 dark:border-white/[0.06]">
              <CheckWindowPicker
                title="Check Time Period"
                description="Choose start and end day and time (e.g. Monday 12:00 AM to Sunday 11:59 PM) when scheduled checks may run."
                value={settings.checkWindow}
                onChange={(checkWindow) => onUpdateSettings({ checkWindow })}
              />
            </div>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Default URL Protocol
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scheme automatically prepended when entering bare domains like example.com.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
              {(['https', 'http'] as const).map((proto) => (
                <button
                  key={proto}
                  type="button"
                  onClick={() => onUpdateSettings({ defaultProtocol: proto })}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                    settings.defaultProtocol === proto
                      ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {proto}://
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                SSL & Deep Inspection
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspect TLS certificate issuer and expiry, or skip for faster HTTP-only Up/Down sweeps.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => onUpdateSettings({ deepInspect: true })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  settings.deepInspect
                    ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
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
                    ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Fast Up/Down
              </button>
            </div>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
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
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-slate-100 dark:bg-[#10121C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {settings.autoInspectFirstIssue ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#171A28] divide-y divide-slate-200 dark:divide-white/[0.06]">
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Organisation Check Alerts & Notifications
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Alerts come from Organisation checks and scheduled timer updates (with View now navigation).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.desktopNotifications !== false}
              onClick={() =>
                onUpdateSettings({
                  desktopNotifications: settings.desktopNotifications === false,
                })
              }
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                settings.desktopNotifications !== false
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-slate-100 dark:bg-[#10121C] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]'
              }`}
            >
              {settings.desktopNotifications !== false ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Desktop System Alerts
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {permissionState === 'granted'
                  ? 'Desktop notifications are permitted on this device.'
                  : permissionState === 'denied'
                    ? 'Desktop notifications are blocked in browser/OS settings.'
                    : permissionState === 'unsupported'
                      ? 'In-app notifications remain active.'
                      : 'Allow native OS notifications when checks complete in the background.'}
              </p>
            </div>
            {permissionState === 'default' && (
              <button
                type="button"
                onClick={() => void handleRequestDesktopPermission()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.1] dark:hover:bg-white/[0.16] text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Bell className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>Enable OS Alerts</span>
              </button>
            )}
            {permissionState !== 'default' && (
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                {permissionState === 'granted'
                  ? 'Allowed'
                  : permissionState === 'denied'
                    ? 'Blocked'
                    : 'In-app only'}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
