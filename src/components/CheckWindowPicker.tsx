import type { CheckTimeWindow, DayOfWeek } from '../types/upsite';
import {
  DAYS_OF_WEEK,
  DEFAULT_CHECK_WINDOW,
  formatCheckWindowLabel,
  isWithinCheckWindow,
} from '../utils/intervals';

interface CheckWindowPickerProps {
  value: CheckTimeWindow | undefined;
  onChange: (next: CheckTimeWindow) => void;
  title?: string;
  description?: string;
}

export function CheckWindowPicker({
  value,
  onChange,
  title = 'Active Time Period',
  description = 'Choose start and end day and time when scheduled timer checks run.',
}: CheckWindowPickerProps) {
  const current: CheckTimeWindow = value ?? DEFAULT_CHECK_WINDOW;
  const activeNow = isWithinCheckWindow(current);

  const updateField = <K extends keyof CheckTimeWindow>(key: K, fieldVal: CheckTimeWindow[K]) => {
    onChange({ ...current, [key]: fieldVal });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {description}
          </p>
        </div>

        <span
          className={`text-xs font-medium tabular-nums whitespace-nowrap shrink-0 ${
            activeNow
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {formatCheckWindowLabel(current)} · {activeNow ? 'In window' : 'Outside window'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Start Day
          </label>
          <select
            aria-label="Start day"
            value={current.startDay}
            onChange={(e) => updateField('startDay', e.target.value as DayOfWeek)}
            className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Start Time
          </label>
          <input
            type="time"
            aria-label="Start time"
            value={current.startTime}
            onChange={(e) => {
              if (e.target.value) updateField('startTime', e.target.value);
            }}
            className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            End Day
          </label>
          <select
            aria-label="End day"
            value={current.endDay}
            onChange={(e) => updateField('endDay', e.target.value as DayOfWeek)}
            className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            End Time
          </label>
          <input
            type="time"
            aria-label="End time"
            value={current.endTime}
            onChange={(e) => {
              if (e.target.value) updateField('endTime', e.target.value);
            }}
            className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() =>
            onChange({
              startDay: 'mon',
              endDay: 'sun',
              startTime: '00:00',
              endTime: '23:59',
            })
          }
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.11] text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
        >
          Mon–Sun (12:00 AM – 11:59 PM)
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              startDay: 'mon',
              endDay: 'fri',
              startTime: '00:00',
              endTime: '23:59',
            })
          }
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.11] text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
        >
          Mon–Fri (Whole Day)
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...current,
              startTime: '00:00',
              endTime: '23:59',
            })
          }
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.11] text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
        >
          Whole Day (12:00 AM – 11:59 PM)
        </button>
      </div>
    </div>
  );
}
