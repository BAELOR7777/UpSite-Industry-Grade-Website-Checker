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
  ensureInitialized,
  getUserProfileAndWorkspace,
  loginWithAccessToken,
  loginWithCredentials,
  registerWithToken,
  sanitizeCheckWindow,
  saveUserCheckerInput,
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
  Organisation,
  RedirectHop,
  SiteCheckResult,
  SiteStatus,
  SslCheckResult,
  UserSettings,
} from './src/types/upsite.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_BULK_URLS = 60;
const CONCURRENCY_LIMIT = 8;
const DEFAULT_TIMEOUT_MS = 8500;
const MAX_REDIRECTS = 10;
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX = 15;

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
): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'URL is empty.' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'URL exceeds maximum length of 2048 characters.' };
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `${defaultProtocol}://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Only HTTP and HTTPS protocols are supported.' };
    }
    if (!parsed.hostname || parsed.hostname.length > 253) {
      return { ok: false, reason: 'Invalid hostname.' };
    }
    return { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: 'Invalid URL format.' };
  }
}

async function resolvePublicHost(hostname: string): Promise<DnsCheckResult & { primaryIp?: string }> {
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
    };
  }

  try {
    const lookupPromise = dns.promises.lookup(hostname, { all: true, verbatim: true });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEOUT' })), 4000);
    });

    const records = await Promise.race([lookupPromise, timeoutPromise]);
    const addresses = Array.from(new Set(records.map((r) => r.address)));

    if (addresses.length === 0) {
      return {
        resolved: false,
        hostname,
        addresses: [],
        error: 'ENOTFOUND',
      };
    }

    if (addresses.some((addr) => isPrivateOrReservedIp(addr))) {
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
      addresses,
      primaryIp: addresses[0],
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || 'DNS_ERROR';
    return {
      resolved: false,
      hostname,
      addresses: [],
      error: code,
    };
  }
}

function pinnedHttpRequest(
  targetUrl: URL,
  pinnedIp: string,
  timeoutMs: number,
): Promise<{ statusCode: number; statusText: string | null; location?: string }> {
  return new Promise((resolve, reject) => {
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

    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'GET',
        timeout: timeoutMs,
        lookup: pinnedLookup,
        rejectUnauthorized: false,
        servername: net.isIP(targetUrl.hostname) ? undefined : targetUrl.hostname,
        headers: {
          Host: targetUrl.host,
          'User-Agent': 'upsite-availability-checker/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Connection: 'close',
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const statusText = res.statusMessage || null;
        const rawLocation = res.headers.location;
        const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
        res.destroy();
        resolve({ statusCode, statusText, location });
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

async function inspectSslCertificate(hostname: string, port: number, connectIp?: string): Promise<SslCheckResult> {
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
        timeout: 4500,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(false);
          const protocol = socket.getProtocol() || undefined;
          const authorized = socket.authorized;
          const authError = socket.authorizationError ? String(socket.authorizationError) : undefined;

          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            finish({
              checked: true,
              valid: false,
              protocol,
              error: authError || 'NO_CERTIFICATE',
            });
            return;
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

          socket.destroy();
          finish({
            checked: true,
            valid: authorized && (daysRemaining === undefined || daysRemaining >= 0),
            protocol,
            issuer,
            subject,
            validFrom,
            validTo,
            daysRemaining,
            error: authorized ? undefined : authError || 'CERT_UNTRUSTED',
          });
        } catch (err: unknown) {
          socket.destroy();
          finish({
            checked: true,
            valid: false,
            error: (err as Error)?.message || 'TLS_INSPECTION_ERROR',
          });
        }
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
}): DiagnosisInfo {
  const { status, httpStatusCode, dns: dnsRes, ssl, networkErrorCode, timeoutMs } = params;

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

  if (status === 'online') {
    if (!ssl.checked) {
      return {
        errorCode: 'NONE',
        likelyReason: 'Website responded normally over HTTP or SSL deep inspection was skipped.',
        possibleFix: 'No action required.',
      };
    }
    if (ssl.daysRemaining !== undefined && ssl.daysRemaining <= 14) {
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

async function checkSingleWebsite(inputUrl: string, options?: CheckOptions): Promise<SiteCheckResult> {
  const checkedAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const defaultProtocol = options?.defaultProtocol === 'http' ? 'http' : 'https';
  const rawTimeout = typeof options?.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(20000, Math.max(2000, rawTimeout));
  const deepInspect = options?.deepInspect !== false;

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

  const initialUrl = normalized.url;
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

  const redirects: RedirectHop[] = [];
  let currentUrl = initialUrl;
  let currentPrimaryIp = dnsResult.primaryIp;
  let httpStatusCode: number | null = null;
  let httpStatusText: string | null = null;
  let networkErrorCode: string | undefined;

  const startTime = performance.now();

  try {
    for (let step = 1; step <= MAX_REDIRECTS; step++) {
      const elapsed = performance.now() - startTime;
      const remainingTimeout = Math.max(500, Math.round(timeoutMs - elapsed));
      if (elapsed >= timeoutMs) {
        networkErrorCode = 'ETIMEDOUT';
        break;
      }

      const response = await pinnedHttpRequest(currentUrl, currentPrimaryIp, remainingTimeout);
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
        currentPrimaryIp = hopDns.primaryIp;
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
    if (currentUrl.protocol === 'https:' && !networkErrorCode) {
      const port = currentUrl.port ? Number(currentUrl.port) : 443;
      sslResult = await inspectSslCertificate(currentUrl.hostname, port, currentPrimaryIp);
    } else if (initialUrl.protocol === 'https:' && networkErrorCode !== 'PRIVATE_NETWORK_BLOCKED') {
      const port = initialUrl.port ? Number(initialUrl.port) : 443;
      sslResult = await inspectSslCertificate(initialUrl.hostname, port, dnsResult.primaryIp);
    }
  }

  let status: SiteStatus = 'offline';
  if (networkErrorCode) {
    status =
      networkErrorCode === 'PRIVATE_NETWORK_BLOCKED' || networkErrorCode === 'TOO_MANY_REDIRECTS'
        ? 'error'
        : 'offline';
  } else if (httpStatusCode !== null) {
    if (httpStatusCode >= 200 && httpStatusCode < 400) {
      status = sslResult.checked && !sslResult.valid ? 'error' : 'online';
    } else {
      status = 'error';
    }
  }

  const statusLabel = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Error';

  return {
    id,
    inputUrl,
    normalizedUrl: initialUrl.toString(),
    finalUrl: currentUrl.toString(),
    status,
    statusLabel,
    responseTimeMs,
    httpStatusCode,
    httpStatusText,
    dns: {
      resolved: dnsResult.resolved,
      hostname: dnsResult.hostname,
      addresses: dnsResult.addresses,
      error: dnsResult.error,
    },
    ssl: sslResult,
    redirects,
    diagnosis: buildDiagnosis({
      status,
      httpStatusCode,
      dns: dnsResult,
      ssl: sslResult,
      networkErrorCode,
      timeoutMs,
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
