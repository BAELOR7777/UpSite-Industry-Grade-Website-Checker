import type { ProjectRecord } from '../types/upsite';
import { sortProjectsByName } from './organisations';

export interface ImportedProjectDraft {
  tempId: string;
  name: string;
  urls: string[];
  sourceHint?: string;
}

export interface UpsiteProjectBundle {
  format: 'upsite-projects-v1';
  exportedAt: string;
  sourceOrganisation: string;
  projects: Array<{
    name: string;
    urls: string[];
  }>;
}

const TWO_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'co.za',
  'com.br',
  'com.ng',
  'com.gh',
  'co.in',
  'com.sg',
  'com.mx',
  'github.io',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'onrender.com',
  'herokuapp.com',
  'appspot.com',
]);

function slugify(value: string, fallback = 'org'): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}

function sanitizeProjectName(raw: string, fallback = 'Imported Project'): string {
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return cleaned || fallback;
}

function escapeCsvField(value: string | number | null | undefined): string {
  let str = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseRawUrlTokens(raw: string): string[] {
  const tokens = raw
    .split(/[\n,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

export function extractDomainGroupKey(
  rawUrl: string,
  defaultProtocol: 'https' | 'http' = 'https',
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `${defaultProtocol}://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
      return host;
    }
    const labels = host.split('.').filter(Boolean);
    if (labels.length <= 2) {
      return host;
    }
    const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
      return labels.slice(-3).join('.');
    }
    return lastTwo;
  } catch {
    return null;
  }
}

export function groupUrlsByDomain(
  rawText: string,
  defaultProtocol: 'https' | 'http' = 'https',
): ImportedProjectDraft[] {
  const tokens = parseRawUrlTokens(rawText);
  const grouped = new Map<string, string[]>();

  for (const token of tokens) {
    const domain = extractDomainGroupKey(token, defaultProtocol);
    if (!domain) continue;
    const list = grouped.get(domain) || [];
    if (!list.includes(token) && list.length < 50) {
      list.push(token);
      grouped.set(domain, list);
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([domain, urls]) => ({
      tempId: crypto.randomUUID(),
      name: domain,
      urls,
      sourceHint: `Domain: ${domain}`,
    }));
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeProjectList(
  items: Array<{ name?: unknown; urls?: unknown }>,
  sourceHint: string,
): ImportedProjectDraft[] {
  const drafts: ImportedProjectDraft[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rawName = typeof item.name === 'string' ? item.name : '';
    const urls = Array.isArray(item.urls)
      ? Array.from(
          new Set(
            item.urls
              .filter((u): u is string => typeof u === 'string')
              .map((u) => u.trim())
              .filter(Boolean),
          ),
        ).slice(0, 50)
      : [];
    if (urls.length === 0) continue;
    drafts.push({
      tempId: crypto.randomUUID(),
      name: sanitizeProjectName(rawName, extractDomainGroupKey(urls[0]) || 'Imported Project'),
      urls,
      sourceHint,
    });
  }
  return drafts.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

export function parseProjectsFromFileContent(
  filename: string,
  content: string,
  defaultProtocol: 'https' | 'http' = 'https',
): { projects: ImportedProjectDraft[]; summary: string } {
  const lowerName = filename.toLowerCase();
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('The selected file is empty.');
  }

  // 1. JSON Bundle (upsite-projects-v1, array of projects, or organisations export)
  if (
    lowerName.endsWith('.json') ||
    (!lowerName.endsWith('.txt') &&
      !lowerName.endsWith('.csv') &&
      (trimmed.startsWith('{') || trimmed.startsWith('[')))
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON file format.');
    }

    if (Array.isArray(parsed)) {
      const drafts = normalizeProjectList(
        parsed as Array<{ name?: unknown; urls?: unknown }>,
        'JSON list',
      );
      if (drafts.length === 0) {
        throw new Error('No valid projects with URLs were found in this JSON file.');
      }
      return { projects: drafts, summary: `${drafts.length} project(s) read from JSON file` };
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.projects)) {
        const drafts = normalizeProjectList(
          obj.projects as Array<{ name?: unknown; urls?: unknown }>,
          typeof obj.sourceOrganisation === 'string'
            ? `From ${obj.sourceOrganisation}`
            : 'upsite bundle',
        );
        if (drafts.length > 0) {
          return {
            projects: drafts,
            summary: `${drafts.length} project(s) read from ${
              typeof obj.sourceOrganisation === 'string' ? obj.sourceOrganisation : 'JSON bundle'
            }`,
          };
        }
      }

      if (Array.isArray(obj.organisations)) {
        const combined: Array<{ name?: unknown; urls?: unknown }> = [];
        for (const org of obj.organisations) {
          if (org && typeof org === 'object' && Array.isArray((org as { projects?: unknown }).projects)) {
            combined.push(
              ...((org as { projects: Array<{ name?: unknown; urls?: unknown }> }).projects),
            );
          }
        }
        const drafts = normalizeProjectList(combined, 'Organisation bundle');
        if (drafts.length > 0) {
          return { projects: drafts, summary: `${drafts.length} project(s) read from JSON bundle` };
        }
      }
    }

    throw new Error('No projects with URLs were found in this JSON file.');
  }

  // 2. CSV file (supports Project + URL columns or raw URL list)
  if (lowerName.endsWith('.csv')) {
    const rows = parseCsvRows(trimmed);
    if (rows.length === 0) {
      throw new Error('No rows found in this CSV file.');
    }

    const headerLower = rows[0].map((col) => col.toLowerCase().trim());
    const projIdx = headerLower.findIndex((h) => h === 'project' || h === 'project name');
    const urlIdx = headerLower.findIndex(
      (h) => h === 'url' || h === 'normalized url' || h === 'website' || h === 'site',
    );

    if (projIdx !== -1 && urlIdx !== -1 && rows.length > 1) {
      const grouped = new Map<string, string[]>();
      for (let i = 1; i < rows.length; i += 1) {
        const r = rows[i];
        const rawUrl = (r[urlIdx] || '').trim();
        if (!rawUrl) continue;
        const projName = sanitizeProjectName(
          r[projIdx] || '',
          extractDomainGroupKey(rawUrl, defaultProtocol) || 'Imported Project',
        );
        const list = grouped.get(projName) || [];
        if (!list.includes(rawUrl) && list.length < 50) {
          list.push(rawUrl);
          grouped.set(projName, list);
        }
      }

      const drafts = Array.from(grouped.entries())
        .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
        .map(([name, urls]) => ({
          tempId: crypto.randomUUID(),
          name,
          urls,
          sourceHint: 'CSV Project column',
        }));

      if (drafts.length === 0) {
        throw new Error('No valid URLs found in the CSV URL column.');
      }
      return { projects: drafts, summary: `${drafts.length} project(s) read from CSV` };
    }

    const extractedUrls: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (const cell of rows[i]) {
        const clean = cell.trim();
        if (clean && /[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(clean)) {
          extractedUrls.push(clean);
        }
      }
    }
    const drafts = groupUrlsByDomain(extractedUrls.join('\n'), defaultProtocol);
    if (drafts.length === 0) {
      throw new Error('No valid URLs found in this CSV file.');
    }
    return {
      projects: drafts,
      summary: `${drafts.length} project(s) grouped by domain from CSV`,
    };
  }

  // 3. Plain text / URL list (supports optional [Project Name] or # Project Name headings)
  const lines = trimmed.split(/\r?\n/);
  const sectioned = new Map<string, string[]>();
  let currentHeading: string | null = null;
  const unsectioned: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const bracketMatch = line.match(/^\[([^\]]{1,80})\]$/);
    const hashMatch = line.match(/^#{1,3}\s+(.{1,80})$/);
    if (bracketMatch) {
      currentHeading = sanitizeProjectName(bracketMatch[1]);
      continue;
    }
    if (hashMatch) {
      currentHeading = sanitizeProjectName(hashMatch[1]);
      continue;
    }
    const tokens = parseRawUrlTokens(line);
    if (currentHeading) {
      const list = sectioned.get(currentHeading) || [];
      for (const tok of tokens) {
        if (extractDomainGroupKey(tok, defaultProtocol) && !list.includes(tok) && list.length < 50) {
          list.push(tok);
        }
      }
      if (list.length > 0) sectioned.set(currentHeading, list);
    } else {
      unsectioned.push(...tokens);
    }
  }

  const drafts: ImportedProjectDraft[] = [];
  for (const [name, urls] of sectioned.entries()) {
    drafts.push({
      tempId: crypto.randomUUID(),
      name,
      urls,
      sourceHint: 'Text section',
    });
  }
  if (unsectioned.length > 0) {
    drafts.push(...groupUrlsByDomain(unsectioned.join('\n'), defaultProtocol));
  }

  if (drafts.length === 0) {
    throw new Error('No valid URLs or projects were found in this file.');
  }

  drafts.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  return {
    projects: drafts,
    summary: `${drafts.length} project(s) ready from ${filename}`,
  };
}

export function exportSelectedProjectsJson(
  orgName: string,
  projects: ProjectRecord[],
): void {
  const sorted = sortProjectsByName(projects);
  if (sorted.length === 0) return;

  const bundle: UpsiteProjectBundle = {
    format: 'upsite-projects-v1',
    exportedAt: new Date().toISOString(),
    sourceOrganisation: orgName,
    projects: sorted.map((p) => ({
      name: p.name,
      urls: [...p.urls],
    })),
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `upsite-${slugify(orgName)}-projects-${datePart}.json`);
}

export function exportSelectedProjectsCsv(
  orgName: string,
  projects: ProjectRecord[],
): void {
  const sorted = sortProjectsByName(projects);
  if (sorted.length === 0) return;

  const headers = ['Project', 'URL'];
  const rows: string[][] = [];
  for (const project of sorted) {
    for (const url of project.urls) {
      rows.push([project.name, url]);
    }
  }

  const csvContent = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `upsite-${slugify(orgName)}-projects-${datePart}.csv`);
}

export function mergeImportedProjects(
  existingProjects: ProjectRecord[],
  draftsToImport: ImportedProjectDraft[],
  mergeMatchingNames: boolean,
): ProjectRecord[] {
  const next = existingProjects.map((p) => ({ ...p, urls: [...p.urls] }));
  const nowIso = new Date().toISOString();

  for (const draft of draftsToImport) {
    const cleanName = sanitizeProjectName(draft.name);
    const cleanUrls = Array.from(new Set(draft.urls.map((u) => u.trim()).filter(Boolean))).slice(
      0,
      50,
    );
    if (cleanUrls.length === 0) continue;

    if (mergeMatchingNames) {
      const existing = next.find(
        (p) => p.name.trim().toLowerCase() === cleanName.toLowerCase(),
      );
      if (existing) {
        existing.urls = Array.from(new Set([...existing.urls, ...cleanUrls])).slice(0, 50);
        continue;
      }
    }

    if (next.length < 100) {
      next.push({
        id: crypto.randomUUID(),
        name: cleanName,
        urls: cleanUrls,
        createdAt: nowIso,
      });
    }
  }

  return sortProjectsByName(next);
}
