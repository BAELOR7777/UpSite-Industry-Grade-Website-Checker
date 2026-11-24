import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AuthUser,
  Organisation,
  SiteCheckResult,
  UserSettings,
} from '../src/types/upsite.ts';
import { hashAccessToken, isValidAccessToken } from './issuedTokens.ts';

const DATA_DIR = process.env.UPSITE_DATA_DIR
  ? path.resolve(process.env.UPSITE_DATA_DIR)
  : path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'upsite-db.json');

export const SESSION_SHORT_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  timeoutMs: 8500,
  defaultProtocol: 'https',
  slowThresholdMs: 1000,
  autoInspectFirstIssue: false,
  autoRefreshSec: 0,
  density: 'comfortable',
  deepInspect: true,
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
  settings: UserSettings;
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
  };
}

function ensureWorkspace(db: UpsiteDatabase, userId: string): UserWorkspace {
  if (!db.workspaces[userId]) {
    db.workspaces[userId] = {
      history: [],
      organisations: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }
  return {
    history: db.workspaces[userId].history || [],
    organisations: db.workspaces[userId].organisations || [],
    settings: { ...DEFAULT_SETTINGS, ...(db.workspaces[userId].settings || {}) },
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
  const rememberMe = params.rememberMe !== false;

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

export function saveUserOrganisations(userId: string, organisations: Organisation[]): Organisation[] {
  const db = loadDb();
  const ws = ensureWorkspace(db, userId);
  db.workspaces[userId] = { ...ws, organisations };
  saveDb(db);
  return organisations;
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
  if (
    partial.autoRefreshSec === 0 ||
    partial.autoRefreshSec === 300 ||
    partial.autoRefreshSec === 600 ||
    partial.autoRefreshSec === 3600 ||
    partial.autoRefreshSec === 14400
  ) {
    next.autoRefreshSec = partial.autoRefreshSec;
  }
  if (partial.density === 'comfortable' || partial.density === 'compact') {
    next.density = partial.density;
  }
  if (typeof partial.deepInspect === 'boolean') {
    next.deepInspect = partial.deepInspect;
  }

  db.workspaces[userId] = { ...ws, settings: next };
  saveDb(db);
  return next;
}
