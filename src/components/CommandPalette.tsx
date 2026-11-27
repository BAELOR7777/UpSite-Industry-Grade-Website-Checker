import {
  BarChart3,
  Building2,
  Clock,
  Folder,
  Globe,
  Minimize2,
  Moon,
  Play,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ActiveView,
  Organisation,
  SiteCheckResult,
  ThemeMode,
} from '../types/upsite';

interface CommandPaletteProps {
  open: boolean;
  organisations: Organisation[];
  history: SiteCheckResult[];
  showAnalytics: boolean;
  theme: ThemeMode;
  onClose: () => void;
  onNavigateView: (view: ActiveView) => void;
  onOpenOrganisation: (orgId: string) => void;
  onInspectResult: (result: SiteCheckResult) => void;
  onRunAllOrganisations: () => void;
  onToggleTheme: () => void;
  onExportStatusPage: () => void;
}

interface PaletteEntry {
  id: string;
  category: 'Action' | 'Organisation' | 'Project' | 'URL';
  label: string;
  subtitle: string;
  icon: typeof Globe;
  onSelect: () => void;
}

export function CommandPalette({
  open,
  organisations,
  history,
  showAnalytics,
  theme,
  onClose,
  onNavigateView,
  onOpenOrganisation,
  onInspectResult,
  onRunAllOrganisations,
  onToggleTheme,
  onExportStatusPage,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const allEntries = useMemo<PaletteEntry[]>(() => {
    const entries: PaletteEntry[] = [
      {
        id: 'act-checker',
        category: 'Action',
        label: 'Go to Website Checker',
        subtitle: 'Check single or multiple URLs',
        icon: Globe,
        onSelect: () => onNavigateView('checker'),
      },
      {
        id: 'act-org',
        category: 'Action',
        label: 'Go to Organisation Projects',
        subtitle: 'Browse organisations, projects, and schedules',
        icon: Building2,
        onSelect: () => onNavigateView('organisation'),
      },
      {
        id: 'act-history',
        category: 'Action',
        label: 'Go to Check History',
        subtitle: 'Inspect past checks and downtime incidents',
        icon: Clock,
        onSelect: () => onNavigateView('history'),
      },
      ...(showAnalytics
        ? [
            {
              id: 'act-analytics',
              category: 'Action' as const,
              label: 'Go to Analytics Dashboard',
              subtitle: 'Uptime %, latency trends, and SSL alerts',
              icon: BarChart3,
              onSelect: () => onNavigateView('analytics'),
            },
          ]
        : []),
      {
        id: 'act-settings',
        category: 'Action',
        label: 'Go to Settings',
        subtitle: 'Preferences, optional features, and connected apps',
        icon: Settings,
        onSelect: () => onNavigateView('settings'),
      },
      ...(organisations.some((o) => o.projects.some((p) => p.urls.length > 0))
        ? [
            {
              id: 'act-run-all',
              category: 'Action' as const,
              label: 'Run All Organisations Now',
              subtitle: 'Trigger immediate availability checks across all projects',
              icon: Play,
              onSelect: onRunAllOrganisations,
            },
          ]
        : []),
      {
        id: 'act-theme',
        category: 'Action',
        label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`,
        subtitle: 'Toggle workspace color appearance',
        icon: theme === 'dark' ? Sun : Moon,
        onSelect: onToggleTheme,
      },
      {
        id: 'act-html',
        category: 'Action',
        label: 'Export HTML Status Page',
        subtitle: 'Download standalone shareable HTML status report',
        icon: Globe,
        onSelect: onExportStatusPage,
      },
    ];

    if (typeof window !== 'undefined' && window.upsiteDesktop?.minimizeToTrayNow) {
      entries.push({
        id: 'act-tray',
        category: 'Action',
        label: 'Minimize to System Tray',
        subtitle: 'Hide window while monitors keep running',
        icon: Minimize2,
        onSelect: () => {
          void window.upsiteDesktop?.minimizeToTrayNow?.();
        },
      });
    }

    const latestByUrl = new Map<string, SiteCheckResult>();
    for (const item of history) {
      const key = (item.normalizedUrl || item.inputUrl).toLowerCase();
      if (!latestByUrl.has(key)) latestByUrl.set(key, item);
    }

    for (const org of organisations) {
      const totalUrls = org.projects.reduce((sum, p) => sum + p.urls.length, 0);
      entries.push({
        id: `org-${org.id}`,
        category: 'Organisation',
        label: org.name,
        subtitle: `${org.projects.length} projects · ${totalUrls} URLs`,
        icon: Building2,
        onSelect: () => onOpenOrganisation(org.id),
      });

      for (const proj of org.projects) {
        entries.push({
          id: `proj-${proj.id}`,
          category: 'Project',
          label: proj.name,
          subtitle: `${org.name} · ${proj.urls.length} URLs`,
          icon: Folder,
          onSelect: () => onOpenOrganisation(org.id),
        });
        for (const r of proj.lastResults || []) {
          const key = (r.normalizedUrl || r.inputUrl).toLowerCase();
          if (!latestByUrl.has(key)) latestByUrl.set(key, r);
        }
      }
    }

    for (const res of Array.from(latestByUrl.values()).slice(0, 60)) {
      entries.push({
        id: `url-${res.id}`,
        category: 'URL',
        label: res.normalizedUrl,
        subtitle: `${res.statusLabel}${
          res.httpStatusCode !== null ? ` · HTTP ${res.httpStatusCode}` : ''
        }${res.responseTimeMs !== null ? ` · ${res.responseTimeMs} ms` : ''}`,
        icon: Globe,
        onSelect: () => onInspectResult(res),
      });
    }

    return entries;
  }, [
    history,
    onExportStatusPage,
    onInspectResult,
    onNavigateView,
    onOpenOrganisation,
    onRunAllOrganisations,
    onToggleTheme,
    organisations,
    showAnalytics,
    theme,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEntries.slice(0, 14);
    return allEntries
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(q) ||
          entry.subtitle.toLowerCase().includes(q) ||
          entry.category.toLowerCase().includes(q),
      )
      .slice(0, 18);
  }, [allEntries, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0,
      );
      return;
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].onSelect();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick command search"
      onKeyDown={handleKeyDown}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-start justify-center pt-[12vh] p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/[0.07] flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={1.8} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to organisation, project, URL, or action..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command search"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.04]">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching organisations, URLs, or commands.
            </div>
          ) : (
            filtered.map((entry, idx) => {
              const Icon = entry.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    entry.onSelect();
                    onClose();
                  }}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-500/[0.14]'
                      : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isSelected
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-400'
                      }`}
                      strokeWidth={1.8}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {entry.label}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {entry.subtitle}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
                    {entry.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-white/[0.06] bg-[#F8FAFC] dark:bg-[#151821] flex items-center justify-between text-[11px] text-slate-400">
          <span>↑↓ Navigate · Enter Select · Esc Close</span>
          <span className="font-mono">Ctrl+K / ⌘K</span>
        </div>
      </div>
    </div>
  );
}
