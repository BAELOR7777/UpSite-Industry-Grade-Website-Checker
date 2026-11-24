export type SiteStatus = 'online' | 'offline' | 'error';

export interface RedirectHop {
  step: number;
  url: string;
  statusCode: number;
  location?: string;
}

export interface DnsCheckResult {
  resolved: boolean;
  hostname: string;
  addresses: string[];
  error?: string;
}

export interface SslCheckResult {
  checked: boolean;
  valid: boolean;
  protocol?: string;
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

export interface DiagnosisInfo {
  errorCode: string;
  likelyReason: string;
  possibleFix: string;
}

export interface SiteCheckResult {
  id: string;
  inputUrl: string;
  normalizedUrl: string;
  finalUrl: string;
  status: SiteStatus;
  statusLabel: 'Online' | 'Offline' | 'Error';
  responseTimeMs: number | null;
  httpStatusCode: number | null;
  httpStatusText: string | null;
  dns: DnsCheckResult;
  ssl: SslCheckResult;
  redirects: RedirectHop[];
  diagnosis: DiagnosisInfo;
  checkedAt: string;
}

export type ActiveView = 'checker' | 'organisation' | 'history' | 'settings';

export type ThemeMode = 'dark' | 'light';

export type AutoRefreshInterval = number;

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CheckTimeWindow {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startTime: string;
  endTime: string;
}

export interface UserSettings {
  theme: ThemeMode;
  timeoutMs: 5000 | 8500 | 15000;
  defaultProtocol: 'https' | 'http';
  slowThresholdMs: 0 | 500 | 1000 | 2000;
  autoInspectFirstIssue: boolean;
  autoRefreshSec: AutoRefreshInterval;
  checkWindow: CheckTimeWindow;
  density: 'comfortable' | 'compact';
  deepInspect: boolean;
  desktopNotifications: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  urls: string[];
  lastResults?: SiteCheckResult[];
  lastCheckedAt?: string;
  createdAt: string;
}

export interface Organisation {
  id: string;
  name: string;
  projects: ProjectRecord[];
  autoRefreshSec?: AutoRefreshInterval;
  checkWindow?: CheckTimeWindow;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  authType: 'account' | 'token';
  tokenMask: string;
  createdAt?: string;
}

export interface CheckOptions {
  timeoutMs?: number;
  defaultProtocol?: 'https' | 'http';
  deepInspect?: boolean;
}

export interface AppNotification {
  id: string;
  kind: 'org-changes' | 'results-ready';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  targetView: 'checker' | 'organisation';
  orgId?: string;
  downCount: number;
  backOnlineCount?: number;
  newErrorCount?: number;
  firstIssueResult?: SiteCheckResult;
}

export interface UpsiteDesktopBridge {
  isDesktop: boolean;
  copyPdfFile: (
    filename: string,
    base64: string,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  sharePdfFile: (
    filename: string,
    base64: string,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
}

declare global {
  interface Window {
    upsiteDesktop?: UpsiteDesktopBridge;
  }
}
