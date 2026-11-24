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

export type AutoRefreshInterval = 0 | 300 | 600 | 3600 | 14400;

export interface UserSettings {
  theme: ThemeMode;
  timeoutMs: 5000 | 8500 | 15000;
  defaultProtocol: 'https' | 'http';
  slowThresholdMs: 0 | 500 | 1000 | 2000;
  autoInspectFirstIssue: boolean;
  autoRefreshSec: AutoRefreshInterval;
  density: 'comfortable' | 'compact';
  deepInspect: boolean;
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
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  authType: 'account' | 'token';
  tokenMask: string;
}

export interface CheckOptions {
  timeoutMs?: number;
  defaultProtocol?: 'https' | 'http';
  deepInspect?: boolean;
}
