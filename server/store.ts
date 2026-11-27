import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AuthUser,
  CheckTimeWindow,
  DayOfWeek,
  FeaturePreferences,
  IncidentRecord,
  IntegrationChannel,
  IntegrationProvider,
  Organisation,
  SiteCheckResult,
  UserSettings,
} from '../src/types/upsite.ts';
import { hashAccessToken, isValidAccessToken } from './issuedTokens.ts';
import { normalizeOrganisationsProjectOrder } from '../src/utils/organisations.ts';

const DATA_DIR = process.env.UPSITE_DATA_DIR
  ? path.resolve(process.env.UPSITE_DATA_DIR)
  : path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'upsite-db.json');

export const SESSION_SHORT_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_REMEMBER_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const VALID_DAYS = new Set<DayOfWeek>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const DEFAULT_CHECK_WINDOW: CheckTimeWindow = {
  startDay: 'mon',
  endDay: 'sun',
  startTime: '00:00',
  endTime: '23:59',
};

export function sanitizeCheckWindow(input: unknown): CheckTimeWindow {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_CHECK_WINDOW };
  }
  const obj = input as Partial<CheckTimeWindow>;
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return {
    startDay: obj.startDay && VALID_DAYS.has(obj.startDay) ? obj.startDay : 'mon',
    endDay: obj.endDay && VALID_DAYS.has(obj.endDay) ? obj.endDay : 'sun',
    startTime: typeof obj.startTime === 'string' && timePattern.test(obj.startTime) ? obj.startTime : '00:00',
    endTime: typeof obj.endTime === 'string' && timePattern.test(obj.endTime) ? obj.endTime : '23:59',
  };
}

const VALID_PROVIDERS = new Set<IntegrationProvider>(['teams', 'slack', 'discord', 'webhook']);

export function sanitizeIntegrations(input: unknown): IntegrationChannel[] {
  if (!Array.isArray(input)) return [];
  const clean: IntegrationChannel[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<IntegrationChannel>;
    const rawUrl = typeof obj.webhookUrl === 'string' ? obj.webhookUrl.trim() : '';
    if (!rawUrl || rawUrl.length > 2048) continue;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;

    const provider: IntegrationProvider =
      obj.provider && VALID_PROVIDERS.has(obj.provider) ? obj.provider : 'webhook';
    const rawName = typeof obj.name === 'string' ? obj.name.trim().slice(0, 60) : '';

    clean.push({
      id: typeof obj.id === 'string' && obj.id ? obj.id.slice(0, 64) : crypto.randomUUID(),
      name:
        rawName ||
        (provider === 'teams'
          ? 'Microsoft Teams'
          : provider === 'slack'
            ? 'Slack'
            : provider === 'discord'
              ? 'Discord'
              : 'Custom Webhook'),
      provider,
      webhookUrl: parsed.toString(),
      enabled: obj.enabled !== false,
      autoSendOnOrgRun: Boolean(obj.autoSendOnOrgRun),
      onlyOnIssues: Boolean(obj.onlyOnIssues),
    });
    if (clean.length >= 20) break;
  }
  return clean;
}

export const DEFAULT_FEATURES: FeaturePreferences = {
  analyticsEnabled: true,
  incidentTrackingEnabled: true,
  sslExpiryAlertsEnabled: true,
  keywordChecksEnabled: true,
  customCheckRulesEnabled: true,
  maintenanceWindowsEnabled: true,
  digestReportsEnabled: false,
  commandPaletteEnabled: true,
};

export function sanitizeFeatures(input: unknown): FeaturePreferences {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_FEATURES };
  }
  const obj = input as Partial<FeaturePreferences>;
  return {
    analyticsEnabled: obj.analyticsEnabled !== false,
    incidentTrackingEnabled: obj.incidentTrackingEnabled !== false,
    sslExpiryAlertsEnabled: obj.sslExpiryAlertsEnabled !== false,
    keywordChecksEnabled: obj.keywordChecksEnabled !== false,
    customCheckRulesEnabled: obj.customCheckRulesEnabled !== false,
    maintenanceWindowsEnabled: obj.maintenanceWindowsEnabled !== false,
    digestReportsEnabled: Boolean(obj.digestReportsEnabled),
    commandPaletteEnabled: obj.commandPaletteEnabled !== false,
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeoutMs: 8500,
  defaultProtocol: 'https',
  slowThresholdMs: 1000,
  autoInspectFirstIssue: false,
  autoRefreshSec: 0,
  checkWindow: { ...DEFAULT_CHECK_WINDOW },
  density: 'comfortable',
  deepInspect: true,
  desktopNotifications: true,
  minimizeToTray: true,
  launchAtStartup: false,
  integrations: [],
  features: { ...DEFAULT_FEATURES },
  sslWarningDays: 14,
  alertConsecutiveFailures: 1,
  alertCooldownMin: 0,
  digestSchedule: 'off',
};

interface StoredUser {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string | null;
  authType: 'account' | 'token';
  tokenMask: string;
  createdAt: string;
}

interface UserWorkspace {
  history: SiteCheckResult[];
  organisations: Organisation[];
  incidents?: IncidentRecord[];
  settings: UserSettings;
  checkerInput?: string;
}

interface UpsiteDatabase {
  sessionSecret: string;
  users: Record<string, StoredUser>;
  workspaces: Record<string, UserWorkspace>;
}

function maskToken(token: string): string {
  if (token.length <= 4) return '••••';
  return `${token.slice(0, 2)}••••••${token.slice(-2)}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveDb(db: UpsiteDatabase): void {
  ensureDataDir();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function initializeDatabase(): UpsiteDatabase {
  ensureDataDir();
  const db: UpsiteDatabase = {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    users: {},
    workspaces: {},
  };
  saveDb(db);
  return db;
}

function loadDb(): UpsiteDatabase {
  if (!fs.existsSync(DB_PATH)) {
    return initializeDatabase();
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpsiteDatabase>;
    let changed = false;
    let sessionSecret = parsed.sessionSecret;
    if (!sessionSecret || typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      changed = true;
    }
    const db: UpsiteDatabase = {
      sessionSecret,
      users: parsed.users || {},
      workspaces: parsed.workspaces || {},
    };
    if (changed) {
      saveDb(db);
    }
    return db;
  } catch {
    return initializeDatabase();
  }
}

function getSigningSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  return loadDb().sessionSecret;
}

export function ensureInitialized(): void {
  loadDb();
}

export function createSessionToken(userId: string, rememberMe = true): {
  token: string;
  ttlMs: number;
} {
  const ttlMs = rememberMe ? SESSION_REMEMBER_TTL_MS : SESSION_SHORT_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Date.now() + ttlMs }),
    'utf8',
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  return { token: `${payload}.${sig}`, ttlMs };
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };
    if (!payload.sub || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    const db = loadDb();
    if (!db.users[payload.sub]) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

function toAuthUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    authType: user.authType,
    tokenMask: user.tokenMask,
    createdAt: user.createdAt,
  };
}

function ensureWorkspace(db: UpsiteDatabase, userId: string): UserWorkspace {
  if (!db.workspaces[userId]) {
    db.workspaces[userId] = {
      history: [],
      organisations: [],
      incidents: [],
      settings: { ...DEFAULT_SETTINGS, features: { ...DEFAULT_FEATURES } },
      checkerInput: '',
    };
  }
  const existing = db.workspaces[userId];
  return {
    history: existing.history || [],
    organisations: normalizeOrganisationsProjectOrder(existing.organisations || []),
    incidents: Array.isArray(existing.incidents) ? existing.incidents.slice(0, 300) : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(existing.settings || {}),
      integrations: sanitizeIntegrations(existing.settings?.integrations),
      features: sanitizeFeatures(existing.settings?.features),
    },
    checkerInput: typeof existing.checkerInput === 'string' ? existing.checkerInput : '',
  };
}

export function registerWithToken(params: {
  username: string;
  password: string;
  accessToken: string;
  rememberMe?: boolean;
}):
  | { ok: true; user: AuthUser; sessionToken: string; ttlMs: number }
  | { ok: false; error: string; status: number } {
  const username = params.username.trim();
  const password = params.password;
  const rawToken = params.accessToken.trim();
  // Always keep newly created accounts signed in until intentional sign-out
  const rememberMe = true;

  if (username.length < 3 || username.length > 32) {
    return { ok: false, error: 'Username must be between 3 and 32 characters.', status: 400 };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return {
      ok: false,
      error: 'Username may only contain letters, numbers, dots, underscores, and hyphens.',
      status: 400,
    };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: 'Password must be at least 6 characters.', status: 400 };
  }
  if (rawToken.length !== 10) {
    return { ok: false, error: 'Access token must be exactly 10 characters.', status: 400 };
  }
  if (!isValidAccessToken(rawToken)) {
    return { ok: false, error: 'Invalid access token.', status: 401 };
  }

  const db = loadDb();
  const usernameLower = username.toLowerCase();

  const existingByUsername = Object.values(db.users).find(
    (u) => u.usernameLower === usernameLower,
  );
  if (existingByUsername) {
    return { ok: false, error: 'Username is already taken.', status: 409 };
  }

  const userId = crypto.randomUUID();
  const newUser: StoredUser = {
    id: userId,
    username,
    usernameLower,
    passwordHash: hashPassword(password),
    authType: 'account',
    tokenMask: maskToken(rawToken),
    createdAt: new Date().toISOString(),
  };

  db.users[userId] = newUser;
  db.workspaces[userId] = {
    history: [],
    organisations: [],
    settings: { ...DEFAULT_SETTINGS },
    checkerInput: '',
  };
  saveDb(db);

  const session = createSessionToken(userId, rememberMe);
  return {
    ok: true,
    user: toAuthUser(newUser),
    sessionToken: session.token,
    ttlMs: session.ttlMs,
  };
}

export function loginWithCredentials(params: {
  username: string;
  password: string;
  rememberMe?: boolean;
}):
  | { ok: true; user: AuthUser; sessionToken: string; ttlMs: number }
  | { ok: false; error: string; status: number } {
  const usernameLower = params.username.trim().toLowerCase();
  const password = params.password;
  const rememberMe = params.rememberMe !== false;

  if (!usernameLower || !password) {
    return { ok: false, error: 'Enter both username and password.', status: 400 };
  }

  const db = loadDb();
  const user = Object.values(db.users).find(
    (u) => u.usernameLower === usernameLower && u.authType === 'account',
  );

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: 'Invalid username or password.', status: 401 };
  }

  const session = createSessionToken(user.id, rememberMe);
  return {
    ok: true,
    user: toAuthUser(user),
    sessionToken: session.token,
    ttlMs: session.ttlMs,
  };
}

export function loginWithAccessToken(
  rawTokenInput: string,
  rememberMe = true,
):
  | { ok: true; user: AuthUser; sessionToken: string; ttlMs: number }
  | { ok: false; error: string; status: number } {
  const rawToken = rawTokenInput.trim();
  if (rawToken.length !== 10) {
    return { ok: false, error: 'Access token must be exactly 10 characters.', status: 400 };
  }
  if (!isValidAccessToken(rawToken)) {
    return { ok: false, error: 'Invalid access token.', status: 401 };
  }

  const db = loadDb();
  const tokenHash = hashAccessToken(rawToken);
  const sharedUserId = `token_${tokenHash.slice(0, 16)}`;

  let tokenUser = db.users[sharedUserId];
  if (!tokenUser) {
    const masked = maskToken(rawToken);
    tokenUser = {
      id: sharedUserId,
      username: `Token ${masked}`,
      usernameLower: sharedUserId,
      passwordHash: null,
      authType: 'token',
      tokenMask: masked,
      createdAt: new Date().toISOString(),
    };
    db.users[sharedUserId] = tokenUser;
    db.workspaces[sharedUserId] = {
      history: [],
      organisations: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    saveDb(db);
  }

  const session = createSessionToken(tokenUser.id, rememberMe);
  return {
    ok: true,
    user: toAuthUser(tokenUser),
    sessionToken: session.token,
    ttlMs: session.ttlMs,
  };
}

export function getUserProfileAndWorkspace(userId: string): {
  user: AuthUser;
  workspace: UserWorkspace;
} | null {
  const db = loadDb();
  const user = db.users[userId];
  if (!user) return null;
  const workspace = ensureWorkspace(db, userId);
  return { user: toAuthUser(user), workspace };
}

export function appendUserHistory(userId: string, items: SiteCheckResult[]): SiteCheckResult[] {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const next = [...items, ...ws.history].slice(0, 300);
  db.workspaces[userId] = { ...ws, history: next };
  saveDb(db);
  return next;
}

export function clearUserHistory(userId: string): void {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  db.workspaces[userId] = { ...ws, history: [] };
  saveDb(db);
}

export function deduplicateUserHistory(userId: string): SiteCheckResult[] {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const seen = new Set<string>();
  const ordered = [...ws.history].sort(
    (a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0),
  );
  const deduped: SiteCheckResult[] = [];
  for (const item of ordered) {
    const key = (item.normalizedUrl || item.inputUrl).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  db.workspaces[userId] = { ...ws, history: deduped };
  saveDb(db);
  return deduped;
}

export function saveUserOrganisations(userId: string, organisations: Organisation[]): Organisation[] {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const normalized = normalizeOrganisationsProjectOrder(organisations);
  db.workspaces[userId] = { ...ws, organisations: normalized };
  saveDb(db);
  return normalized;
}

export function saveUserCheckerInput(userId: string, checkerInput: string): string {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const cleaned = checkerInput.slice(0, 20000);
  db.workspaces[userId] = { ...ws, checkerInput: cleaned };
  saveDb(db);
  return cleaned;
}

export function saveUserIncidents(userId: string, incidents: IncidentRecord[]): IncidentRecord[] {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const clean = incidents
    .filter((item): item is IncidentRecord => Boolean(item && typeof item === 'object' && item.url))
    .slice(0, 300)
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : crypto.randomUUID(),
      orgId: String(item.orgId || '').slice(0, 64),
      orgName: String(item.orgName || '').slice(0, 80),
      projectId: typeof item.projectId === 'string' ? item.projectId.slice(0, 64) : undefined,
      projectName: typeof item.projectName === 'string' ? item.projectName.slice(0, 80) : undefined,
      url: String(item.url).slice(0, 2048),
      status: item.status === 'resolved' ? ('resolved' as const) : ('open' as const),
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : new Date().toISOString(),
      resolvedAt: typeof item.resolvedAt === 'string' ? item.resolvedAt : undefined,
      durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? Math.max(0, item.durationMs) : undefined,
      errorCode: String(item.errorCode || 'UNKNOWN').slice(0, 60),
      reason: String(item.reason || '').slice(0, 300),
    }));
  db.workspaces[userId] = { ...ws, incidents: clean };
  saveDb(db);
  return clean;
}

export function clearUserIncidents(userId: string): void {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  db.workspaces[userId] = { ...ws, incidents: [] };
  saveDb(db);
}

export function updateUserSettings(
  userId: string,
  partial: Partial<UserSettings>,
): UserSettings {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  const next: UserSettings = { ...ws.settings };

  if (partial.theme === 'dark' || partial.theme === 'light') {
    next.theme = partial.theme;
  }
  if (partial.timeoutMs === 5000 || partial.timeoutMs === 8500 || partial.timeoutMs === 15000) {
    next.timeoutMs = partial.timeoutMs;
  }
  if (partial.defaultProtocol === 'https' || partial.defaultProtocol === 'http') {
    next.defaultProtocol = partial.defaultProtocol;
  }
  if (
    partial.slowThresholdMs === 0 ||
    partial.slowThresholdMs === 500 ||
    partial.slowThresholdMs === 1000 ||
    partial.slowThresholdMs === 2000
  ) {
    next.slowThresholdMs = partial.slowThresholdMs;
  }
  if (typeof partial.autoInspectFirstIssue === 'boolean') {
    next.autoInspectFirstIssue = partial.autoInspectFirstIssue;
  }
  if (partial.autoRefreshSec === 0) {
    next.autoRefreshSec = 0;
  } else if (
    typeof partial.autoRefreshSec === 'number' &&
    Number.isFinite(partial.autoRefreshSec)
  ) {
    const rounded = Math.round(partial.autoRefreshSec);
    if (rounded >= 60 && rounded <= 86400) {
      next.autoRefreshSec = rounded;
    }
  }
  if (partial.checkWindow) {
    next.checkWindow = sanitizeCheckWindow(partial.checkWindow);
  } else {
    next.checkWindow = sanitizeCheckWindow(next.checkWindow);
  }
  if (partial.density === 'comfortable' || partial.density === 'compact') {
    next.density = partial.density;
  }
  if (typeof partial.deepInspect === 'boolean') {
    next.deepInspect = partial.deepInspect;
  }
  if (typeof partial.desktopNotifications === 'boolean') {
    next.desktopNotifications = partial.desktopNotifications;
  }
  if (typeof partial.minimizeToTray === 'boolean') {
    next.minimizeToTray = partial.minimizeToTray;
  }
  if (typeof partial.launchAtStartup === 'boolean') {
    next.launchAtStartup = partial.launchAtStartup;
  }
  if (Array.isArray(partial.integrations)) {
    next.integrations = sanitizeIntegrations(partial.integrations);
  } else {
    next.integrations = sanitizeIntegrations(next.integrations);
  }
  if (partial.features && typeof partial.features === 'object') {
    next.features = sanitizeFeatures({ ...next.features, ...partial.features });
  } else {
    next.features = sanitizeFeatures(next.features);
  }
  if (partial.sslWarningDays === 7 || partial.sslWarningDays === 14 || partial.sslWarningDays === 30) {
    next.sslWarningDays = partial.sslWarningDays;
  }
  if (
    partial.alertConsecutiveFailures === 1 ||
    partial.alertConsecutiveFailures === 2 ||
    partial.alertConsecutiveFailures === 3
  ) {
    next.alertConsecutiveFailures = partial.alertConsecutiveFailures;
  }
  if (
    partial.alertCooldownMin === 0 ||
    partial.alertCooldownMin === 5 ||
    partial.alertCooldownMin === 15 ||
    partial.alertCooldownMin === 30 ||
    partial.alertCooldownMin === 60
  ) {
    next.alertCooldownMin = partial.alertCooldownMin;
  }
  if (
    partial.digestSchedule === 'off' ||
    partial.digestSchedule === 'daily' ||
    partial.digestSchedule === 'weekly'
  ) {
    next.digestSchedule = partial.digestSchedule;
  }
  if ('lastDigestSentAt' in partial) {
    next.lastDigestSentAt =
      typeof partial.lastDigestSentAt === 'string' && partial.lastDigestSentAt
        ? partial.lastDigestSentAt.slice(0, 64)
        : undefined;
  }
  if ('workspaceMaintenanceUntil' in partial) {
    next.workspaceMaintenanceUntil =
      typeof partial.workspaceMaintenanceUntil === 'string' && partial.workspaceMaintenanceUntil
        ? partial.workspaceMaintenanceUntil.slice(0, 64)
        : undefined;
  }

  db.workspaces[userId] = { ...ws, settings: next };
  saveDb(db);
  return next;
}
