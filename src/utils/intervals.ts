import type { AutoRefreshInterval, CheckTimeWindow, DayOfWeek } from '../types/upsite';

export const AUTO_REFRESH_PRESETS: Array<{ value: AutoRefreshInterval; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 3600, label: '1 hr' },
  { value: 14400, label: '4 hr' },
];

export const DAYS_OF_WEEK: Array<{ id: DayOfWeek; label: string; short: string }> = [
  { id: 'mon', label: 'Monday', short: 'Mon' },
  { id: 'tue', label: 'Tuesday', short: 'Tue' },
  { id: 'wed', label: 'Wednesday', short: 'Wed' },
  { id: 'thu', label: 'Thursday', short: 'Thu' },
  { id: 'fri', label: 'Friday', short: 'Fri' },
  { id: 'sat', label: 'Saturday', short: 'Sat' },
  { id: 'sun', label: 'Sunday', short: 'Sun' },
];

export const DEFAULT_CHECK_WINDOW: CheckTimeWindow = {
  startDay: 'mon',
  endDay: 'sun',
  startTime: '00:00',
  endTime: '23:59',
};

const DAY_INDEX: Record<DayOfWeek, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function formatIntervalLabel(seconds: number): string {
  if (!seconds || seconds <= 0) return 'Off';
  if (seconds % 3600 === 0) {
    const hrs = seconds / 3600;
    return `${hrs} hr`;
  }
  if (seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} min`;
  }
  return `${seconds}s`;
}

export function parseCustomIntervalSeconds(
  rawValue: string,
  unit: 'min' | 'hr',
): number | null {
  const num = Number(rawValue);
  if (!Number.isFinite(num) || num <= 0) return null;
  const rawSeconds = Math.round(unit === 'hr' ? num * 3600 : num * 60);
  if (rawSeconds < 60 || rawSeconds > 86400) return null;
  return rawSeconds;
}

export function formatTime12h(hhmm: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return hhmm;
  const h24 = Number(match[1]);
  const mins = match[2];
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mins} ${suffix}`;
}

export function formatCheckWindowLabel(win?: CheckTimeWindow): string {
  const w = win ?? DEFAULT_CHECK_WINDOW;
  const startShort = DAYS_OF_WEEK.find((d) => d.id === w.startDay)?.short || 'Mon';
  const endShort = DAYS_OF_WEEK.find((d) => d.id === w.endDay)?.short || 'Sun';
  return `${startShort} – ${endShort} · ${formatTime12h(w.startTime)} – ${formatTime12h(w.endTime)}`;
}

function parseMinutes(hhmm: string, fallback: number): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isWithinCheckWindow(win?: CheckTimeWindow, now = new Date()): boolean {
  const w = win ?? DEFAULT_CHECK_WINDOW;
  const currentDayIdx = (now.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const startIdx = DAY_INDEX[w.startDay] ?? 0;
  const endIdx = DAY_INDEX[w.endDay] ?? 6;

  const dayMatched =
    startIdx <= endIdx
      ? currentDayIdx >= startIdx && currentDayIdx <= endIdx
      : currentDayIdx >= startIdx || currentDayIdx <= endIdx;

  if (!dayMatched) return false;

  const currentMin = now.getHours() * 60 + now.getMinutes();
  const startMin = parseMinutes(w.startTime, 0);
  const endMin = parseMinutes(w.endTime, 23 * 60 + 59);

  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin <= endMin;
  }
  return currentMin >= startMin || currentMin <= endMin;
}
