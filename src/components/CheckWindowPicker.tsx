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
}

export function CheckWindowPicker({
  value,
  onChange,
  title = 'Time Period',
}: CheckWindowPickerProps) {
  const current: CheckTimeWindow = value ?? DEFAULT_CHECK_WINDOW;
  const activeNow = isWithinCheckWindow(current);

  const updateField = <K extends keyof CheckTimeWindow>(key: K, fieldVal: CheckTimeWindow[K]) => {
    onChange({ ...current, [key]: fieldVal });
  };

  const isAllWeekWholeDay =
    current.startDay === 'mon' &&
    current.endDay === 'sun' &&
    current.startTime === '00:00' &&
    current.endTime === '23:59';

  const isWeekdaysWholeDay =
    current.startDay === 'mon' &&
    current.endDay === 'fri' &&
    current.startTime === '00:00' &&
    current.endTime === '23:59';

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {title}
          </span>
          <span
            className={`text-xs font-medium tabular-nums whitespace-nowrap ${
              activeNow
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            · {activeNow ? 'Active' : 'Paused'} ({formatCheckWindowLabel(current)})
          </span>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08]">
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
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              isAllWeekWholeDay
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            24/7
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
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              isWeekdaysWholeDay
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Mon–Fri
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
            className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Whole Day
          </button>
        </div>
      </div>

      {/* Compact single-bar Day & Time selector */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#F3F5F8] dark:bg-[#12151C] border border-slate-200 dark:border-white/[0.08] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Start day"
            value={current.startDay}
            onChange={(e) => updateField('startDay', e.target.value as DayOfWeek)}
            className="rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.id} value={d.id}>
                {d.short}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400">to</span>
          <select
            aria-label="End day"
            value={current.endDay}
            onChange={(e) => updateField('endDay', e.target.value as DayOfWeek)}
            className="rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.id} value={d.id}>
                {d.short}
              </option>
            ))}
          </select>
        </div>

        <span className="hidden sm:inline text-slate-300 dark:text-white/[0.12]">|</span>

        <div className="flex items-center gap-1.5">
          <input
            type="time"
            aria-label="Start time"
            value={current.startTime}
            onChange={(e) => {
              if (e.target.value) updateField('startTime', e.target.value);
            }}
            className="rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="time"
            aria-label="End time"
            value={current.endTime}
            onChange={(e) => {
              if (e.target.value) updateField('endTime', e.target.value);
            }}
            className="rounded-md bg-white dark:bg-[#1B1F28] border border-slate-200 dark:border-white/[0.08] px-2.5 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
