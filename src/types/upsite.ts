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

export interface KeywordCheckResult {
  checked: boolean;
  passed: boolean;
  expectedKeyword?: string;
  expectedMatched?: boolean;
  forbiddenKeyword?: string;
  forbiddenFound?: boolean;
  detail?: string;
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
  keywordCheck?: KeywordCheckResult;
  redirects: RedirectHop[];
  diagnosis: DiagnosisInfo;
  checkedAt: string;
}

export type ActiveView = 'checker' | 'organisation' | 'history' | 'analytics' | 'settings';

export type ThemeMode = 'dark' | 'light';

export type AutoRefreshInterval = number;

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CheckTimeWindow {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startTime: string;
  endTime: string;
}

export type IntegrationProvider = 'teams' | 'slack' | 'discord' | 'webhook';

export interface IntegrationChannel {
  id: string;
  name: string;
  provider: IntegrationProvider;
  webhookUrl: string;
  enabled: boolean;
  autoSendOnOrgRun: boolean;
  onlyOnIssues: boolean;
}

export interface ReportDispatchSiteItem {
  projectName?: string;
  url: string;
  status: SiteStatus;
  statusLabel: 'Online' | 'Offline' | 'Error';
  httpStatusCode: number | null;
  responseTimeMs: number | null;
  errorCode: string;
  likelyReason?: string;
}

export interface ReportDispatchPayload {
  title: string;
  source: string;
  generatedAt: string;
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  errorCount: number;
  avgLatencyMs: number | null;
  sites: ReportDispatchSiteItem[];
}

export interface FeaturePreferences {
  analyticsEnabled: boolean;
  incidentTrackingEnabled: boolean;
  sslExpiryAlertsEnabled: boolean;
  keywordChecksEnabled: boolean;
  customCheckRulesEnabled: boolean;
  maintenanceWindowsEnabled: boolean;
  digestReportsEnabled: boolean;
  commandPaletteEnabled: boolean;
}

export interface ProjectCheckRules {
  method?: 'GET' | 'HEAD' | 'POST';
  expectedStatuses?: number[];
  expectedKeyword?: string;
  forbiddenKeyword?: string;
  customHeaders?: Array<{ key: string; value: string }>;
}

export interface IncidentRecord {
  id: string;
  orgId: string;
  orgName: string;
  projectId?: string;
  projectName?: string;
  url: string;
  status: 'open' | 'resolved';
  startedAt: string;
  resolvedAt?: string;
  durationMs?: number;
  errorCode: string;
  reason: string;
}

export interface UserSettings {
  theme: ThemeMode;
  timeoutMs: 5000 | 8500 | 15000;
  defaultProtocol: 'https' | 'http';
  slowThresholdMs: 0 | 500 | 1000 | 2000;
  smartThresholdEnabled: boolean;
  smartThresholdSensitivity: 'tight' | 'balanced' | 'relaxed';
  autoInspectFirstIssue: boolean;
  autoRefreshSec: AutoRefreshInterval;
  checkWindow: CheckTimeWindow;
  density: 'comfortable' | 'compact';
  deepInspect: boolean;
  desktopNotifications: boolean;
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  integrations: IntegrationChannel[];
  features: FeaturePreferences;
  sslWarningDays: 7 | 14 | 30;
  alertConsecutiveFailures: 1 | 2 | 3;
  alertCooldownMin: 0 | 5 | 15 | 30 | 60;
  digestSchedule: 'off' | 'daily' | 'weekly';
  lastDigestSentAt?: string;
  workspaceMaintenanceUntil?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  urls: string[];
  checkRules?: ProjectCheckRules;
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
  maintenanceUntil?: string;
  maintenanceReason?: string;
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
  rules?: ProjectCheckRules;
  sslWarningDays?: number;
}

export interface AppNotification {
  id: string;
  kind: 'org-changes' | 'results-ready' | 'ssl-expiry';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  targetView: 'checker' | 'organisation' | 'analytics';
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
  showNotification?: (payload: {
    id: string;
    title: string;
    body: string;
  }) => Promise<{ ok: boolean }>;
  onNotificationClick?: (callback: (id: string) => void) => () => void;
  setTraySettings?: (payload: { minimizeToTray: boolean }) => Promise<{ ok: boolean }>;
  minimizeToTrayNow?: () => Promise<{ ok: boolean }>;
  updateTrayStatus?: (payload: { summary: string; downCount: number }) => Promise<{ ok: boolean }>;
  onTrayRunOrg?: (callback: () => void) => () => void;
  setLaunchAtStartup?: (enabled: boolean) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    upsiteDesktop?: UpsiteDesktopBridge;
  }
}
