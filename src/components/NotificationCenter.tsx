import { AlertTriangle, ArrowRight, Bell, CheckCircle2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AppNotification } from '../types/upsite';

interface NotificationBellProps {
  notifications: AppNotification[];
  onViewNotification: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

export function NotificationBellButton({
  notifications,
  onViewNotification,
  onMarkAllRead,
  onClearAll,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Notifications"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#1B1F28] hover:bg-slate-50 dark:hover:bg-[#222734] border border-slate-200 dark:border-white/[0.08] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Bell
          className={`w-3.5 h-3.5 shrink-0 ${
            unreadCount > 0
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
          strokeWidth={1.8}
        />
        <span>Alerts</span>
        {unreadCount > 0 && (
          <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notification center"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-white/[0.07] flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Notifications
            </span>
            {notifications.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 whitespace-nowrap"
                  >
                    Mark read
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 whitespace-nowrap"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-200 dark:divide-white/[0.06]">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                No alerts yet. Scheduled organisation updates and completed organisation site check results will appear here.
              </div>
            ) : (
              notifications.map((item) => {
                const hasIssues = item.downCount > 0 || (item.newErrorCount ?? 0) > 0;
                const Icon = hasIssues ? AlertTriangle : CheckCircle2;
                const timeStr = new Date(item.createdAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={item.id}
                    className={`px-4 py-3 space-y-2 transition-colors ${
                      item.read
                        ? 'bg-transparent'
                        : 'bg-blue-50/50 dark:bg-blue-500/[0.06]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            hasIssues
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                          strokeWidth={1.8}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.title}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                            {item.message}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                        {timeStr}
                      </span>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          onViewNotification(item);
                          setOpen(false);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 whitespace-nowrap"
                      >
                        <span>View now</span>
                        <ArrowRight className="w-3 h-3 shrink-0" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface NotificationToastStackProps {
  toasts: AppNotification[];
  onDismiss: (id: string) => void;
  onViewNow: (notification: AppNotification) => void;
}

export function NotificationToastStack({
  toasts,
  onDismiss,
  onViewNow,
}: NotificationToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Live check notifications"
      className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] space-y-2.5 pointer-events-none"
    >
      {toasts.slice(0, 3).map((toast) => {
        const hasIssues = toast.downCount > 0 || (toast.newErrorCount ?? 0) > 0;
        const Icon = hasIssues ? AlertTriangle : CheckCircle2;

        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto rounded-xl border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-[#1B1F28] shadow-xl px-4 py-3.5 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    hasIssues
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                  strokeWidth={2}
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {toast.title}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    {toast.message}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => onViewNow(toast)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>View now</span>
                <ArrowRight className="w-3 h-3 shrink-0" strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
