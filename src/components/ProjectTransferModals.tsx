import {
  CheckSquare,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileUp,
  FolderInput,
  Globe,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Organisation, ProjectRecord } from '../types/upsite';
import {
  exportSelectedProjectsCsv,
  exportSelectedProjectsJson,
  groupUrlsByDomain,
  parseProjectsFromFileContent,
} from '../utils/projectTransfer';
import type { ImportedProjectDraft } from '../utils/projectTransfer';

interface BulkImportModalProps {
  open: boolean;
  organisations: Organisation[];
  initialTargetOrgId: string | null;
  defaultProtocol: 'https' | 'http';
  onClose: () => void;
  onConfirmImport: (payload: {
    targetOrgId: string | null;
    newOrgName: string;
    drafts: ImportedProjectDraft[];
    mergeMatchingNames: boolean;
  }) => void;
}

type ImportMode = 'file' | 'paste';
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export function BulkImportModal({
  open,
  organisations,
  initialTargetOrgId,
  defaultProtocol,
  onClose,
  onConfirmImport,
}: BulkImportModalProps) {
  const [mode, setMode] = useState<ImportMode>('file');
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    initialTargetOrgId || organisations[0]?.id || '__new__',
  );
  const [newOrgName, setNewOrgName] = useState('');
  const [pastedUrls, setPastedUrls] = useState('');
  const [fileDrafts, setFileDrafts] = useState<ImportedProjectDraft[]>([]);
  const [fileSummary, setFileSummary] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteDrafts, setPasteDrafts] = useState<ImportedProjectDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [mergeMatchingNames, setMergeMatchingNames] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedOrgId(initialTargetOrgId || organisations[0]?.id || '__new__');
    setErrorMessage(null);
  }, [open, initialTargetOrgId, organisations]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handlePasteChange = (nextText: string) => {
    setPastedUrls(nextText);
    setErrorMessage(null);
    const grouped = groupUrlsByDomain(nextText, defaultProtocol);
    setPasteDrafts(grouped);
    const nextSel: Record<string, boolean> = {};
    for (const d of grouped) {
      nextSel[d.tempId] = true;
    }
    setSelectedIds((prev) => ({ ...prev, ...nextSel }));
  };

  const processSelectedFile = async (file: File) => {
    setErrorMessage(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setErrorMessage('File exceeds the 2 MB import limit.');
      return;
    }
    try {
      const content = await file.text();
      const parsed = parseProjectsFromFileContent(file.name, content, defaultProtocol);
      setFileDrafts(parsed.projects);
      setFileSummary(parsed.summary);
      setFileName(file.name);
      const nextSel: Record<string, boolean> = {};
      for (const d of parsed.projects) {
        nextSel[d.tempId] = true;
      }
      setSelectedIds((prev) => ({ ...prev, ...nextSel }));
    } catch (err: unknown) {
      setFileDrafts([]);
      setFileSummary(null);
      setFileName(file.name);
      setErrorMessage(err instanceof Error ? err.message : 'Unable to read project file.');
    }
  };

  const activeDrafts = mode === 'file' ? fileDrafts : pasteDrafts;

  const updateDraftName = (tempId: string, name: string) => {
    if (mode === 'file') {
      setFileDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, name } : d)));
    } else {
      setPasteDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, name } : d)));
    }
  };

  const targetOrg = useMemo(
    () => organisations.find((o) => o.id === selectedOrgId) || null,
    [organisations, selectedOrgId],
  );

  const existingProjectNames = useMemo(() => {
    const set = new Set<string>();
    if (targetOrg) {
      for (const p of targetOrg.projects) {
        set.add(p.name.trim().toLowerCase());
      }
    }
    return set;
  }, [targetOrg]);

  const selectedDrafts = useMemo(
    () => activeDrafts.filter((d) => selectedIds[d.tempId] !== false && d.name.trim().length > 0),
    [activeDrafts, selectedIds],
  );

  const allSelected =
    activeDrafts.length > 0 && activeDrafts.every((d) => selectedIds[d.tempId] !== false);

  const toggleSelectAll = () => {
    const targetVal = !allSelected;
    const next: Record<string, boolean> = { ...selectedIds };
    for (const d of activeDrafts) {
      next[d.tempId] = targetVal;
    }
    setSelectedIds(next);
  };

  const handleSubmit = () => {
    setErrorMessage(null);
    if (selectedDrafts.length === 0) {
      setErrorMessage('Select at least one project with a valid name to import.');
      return;
    }
    if (selectedOrgId === '__new__' && !newOrgName.trim()) {
      setErrorMessage('Enter a name for the new organisation.');
      return;
    }

    onConfirmImport({
      targetOrgId: selectedOrgId === '__new__' ? null : selectedOrgId,
      newOrgName: newOrgName.trim(),
      drafts: selectedDrafts,
      mergeMatchingNames,
    });
    setPastedUrls('');
    setPasteDrafts([]);
    setFileDrafts([]);
    setFileName(null);
    setFileSummary(null);
    setNewOrgName('');
    onClose();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsite-bulk-import-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#171A28] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.07] flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0">
              <FolderInput className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3
                id="upsite-bulk-import-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Bulk Import Projects & URLs
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Import projects from an exported file (.json, .csv, .txt) or paste URLs to auto-group by domain.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk import"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.07]">
            <button
              type="button"
              onClick={() => {
                setMode('file');
                setErrorMessage(null);
              }}
              className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'file'
                  ? 'bg-white dark:bg-white/[0.1] text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileUp className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Import from File (.json / .csv / .txt)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('paste');
                setErrorMessage(null);
              }}
              className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'paste'
                  ? 'bg-white dark:bg-white/[0.1] text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Paste URLs (Auto-Group by Domain)</span>
            </button>
          </div>

          {/* Target Organisation Selector (when choosing destination) */}
          {!initialTargetOrgId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="import-target-org"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Target Organisation
                </label>
                <select
                  id="import-target-org"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                >
                  {organisations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.projects.length} projects)
                    </option>
                  ))}
                  <option value="__new__">+ Create New Organisation</option>
                </select>
              </div>

              {selectedOrgId === '__new__' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="import-new-org-name"
                    className="text-xs font-medium text-slate-600 dark:text-slate-400"
                  >
                    New Organisation Name
                  </label>
                  <input
                    id="import-new-org-name"
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="e.g. Imported Clients"
                    className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
              )}
            </div>
          )}

          {/* Mode A: File Upload */}
          {mode === 'file' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-xl border border-dashed px-5 py-6 text-center space-y-3 transition-colors ${
                isDragging
                  ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-500/10'
                  : 'border-slate-300 dark:border-white/[0.14] bg-slate-50 dark:bg-[#10121C]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void processSelectedFile(f);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#171A28] border border-slate-200 dark:border-white/[0.08] flex items-center justify-center mx-auto text-slate-600 dark:text-slate-300">
                <Upload className="w-4 h-4" strokeWidth={1.75} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  {fileName ? `Selected: ${fileName}` : 'Choose a project file or drop it here'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Reads exported upsite `.json` bundles, `.csv` project sheets, or `.txt` URL lists.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 dark:bg-white/[0.1] dark:hover:bg-white/[0.16] text-white transition-colors whitespace-nowrap shrink-0"
              >
                <FileUp className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                <span>{fileName ? 'Pick Different File' : 'Choose File'}</span>
              </button>
              {fileSummary && (
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {fileSummary}
                </p>
              )}
            </div>
          )}

          {/* Mode B: Paste URLs */}
          {mode === 'paste' && (
            <div className="space-y-2">
              <label
                htmlFor="bulk-import-paste-urls"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Paste URLs (one per line, comma, or space-separated)
              </label>
              <textarea
                id="bulk-import-paste-urls"
                rows={4}
                value={pastedUrls}
                onChange={(e) => handlePasteChange(e.target.value)}
                placeholder={'https://example.com\nhttps://api.example.com\nhttps://shop.brand.co.uk\nhttps://docs.brand.co.uk'}
                className="w-full rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-300 dark:border-white/[0.08] px-3.5 py-2.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-rose-500 resize-y"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Subdomains sharing the same root domain are automatically grouped into suggested projects below. Edit any project name or uncheck groups you want to skip.
              </p>
            </div>
          )}

          {/* Suggested / Parsed Projects Selection List */}
          {activeDrafts.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  Projects Ready to Import ({selectedDrafts.length} of {activeDrafts.length} selected)
                </p>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
                >
                  {allSelected ? (
                    <CheckSquare className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.75} />
                  ) : (
                    <Square className="w-3.5 h-3.5" strokeWidth={1.75} />
                  )}
                  <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {activeDrafts.map((draft) => {
                  const isChecked = selectedIds[draft.tempId] !== false;
                  const matchesExisting = existingProjectNames.has(
                    draft.name.trim().toLowerCase(),
                  );

                  return (
                    <div
                      key={draft.tempId}
                      className={`rounded-xl border p-3.5 space-y-2 transition-colors ${
                        isChecked
                          ? 'border-slate-300 dark:border-white/[0.12] bg-white dark:bg-[#141724]'
                          : 'border-slate-200 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#10121C]/60 opacity-65'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setSelectedIds((prev) => ({
                              ...prev,
                              [draft.tempId]: e.target.checked,
                            }))
                          }
                          aria-label={`Select project ${draft.name}`}
                          className="w-4 h-4 rounded border-slate-300 dark:border-white/[0.2] accent-rose-600 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(e) => updateDraftName(draft.tempId, e.target.value)}
                          aria-label="Project name"
                          className="flex-1 min-w-0 rounded-lg bg-slate-50 dark:bg-[#10121C] border border-slate-200 dark:border-white/[0.08] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                        />
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                          {draft.urls.length} {draft.urls.length === 1 ? 'URL' : 'URLs'}
                        </span>
                      </div>

                      <div className="pl-7 space-y-1">
                        {matchesExisting && (
                          <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            {mergeMatchingNames
                              ? 'Matches existing project — new URLs will merge into it.'
                              : 'Matches existing project name — will be added separately.'}
                          </p>
                        )}
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all line-clamp-2">
                          {draft.urls.join(', ')}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={mergeMatchingNames}
                  onChange={(e) => setMergeMatchingNames(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-white/[0.2] accent-rose-600 cursor-pointer"
                />
                <span>Merge URLs into existing project when project name matches</span>
              </label>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.07] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedDrafts.length === 0}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            <FolderInput className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              Import {selectedDrafts.length} {selectedDrafts.length === 1 ? 'Project' : 'Projects'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExportProjectsModalProps {
  open: boolean;
  orgName: string;
  projects: ProjectRecord[];
  onClose: () => void;
}

export function ExportProjectsModal({
  open,
  orgName,
  projects,
  onClose,
}: ExportProjectsModalProps) {
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const p of projects) {
      next[p.id] = true;
    }
    setSelectedIds(next);
  }, [open, projects]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const selectedProjects = useMemo(
    () => projects.filter((p) => selectedIds[p.id]),
    [projects, selectedIds],
  );

  const allSelected = projects.length > 0 && selectedProjects.length === projects.length;

  const toggleAll = () => {
    const val = !allSelected;
    const next: Record<string, boolean> = {};
    for (const p of projects) {
      next[p.id] = val;
    }
    setSelectedIds(next);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsite-export-projects-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#171A28] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/[0.07] flex items-start justify-between gap-4 shrink-0">
          <div className="space-y-1 min-w-0">
            <h3
              id="upsite-export-projects-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              Export Projects from {orgName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select the projects to export. Anyone with upsite can open the exported file and pick which projects to import.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">
              {selectedProjects.length} of {projects.length} projects selected
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
            >
              {allSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-rose-500" strokeWidth={1.75} />
              ) : (
                <Square className="w-3.5 h-3.5" strokeWidth={1.75} />
              )}
              <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
            </button>
          </div>

          <div className="space-y-2">
            {projects.map((project) => {
              const checked = Boolean(selectedIds[project.id]);
              return (
                <label
                  key={project.id}
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 cursor-pointer transition-colors ${
                    checked
                      ? 'border-slate-300 dark:border-white/[0.12] bg-white dark:bg-[#141724]'
                      : 'border-slate-200 dark:border-white/[0.06] bg-slate-50/70 dark:bg-[#10121C]/60 opacity-65'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedIds((prev) => ({ ...prev, [project.id]: e.target.checked }))
                    }
                    className="w-4 h-4 mt-0.5 rounded border-slate-300 dark:border-white/[0.2] accent-rose-600 cursor-pointer shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {project.name}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                        {project.urls.length} {project.urls.length === 1 ? 'URL' : 'URLs'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {project.urls.join(', ')}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.07] flex flex-wrap items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedProjects.length === 0}
            onClick={() => {
              exportSelectedProjectsCsv(orgName, selectedProjects);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            disabled={selectedProjects.length === 0}
            onClick={() => {
              exportSelectedProjectsJson(orgName, selectedProjects);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            <FileCode2 className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>Export Project File (.json)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
