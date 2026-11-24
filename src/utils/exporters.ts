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

export function exportResultsToCsv(results: SiteCheckResult[], filenamePrefix = 'upsite-report'): void {
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
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${filenamePrefix}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportResultsToPdf(results: SiteCheckResult[], filenamePrefix = 'upsite-report'): void {
  if (results.length === 0) return;

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
  doc.save(`${filenamePrefix}-${datePart}.pdf`);
}
