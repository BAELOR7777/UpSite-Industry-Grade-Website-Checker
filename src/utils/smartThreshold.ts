import type {
  Organisation,
  ProjectRecord,
  SiteCheckResult,
  UserSettings,
} from '../types/upsite';

export const ROLLING_THRESHOLD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SMART_THRESHOLD_MIN_SAMPLES = 2;

export type SmartThresholdSensitivity = 'tight' | 'balanced' | 'relaxed';

export interface ProjectThresholdInfo {
  projectId: string;
  sampleCount: number;
  rollingAvgMs: number | null;
  thresholdMs: number;
  isSmartActive: boolean;
}

const SENSITIVITY_CONFIG: Record<
  SmartThresholdSensitivity,
  { multiplier: number; minHeadroomMs: number; label: string }
> = {
  tight: { multiplier: 1.5, minHeadroomMs: 150, label: 'Tight (1.5x)' },
  balanced: { multiplier: 2.0, minHeadroomMs: 200, label: 'Balanced (2.0x)' },
  relaxed: { multiplier: 2.5, minHeadroomMs: 300, label: 'Relaxed (2.5x)' },
};

export function getSmartSensitivityLabel(
  sensitivity?: SmartThresholdSensitivity,
): string {
  return SENSITIVITY_CONFIG[sensitivity || 'balanced'].label;
}

export function computeAdaptiveThresholdFromAvg(
  rollingAvgMs: number,
  sensitivity: SmartThresholdSensitivity = 'balanced',
  maxCapMs = 15000,
): number {
  const cfg = SENSITIVITY_CONFIG[sensitivity] || SENSITIVITY_CONFIG.balanced;
  const candidate = Math.max(
    rollingAvgMs * cfg.multiplier,
    rollingAvgMs + cfg.minHeadroomMs,
  );
  return Math.min(maxCapMs, Math.max(200, Math.round(candidate)));
}

/**
 * Computes per-project adaptive slow latency thresholds using each project's
 * rolling 7-day average response time from check history (and latest project results).
 */
export function computeProjectThresholdsMap(
  projects: ProjectRecord[],
  history: SiteCheckResult[],
  settings: Pick<
    UserSettings,
    'slowThresholdMs' | 'smartThresholdEnabled' | 'smartThresholdSensitivity' | 'timeoutMs'
  >,
  nowMs = Date.now(),
): Map<string, ProjectThresholdInfo> {
  const map = new Map<string, ProjectThresholdInfo>();
  const fallbackMs = settings.slowThresholdMs;
  const smartEnabled = Boolean(settings.smartThresholdEnabled);
  const sensitivity: SmartThresholdSensitivity =
    settings.smartThresholdSensitivity || 'balanced';
  const maxCapMs = Math.max(2000, settings.timeoutMs || 8500);

  if (!smartEnabled) {
    for (const proj of projects) {
      map.set(proj.id, {
        projectId: proj.id,
        sampleCount: 0,
        rollingAvgMs: null,
        thresholdMs: fallbackMs,
        isSmartActive: false,
      });
    }
    return map;
  }

  const cutoffMs = nowMs - ROLLING_THRESHOLD_WINDOW_MS;

  // Map each lowercase URL -> list of projectIds that monitor it
  const urlToProjectIds = new Map<string, string[]>();
  for (const proj of projects) {
    const seenForProj = new Set<string>();
    const addUrl = (raw?: string) => {
      if (!raw) return;
      const key = raw.trim().toLowerCase();
      if (!key || seenForProj.has(key)) return;
      seenForProj.add(key);
      const list = urlToProjectIds.get(key) || [];
      list.push(proj.id);
      urlToProjectIds.set(key, list);
    };

    for (const u of proj.urls) addUrl(u);
    for (const r of proj.lastResults || []) {
      addUrl(r.inputUrl);
      addUrl(r.normalizedUrl);
    }
  }

  const acc = new Map<
    string,
    {
      seenIds: Set<string>;
      onlineSum: number;
      onlineCount: number;
      allSum: number;
      allCount: number;
    }
  >();

  const ensureAcc = (projectId: string) => {
    let entry = acc.get(projectId);
    if (!entry) {
      entry = {
        seenIds: new Set<string>(),
        onlineSum: 0,
        onlineCount: 0,
        allSum: 0,
        allCount: 0,
      };
      acc.set(projectId, entry);
    }
    return entry;
  };

  const recordSample = (projectId: string, item: SiteCheckResult) => {
    if (typeof item.responseTimeMs !== 'number' || item.responseTimeMs <= 0) return;
    const ts = Date.parse(item.checkedAt);
    if (Number.isNaN(ts) || ts < cutoffMs) return;

    const bucket = ensureAcc(projectId);
    if (bucket.seenIds.has(item.id)) return;
    bucket.seenIds.add(item.id);

    bucket.allSum += item.responseTimeMs;
    bucket.allCount += 1;
    if (item.status === 'online') {
      bucket.onlineSum += item.responseTimeMs;
      bucket.onlineCount += 1;
    }
  };

  for (const item of history) {
    if (typeof item.responseTimeMs !== 'number' || item.responseTimeMs <= 0) continue;
    const ts = Date.parse(item.checkedAt);
    if (Number.isNaN(ts) || ts < cutoffMs) continue;

    const matchedProjects = new Set<string>();
    const inputList = urlToProjectIds.get(item.inputUrl.trim().toLowerCase());
    if (inputList) {
      for (const pid of inputList) matchedProjects.add(pid);
    }
    const normList = item.normalizedUrl
      ? urlToProjectIds.get(item.normalizedUrl.trim().toLowerCase())
      : undefined;
    if (normList) {
      for (const pid of normList) matchedProjects.add(pid);
    }

    for (const pid of matchedProjects) {
      recordSample(pid, item);
    }
  }

  // Also include latest project results in case history was cleared or truncated
  for (const proj of projects) {
    for (const res of proj.lastResults || []) {
      recordSample(proj.id, res);
    }
  }

  for (const proj of projects) {
    const bucket = acc.get(proj.id);
    const useOnline = Boolean(bucket && bucket.onlineCount > 0);
    const sampleCount = bucket ? (useOnline ? bucket.onlineCount : bucket.allCount) : 0;
    const rollingAvgMs =
      bucket && sampleCount > 0
        ? Math.round((useOnline ? bucket.onlineSum : bucket.allSum) / sampleCount)
        : null;

    if (rollingAvgMs !== null && sampleCount >= SMART_THRESHOLD_MIN_SAMPLES) {
      map.set(proj.id, {
        projectId: proj.id,
        sampleCount,
        rollingAvgMs,
        thresholdMs: computeAdaptiveThresholdFromAvg(
          rollingAvgMs,
          sensitivity,
          maxCapMs,
        ),
        isSmartActive: true,
      });
    } else {
      map.set(proj.id, {
        projectId: proj.id,
        sampleCount,
        rollingAvgMs,
        thresholdMs: fallbackMs,
        isSmartActive: false,
      });
    }
  }

  return map;
}

/**
 * Builds a URL -> adaptive slow threshold map across all organisations for analytics views.
 */
export function computeUrlSmartThresholdMap(
  organisations: Organisation[],
  history: SiteCheckResult[],
  settings: Pick<
    UserSettings,
    'slowThresholdMs' | 'smartThresholdEnabled' | 'smartThresholdSensitivity' | 'timeoutMs'
  >,
  nowMs = Date.now(),
): Map<string, ProjectThresholdInfo> {
  const urlMap = new Map<string, ProjectThresholdInfo>();
  if (!settings.smartThresholdEnabled) return urlMap;

  const allProjects = organisations.flatMap((o) => o.projects);
  const projectMap = computeProjectThresholdsMap(
    allProjects,
    history,
    settings,
    nowMs,
  );

  for (const proj of allProjects) {
    const info = projectMap.get(proj.id);
    if (!info || !info.isSmartActive) continue;
    for (const u of proj.urls) {
      const key = u.trim().toLowerCase();
      if (key && !urlMap.has(key)) urlMap.set(key, info);
    }
    for (const r of proj.lastResults || []) {
      const k1 = r.inputUrl.trim().toLowerCase();
      const k2 = (r.normalizedUrl || '').trim().toLowerCase();
      if (k1 && !urlMap.has(k1)) urlMap.set(k1, info);
      if (k2 && !urlMap.has(k2)) urlMap.set(k2, info);
    }
  }

  return urlMap;
}
