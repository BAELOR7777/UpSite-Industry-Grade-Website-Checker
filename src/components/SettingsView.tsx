import { Check, Moon, Sun } from 'lucide-react';
import type { UserSettings } from '../types/upsite';

interface SettingsViewProps {
  settings: UserSettings;
  isSaving: boolean;
  savedNotice: boolean;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
}

export function SettingsView({
  settings,
  isSaving,
  savedNotice,
  onUpdateSettings,
}: SettingsViewProps) {
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

          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Checker Auto-Refresh
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatically re-check the active Checker batch on a repeating cycle (per-organisation schedules are inside Organisation).
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
              {(
                [
                  { value: 0, label: 'Off' },
                  { value: 300, label: '5 min' },
                  { value: 600, label: '10 min' },
                  { value: 3600, label: '1 hr' },
                  { value: 14400, label: '4 hr' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateSettings({ autoRefreshSec: opt.value })}
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
      </div>
    </div>
  );
}
