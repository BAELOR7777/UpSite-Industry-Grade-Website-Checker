import type { ProjectRecord } from '../types/upsite';
import { sortProjectsByName } from './organisations';

export interface ImportedProjectDraft {
  tempId: string;
  name: string;
  urls: string[];
  sourceHint?: string;
}

export type ImportConflictMode = 'merge' | 'skip' | 'duplicate';

export interface UpsiteProjectBundle {
  format: 'upsite-projects-v1';
  exportedAt: string;
  sourceOrganisation: string;
  projects: Array<{
    name: string;
    urls: string[];
  }>;
}

const MAX_URLS_PER_PROJECT = 50;

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

function stripBomAndFormulaEscape(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/^'(?=[=+\-@\t\r])/, '');
}

function sanitizeProjectName(raw: string, fallback = 'Imported Project'): string {
  const cleaned = stripBomAndFormulaEscape(raw).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return cleaned || fallback;
}

function cleanUrlToken(raw: string): string {
  return stripBomAndFormulaEscape(raw)
    .trim()
    .replace(/^[<("']+/, '')
    .replace(/[>),;"']+$/, '');
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
  // Extract HTML href / markdown links alongside plain URL tokens
  const extracted: string[] = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(raw)) !== null) {
    if (match[1]) extracted.push(match[1]);
  }
  const mdLinkRegex = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
  while ((match = mdLinkRegex.exec(raw)) !== null) {
    if (match[1]) extracted.push(match[1]);
  }

  const normalizedSource = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi, ' $1 ');

  const tokens = normalizedSource
    .split(/[\n,;\s\t]+/)
    .map(cleanUrlToken)
    .filter(Boolean);

  return Array.from(new Set([...extracted.map(cleanUrlToken).filter(Boolean), ...tokens]));
}

export function extractDomainGroupKey(
  rawUrl: string,
  defaultProtocol: 'https' | 'http' = 'https',
): string | null {
  const trimmed = cleanUrlToken(rawUrl);
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) return null;
  if (!trimmed.includes('.') && !trimmed.includes('localhost')) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;

  const candidate = hasScheme ? trimmed : `${defaultProtocol}://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost') {
      return host;
    }
    const labels = host.split('.').filter(Boolean);
    if (labels.length < 2) return null;
    const tld = labels[labels.length - 1];
    if (!/^[a-z]{2,}$/i.test(tld)) return null;
    if (labels.length === 2) {
      return host;
    }
    const lastTwo = `${labels[labels.length - 2]}.${tld}`;
    if (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
      return labels.slice(-3).join('.');
    }
    return lastTwo;
  } catch {
    return null;
  }
}

function splitLargeProjectUrls(
  baseName: string,
  urls: string[],
  sourceHint?: string,
): ImportedProjectDraft[] {
  const uniqueUrls = Array.from(new Set(urls.map(cleanUrlToken).filter(Boolean)));
  if (uniqueUrls.length === 0) return [];
  if (uniqueUrls.length <= MAX_URLS_PER_PROJECT) {
    return [
      {
        tempId: crypto.randomUUID(),
        name: sanitizeProjectName(baseName),
        urls: uniqueUrls,
        sourceHint,
      },
    ];
  }

  const parts: ImportedProjectDraft[] = [];
  for (let i = 0; i < uniqueUrls.length; i += MAX_URLS_PER_PROJECT) {
    const partIndex = Math.floor(i / MAX_URLS_PER_PROJECT) + 1;
    parts.push({
      tempId: crypto.randomUUID(),
      name: sanitizeProjectName(
        partIndex === 1 ? baseName : `${baseName} (Part ${partIndex})`,
      ),
      urls: uniqueUrls.slice(i, i + MAX_URLS_PER_PROJECT),
      sourceHint,
    });
  }
  return parts;
}

export function groupUrlsByDomainWithStats(
  rawText: string,
  defaultProtocol: 'https' | 'http' = 'https',
): { projects: ImportedProjectDraft[]; skippedCount: number } {
  const tokens = parseRawUrlTokens(rawText);
  const grouped = new Map<string, string[]>();
  let skippedCount = 0;

  for (const token of tokens) {
    const domain = extractDomainGroupKey(token, defaultProtocol);
    if (!domain) {
      skippedCount += 1;
      continue;
    }
    const list = grouped.get(domain) || [];
    if (!list.includes(token)) {
      list.push(token);
      grouped.set(domain, list);
    }
  }

  const drafts: ImportedProjectDraft[] = [];
  for (const [domain, urls] of Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
  )) {
    drafts.push(...splitLargeProjectUrls(domain, urls, `Domain: ${domain}`));
  }

  return { projects: drafts, skippedCount };
}

export function groupUrlsByDomain(
  rawText: string,
  defaultProtocol: 'https' | 'http' = 'https',
): ImportedProjectDraft[] {
  return groupUrlsByDomainWithStats(rawText, defaultProtocol).projects;
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const cleanText = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i += 1) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

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
    } else if (ch === delimiter) {
      row.push(stripBomAndFormulaEscape(cell.trim()));
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(stripBomAndFormulaEscape(cell.trim()));
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(stripBomAndFormulaEscape(cell.trim()));
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(stripBomAndFormulaEscape(cell.trim()));
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeProjectList(
  items: Array<{ name?: unknown; urls?: unknown }>,
  sourceHint: string,
  defaultProtocol: 'https' | 'http',
): { drafts: ImportedProjectDraft[]; skippedCount: number } {
  const drafts: ImportedProjectDraft[] = [];
  let skippedCount = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rawName = typeof item.name === 'string' ? item.name : '';
    const validUrls: string[] = [];

    if (Array.isArray(item.urls)) {
      for (const rawUrl of item.urls) {
        if (typeof rawUrl !== 'string') continue;
        const cleaned = cleanUrlToken(rawUrl);
        if (!cleaned) continue;
        if (!extractDomainGroupKey(cleaned, defaultProtocol)) {
          skippedCount += 1;
          continue;
        }
        if (!validUrls.includes(cleaned)) {
          validUrls.push(cleaned);
        }
      }
    }

    if (validUrls.length === 0) continue;
    const baseName = sanitizeProjectName(
      rawName,
      extractDomainGroupKey(validUrls[0], defaultProtocol) || 'Imported Project',
    );
    drafts.push(...splitLargeProjectUrls(baseName, validUrls, sourceHint));
  }

  drafts.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  return { drafts, skippedCount };
}

export function parseProjectsFromFileContent(
  filename: string,
  content: string,
  defaultProtocol: 'https' | 'http' = 'https',
): { projects: ImportedProjectDraft[]; summary: string; skippedCount: number } {
  const lowerName = filename.toLowerCase();
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('The selected file is empty.');
  }

  // 1. JSON Bundle (upsite-projects-v1, array of projects, or organisations export)
  if (
    lowerName.endsWith('.json') ||
    (!lowerName.endsWith('.txt') &&
      !lowerName.endsWith('.csv') &&
      !lowerName.endsWith('.tsv') &&
      !lowerName.endsWith('.html') &&
      (trimmed.startsWith('{') || trimmed.startsWith('[')))
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON file format.');
    }

    if (Array.isArray(parsed)) {
      const { drafts, skippedCount } = normalizeProjectList(
        parsed as Array<{ name?: unknown; urls?: unknown }>,
        'JSON list',
        defaultProtocol,
      );
      if (drafts.length === 0) {
        throw new Error('No valid projects with URLs were found in this JSON file.');
      }
      return {
        projects: drafts,
        skippedCount,
        summary: `${drafts.length} project(s) read from JSON file`,
      };
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.projects)) {
        const { drafts, skippedCount } = normalizeProjectList(
          obj.projects as Array<{ name?: unknown; urls?: unknown }>,
          typeof obj.sourceOrganisation === 'string'
            ? `From ${obj.sourceOrganisation}`
            : 'upsite bundle',
          defaultProtocol,
        );
        if (drafts.length > 0) {
          return {
            projects: drafts,
            skippedCount,
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
        const { drafts, skippedCount } = normalizeProjectList(
          combined,
          'Organisation bundle',
          defaultProtocol,
        );
        if (drafts.length > 0) {
          return {
            projects: drafts,
            skippedCount,
            summary: `${drafts.length} project(s) read from JSON bundle`,
          };
        }
      }
    }

    throw new Error('No projects with URLs were found in this JSON file.');
  }

  // 2. CSV or TSV file (supports Project + URL columns, upsite Simple Report CSV, or raw URL list)
  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    const delimiter = lowerName.endsWith('.tsv') ? '\t' : ',';
    const rows = parseDelimitedRows(trimmed, delimiter);
    if (rows.length === 0) {
      throw new Error('No rows found in this spreadsheet file.');
    }

    const headerLower = rows[0].map((col) => col.toLowerCase().trim());
    const projIdx = headerLower.findIndex(
      (h) => h === 'project' || h === 'project name' || h === 'group' || h === 'folder',
    );
    const urlIdx = headerLower.findIndex(
      (h) =>
        h === 'url' ||
        h === 'normalized url' ||
        h === 'input url' ||
        h === 'website' ||
        h === 'site' ||
        h === 'domain',
    );

    if (projIdx !== -1 && urlIdx !== -1 && rows.length > 1) {
      const grouped = new Map<string, string[]>();
      let skippedCount = 0;

      for (let i = 1; i < rows.length; i += 1) {
        const r = rows[i];
        const rawUrl = cleanUrlToken(r[urlIdx] || '');
        if (!rawUrl) continue;
        const domainKey = extractDomainGroupKey(rawUrl, defaultProtocol);
        if (!domainKey) {
          skippedCount += 1;
          continue;
        }
        const projName = sanitizeProjectName(r[projIdx] || '', domainKey);
        const list = grouped.get(projName) || [];
        if (!list.includes(rawUrl)) {
          list.push(rawUrl);
          grouped.set(projName, list);
        }
      }

      const drafts: ImportedProjectDraft[] = [];
      for (const [name, urls] of Array.from(grouped.entries()).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
      )) {
        drafts.push(...splitLargeProjectUrls(name, urls, 'Spreadsheet Project column'));
      }

      if (drafts.length === 0) {
        throw new Error('No valid URLs found in the spreadsheet URL column.');
      }
      return {
        projects: drafts,
        skippedCount,
        summary: `${drafts.length} project(s) read from ${lowerName.endsWith('.tsv') ? 'TSV' : 'CSV'}`,
      };
    }

    // Fallback: extract URL tokens from all spreadsheet cells
    const extractedUrls: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (const cell of rows[i]) {
        const clean = cleanUrlToken(cell);
        if (clean && extractDomainGroupKey(clean, defaultProtocol)) {
          extractedUrls.push(clean);
        }
      }
    }
    const { projects: drafts, skippedCount } = groupUrlsByDomainWithStats(
      extractedUrls.join('\n'),
      defaultProtocol,
    );
    if (drafts.length === 0) {
      throw new Error('No valid URLs found in this spreadsheet file.');
    }
    return {
      projects: drafts,
      skippedCount,
      summary: `${drafts.length} project(s) grouped by domain from ${lowerName.endsWith('.tsv') ? 'TSV' : 'CSV'}`,
    };
  }

  // 3. Plain text / Markdown / HTML bookmarks (supports optional [Project Name] or # Project Name headings)
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    const tokens = parseRawUrlTokens(trimmed);
    const { projects: drafts, skippedCount } = groupUrlsByDomainWithStats(
      tokens.join('\n'),
      defaultProtocol,
    );
    if (drafts.length === 0) {
      throw new Error('No valid HTTP/HTTPS bookmark URLs were found in this HTML file.');
    }
    return {
      projects: drafts,
      skippedCount,
      summary: `${drafts.length} project(s) grouped from bookmarks`,
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const sectioned = new Map<string, string[]>();
  let currentHeading: string | null = null;
  const unsectioned: string[] = [];
  let skippedCount = 0;

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
        if (extractDomainGroupKey(tok, defaultProtocol)) {
          if (!list.includes(tok)) list.push(tok);
        } else {
          skippedCount += 1;
        }
      }
      if (list.length > 0) sectioned.set(currentHeading, list);
    } else {
      unsectioned.push(...tokens);
    }
  }

  const drafts: ImportedProjectDraft[] = [];
  for (const [name, urls] of sectioned.entries()) {
    drafts.push(...splitLargeProjectUrls(name, urls, 'Text section'));
  }
  if (unsectioned.length > 0) {
    const grouped = groupUrlsByDomainWithStats(unsectioned.join('\n'), defaultProtocol);
    drafts.push(...grouped.projects);
    skippedCount += grouped.skippedCount;
  }

  if (drafts.length === 0) {
    throw new Error('No valid URLs or projects were found in this file.');
  }

  drafts.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
  return {
    projects: drafts,
    skippedCount,
    summary: `${drafts.length} project(s) ready from ${filename}`,
  };
}

export function buildSelectedProjectsBundle(
  orgName: string,
  projects: ProjectRecord[],
): UpsiteProjectBundle {
  const sorted = sortProjectsByName(projects);
  return {
    format: 'upsite-projects-v1',
    exportedAt: new Date().toISOString(),
    sourceOrganisation: orgName,
    projects: sorted.map((p) => ({
      name: p.name,
      urls: [...p.urls],
    })),
  };
}

export function exportSelectedProjectsJson(
  orgName: string,
  projects: ProjectRecord[],
): void {
  const sorted = sortProjectsByName(projects);
  if (sorted.length === 0) return;

  const bundle = buildSelectedProjectsBundle(orgName, sorted);
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

  // Prepend UTF-8 BOM so Microsoft Excel preserves UTF-8 characters
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `upsite-${slugify(orgName)}-projects-${datePart}.csv`);
}

export function exportSelectedProjectsTxt(
  orgName: string,
  projects: ProjectRecord[],
): void {
  const sorted = sortProjectsByName(projects);
  if (sorted.length === 0) return;

  const sections = sorted.map((p) => `[${p.name}]\n${p.urls.join('\n')}`);
  const txtContent = sections.join('\n\n') + '\n';
  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `upsite-${slugify(orgName)}-projects-${datePart}.txt`);
}

export async function copySelectedProjectsBundle(
  orgName: string,
  projects: ProjectRecord[],
): Promise<string> {
  const sorted = sortProjectsByName(projects);
  if (sorted.length === 0) return 'No projects selected.';
  const bundle = buildSelectedProjectsBundle(orgName, sorted);
  const text = JSON.stringify(bundle, null, 2);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return `Copied ${sorted.length} ${sorted.length === 1 ? 'project' : 'projects'} bundle to clipboard.`;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return `Copied ${sorted.length} ${sorted.length === 1 ? 'project' : 'projects'} bundle to clipboard.`;
}

export function mergeImportedProjects(
  existingProjects: ProjectRecord[],
  draftsToImport: ImportedProjectDraft[],
  conflictModeOrMerge: ImportConflictMode | boolean,
): ProjectRecord[] {
  const mode: ImportConflictMode =
    typeof conflictModeOrMerge === 'boolean'
      ? conflictModeOrMerge
        ? 'merge'
        : 'duplicate'
      : conflictModeOrMerge;

  const next = existingProjects.map((p) => ({ ...p, urls: [...p.urls] }));
  const nowIso = new Date().toISOString();

  for (const draft of draftsToImport) {
    const cleanName = sanitizeProjectName(draft.name);
    const cleanUrls = Array.from(
      new Set(draft.urls.map(cleanUrlToken).filter(Boolean)),
    ).slice(0, MAX_URLS_PER_PROJECT);
    if (cleanUrls.length === 0) continue;

    const existing = next.find(
      (p) => p.name.trim().toLowerCase() === cleanName.toLowerCase(),
    );

    if (existing) {
      if (mode === 'skip') {
        continue;
      }
      if (mode === 'merge') {
        existing.urls = Array.from(new Set([...existing.urls, ...cleanUrls])).slice(
          0,
          MAX_URLS_PER_PROJECT,
        );
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
