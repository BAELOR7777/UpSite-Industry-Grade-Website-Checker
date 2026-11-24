import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SiteCheckResult } from '../types/upsite';

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

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated: ${stamp} UTC  |  Total: ${results.length}  |  Online: ${onlineCount}  |  Offline: ${offlineCount}  |  Error: ${errorCount}`,
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
      fillColor: [18, 20, 32],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
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
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(`${orgName} — Simple Site Report`, 40, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Generated: ${stamp} UTC  |  Sites: ${rows.length}  |  Online: ${onlineCount}  |  Issues: ${downCount}`,
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
      fillColor: [18, 20, 32],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
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
