import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'neutral';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsite-confirm-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1B1F28] shadow-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                tone === 'danger'
                  ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                  : 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
              }`}
            >
              <AlertTriangle className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 space-y-1">
              <h3
                id="upsite-confirm-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-[#F3F5F8] dark:bg-white/[0.07] hover:bg-slate-200 dark:hover:bg-white/[0.12] transition-colors whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 ${
              tone === 'danger'
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
