import {
  Activity,
  Building2,
  Clock,
  Globe,
  LogOut,
  Settings,
} from 'lucide-react';
import type { ActiveView, AuthUser, SiteCheckResult } from '../types/upsite';

interface SidebarProps {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  latestResults: SiteCheckResult[];
  historyCount: number;
  organisationCount: number;
  user: AuthUser;
  onSignOut: () => void;
}

export function Sidebar({
  activeView,
  onChangeView,
  latestResults,
  historyCount,
  organisationCount,
  user,
  onSignOut,
}: SidebarProps) {
  const onlineCount = latestResults.filter((r) => r.status === 'online').length;
  const downCount = latestResults.filter((r) => r.status !== 'online').length;

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: typeof Globe;
    count?: number;
  }> = [
    { id: 'checker', label: 'Checker', icon: Globe },
    { id: 'organisation', label: 'Organisation', icon: Building2, count: organisationCount },
    { id: 'history', label: 'History', icon: Clock, count: historyCount },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-full md:w-60 shrink-0 bg-white dark:bg-[#151824] border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/[0.07] flex flex-col justify-between">
      <div>
        {/* Brand Header */}
        <div className="h-14 md:h-16 px-5 md:px-6 flex items-center justify-between md:justify-start gap-3 border-b border-slate-200 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center text-slate-900 dark:text-slate-100 shrink-0">
              <Activity className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
              upsite
            </span>
          </div>
          <div className="flex items-center gap-3 md:hidden">
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {onlineCount} up · {downCount} down
            </span>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-3 py-3 md:px-4 md:py-6 flex md:block items-center gap-2 overflow-x-auto md:space-y-6">
          <div className="flex md:block items-center gap-1 md:gap-0">
            <p className="hidden md:block px-3 mb-2 text-xs font-medium text-slate-400 dark:text-slate-500">
              Workspace
            </p>
            <nav className="flex md:block items-center gap-1 md:space-y-1" aria-label="Primary navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeView(item.id)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 md:py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                      isActive
                        ? 'bg-slate-100 text-slate-900 dark:bg-white/[0.08] dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.count === 'number' && item.count > 0 && (
                      <span className="text-xs text-slate-400 tabular-nums shrink-0">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* Bottom Summary & User Session */}
      <div className="hidden md:block border-t border-slate-200 dark:border-white/[0.06]">
        <div className="p-5 space-y-2 text-xs border-b border-slate-200 dark:border-white/[0.06]">
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mb-2">
            Current Batch
          </p>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Checked</span>
            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-200">
              {latestResults.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Online</span>
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {onlineCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Offline / Error</span>
            <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {downCount}
            </span>
          </div>
        </div>

        <div className="p-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {user.username}
            </p>
            <p className="text-[11px] font-mono text-slate-400 truncate">
              {user.tokenMask}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
