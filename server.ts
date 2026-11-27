import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  appendUserHistory,
  clearUserHistory,
  clearUserIncidents,
  deduplicateUserHistory,
  ensureInitialized,
  getUserProfileAndWorkspace,
  loginWithAccessToken,
  loginWithCredentials,
  registerWithToken,
  sanitizeCheckWindow,
  saveUserCheckerInput,
  saveUserIncidents,
  saveUserOrganisations,
  SESSION_REMEMBER_TTL_MS,
  updateUserSettings,
  verifySessionToken,
} from './server/store.ts';
import { sortProjectsByName } from './src/utils/organisations.ts';
import type {
  AutoRefreshInterval,
  CheckOptions,
  DiagnosisInfo,
  DnsCheckResult,
  IncidentRecord,
  IntegrationChannel,
  IntegrationProvider,
  KeywordCheckResult,
  Organisation,
  ProjectCheckRules,
  RedirectHop,
  ReportDispatchPayload,
  SiteCheckResult,
  SiteStatus,
  SslCheckResult,
  UserSettings,
} from './src/types/upsite.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_BULK_URLS = 60;
const CONCURRENCY_LIMIT = 6;
const DEFAULT_TIMEOUT_MS = 8500;
const MAX_REDIRECTS = 10;
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX = 15;

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface AuthenticatedRequest extends Request {
  userId?: string;
}

const authAttemptsByIp = new Map<string, number[]>();

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const cutoff = now - AUTH_RATE_WINDOW_MS;
  const recent = (authAttemptsByIp.get(clientIp) || []).filter((ts) => ts > cutoff);

  if (recent.length >= AUTH_RATE_MAX) {
    res.status(429).json({
      error: 'Too many authentication attempts. Please wait 60 seconds and try again.',
    });
    return;
  }

  recent.push(now);
  authAttemptsByIp.set(clientIp, recent);
  if (authAttemptsByIp.size > 1000) {
    for (const [key, list] of authAttemptsByIp.entries()) {
      if (list.every((ts) => ts <= cutoff)) {
        authAttemptsByIp.delete(key);
      }
    }
  }
  next();
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  const version = net.isIP(clean);
  if (version === 4) {
    return isPrivateIpv4(clean);
  }
  if (version === 6) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('::ffff:')) {
      const mapped = clean.slice(7);
      if (net.isIP(mapped) === 4) return isPrivateIpv4(mapped);
    }
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (
      clean.startsWith('fe8') ||
      clean.startsWith('fe9') ||
      clean.startsWith('fea') ||
      clean.startsWith('feb')
    ) {
      return true;
    }
    if (clean.startsWith('ff')) return true;
    return false;
  }
  return true;
}

function normalizeUrlInput(
  raw: string,
  defaultProtocol: 'https' | 'http' = 'https',
): { ok: true; url: URL; hasExplicitScheme: boolean } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'URL is empty.' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'URL exceeds maximum length of 2048 characters.' };
  }

  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasExplicitScheme ? trimmed : `${defaultProtocol}://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Only HTTP and HTTPS protocols are supported.' };
    }
    if (!parsed.hostname || parsed.hostname.length > 253) {
      return { ok: false, reason: 'Invalid hostname.' };
    }
    return { ok: true, url: parsed, hasExplicitScheme };
  } catch {
    return { ok: false, reason: 'Invalid URL format.' };
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prioritizeAddresses(addresses: string[]): string[] {
  const unique = Array.from(new Set(addresses));
  const ipv4 = unique.filter((addr) => net.isIP(addr) === 4);
  const ipv6 = unique.filter((addr) => net.isIP(addr) === 6);
  return [...ipv4, ...ipv6];
}

async function resolveWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEOUT' })),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryDnsOnce(hostname: string): Promise<string[]> {
  // Run c-ares resolve4/resolve6 first or alongside system lookup so libuv's 4-thread pool
  // doesn't bottleneck bulk checks, falling back to dns.lookup for /etc/hosts or OS resolvers.
  const [v4Result, v6Result] = await Promise.allSettled([
    resolveWithTimeout(dns.promises.resolve4(hostname), 4500),
    resolveWithTimeout(dns.promises.resolve6(hostname), 4500),
  ]);

  const resolvedDirect: string[] = [];
  if (v4Result.status === 'fulfilled') resolvedDirect.push(...v4Result.value);
  if (v6Result.status === 'fulfilled') resolvedDirect.push(...v6Result.value);

  if (resolvedDirect.length > 0) {
    return prioritizeAddresses(resolvedDirect);
  }

  const lookupRecords = await resolveWithTimeout(
    dns.promises.lookup(hostname, { all: true, verbatim: true }),
    5000,
  );
  return prioritizeAddresses(lookupRecords.map((r) => r.address));
}

async function resolvePublicHost(
  hostname: string,
): Promise<DnsCheckResult & { primaryIp?: string; candidateIps?: string[] }> {
  const hostLower = hostname.toLowerCase();
  if (hostLower === 'localhost' || hostLower.endsWith('.local') || hostLower.endsWith('.internal')) {
    return {
      resolved: false,
      hostname,
      addresses: [],
      error: 'PRIVATE_NETWORK_BLOCKED',
    };
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        resolved: false,
        hostname,
        addresses: [],
        error: 'PRIVATE_NETWORK_BLOCKED',
      };
    }
    return {
      resolved: true,
      hostname,
      addresses: [hostname],
      primaryIp: hostname,
      candidateIps: [hostname],
    };
  }

  let lastErrorCode = 'ENOTFOUND';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const addresses = await queryDnsOnce(hostname);
      if (addresses.length === 0) {
        lastErrorCode = 'ENOTFOUND';
      } else if (addresses.some((addr) => isPrivateOrReservedIp(addr))) {
        return {
          resolved: false,
          hostname,
          addresses: [],
          error: 'PRIVATE_NETWORK_BLOCKED',
        };
      } else {
        return {
          resolved: true,
          hostname,
          addresses,
          primaryIp: addresses[0],
          candidateIps: addresses.slice(0, 4),
        };
      }
    } catch (err: unknown) {
      lastErrorCode = (err as { code?: string })?.code || 'DNS_ERROR';
    }

    if (attempt === 0) {
      await delayMs(180);
    }
  }

  return {
    resolved: false,
    hostname,
    addresses: [],
    error: lastErrorCode,
  };
}

function extractSslFromTlsSocket(socket: tls.TLSSocket, hostname: string): SslCheckResult {
  try {
    const cert = socket.getPeerCertificate(false);
    const protocol = socket.getProtocol() || undefined;
    const authorized = socket.authorized;
    const authError = socket.authorizationError ? String(socket.authorizationError) : undefined;

    if (!cert || Object.keys(cert).length === 0) {
      return {
        checked: true,
        valid: false,
        protocol,
        error: authError || 'NO_CERTIFICATE',
      };
    }

    const rawIssuer = cert.issuer?.O || cert.issuer?.CN;
    const issuer = Array.isArray(rawIssuer)
      ? rawIssuer[0] || 'Unknown Issuer'
      : rawIssuer || 'Unknown Issuer';
    const rawSubject = cert.subject?.CN;
    const subject = Array.isArray(rawSubject)
      ? rawSubject[0] || hostname
      : rawSubject || hostname;
    const validFrom = cert.valid_from;
    const validTo = cert.valid_to;
    const expiryMs = validTo ? Date.parse(validTo) : NaN;
    const daysRemaining = Number.isNaN(expiryMs)
      ? undefined
      : Math.floor((expiryMs - Date.now()) / (1000 * 60 * 60 * 24));

    return {
      checked: true,
      valid: authorized && (daysRemaining === undefined || daysRemaining >= 0),
      protocol,
      issuer,
      subject,
      validFrom,
      validTo,
      daysRemaining,
      error: authorized ? undefined : authError || 'CERT_UNTRUSTED',
    };
  } catch (err: unknown) {
    return {
      checked: true,
      valid: false,
      error: (err as Error)?.message || 'TLS_INSPECTION_ERROR',
    };
  }
}

const MAX_KEYWORD_BODY_BYTES = 262_144;
const BLOCKED_CUSTOM_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'cookie',
  'te',
  'trailer',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
]);
const HEADER_TOKEN_REGEX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function sanitizeCheckRules(raw: unknown): ProjectCheckRules | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<ProjectCheckRules>;
  const clean: ProjectCheckRules = {};
  let hasAny = false;

  if (obj.method === 'GET' || obj.method === 'HEAD' || obj.method === 'POST') {
    clean.method = obj.method;
    hasAny = true;
  }

  if (Array.isArray(obj.expectedStatuses)) {
    const validStatuses = Array.from(
      new Set(
        obj.expectedStatuses
          .map((n) => (typeof n === 'number' ? Math.round(n) : Number(n)))
          .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599),
      ),
    ).slice(0, 15);
    if (validStatuses.length > 0) {
      clean.expectedStatuses = validStatuses;
      hasAny = true;
    }
  }

  if (typeof obj.expectedKeyword === 'string') {
    const trimmed = obj.expectedKeyword.trim().slice(0, 120);
    if (trimmed) {
      clean.expectedKeyword = trimmed;
      hasAny = true;
    }
  }

  if (typeof obj.forbiddenKeyword === 'string') {
    const trimmed = obj.forbiddenKeyword.trim().slice(0, 120);
    if (trimmed) {
      clean.forbiddenKeyword = trimmed;
      hasAny = true;
    }
  }

  if (Array.isArray(obj.customHeaders)) {
    const safeHeaders: Array<{ key: string; value: string }> = [];
    for (const h of obj.customHeaders) {
      if (!h || typeof h !== 'object') continue;
      const key = typeof h.key === 'string' ? h.key.trim().slice(0, 64) : '';
      const val = typeof h.value === 'string' ? h.value.trim().slice(0, 512) : '';
      const lower = key.toLowerCase();
      if (!key || !HEADER_TOKEN_REGEX.test(key)) continue;
      if (BLOCKED_CUSTOM_HEADERS.has(lower) || lower.startsWith('proxy-')) continue;
      if (/[\r\n\0]/.test(val)) continue;
      safeHeaders.push({ key, value: val });
      if (safeHeaders.length >= 8) break;
    }
    if (safeHeaders.length > 0) {
      clean.customHeaders = safeHeaders;
      hasAny = true;
    }
  }

  return hasAny ? clean : undefined;
}

interface PinnedHttpResponse {
  statusCode: number;
  statusText: string | null;
  location?: string;
  setCookies: string[];
  ssl?: SslCheckResult;
  bodySnippet?: string;
}

function pinnedHttpRequest(params: {
  targetUrl: URL;
  pinnedIp: string;
  timeoutMs: number;
  method?: 'GET' | 'HEAD' | 'POST';
  cookieHeader?: string;
  customHeaders?: Array<{ key: string; value: string }>;
  captureSsl?: boolean;
  captureBody?: boolean;
}): Promise<PinnedHttpResponse> {
  const {
    targetUrl,
    pinnedIp,
    timeoutMs,
    method = 'GET',
    cookieHeader,
    customHeaders,
    captureSsl = false,
    captureBody = false,
  } = params;
  return new Promise((resolve, reject) => {
    let settled = false;
    const isHttps = targetUrl.protocol === 'https:';
    const ipFamily = net.isIP(pinnedIp) === 6 ? 6 : 4;
    const defaultPort = isHttps ? 443 : 80;
    const port = targetUrl.port ? Number(targetUrl.port) : defaultPort;

    const pinnedLookup: Parameters<typeof http.request>[1]['lookup'] = (
      _hostname,
      options,
      callback,
    ) => {
      if (typeof options === 'object' && options?.all) {
        callback(null, [{ address: pinnedIp, family: ipFamily }]);
      } else {
        callback(null, pinnedIp, ipFamily);
      }
    };

    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    if (customHeaders) {
      for (const h of customHeaders) {
        headers[h.key] = h.value;
      }
    }
    // Always enforce safe Host & Connection headers
    headers.Host = targetUrl.host;
    headers.Connection = 'close';
    if (method === 'POST') {
      headers['Content-Length'] = '0';
    }
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        agent: false,
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        timeout: timeoutMs,
        lookup: pinnedLookup,
        rejectUnauthorized: false,
        servername: net.isIP(targetUrl.hostname) ? undefined : targetUrl.hostname,
        headers,
      },
      (res) => {
        if (settled) {
          res.destroy();
          return;
        }

        const statusCode = res.statusCode ?? 0;
        const statusText = res.statusMessage || null;
        const rawLocation = res.headers.location;
        const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
        const rawSetCookie = res.headers['set-cookie'];
        const setCookies = Array.isArray(rawSetCookie)
          ? rawSetCookie
          : typeof rawSetCookie === 'string'
            ? [rawSetCookie]
            : [];

        let ssl: SslCheckResult | undefined;
        if (captureSsl && isHttps && res.socket instanceof tls.TLSSocket) {
          ssl = extractSslFromTlsSocket(res.socket, targetUrl.hostname);
        }

        const isRedirect = statusCode >= 300 && statusCode < 400 && Boolean(location);
        if (!captureBody || method === 'HEAD' || isRedirect) {
          settled = true;
          res.destroy();
          resolve({ statusCode, statusText, location, setCookies, ssl });
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const finalizeBody = () => {
          if (settled) return;
          settled = true;
          const bodySnippet = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode, statusText, location, setCookies, ssl, bodySnippet });
        };

        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          const remaining = MAX_KEYWORD_BODY_BYTES - totalBytes;
          if (remaining <= 0) {
            finalizeBody();
            res.destroy();
            return;
          }
          const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
          chunks.push(slice);
          totalBytes += slice.length;
          if (totalBytes >= MAX_KEYWORD_BODY_BYTES) {
            finalizeBody();
            res.destroy();
          }
        });
        res.on('end', finalizeBody);
        res.on('close', finalizeBody);
        res.on('error', () => finalizeBody());
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.end();
  });
}

async function inspectSslCertificate(
  hostname: string,
  port: number,
  connectIp?: string,
  timeoutMs = 5500,
): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SslCheckResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const socket = tls.connect(
      {
        host: connectIp || hostname,
        port,
        servername: net.isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: false,
        timeout: Math.max(4500, Math.min(timeoutMs, 10000)),
      },
      () => {
        const result = extractSslFromTlsSocket(socket, hostname);
        socket.destroy();
        finish(result);
      },
    );

    socket.on('timeout', () => {
      socket.destroy();
      finish({
        checked: true,
        valid: false,
        error: 'TLS_TIMEOUT',
      });
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      socket.destroy();
      finish({
        checked: true,
        valid: false,
        error: err.code || err.message || 'TLS_CONNECTION_ERROR',
      });
    });
  });
}

function buildDiagnosis(params: {
  status: SiteStatus;
  httpStatusCode: number | null;
  dns: DnsCheckResult;
  ssl: SslCheckResult;
  networkErrorCode?: string;
  timeoutMs: number;
  rules?: ProjectCheckRules;
  keywordCheck?: KeywordCheckResult;
  sslWarningDays?: number;
}): DiagnosisInfo {
  const {
    status,
    httpStatusCode,
    dns: dnsRes,
    ssl,
    networkErrorCode,
    timeoutMs,
    rules,
    keywordCheck,
    sslWarningDays = 14,
  } = params;

  if (dnsRes.error === 'PRIVATE_NETWORK_BLOCKED') {
    return {
      errorCode: 'PRIVATE_NETWORK_BLOCKED',
      likelyReason: 'Localhost, private LAN IPs, and internal hostnames are blocked for server-side probing.',
      possibleFix: 'Enter a publicly reachable domain name or public IP address (http:// or https://).',
    };
  }

  if (!dnsRes.resolved) {
    if (dnsRes.error === 'ENOTFOUND' || dnsRes.error === 'ENODATA') {
      return {
        errorCode: dnsRes.error,
        likelyReason: `Domain "${dnsRes.hostname}" could not be resolved to an IP address in DNS.`,
        possibleFix: 'Verify the domain spelling, check registrar expiration, or confirm A/AAAA/CNAME records exist.',
      };
    }
    return {
      errorCode: dnsRes.error || 'DNS_LOOKUP_FAILED',
      likelyReason: `DNS resolution timed out or returned an error for "${dnsRes.hostname}".`,
      possibleFix: 'Check authoritative nameserver health and DNSSEC configuration.',
    };
  }

  if (networkErrorCode) {
    if (networkErrorCode === 'TIMEOUT' || networkErrorCode === 'ETIMEDOUT' || networkErrorCode === 'ABORT_ERR') {
      return {
        errorCode: 'ETIMEDOUT',
        likelyReason: `The target server did not respond within the ${(timeoutMs / 1000).toFixed(1)} second timeout window.`,
        possibleFix: 'Check if the origin server is overloaded, down, or increase Check Timeout in Settings.',
      };
    }
    if (networkErrorCode === 'ECONNREFUSED') {
      return {
        errorCode: 'ECONNREFUSED',
        likelyReason: 'The host IP is reachable, but nothing is listening on the requested port.',
        possibleFix: 'Confirm the web server (Nginx, Apache, IIS, Node) is running and port 80/443 is open.',
      };
    }
    if (networkErrorCode === 'ECONNRESET') {
      return {
        errorCode: 'ECONNRESET',
        likelyReason: 'The remote server forcibly closed the TCP connection mid-handshake or mid-request.',
        possibleFix: 'Inspect reverse proxy timeouts, TLS version compatibility, or rate-limiting rules.',
      };
    }
    return {
      errorCode: networkErrorCode,
      likelyReason: 'A network transport error prevented a valid HTTP response from being received.',
      possibleFix: 'Verify server uptime, firewall rules, and TLS/port configuration.',
    };
  }

  if (ssl.checked && !ssl.valid) {
    const code = ssl.error || 'SSL_ERROR';
    if (code.includes('EXPIRED')) {
      return {
        errorCode: 'CERT_HAS_EXPIRED',
        likelyReason: 'The site SSL/TLS certificate has passed its expiration date.',
        possibleFix: 'Renew the TLS certificate (e.g., via Let’s Encrypt / Certbot or your CA) and reload the web server.',
      };
    }
    if (code.includes('SELF_SIGNED') || code.includes('UNABLE_TO_VERIFY')) {
      return {
        errorCode: code,
        likelyReason: 'The SSL certificate is self-signed or missing an intermediate certificate chain.',
        possibleFix: 'Install a trusted CA certificate with the complete intermediate certificate bundle.',
      };
    }
    return {
      errorCode: code,
      likelyReason: `TLS handshake or certificate validation failed (${code}).`,
      possibleFix: 'Check certificate hostname match (SAN), chain completeness, and supported TLS versions (TLS 1.2/1.3).',
    };
  }

  if (httpStatusCode !== null) {
    const hasCustomStatuses = Boolean(rules?.expectedStatuses && rules.expectedStatuses.length > 0);
    const matchesCustomStatus = hasCustomStatuses
      ? rules!.expectedStatuses!.includes(httpStatusCode)
      : false;

    if (hasCustomStatuses && !matchesCustomStatus) {
      return {
        errorCode: `HTTP_${httpStatusCode}`,
        likelyReason: `Expected HTTP ${rules!.expectedStatuses!.join(', ')}, but server returned HTTP ${httpStatusCode}.`,
        possibleFix: 'Verify the endpoint response or update Expected HTTP Statuses in Project Check Rules.',
      };
    }

    if (!hasCustomStatuses) {
      if (httpStatusCode === 401 || httpStatusCode === 403) {
        return {
          errorCode: `HTTP_${httpStatusCode}`,
          likelyReason:
            httpStatusCode === 403
              ? 'The server or WAF (e.g., Cloudflare) denied the request (403 Forbidden).'
              : 'The endpoint requires authentication credentials (401 Unauthorized).',
          possibleFix:
            httpStatusCode === 403
              ? 'Check WAF/bot protection rules, IP allowlists, or directory permissions on the origin.'
              : 'Verify access tokens or public route configuration if the page should be publicly accessible.',
        };
      }
      if (httpStatusCode === 404) {
        return {
          errorCode: 'HTTP_404',
          likelyReason: 'The server is reachable, but the requested URL path does not exist (404 Not Found).',
          possibleFix: 'Check the URL path for typos, verify routing rules, or restore the missing resource.',
        };
      }
      if (httpStatusCode === 429) {
        return {
          errorCode: 'HTTP_429',
          likelyReason: 'The server is throttling incoming requests due to rate limits (429 Too Many Requests).',
          possibleFix: 'Reduce check frequency or allowlist monitoring requests on your API gateway.',
        };
      }
      if (httpStatusCode >= 500) {
        return {
          errorCode: `HTTP_${httpStatusCode}`,
          likelyReason: `The origin or upstream server encountered an internal failure (${httpStatusCode}).`,
          possibleFix:
            httpStatusCode === 502 || httpStatusCode === 504
              ? 'Check if the upstream app process crashed or timed out behind the reverse proxy.'
              : 'Inspect application error logs, database connectivity, and recent deployments.',
        };
      }
      if (httpStatusCode >= 400) {
        return {
          errorCode: `HTTP_${httpStatusCode}`,
          likelyReason: `The server returned a client error status (${httpStatusCode}).`,
          possibleFix: 'Review the target URL, HTTP method, and server access policies.',
        };
      }
    }
  }

  if (keywordCheck?.checked && !keywordCheck.passed) {
    if (keywordCheck.forbiddenFound) {
      return {
        errorCode: 'FORBIDDEN_KEYWORD_FOUND',
        likelyReason: `Page content contained the forbidden keyword "${keywordCheck.forbiddenKeyword}".`,
        possibleFix: 'Inspect the live site for error notices, maintenance banners, or unexpected content.',
      };
    }
    return {
      errorCode: 'KEYWORD_MISSING',
      likelyReason: `Required keyword "${keywordCheck.expectedKeyword}" was not found in the response body.`,
      possibleFix: 'Check if the page rendered properly, redirected to a login wall, or update the expected keyword.',
    };
  }

  if (status === 'online') {
    if (!ssl.checked) {
      return {
        errorCode: 'NONE',
        likelyReason:
          rules?.expectedStatuses && httpStatusCode !== null
            ? `Website responded with expected status HTTP ${httpStatusCode}.`
            : 'Website responded normally over HTTP or SSL deep inspection was skipped.',
        possibleFix: 'No action required.',
      };
    }
    if (ssl.daysRemaining !== undefined && ssl.daysRemaining <= sslWarningDays) {
      return {
        errorCode: 'SSL_EXPIRING_SOON',
        likelyReason: `Website is online, but the SSL certificate expires in ${ssl.daysRemaining} day(s).`,
        possibleFix: 'Schedule or trigger certificate renewal before expiration.',
      };
    }
    return {
      errorCode: 'NONE',
      likelyReason: 'DNS resolved, TLS certificate is valid, and the HTTP server responded normally.',
      possibleFix: 'No action required.',
    };
  }

  return {
    errorCode: 'UNKNOWN_ERROR',
    likelyReason: 'An unexpected condition occurred while probing the endpoint.',
    possibleFix: 'Re-run the check or inspect server network logs.',
  };
}

interface ProbeAttemptResult {
  finalUrl: URL;
  finalPrimaryIp: string;
  httpStatusCode: number | null;
  httpStatusText: string | null;
  networkErrorCode?: string;
  redirects: RedirectHop[];
  responseTimeMs: number | null;
  sslResult: SslCheckResult;
  bodySnippet?: string;
}

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const raw of setCookies) {
    const firstPart = raw.split(';', 1)[0]?.trim();
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (name) jar.set(name, val);
  }
}

function formatCookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined;
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
  'EPIPE',
  'EAI_AGAIN',
  'ECONNABORTED',
  'FETCH_FAILED',
]);

const RETRYABLE_HTTP_STATUSES = new Set([403, 405, 406, 408, 425, 429, 500, 502, 503, 504]);

async function executeProbeWithRedirects(params: {
  initialUrl: URL;
  initialCandidateIps: string[];
  timeoutMs: number;
  deepInspect: boolean;
  preferredMethod?: 'GET' | 'HEAD' | 'POST';
  customHeaders?: Array<{ key: string; value: string }>;
  captureBody?: boolean;
}): Promise<ProbeAttemptResult> {
  const {
    initialUrl,
    initialCandidateIps,
    timeoutMs,
    deepInspect,
    preferredMethod = 'GET',
    customHeaders,
    captureBody = false,
  } = params;

  const redirects: RedirectHop[] = [];
  const cookieJar = new Map<string, string>();
  let currentUrl = initialUrl;
  let currentIps = initialCandidateIps;
  let finalPrimaryIp = initialCandidateIps[0];
  let httpStatusCode: number | null = null;
  let httpStatusText: string | null = null;
  let networkErrorCode: string | undefined;
  let latestSsl: SslCheckResult | undefined;
  let bodySnippet: string | undefined;

  const startTime = performance.now();
  const maxTotalBudgetMs = Math.round(timeoutMs * 1.6);

  try {
    for (let step = 1; step <= MAX_REDIRECTS; step++) {
      const elapsed = performance.now() - startTime;
      if (elapsed >= maxTotalBudgetMs) {
        networkErrorCode = 'ETIMEDOUT';
        break;
      }

      const hopTimeout = Math.max(2500, Math.min(timeoutMs, Math.round(maxTotalBudgetMs - elapsed)));
      const cookieHeader = formatCookieHeader(cookieJar);

      let response: PinnedHttpResponse | undefined;
      let lastHopError: unknown;

      for (let ipIdx = 0; ipIdx < currentIps.length; ipIdx++) {
        const candidateIp = currentIps[ipIdx];
        try {
          response = await pinnedHttpRequest({
            targetUrl: currentUrl,
            pinnedIp: candidateIp,
            timeoutMs: hopTimeout,
            method: preferredMethod,
            cookieHeader,
            customHeaders,
            captureSsl: deepInspect && currentUrl.protocol === 'https:',
            captureBody,
          });
          finalPrimaryIp = candidateIp;
          break;
        } catch (err: unknown) {
          lastHopError = err;
          const code =
            (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
            (err as { code?: string })?.code ||
            'FETCH_FAILED';
          // Only fail over to another IP if there is another IP and the error is transport/connect related
          if (!TRANSIENT_NETWORK_CODES.has(code) || ipIdx === currentIps.length - 1) {
            throw err;
          }
        }
      }

      if (!response) {
        throw lastHopError || new Error('Request failed');
      }

      if (response.ssl) {
        latestSsl = response.ssl;
      }
      mergeCookies(cookieJar, response.setCookies);

      const status = response.statusCode;
      const locationHeader = response.location;
      const isRedirect = status >= 300 && status < 400 && Boolean(locationHeader);

      redirects.push({
        step,
        url: currentUrl.toString(),
        statusCode: status,
        location: locationHeader,
      });

      httpStatusCode = status;
      httpStatusText = response.statusText;

      if (!isRedirect || !locationHeader) {
        bodySnippet = response.bodySnippet;
        break;
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(locationHeader, currentUrl);
      } catch {
        networkErrorCode = 'INVALID_REDIRECT_URL';
        break;
      }

      if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
        networkErrorCode = 'UNSUPPORTED_REDIRECT_SCHEME';
        break;
      }

      if (nextUrl.hostname !== currentUrl.hostname) {
        const hopDns = await resolvePublicHost(nextUrl.hostname);
        if (!hopDns.resolved || !hopDns.primaryIp) {
          networkErrorCode = hopDns.error || 'REDIRECT_DNS_FAILED';
          currentUrl = nextUrl;
          break;
        }
        currentIps = hopDns.candidateIps || [hopDns.primaryIp];
        finalPrimaryIp = hopDns.primaryIp;
      }

      currentUrl = nextUrl;

      if (step === MAX_REDIRECTS) {
        networkErrorCode = 'TOO_MANY_REDIRECTS';
      }
    }
  } catch (err: unknown) {
    const errObj = err as { name?: string; code?: string; cause?: { code?: string } };
    networkErrorCode = errObj.cause?.code || errObj.code || 'FETCH_FAILED';
  }

  const responseTimeMs =
    networkErrorCode && httpStatusCode === null
      ? null
      : Math.max(1, Math.round(performance.now() - startTime));

  let sslResult: SslCheckResult = { checked: false, valid: false };
  if (deepInspect) {
    if (latestSsl && currentUrl.protocol === 'https:') {
      sslResult = latestSsl;
    } else if (currentUrl.protocol === 'https:' && !networkErrorCode) {
      const port = currentUrl.port ? Number(currentUrl.port) : 443;
      sslResult = await inspectSslCertificate(currentUrl.hostname, port, finalPrimaryIp, timeoutMs);
    } else if (
      initialUrl.protocol === 'https:' &&
      networkErrorCode &&
      networkErrorCode !== 'PRIVATE_NETWORK_BLOCKED' &&
      networkErrorCode !== 'ETIMEDOUT'
    ) {
      const port = initialUrl.port ? Number(initialUrl.port) : 443;
      sslResult = await inspectSslCertificate(
        initialUrl.hostname,
        port,
        initialCandidateIps[0],
        timeoutMs,
      );
    }
  }

  return {
    finalUrl: currentUrl,
    finalPrimaryIp,
    httpStatusCode,
    httpStatusText,
    networkErrorCode,
    redirects,
    responseTimeMs,
    sslResult,
    bodySnippet,
  };
}

function evaluateKeywordCheck(
  bodySnippet: string | undefined,
  rules?: ProjectCheckRules,
): KeywordCheckResult | undefined {
  if (!rules?.expectedKeyword && !rules?.forbiddenKeyword) return undefined;

  if (rules.method === 'HEAD') {
    return {
      checked: false,
      passed: true,
      expectedKeyword: rules.expectedKeyword,
      forbiddenKeyword: rules.forbiddenKeyword,
      detail: 'HEAD requests do not return a body; use GET to verify keywords.',
    };
  }

  if (typeof bodySnippet !== 'string') {
    return {
      checked: false,
      passed: true,
      expectedKeyword: rules.expectedKeyword,
      forbiddenKeyword: rules.forbiddenKeyword,
      detail: 'No response body captured.',
    };
  }

  const lower = bodySnippet.toLowerCase();
  const expectedMatched = rules.expectedKeyword
    ? lower.includes(rules.expectedKeyword.toLowerCase())
    : undefined;
  const forbiddenFound = rules.forbiddenKeyword
    ? lower.includes(rules.forbiddenKeyword.toLowerCase())
    : undefined;
  const passed = expectedMatched !== false && forbiddenFound !== true;

  let detail = 'All keyword rules matched.';
  if (forbiddenFound) {
    detail = `Forbidden text "${rules.forbiddenKeyword}" appeared in response.`;
  } else if (expectedMatched === false) {
    detail = `Required keyword "${rules.expectedKeyword}" was not found.`;
  }

  return {
    checked: true,
    passed,
    expectedKeyword: rules.expectedKeyword,
    expectedMatched,
    forbiddenKeyword: rules.forbiddenKeyword,
    forbiddenFound,
    detail,
  };
}

function classifyProbeOutcome(
  probe: ProbeAttemptResult,
  rules?: ProjectCheckRules,
  keywordCheck?: KeywordCheckResult,
): SiteStatus {
  if (probe.networkErrorCode) {
    return probe.networkErrorCode === 'PRIVATE_NETWORK_BLOCKED' ||
      probe.networkErrorCode === 'TOO_MANY_REDIRECTS'
      ? 'error'
      : 'offline';
  }
  if (probe.httpStatusCode !== null) {
    const statusOk =
      rules?.expectedStatuses && rules.expectedStatuses.length > 0
        ? rules.expectedStatuses.includes(probe.httpStatusCode)
        : probe.httpStatusCode >= 200 && probe.httpStatusCode < 400;

    if (!statusOk) {
      return 'error';
    }
    if (probe.sslResult.checked && !probe.sslResult.valid) {
      return 'error';
    }
    if (keywordCheck?.checked && !keywordCheck.passed) {
      return 'error';
    }
    return 'online';
  }
  return 'offline';
}

async function checkSingleWebsite(inputUrl: string, options?: CheckOptions): Promise<SiteCheckResult> {
  const checkedAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const defaultProtocol = options?.defaultProtocol === 'http' ? 'http' : 'https';
  const rawTimeout = typeof options?.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(20000, Math.max(2000, rawTimeout));
  const deepInspect = options?.deepInspect !== false;
  const rules = sanitizeCheckRules(options?.rules);
  const sslWarningDays =
    typeof options?.sslWarningDays === 'number' && Number.isFinite(options.sslWarningDays)
      ? Math.min(90, Math.max(1, Math.round(options.sslWarningDays)))
      : 14;
  const needBody = Boolean(rules?.expectedKeyword || rules?.forbiddenKeyword);
  const preferredMethod = rules?.method || 'GET';

  const normalized = normalizeUrlInput(inputUrl, defaultProtocol);

  if (!normalized.ok) {
    return {
      id,
      inputUrl,
      normalizedUrl: inputUrl.trim(),
      finalUrl: inputUrl.trim(),
      status: 'error',
      statusLabel: 'Error',
      responseTimeMs: null,
      httpStatusCode: null,
      httpStatusText: null,
      dns: {
        resolved: false,
        hostname: inputUrl.trim(),
        addresses: [],
        error: 'INVALID_URL',
      },
      ssl: {
        checked: false,
        valid: false,
      },
      redirects: [],
      diagnosis: {
        errorCode: 'INVALID_URL',
        likelyReason: normalized.reason,
        possibleFix: 'Enter a valid domain or full URL such as https://example.com.',
      },
      checkedAt,
    };
  }

  let initialUrl = normalized.url;
  const dnsResult = await resolvePublicHost(initialUrl.hostname);

  if (!dnsResult.resolved || !dnsResult.primaryIp) {
    const status: SiteStatus = dnsResult.error === 'PRIVATE_NETWORK_BLOCKED' ? 'error' : 'offline';
    return {
      id,
      inputUrl,
      normalizedUrl: initialUrl.toString(),
      finalUrl: initialUrl.toString(),
      status,
      statusLabel: status === 'error' ? 'Error' : 'Offline',
      responseTimeMs: null,
      httpStatusCode: null,
      httpStatusText: null,
      dns: {
        resolved: false,
        hostname: dnsResult.hostname,
        addresses: [],
        error: dnsResult.error,
      },
      ssl: {
        checked: false,
        valid: false,
      },
      redirects: [],
      diagnosis: buildDiagnosis({
        status,
        httpStatusCode: null,
        dns: dnsResult,
        ssl: { checked: false, valid: false },
        timeoutMs,
      }),
      checkedAt,
    };
  }

  const candidateIps = dnsResult.candidateIps || [dnsResult.primaryIp];
  let probe = await executeProbeWithRedirects({
    initialUrl,
    initialCandidateIps: candidateIps,
    timeoutMs,
    deepInspect,
    preferredMethod,
    customHeaders: rules?.customHeaders,
    captureBody: needBody,
  });
  let keywordCheck = probe.httpStatusCode !== null ? evaluateKeywordCheck(probe.bodySnippet, rules) : undefined;
  let status = classifyProbeOutcome(probe, rules, keywordCheck);

  // Confirmation retry on transient transport errors or suspect HTTP error statuses
  const shouldConfirmRetry =
    status !== 'online' &&
    ((probe.networkErrorCode && TRANSIENT_NETWORK_CODES.has(probe.networkErrorCode)) ||
      (probe.httpStatusCode !== null && RETRYABLE_HTTP_STATUSES.has(probe.httpStatusCode)));

  if (shouldConfirmRetry) {
    await delayMs(350);

    const rotatedIps =
      candidateIps.length > 1 ? [...candidateIps.slice(1), candidateIps[0]] : candidateIps;
    const retryMethod: 'GET' | 'HEAD' | 'POST' =
      rules?.method ||
      (!needBody &&
      (probe.httpStatusCode === 403 || probe.httpStatusCode === 405 || probe.httpStatusCode === 406)
        ? 'HEAD'
        : 'GET');

    const retryProbe = await executeProbeWithRedirects({
      initialUrl,
      initialCandidateIps: rotatedIps,
      timeoutMs: Math.max(timeoutMs, 10000),
      deepInspect,
      preferredMethod: retryMethod,
      customHeaders: rules?.customHeaders,
      captureBody: needBody,
    });
    const retryKeyword =
      retryProbe.httpStatusCode !== null
        ? evaluateKeywordCheck(retryProbe.bodySnippet, rules)
        : undefined;
    const retryStatus = classifyProbeOutcome(retryProbe, rules, retryKeyword);

    if (retryStatus === 'online' || (status === 'offline' && retryStatus === 'error')) {
      probe = retryProbe;
      keywordCheck = retryKeyword;
      status = retryStatus;
    }
  }

  // If the user entered a bare domain (no explicit scheme), defaultProtocol guessed https://,
  // and port 443 is closed/non-TLS (e.g. HTTP-only site), verify http:// before marking offline
  const isPort443RefusedOrNonTls =
    probe.networkErrorCode === 'ECONNREFUSED' ||
    probe.networkErrorCode === 'EPROTO' ||
    (probe.networkErrorCode?.startsWith('ERR_SSL_') ?? false);

  if (
    status !== 'online' &&
    !normalized.hasExplicitScheme &&
    initialUrl.protocol === 'https:' &&
    isPort443RefusedOrNonTls
  ) {
    const httpFallbackUrl = new URL(initialUrl.toString());
    httpFallbackUrl.protocol = 'http:';
    const httpProbe = await executeProbeWithRedirects({
      initialUrl: httpFallbackUrl,
      initialCandidateIps: candidateIps,
      timeoutMs,
      deepInspect,
      preferredMethod,
      customHeaders: rules?.customHeaders,
      captureBody: needBody,
    });
    const httpKeyword =
      httpProbe.httpStatusCode !== null
        ? evaluateKeywordCheck(httpProbe.bodySnippet, rules)
        : undefined;
    const httpStatus = classifyProbeOutcome(httpProbe, rules, httpKeyword);
    if (httpStatus === 'online') {
      initialUrl = httpFallbackUrl;
      probe = httpProbe;
      keywordCheck = httpKeyword;
      status = httpStatus;
    }
  }

  const statusLabel = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Error';

  return {
    id,
    inputUrl,
    normalizedUrl: initialUrl.toString(),
    finalUrl: probe.finalUrl.toString(),
    status,
    statusLabel,
    responseTimeMs: probe.responseTimeMs,
    httpStatusCode: probe.httpStatusCode,
    httpStatusText: probe.httpStatusText,
    dns: {
      resolved: dnsResult.resolved,
      hostname: dnsResult.hostname,
      addresses: dnsResult.addresses,
      error: dnsResult.error,
    },
    ssl: probe.sslResult,
    ...(keywordCheck ? { keywordCheck } : {}),
    redirects: probe.redirects,
    diagnosis: buildDiagnosis({
      status,
      httpStatusCode: probe.httpStatusCode,
      dns: dnsResult,
      ssl: probe.sslResult,
      networkErrorCode: probe.networkErrorCode,
      timeoutMs,
      rules,
      keywordCheck,
      sslWarningDays,
    }),
    checkedAt,
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      results[idx] = await worker(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

const SESSION_COOKIE_NAME = 'upsite_session';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = typeof forwarded === 'string' ? forwarded.split(',')[0].trim().toLowerCase() : '';
  return Boolean(req.secure || proto === 'https');
}

function setSessionCookie(req: Request, res: Response, token: string, ttlMs: number): void {
  const maxAgeSec = Math.max(60, Math.floor(ttlMs / 1000));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly'];
  if (isHttpsRequest(req)) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token = '';
  let usedCookie = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      token = cookies[SESSION_COOKIE_NAME];
      usedCookie = true;
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (usedCookie && isMutation && req.headers['x-requested-with'] !== 'upsite-app') {
    res.status(403).json({ error: 'Forbidden request origin.' });
    return;
  }

  const userId = verifySessionToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  req.userId = userId;
  next();
}

function sanitizeAutoRefresh(val: unknown): AutoRefreshInterval {
  if (val === 0) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) {
    const rounded = Math.round(val);
    if (rounded >= 60 && rounded <= 86400) {
      return rounded;
    }
  }
  return 0;
}

function sanitizeReportPayload(raw: unknown): ReportDispatchPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ReportDispatchPayload>;
  if (!Array.isArray(obj.sites) || obj.sites.length === 0) return null;

  const sites = obj.sites
    .filter((s) => Boolean(s && typeof s === 'object'))
    .slice(0, 60)
    .map((s) => ({
      projectName: typeof s.projectName === 'string' ? s.projectName.slice(0, 80) : undefined,
      url: typeof s.url === 'string' ? s.url.slice(0, 500) : 'Unknown URL',
      status: (s.status === 'online' || s.status === 'offline' || s.status === 'error'
        ? s.status
        : 'error') as SiteStatus,
      statusLabel: (s.statusLabel === 'Online' || s.statusLabel === 'Offline' || s.statusLabel === 'Error'
        ? s.statusLabel
        : 'Error') as 'Online' | 'Offline' | 'Error',
      httpStatusCode: typeof s.httpStatusCode === 'number' ? s.httpStatusCode : null,
      responseTimeMs: typeof s.responseTimeMs === 'number' ? s.responseTimeMs : null,
      errorCode: typeof s.errorCode === 'string' ? s.errorCode.slice(0, 60) : 'UNKNOWN',
      likelyReason: typeof s.likelyReason === 'string' ? s.likelyReason.slice(0, 240) : undefined,
    }));

  if (sites.length === 0) return null;

  const onlineCount = sites.filter((s) => s.status === 'online').length;
  const offlineCount = sites.filter((s) => s.status === 'offline').length;
  const errorCount = sites.filter((s) => s.status === 'error').length;
  const latencies = sites
    .map((s) => s.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : null;

  return {
    title:
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim().slice(0, 120)
        : 'upsite Availability Report',
    source:
      typeof obj.source === 'string' && obj.source.trim()
        ? obj.source.trim().slice(0, 100)
        : 'upsite Monitor',
    generatedAt:
      typeof obj.generatedAt === 'string' && obj.generatedAt
        ? obj.generatedAt
        : new Date().toISOString(),
    totalCount: sites.length,
    onlineCount,
    offlineCount,
    errorCount,
    avgLatencyMs,
    sites,
  };
}

function buildWebhookBody(provider: IntegrationProvider, report: ReportDispatchPayload): string {
  const issues = report.sites.filter((s) => s.status !== 'online');
  const previewSites = (issues.length > 0 ? issues : report.sites).slice(0, 15);
  const summaryLine = `${report.totalCount} checked · ${report.onlineCount} online · ${report.offlineCount} offline · ${report.errorCount} error${
    report.avgLatencyMs !== null ? ` · Avg ${report.avgLatencyMs} ms` : ''
  }`;

  const formatSiteLine = (s: ReportDispatchPayload['sites'][number]) => {
    const prefix = s.projectName ? `[${s.projectName}] ` : '';
    const httpPart = s.httpStatusCode !== null ? `HTTP ${s.httpStatusCode}` : 'No HTTP';
    const msPart = s.responseTimeMs !== null ? `${s.responseTimeMs} ms` : '—';
    const errPart = s.errorCode !== 'NONE' ? ` · ${s.errorCode}` : '';
    return `${s.status === 'online' ? '✅' : s.status === 'offline' ? '❌' : '⚠️'} ${prefix}${s.url} — ${s.statusLabel} (${httpPart}, ${msPart}${errPart})`;
  };

  const linesText = previewSites.map(formatSiteLine).join('\n');
  const remainingNote =
    (issues.length > 0 ? issues.length : report.sites.length) > previewSites.length
      ? `\n...and ${(issues.length > 0 ? issues.length : report.sites.length) - previewSites.length} more.`
      : '';

  if (provider === 'teams') {
    const facts = previewSites.slice(0, 12).map((s) => ({
      title: `${s.statusLabel}${s.projectName ? ` · ${s.projectName}` : ''}`,
      value: `${s.url} (${s.httpStatusCode !== null ? `HTTP ${s.httpStatusCode}` : 'No HTTP'}, ${
        s.responseTimeMs !== null ? `${s.responseTimeMs} ms` : '—'
      }${s.errorCode !== 'NONE' ? `, ${s.errorCode}` : ''})`,
    }));

    return JSON.stringify({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: report.title,
                weight: 'Bolder',
                size: 'Medium',
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: `${report.source} · ${summaryLine}`,
                isSubtle: true,
                wrap: true,
                spacing: 'Small',
              },
              {
                type: 'FactSet',
                facts,
                spacing: 'Medium',
              },
              ...(remainingNote
                ? [
                    {
                      type: 'TextBlock',
                      text: remainingNote.trim(),
                      isSubtle: true,
                      size: 'Small',
                      wrap: true,
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    });
  }

  if (provider === 'slack') {
    return JSON.stringify({
      text: `${report.title}: ${summaryLine}\n${linesText}${remainingNote}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: report.title.slice(0, 140) },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${report.source}*\n${summaryLine}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${linesText}${remainingNote}`.slice(0, 2900),
          },
        },
      ],
    });
  }

  if (provider === 'discord') {
    const color =
      report.offlineCount > 0 ? 0xe11d48 : report.errorCount > 0 ? 0xd97706 : 0x10b981;
    return JSON.stringify({
      content: `${report.title} — ${summaryLine}`,
      embeds: [
        {
          title: report.title.slice(0, 250),
          description: `${linesText}${remainingNote}`.slice(0, 3800),
          color,
          fields: [
            { name: 'Online', value: String(report.onlineCount), inline: true },
            { name: 'Offline', value: String(report.offlineCount), inline: true },
            { name: 'Error', value: String(report.errorCount), inline: true },
          ],
          footer: { text: report.source },
          timestamp: report.generatedAt,
        },
      ],
    });
  }

  return JSON.stringify({
    service: 'upsite',
    title: report.title,
    source: report.source,
    text: `${report.title} (${summaryLine})\n${linesText}${remainingNote}`,
    summary: summaryLine,
    counts: {
      total: report.totalCount,
      online: report.onlineCount,
      offline: report.offlineCount,
      error: report.errorCount,
    },
    avgLatencyMs: report.avgLatencyMs,
    generatedAt: report.generatedAt,
    sites: report.sites,
  });
}

function pinnedHttpsJsonPost(
  targetUrl: URL,
  pinnedIp: string,
  jsonBody: string,
  timeoutMs = 9000,
): Promise<{ statusCode: number; responseBody: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ipFamily = net.isIP(pinnedIp) === 6 ? 6 : 4;
    const port = targetUrl.port ? Number(targetUrl.port) : 443;

    const pinnedLookup: Parameters<typeof https.request>[1]['lookup'] = (
      _hostname,
      options,
      callback,
    ) => {
      if (typeof options === 'object' && options?.all) {
        callback(null, [{ address: pinnedIp, family: ipFamily }]);
      } else {
        callback(null, pinnedIp, ipFamily);
      }
    };

    const req = https.request(
      {
        agent: false,
        protocol: 'https:',
        hostname: targetUrl.hostname,
        port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'POST',
        timeout: timeoutMs,
        lookup: pinnedLookup,
        rejectUnauthorized: true,
        servername: net.isIP(targetUrl.hostname) ? undefined : targetUrl.hostname,
        headers: {
          Host: targetUrl.host,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(jsonBody, 'utf8'),
          'User-Agent': 'upsite-report-webhook/1.0',
          Connection: 'close',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          if (chunks.reduce((sum, b) => sum + b.length, 0) < 4096) {
            chunks.push(chunk);
          }
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: res.statusCode ?? 0,
            responseBody: Buffer.concat(chunks).toString('utf8').slice(0, 300),
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Webhook request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.write(jsonBody);
    req.end();
  });
}

async function sendWebhookReport(
  channel: IntegrationChannel,
  report: ReportDispatchPayload,
): Promise<{ ok: boolean; statusCode?: number; message: string }> {
  let parsed: URL;
  try {
    parsed = new URL(channel.webhookUrl.trim());
  } catch {
    return { ok: false, statusCode: 400, message: `Invalid webhook URL for ${channel.name}.` };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      statusCode: 400,
      message: `${channel.name}: Webhook URL must use https://.`,
    };
  }

  const dnsResult = await resolvePublicHost(parsed.hostname);
  if (!dnsResult.resolved || !dnsResult.primaryIp) {
    return {
      ok: false,
      statusCode: 400,
      message:
        dnsResult.error === 'PRIVATE_NETWORK_BLOCKED'
          ? `${channel.name}: Localhost and private network webhook addresses are not permitted.`
          : `${channel.name}: Could not resolve webhook host (${dnsResult.error || 'DNS_ERROR'}).`,
    };
  }

  const payloadBody = buildWebhookBody(channel.provider, report);
  try {
    const res = await pinnedHttpsJsonPost(parsed, dnsResult.primaryIp, payloadBody);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { ok: true, statusCode: res.statusCode, message: `Sent to ${channel.name}.` };
    }
    return {
      ok: false,
      statusCode: 502,
      message: `${channel.name} returned HTTP ${res.statusCode}${
        res.responseBody ? `: ${res.responseBody}` : ''
      }`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      statusCode: 502,
      message: `${channel.name} delivery failed: ${
        err instanceof Error ? err.message : 'Network error'
      }`,
    };
  }
}

export async function createServer() {
  ensureInitialized();

  const app = express();
  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'upsite' });
  });

  // Authentication Routes (Rate-limited)
  app.post('/api/auth/register', authRateLimit, (req: Request, res: Response) => {
    const body = req.body as {
      username?: unknown;
      password?: unknown;
      accessToken?: unknown;
      rememberMe?: unknown;
    };
    if (
      typeof body?.username !== 'string' ||
      typeof body?.password !== 'string' ||
      typeof body?.accessToken !== 'string'
    ) {
      res.status(400).json({ error: 'Username, password, and 10-character access token are required.' });
      return;
    }

    const result = registerWithToken({
      username: body.username,
      password: body.password,
      accessToken: body.accessToken,
      rememberMe: true,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    setSessionCookie(req, res, result.sessionToken, result.ttlMs);

    const profile = getUserProfileAndWorkspace(result.user.id);
    res.status(201).json({
      sessionToken: result.sessionToken,
      user: result.user,
      workspace: profile?.workspace,
    });
  });

  app.post('/api/auth/login', authRateLimit, (req: Request, res: Response) => {
    const body = req.body as { username?: unknown; password?: unknown; rememberMe?: unknown };
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const rememberMe = body.rememberMe !== false;
    const result = loginWithCredentials({
      username: body.username,
      password: body.password,
      rememberMe,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    if (rememberMe) {
      setSessionCookie(req, res, result.sessionToken, result.ttlMs);
    } else {
      clearSessionCookie(req, res);
    }

    const profile = getUserProfileAndWorkspace(result.user.id);
    res.json({
      sessionToken: result.sessionToken,
      user: result.user,
      workspace: profile?.workspace,
    });
  });

  app.post('/api/auth/token-login', authRateLimit, (req: Request, res: Response) => {
    const body = req.body as { accessToken?: unknown; rememberMe?: unknown };
    if (typeof body?.accessToken !== 'string') {
      res.status(400).json({ error: 'Provide a 10-character access token.' });
      return;
    }

    const rememberMe = body.rememberMe !== false;
    const result = loginWithAccessToken(body.accessToken, rememberMe);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    if (rememberMe) {
      setSessionCookie(req, res, result.sessionToken, result.ttlMs);
    } else {
      clearSessionCookie(req, res);
    }

    const profile = getUserProfileAndWorkspace(result.user.id);
    res.json({
      sessionToken: result.sessionToken,
      user: result.user,
      workspace: profile?.workspace,
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const profile = req.userId ? getUserProfileAndWorkspace(req.userId) : null;
    if (!profile) {
      clearSessionCookie(req, res);
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie);
    const activeToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : cookies[SESSION_COOKIE_NAME];
    if (activeToken) {
      setSessionCookie(req, res, activeToken, SESSION_REMEMBER_TTL_MS);
    }
    res.json(profile);
  });

  // Protected Website Checking Routes
  app.post('/api/check', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { url?: unknown; options?: CheckOptions; skipHistory?: unknown };
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      res.status(400).json({ error: 'Provide a non-empty "url" string.' });
      return;
    }
    const result = await checkSingleWebsite(body.url, body.options);
    const history =
      req.userId && body.skipHistory !== true
        ? appendUserHistory(req.userId, [result])
        : undefined;
    res.json({ result, history });
  });

  app.post('/api/check-bulk', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { urls?: unknown; options?: CheckOptions; skipHistory?: unknown };
    if (!Array.isArray(body?.urls)) {
      res.status(400).json({ error: 'Provide a "urls" array of URL strings.' });
      return;
    }

    const cleaned = body.urls
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_BULK_URLS);

    if (cleaned.length === 0) {
      res.status(400).json({ error: 'Provide at least one valid URL.' });
      return;
    }

    const results = await runWithConcurrency(cleaned, CONCURRENCY_LIMIT, (url) =>
      checkSingleWebsite(url, body.options),
    );
    const history =
      req.userId && body.skipHistory !== true
        ? appendUserHistory(req.userId, results)
        : undefined;
    res.json({ results, history });
  });

  // Protected User Workspace Routes
  app.delete('/api/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.userId) {
      clearUserHistory(req.userId);
    }
    res.json({ ok: true });
  });

  app.post('/api/history/deduplicate', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const history = req.userId ? deduplicateUserHistory(req.userId) : [];
    res.json({ history });
  });

  app.put('/api/organisations', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { organisations?: unknown };
    if (!Array.isArray(body?.organisations)) {
      res.status(400).json({ error: 'Invalid organisations payload.' });
      return;
    }

    const sanitized: Organisation[] = body.organisations
      .filter((org): org is Organisation => Boolean(org && typeof org === 'object'))
      .slice(0, 50)
      .map((org) => ({
        id: typeof org.id === 'string' && org.id ? org.id : crypto.randomUUID(),
        name: typeof org.name === 'string' ? org.name.trim().slice(0, 80) : 'Untitled Organisation',
        autoRefreshSec: sanitizeAutoRefresh(org.autoRefreshSec),
        checkWindow: sanitizeCheckWindow(org.checkWindow),
        maintenanceUntil:
          typeof org.maintenanceUntil === 'string' && org.maintenanceUntil
            ? org.maintenanceUntil.slice(0, 64)
            : undefined,
        maintenanceReason:
          typeof org.maintenanceReason === 'string' && org.maintenanceReason.trim()
            ? org.maintenanceReason.trim().slice(0, 120)
            : undefined,
        createdAt: typeof org.createdAt === 'string' ? org.createdAt : new Date().toISOString(),
        projects: Array.isArray(org.projects)
          ? sortProjectsByName(
              org.projects
                .filter((p) => Boolean(p && typeof p === 'object'))
                .slice(0, 100)
                .map((p) => ({
                  id: typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID(),
                  name: typeof p.name === 'string' ? p.name.trim().slice(0, 80) : 'Untitled Project',
                  urls: Array.isArray(p.urls)
                    ? p.urls
                        .filter((u): u is string => typeof u === 'string')
                        .map((u) => u.trim())
                        .filter(Boolean)
                        .slice(0, 50)
                    : [],
                  checkRules: sanitizeCheckRules(p.checkRules),
                  lastResults: Array.isArray(p.lastResults) ? p.lastResults.slice(0, 50) : undefined,
                  lastCheckedAt: typeof p.lastCheckedAt === 'string' ? p.lastCheckedAt : undefined,
                  createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
                })),
            )
          : [],
      }));

    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const saved = saveUserOrganisations(req.userId, sanitized);
    res.json({ organisations: saved });
  });

  app.put('/api/incidents', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { incidents?: unknown };
    if (!Array.isArray(body?.incidents)) {
      res.status(400).json({ error: 'Invalid incidents payload.' });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const saved = saveUserIncidents(req.userId, body.incidents as IncidentRecord[]);
    res.json({ incidents: saved });
  });

  app.delete('/api/incidents', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.userId) {
      clearUserIncidents(req.userId);
    }
    res.json({ ok: true });
  });

  app.put('/api/settings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { settings?: Partial<UserSettings> };
    if (!body?.settings || typeof body.settings !== 'object') {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const updated = updateUserSettings(req.userId, body.settings);
    res.json({ settings: updated });
  });

  app.put('/api/checker-input', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { checkerInput?: unknown };
    if (typeof body?.checkerInput !== 'string') {
      res.status(400).json({ error: 'Invalid checker input payload.' });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const checkerInput = saveUserCheckerInput(req.userId, body.checkerInput);
    res.json({ checkerInput });
  });

  // Protected App Integrations Routes (Microsoft Teams, Slack, Discord, Custom Webhooks)
  app.post('/api/integrations/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { provider?: unknown; webhookUrl?: unknown; name?: unknown };
    if (typeof body?.webhookUrl !== 'string' || !body.webhookUrl.trim()) {
      res.status(400).json({ error: 'Provide an HTTPS webhook URL to test.' });
      return;
    }
    const provider: IntegrationProvider =
      body.provider === 'teams' ||
      body.provider === 'slack' ||
      body.provider === 'discord' ||
      body.provider === 'webhook'
        ? body.provider
        : 'webhook';
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : provider;

    const sampleReport: ReportDispatchPayload = {
      title: 'upsite Connection Test',
      source: 'Settings Integration Test',
      generatedAt: new Date().toISOString(),
      totalCount: 2,
      onlineCount: 2,
      offlineCount: 0,
      errorCount: 0,
      avgLatencyMs: 124,
      sites: [
        {
          url: 'https://example.com/',
          status: 'online',
          statusLabel: 'Online',
          httpStatusCode: 200,
          responseTimeMs: 112,
          errorCode: 'NONE',
        },
        {
          url: 'https://api.example.com/',
          status: 'online',
          statusLabel: 'Online',
          httpStatusCode: 200,
          responseTimeMs: 136,
          errorCode: 'NONE',
        },
      ],
    };

    const result = await sendWebhookReport(
      {
        id: 'test',
        name,
        provider,
        webhookUrl: body.webhookUrl.trim(),
        enabled: true,
        autoSendOnOrgRun: false,
        onlyOnIssues: false,
      },
      sampleReport,
    );

    if (!result.ok) {
      res.status(result.statusCode || 400).json({ error: result.message });
      return;
    }
    res.json({ ok: true, message: result.message });
  });

  app.post('/api/integrations/send', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const body = req.body as { channelIds?: unknown; report?: unknown };
    const report = sanitizeReportPayload(body?.report);
    if (!report) {
      res.status(400).json({ error: 'Invalid report payload.' });
      return;
    }

    const profile = getUserProfileAndWorkspace(req.userId);
    const savedChannels = profile?.workspace.settings.integrations || [];
    const requestedIds = Array.isArray(body?.channelIds)
      ? new Set(body.channelIds.filter((id): id is string => typeof id === 'string'))
      : null;

    const targets = savedChannels.filter((ch) => {
      if (!ch.enabled) return false;
      if (requestedIds && requestedIds.size > 0) {
        return requestedIds.has(ch.id);
      }
      return true;
    });

    if (targets.length === 0) {
      res.status(400).json({ error: 'No enabled app integrations matched this request.' });
      return;
    }

    const results = await Promise.all(
      targets.map(async (channel) => {
        const resItem = await sendWebhookReport(channel, report);
        return {
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          ok: resItem.ok,
          error: resItem.ok ? undefined : resItem.message,
        };
      }),
    );

    const sentCount = results.filter((o) => o.ok).length;
    res.json({
      ok: sentCount > 0,
      sentCount,
      totalTargets: results.length,
      results,
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = fs.existsSync(path.resolve(__dirname, 'dist'))
    ? path.resolve(__dirname, 'dist')
    : path.resolve(__dirname, '..', 'dist');

  if (!isProd && fs.existsSync(path.resolve(__dirname, 'index.html'))) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createServer()
    .then((app) => {
      app.listen(port, host, () => {
        console.log(`upsite server listening on http://${host}:${port}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start upsite server:', err);
      process.exit(1);
    });
}
