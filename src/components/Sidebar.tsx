import {
  Activity,
  BarChart3,
  Building2,
  Clock,
  Globe,
  LogOut,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ActiveView, AuthUser, SiteCheckResult } from '../types/upsite';

interface SidebarProps {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  latestResults: SiteCheckResult[];
  historyCount: number;
  organisationCount: number;
  openIncidentCount?: number;
  showAnalytics?: boolean;
  user: AuthUser;
  onSignOut: () => void;
  width: number;
  collapsed: boolean;
  onResizeWidth: (nextWidth: number) => void;
  onToggleCollapse: () => void;
}

const MIN_EXPANDED_WIDTH = 172;
const MAX_EXPANDED_WIDTH = 360;
const COLLAPSE_SNAP_THRESHOLD = 116;
const RAIL_WIDTH = 68;

export function Sidebar({
  activeView,
  onChangeView,
  latestResults,
  historyCount,
  organisationCount,
  openIncidentCount = 0,
  showAnalytics = true,
  user,
  onSignOut,
  width,
  collapsed,
  onResizeWidth,
  onToggleCollapse,
}: SidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number; wasCollapsed: boolean } | null>(
    null,
  );

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
    ...(showAnalytics
      ? [
          {
            id: 'analytics' as ActiveView,
            label: 'Analytics',
            icon: BarChart3,
            count: openIncidentCount > 0 ? openIncidentCount : undefined,
          },
        ]
      : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragStartRef.current;
      if (!drag) return;
      const baseWidth = drag.wasCollapsed ? RAIL_WIDTH : drag.startWidth;
      const rawWidth = baseWidth + (e.clientX - drag.startX);

      if (rawWidth < COLLAPSE_SNAP_THRESHOLD) {
        if (!collapsed) {
          onToggleCollapse();
        }
        return;
      }

      if (collapsed) {
        onToggleCollapse();
      }
      const clamped = Math.min(MAX_EXPANDED_WIDTH, Math.max(MIN_EXPANDED_WIDTH, rawWidth));
      onResizeWidth(Math.round(clamped));
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [collapsed, isDragging, onResizeWidth, onToggleCollapse]);

  const handleStartResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startWidth: width,
      wasCollapsed: collapsed,
    };
    setIsDragging(true);
  };

  const handleLogoClick = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileMenuOpen((prev) => !prev);
      return;
    }
    onToggleCollapse();
  };

  const desktopWidthPx = collapsed ? RAIL_WIDTH : width;

  return (
    <aside
      style={{ ['--sidebar-w' as string]: `${desktopWidthPx}px` }}
      className={`relative w-full md:w-[var(--sidebar-w)] shrink-0 bg-[#EAEFF5]/95 dark:bg-[#161920] border-b md:border-b-0 md:border-r border-slate-200/90 dark:border-white/[0.08] flex flex-col justify-between ${
        isDragging ? '' : 'md:transition-[width] md:duration-150'
      }`}
    >
      <div>
        {/* Brand Logo Header — Click logo to toggle taskbar open/collapsed */}
        <div
          className={`h-14 px-3.5 flex items-center justify-between border-b border-slate-200/80 dark:border-white/[0.06] ${
            collapsed ? 'md:justify-center md:px-2' : 'md:px-4'
          }`}
        >
          <button
            type="button"
            onClick={handleLogoClick}
            title={collapsed ? 'Open navigation taskbar' : 'Collapse navigation taskbar'}
            aria-label={collapsed ? 'Open navigation taskbar' : 'Collapse navigation taskbar'}
            className="flex items-center gap-2.5 rounded-lg p-1 -ml-1 hover:bg-slate-200/70 dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <Activity className="w-4 h-4" strokeWidth={2} />
            </div>
            {!collapsed && (
              <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
                upsite
              </span>
            )}
          </button>

          <div className="flex items-center gap-2.5 md:hidden">
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
        <div
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } md:block px-2.5 py-3 md:py-4`}
        >
          {!collapsed && (
            <p className="hidden md:block px-2.5 mb-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Workspace
            </p>
          )}
          <nav
            className="flex flex-wrap md:flex-col items-center md:items-stretch gap-1"
            aria-label="Primary navigation"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChangeView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  title={collapsed ? item.label : undefined}
                  className={`relative flex-1 md:flex-none flex items-center ${
                    collapsed ? 'md:justify-center md:px-0' : 'justify-between px-3'
                  } gap-2.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-white/[0.09] dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="hidden md:block absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-blue-600 dark:bg-blue-400"
                    />
                  )}
                  <span
                    className={`flex items-center gap-2.5 min-w-0 ${
                      collapsed ? 'md:justify-center' : ''
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                      strokeWidth={1.8}
                    />
                    <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>
                      {item.label}
                    </span>
                  </span>
                  {!collapsed && typeof item.count === 'number' && item.count > 0 && (
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

      {/* Bottom Summary & User Session */}
      <div className="hidden md:block border-t border-slate-200/80 dark:border-white/[0.06]">
        {!collapsed && (
          <div className="px-4 py-3.5 space-y-1.5 text-xs border-b border-slate-200/80 dark:border-white/[0.06]">
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-1.5">
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
        )}

        <div
          className={`p-3 flex items-center ${
            collapsed ? 'justify-center' : 'justify-between gap-2'
          }`}
        >
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                {user.username}
              </p>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                {user.tokenMask}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </div>

      {/* Mouse-Drag Resizable Edge Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left navigation taskbar"
        onPointerDown={handleStartResize}
        onDoubleClick={onToggleCollapse}
        title="Drag to resize sidebar (double-click to toggle)"
        className="hidden md:flex absolute top-0 bottom-0 -right-1 w-2.5 cursor-col-resize items-center justify-center group z-20 touch-none"
      >
        <div
          className={`w-[2px] h-full transition-colors ${
            isDragging
              ? 'bg-blue-500'
              : 'bg-transparent group-hover:bg-blue-500/70'
          }`}
        />
      </div>
    </aside>
  );
}
