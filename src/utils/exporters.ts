import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  IncidentRecord,
  Organisation,
  ReportDispatchPayload,
  ReportDispatchSiteItem,
  SiteCheckResult,
} from '../types/upsite';

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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value: string, fallback = 'org'): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] || '' : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to encode PDF file.'));
    reader.readAsDataURL(blob);
  });
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

async function copyRichReportToClipboard(plainText: string, htmlTable: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
          'text/html': new Blob([htmlTable], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Fallback to writeText below
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(plainText);
    return;
  }
  throw new Error('Clipboard access is unavailable in this window.');
}

async function shareOrSavePdf(params: {
  pdfBlob: Blob;
  filename: string;
  title: string;
  plainSummary: string;
  htmlSummary: string;
}): Promise<string> {
  const { pdfBlob, filename, title, plainSummary, htmlSummary } = params;

  if (window.upsiteDesktop?.isDesktop) {
    const base64 = await blobToBase64(pdfBlob);
    const res = await window.upsiteDesktop.sharePdfFile(filename, base64);
    if (res.ok) {
      return 'PDF saved to Downloads and revealed in folder for sharing.';
    }
  }

  const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && typeof nav.share === 'function') {
    const canShareFile =
      typeof nav.canShare === 'function' ? nav.canShare({ files: [pdfFile] }) : false;
    if (canShareFile) {
      try {
        await nav.share({
          files: [pdfFile],
          title,
          text: plainSummary,
        });
        return 'PDF shared to selected app.';
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return 'Share cancelled.';
        }
      }
    }
  }

  downloadBlob(pdfBlob, filename);
  try {
    await copyRichReportToClipboard(plainSummary, htmlSummary);
    return 'PDF downloaded and report summary copied to clipboard.';
  } catch {
    return 'PDF downloaded for sharing.';
  }
}

async function copyPdfOrReport(params: {
  pdfBlob: Blob;
  filename: string;
  plainSummary: string;
  htmlSummary: string;
}): Promise<string> {
  const { pdfBlob, filename, plainSummary, htmlSummary } = params;

  if (window.upsiteDesktop?.isDesktop) {
    try {
      const base64 = await blobToBase64(pdfBlob);
      const res = await window.upsiteDesktop.copyPdfFile(filename, base64);
      if (res.ok) {
        return 'PDF file copied to clipboard — press Ctrl+V anywhere to paste.';
      }
    } catch {
      // Fallback to copying formatted report text/table
    }
  }

  await copyRichReportToClipboard(plainSummary, htmlSummary);
  return 'Report copied to clipboard — paste into email, chat, or docs.';
}

export function exportResultsToCsv(
  results: SiteCheckResult[],
  filenamePrefix = 'upsite-report',
): void {
  if (results.length === 0) return;

  const headers = [
    'URL',
    'Final URL',
    'Status',
    'HTTP Code',
    'Response Time (ms)',
    'DNS Resolved',
    'DNS Addresses',
    'SSL Valid',
    'SSL Issuer',
    'SSL Days Remaining',
    'Redirect Hops',
    'Error Code',
    'Likely Reason',
    'Possible Fix',
    'Checked At',
  ];

  const rows = results.map((item) => [
    item.normalizedUrl,
    item.finalUrl,
    item.statusLabel,
    item.httpStatusCode ?? '',
    item.responseTimeMs ?? '',
    item.dns.resolved ? 'Yes' : 'No',
    item.dns.addresses.join('; '),
    item.ssl.checked ? (item.ssl.valid ? 'Valid' : 'Invalid') : 'N/A (HTTP)',
    item.ssl.issuer ?? '',
    item.ssl.daysRemaining ?? '',
    item.redirects.length,
    item.diagnosis.errorCode,
    item.diagnosis.likelyReason,
    item.diagnosis.possibleFix,
    item.checkedAt,
  ]);

  const csvContent = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(',')),
  ].join('\r\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `${filenamePrefix}-${stamp}.csv`);
}

function buildResultsPdf(
  results: SiteCheckResult[],
  filenamePrefix = 'upsite-report',
): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('upsite — Website Availability Report', 40, 42);

  const onlineCount = results.filter((r) => r.status === 'online').length;
  const offlineCount = results.filter((r) => r.status === 'offline').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const latencies = results
    .map((r) => r.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const avgMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : null;
  const uptimePct = Math.round((onlineCount / Math.max(1, results.length)) * 100);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated: ${stamp} UTC  |  Total: ${results.length}  |  Online: ${onlineCount} (${uptimePct}%)  |  Offline: ${offlineCount}  |  Error: ${errorCount}${
      avgMs !== null ? `  |  Avg: ${avgMs} ms` : ''
    }`,
    40,
    60,
  );

  autoTable(doc, {
    startY: 78,
    head: [
      [
        'URL',
        'Status',
        'HTTP',
        'Latency',
        'DNS',
        'SSL',
        'Redirects',
        'Diagnosis / Error Code',
      ],
    ],
    body: results.map((item) => [
      item.normalizedUrl,
      item.statusLabel,
      item.httpStatusCode !== null ? String(item.httpStatusCode) : '—',
      item.responseTimeMs !== null ? `${item.responseTimeMs} ms` : '—',
      item.dns.resolved ? item.dns.addresses[0] || 'Resolved' : item.dns.error || 'Failed',
      item.ssl.checked
        ? item.ssl.valid
          ? `Valid (${item.ssl.daysRemaining ?? '?'}d)`
          : item.ssl.error || 'Invalid'
        : 'HTTP',
      item.redirects.length > 1 ? `${item.redirects.length} hops` : 'Direct',
      item.diagnosis.errorCode === 'NONE'
        ? 'Healthy'
        : `${item.diagnosis.errorCode}: ${item.diagnosis.likelyReason}`,
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
      textColor: [30, 41, 59],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const val = String(data.cell.raw || '').toLowerCase();
        data.cell.styles.fontStyle = 'bold';
        if (val === 'online') data.cell.styles.textColor = [5, 150, 105];
        else if (val === 'offline') data.cell.styles.textColor = [225, 29, 72];
        else if (val === 'error') data.cell.styles.textColor = [217, 119, 6];
      }
    },
    columnStyles: {
      0: { cellWidth: 165 },
      1: { cellWidth: 55 },
      2: { cellWidth: 45 },
      3: { cellWidth: 55 },
      4: { cellWidth: 95 },
      5: { cellWidth: 80 },
      6: { cellWidth: 55 },
      7: { cellWidth: 'auto' },
    },
  });

  const datePart = new Date().toISOString().slice(0, 10);
  return { doc, filename: `${filenamePrefix}-${datePart}.pdf` };
}

function formatResultsSummary(results: SiteCheckResult[], title: string): {
  plain: string;
  html: string;
} {
  const onlineCount = results.filter((r) => r.status === 'online').length;
  const downCount = results.length - onlineCount;
  const lines = [
    `${title} (${results.length} sites | ${onlineCount} online | ${downCount} issues)`,
    ...results.map((r) => {
      const code = r.httpStatusCode !== null ? `HTTP ${r.httpStatusCode}` : 'No HTTP';
      const ms = r.responseTimeMs !== null ? `${r.responseTimeMs} ms` : '—';
      const note = r.diagnosis.errorCode === 'NONE' ? 'Healthy' : r.diagnosis.errorCode;
      return `• ${r.normalizedUrl} — ${r.statusLabel} (${code}, ${ms}) [${note}]`;
    }),
  ];

  const htmlRows = results
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.normalizedUrl)}</td><td>${escapeHtml(r.statusLabel)}</td><td>${
          r.httpStatusCode ?? '—'
        }</td><td>${r.responseTimeMs !== null ? `${r.responseTimeMs} ms` : '—'}</td><td>${escapeHtml(
          r.diagnosis.errorCode === 'NONE' ? 'Healthy' : r.diagnosis.errorCode,
        )}</td></tr>`,
    )
    .join('');

  const html = `<div><p><strong>${escapeHtml(
    title,
  )}</strong> (${results.length} sites | ${onlineCount} online | ${downCount} issues)</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>URL</th><th>Status</th><th>HTTP</th><th>Latency</th><th>Diagnosis</th></tr></thead><tbody>${htmlRows}</tbody></table></div>`;

  return { plain: lines.join('\n'), html };
}

export function exportResultsToPdf(
  results: SiteCheckResult[],
  filenamePrefix = 'upsite-report',
): void {
  if (results.length === 0) return;
  const { doc, filename } = buildResultsPdf(results, filenamePrefix);
  doc.save(filename);
}

export async function shareResultsPdf(
  results: SiteCheckResult[],
  filenamePrefix = 'upsite-report',
  title = 'upsite Website Availability Report',
): Promise<string> {
  if (results.length === 0) return 'No results to share.';
  const { doc, filename } = buildResultsPdf(results, filenamePrefix);
  const pdfBlob = doc.output('blob');
  const summary = formatResultsSummary(results, title);
  return shareOrSavePdf({
    pdfBlob,
    filename,
    title,
    plainSummary: summary.plain,
    htmlSummary: summary.html,
  });
}

export async function copyResultsReport(
  results: SiteCheckResult[],
  filenamePrefix = 'upsite-report',
  title = 'upsite Website Availability Report',
): Promise<string> {
  if (results.length === 0) return 'No results to copy.';
  const { doc, filename } = buildResultsPdf(results, filenamePrefix);
  const pdfBlob = doc.output('blob');
  const summary = formatResultsSummary(results, title);
  return copyPdfOrReport({
    pdfBlob,
    filename,
    plainSummary: summary.plain,
    htmlSummary: summary.html,
  });
}

export interface SimpleOrgSiteRow {
  projectName: string;
  result: SiteCheckResult;
}

export function exportSimpleOrgReportCsv(
  orgName: string,
  rows: SimpleOrgSiteRow[],
): void {
  if (rows.length === 0) return;
  const headers = [
    'Organisation',
    'Project',
    'URL',
    'Status',
    'HTTP Code',
    'Response Time (ms)',
    'Summary',
    'Checked At',
  ];

  const dataRows = rows.map(({ projectName, result }) => [
    orgName,
    projectName,
    result.normalizedUrl,
    result.statusLabel,
    result.httpStatusCode ?? '',
    result.responseTimeMs ?? '',
    result.diagnosis.errorCode === 'NONE'
      ? 'Healthy'
      : `${result.diagnosis.errorCode}: ${result.diagnosis.likelyReason}`,
    result.checkedAt,
  ]);

  const csvContent = [
    headers.map(escapeCsvField).join(','),
    ...dataRows.map((row) => row.map(escapeCsvField).join(',')),
  ].join('\r\n');

  const slug = slugify(orgName);
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `upsite-${slug}-simple-report-${stamp}.csv`);
}

function buildSimpleOrgReportPdf(
  orgName: string,
  rows: SimpleOrgSiteRow[],
): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const onlineCount = rows.filter((r) => r.result.status === 'online').length;
  const downCount = rows.length - onlineCount;
  const latencies = rows
    .map((r) => r.result.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const avgMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : null;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(`${orgName} — Simple Site Report`, 40, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated: ${stamp} UTC  |  Sites: ${rows.length}  |  Online: ${onlineCount}  |  Issues: ${downCount}${
      avgMs !== null ? `  |  Avg: ${avgMs} ms` : ''
    }`,
    40,
    60,
  );

  autoTable(doc, {
    startY: 78,
    head: [['Project', 'URL', 'Status', 'Code', 'Latency', 'Note']],
    body: rows.map(({ projectName, result }) => [
      projectName,
      result.normalizedUrl,
      result.statusLabel,
      result.httpStatusCode !== null ? String(result.httpStatusCode) : '—',
      result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—',
      result.diagnosis.errorCode === 'NONE' ? 'Healthy' : result.diagnosis.errorCode,
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 5,
      textColor: [30, 41, 59],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const val = String(data.cell.raw || '').toLowerCase();
        data.cell.styles.fontStyle = 'bold';
        if (val === 'online') data.cell.styles.textColor = [5, 150, 105];
        else if (val === 'offline') data.cell.styles.textColor = [225, 29, 72];
        else if (val === 'error') data.cell.styles.textColor = [217, 119, 6];
      }
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 165 },
      2: { cellWidth: 50 },
      3: { cellWidth: 40 },
      4: { cellWidth: 55 },
      5: { cellWidth: 'auto' },
    },
  });

  const slug = slugify(orgName);
  const datePart = new Date().toISOString().slice(0, 10);
  return { doc, filename: `upsite-${slug}-simple-report-${datePart}.pdf` };
}

function formatSimpleOrgSummary(orgName: string, rows: SimpleOrgSiteRow[]): {
  plain: string;
  html: string;
} {
  const onlineCount = rows.filter((r) => r.result.status === 'online').length;
  const downCount = rows.length - onlineCount;
  const lines = [
    `${orgName} — Simple Site Report (${rows.length} sites | ${onlineCount} online | ${downCount} issues)`,
    ...rows.map(({ projectName, result }) => {
      const code = result.httpStatusCode !== null ? `HTTP ${result.httpStatusCode}` : 'No HTTP';
      const ms = result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—';
      const note = result.diagnosis.errorCode === 'NONE' ? 'Healthy' : result.diagnosis.errorCode;
      return `• [${projectName}] ${result.normalizedUrl} — ${result.statusLabel} (${code}, ${ms}) [${note}]`;
    }),
  ];

  const htmlRows = rows
    .map(
      ({ projectName, result }) =>
        `<tr><td>${escapeHtml(projectName)}</td><td>${escapeHtml(
          result.normalizedUrl,
        )}</td><td>${escapeHtml(result.statusLabel)}</td><td>${
          result.httpStatusCode ?? '—'
        }</td><td>${result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—'}</td><td>${escapeHtml(
          result.diagnosis.errorCode === 'NONE' ? 'Healthy' : result.diagnosis.errorCode,
        )}</td></tr>`,
    )
    .join('');

  const html = `<div><p><strong>${escapeHtml(
    orgName,
  )} — Simple Site Report</strong> (${rows.length} sites | ${onlineCount} online | ${downCount} issues)</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Project</th><th>URL</th><th>Status</th><th>Code</th><th>Latency</th><th>Note</th></tr></thead><tbody>${htmlRows}</tbody></table></div>`;

  return { plain: lines.join('\n'), html };
}

export function exportSimpleOrgReportPdf(
  orgName: string,
  rows: SimpleOrgSiteRow[],
): void {
  if (rows.length === 0) return;
  const { doc, filename } = buildSimpleOrgReportPdf(orgName, rows);
  doc.save(filename);
}

export async function shareSimpleOrgReportPdf(
  orgName: string,
  rows: SimpleOrgSiteRow[],
): Promise<string> {
  if (rows.length === 0) return 'No report rows to share.';
  const { doc, filename } = buildSimpleOrgReportPdf(orgName, rows);
  const pdfBlob = doc.output('blob');
  const summary = formatSimpleOrgSummary(orgName, rows);
  return shareOrSavePdf({
    pdfBlob,
    filename,
    title: `${orgName} — Simple Site Report`,
    plainSummary: summary.plain,
    htmlSummary: summary.html,
  });
}

export async function copySimpleOrgReport(
  orgName: string,
  rows: SimpleOrgSiteRow[],
): Promise<string> {
  if (rows.length === 0) return 'No report rows to copy.';
  const { doc, filename } = buildSimpleOrgReportPdf(orgName, rows);
  const pdfBlob = doc.output('blob');
  const summary = formatSimpleOrgSummary(orgName, rows);
  return copyPdfOrReport({
    pdfBlob,
    filename,
    plainSummary: summary.plain,
    htmlSummary: summary.html,
  });
}

export function buildReportDispatchPayloadFromResults(
  results: SiteCheckResult[],
  title: string,
  source: string,
): ReportDispatchPayload {
  const sites: ReportDispatchSiteItem[] = results.map((r) => ({
    url: r.normalizedUrl,
    status: r.status,
    statusLabel: r.statusLabel,
    httpStatusCode: r.httpStatusCode,
    responseTimeMs: r.responseTimeMs,
    errorCode: r.diagnosis.errorCode,
    likelyReason: r.diagnosis.likelyReason,
  }));

  const onlineCount = sites.filter((s) => s.status === 'online').length;
  const offlineCount = sites.filter((s) => s.status === 'offline').length;
  const errorCount = sites.filter((s) => s.status === 'error').length;
  const latencies = sites
    .map((s) => s.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');

  return {
    title,
    source,
    generatedAt: new Date().toISOString(),
    totalCount: sites.length,
    onlineCount,
    offlineCount,
    errorCount,
    avgLatencyMs:
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
        : null,
    sites,
  };
}

export function buildReportDispatchPayloadFromOrgRows(
  orgName: string,
  rows: SimpleOrgSiteRow[],
  source: string,
): ReportDispatchPayload {
  const sites: ReportDispatchSiteItem[] = rows.map(({ projectName, result }) => ({
    projectName,
    url: result.normalizedUrl,
    status: result.status,
    statusLabel: result.statusLabel,
    httpStatusCode: result.httpStatusCode,
    responseTimeMs: result.responseTimeMs,
    errorCode: result.diagnosis.errorCode,
    likelyReason: result.diagnosis.likelyReason,
  }));

  const onlineCount = sites.filter((s) => s.status === 'online').length;
  const offlineCount = sites.filter((s) => s.status === 'offline').length;
  const errorCount = sites.filter((s) => s.status === 'error').length;
  const latencies = sites
    .map((s) => s.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');

  return {
    title: `${orgName} — Availability Report`,
    source,
    generatedAt: new Date().toISOString(),
    totalCount: sites.length,
    onlineCount,
    offlineCount,
    errorCount,
    avgLatencyMs:
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
        : null,
    sites,
  };
}

function formatDurationMsShort(ms?: number): string {
  if (typeof ms !== 'number' || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m ${totalSec % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function exportStatusPageHtml(params: {
  title?: string;
  subtitle?: string;
  results?: SiteCheckResult[];
  organisations?: Organisation[];
  incidents?: IncidentRecord[];
}): void {
  const title = (params.title || 'upsite Service Status').trim();
  const subtitle = (params.subtitle || 'Live availability snapshot & incident summary').trim();
  const orgs = params.organisations || [];
  const incidents = (params.incidents || []).slice(0, 30);

  // Build rows from either explicit results or latest org results
  const siteRows: Array<{ group: string; result: SiteCheckResult }> = [];
  if (params.results && params.results.length > 0) {
    for (const r of params.results) {
      siteRows.push({ group: 'Monitored URL', result: r });
    }
  } else {
    for (const org of orgs) {
      for (const proj of org.projects) {
        for (const r of proj.lastResults || []) {
          siteRows.push({ group: `${org.name} / ${proj.name}`, result: r });
        }
      }
    }
  }

  const total = siteRows.length;
  const onlineCount = siteRows.filter((s) => s.result.status === 'online').length;
  const downCount = total - onlineCount;
  const uptimePct = total > 0 ? ((onlineCount / total) * 100).toFixed(1) : '100.0';
  const latencies = siteRows
    .map((s) => s.result.responseTimeMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const avgMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
      : null;

  const overallBannerText =
    total === 0
      ? 'No endpoints monitored yet'
      : downCount === 0
        ? 'All Systems Operational'
        : `${downCount} ${downCount === 1 ? 'Endpoint' : 'Endpoints'} Experiencing Issues`;
  const bannerColor = downCount === 0 ? '#059669' : '#e11d48';

  const rowsHtml = siteRows
    .map(({ group, result }) => {
      const safeUrl = escapeHtml(result.normalizedUrl);
      const isSafeHttp = /^https?:\/\//i.test(result.normalizedUrl);
      const badgeColor =
        result.status === 'online'
          ? '#059669'
          : result.status === 'offline'
            ? '#e11d48'
            : '#d97706';
      const note =
        result.diagnosis.errorCode === 'NONE'
          ? 'Healthy'
          : `${result.diagnosis.errorCode}: ${result.diagnosis.likelyReason}`;
      return `<tr>
        <td><div class="group">${escapeHtml(group)}</div>${
          isSafeHttp
            ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="url">${safeUrl}</a>`
            : `<span class="url">${safeUrl}</span>`
        }</td>
        <td><span class="status" style="color:${badgeColor};border-color:${badgeColor}33;background:${badgeColor}14">${escapeHtml(
          result.statusLabel,
        )}</span></td>
        <td class="mono">${result.httpStatusCode ?? '—'}</td>
        <td class="mono">${result.responseTimeMs !== null ? `${result.responseTimeMs} ms` : '—'}</td>
        <td class="mono">${
          result.ssl.checked
            ? result.ssl.valid
              ? `${result.ssl.daysRemaining ?? '?'}d left`
              : escapeHtml(result.ssl.error || 'Invalid')
            : 'HTTP'
        }</td>
        <td class="note">${escapeHtml(note)}</td>
      </tr>`;
    })
    .join('\n');

  const incidentsHtml =
    incidents.length > 0
      ? `<section class="card">
          <h2>Recent Incidents (${incidents.length})</h2>
          <table>
            <thead><tr><th>Endpoint</th><th>Status</th><th>Started</th><th>Duration</th><th>Detail</th></tr></thead>
            <tbody>
              ${incidents
                .map(
                  (inc) => `<tr>
                    <td><div class="group">${escapeHtml(inc.orgName)}${
                      inc.projectName ? ` / ${escapeHtml(inc.projectName)}` : ''
                    }</div><span class="url">${escapeHtml(inc.url)}</span></td>
                    <td><span class="status" style="color:${
                      inc.status === 'open' ? '#e11d48' : '#059669'
                    };border-color:${inc.status === 'open' ? '#e11d4833' : '#05966933'};background:${
                      inc.status === 'open' ? '#e11d4814' : '#05966914'
                    }">${inc.status === 'open' ? 'Open' : 'Resolved'}</span></td>
                    <td class="mono">${escapeHtml(new Date(inc.startedAt).toLocaleString())}</td>
                    <td class="mono">${
                      inc.status === 'open' ? 'Ongoing' : escapeHtml(formatDurationMsShort(inc.durationMs))
                    }</td>
                    <td class="note">${escapeHtml(inc.errorCode)}: ${escapeHtml(inc.reason)}</td>
                  </tr>`,
                )
                .join('\n')}
            </tbody>
          </table>
        </section>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)} — Status Page</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f3f5f8; color: #0f172a; line-height: 1.5; }
  @media (prefers-color-scheme: dark) {
    body { background: #111318; color: #f1f5f9; }
    .card, .kpi { background: #1b1f28 !important; border-color: rgba(255,255,255,0.08) !important; }
    th { background: #151821 !important; color: #94a3b8 !important; }
    td { border-color: rgba(255,255,255,0.06) !important; }
    .muted, .group, .note { color: #94a3b8 !important; }
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }
  .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .sub { margin: 4px 0 0; font-size: 13px; color: #64748b; }
  .banner { border-radius: 12px; padding: 14px 18px; color: #fff; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .kpi-label { font-size: 12px; color: #64748b; }
  .kpi-val { font-size: 22px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
  .card h2 { margin: 0; font-size: 14px; padding: 14px 18px; border-bottom: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; background: #f8fafc; padding: 10px 16px; }
  td { padding: 12px 16px; border-top: 1px solid #e2e8f0; vertical-align: top; }
  .group { font-size: 11px; color: #64748b; margin-bottom: 2px; }
  .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: inherit; text-decoration: none; word-break: break-all; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 6px; border: 1px solid; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .note { font-size: 12px; color: #475569; max-width: 300px; }
  .footer { text-align: center; font-size: 12px; color: #64748b; margin-top: 24px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="sub">${escapeHtml(subtitle)}</p>
      </div>
      <div class="sub">Generated ${escapeHtml(new Date().toLocaleString())}</div>
    </div>
    <div class="banner" style="background:${bannerColor}">
      <span>${escapeHtml(overallBannerText)}</span>
      <span>${uptimePct}% Healthy</span>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Monitored Endpoints</div><div class="kpi-val">${total}</div></div>
      <div class="kpi"><div class="kpi-label">Online</div><div class="kpi-val" style="color:#059669">${onlineCount}</div></div>
      <div class="kpi"><div class="kpi-label">Issues</div><div class="kpi-val" style="color:${downCount > 0 ? '#e11d48' : '#0f172a'}">${downCount}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Latency</div><div class="kpi-val">${avgMs !== null ? `${avgMs} ms` : '—'}</div></div>
    </div>
    <section class="card">
      <h2>Endpoint Status (${total})</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Status</th><th>HTTP</th><th>Latency</th><th>SSL</th><th>Details</th></tr></thead>
        <tbody>${
          rowsHtml ||
          '<tr><td colspan="6" class="note">No endpoint checks recorded yet.</td></tr>'
        }</tbody>
      </table>
    </section>
    ${incidentsHtml}
    <div class="footer">Generated by upsite</div>
  </div>
</body>
</html>`;

  const slug = slugify(title, 'upsite-status');
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slug}-status-${stamp}.html`);
}
