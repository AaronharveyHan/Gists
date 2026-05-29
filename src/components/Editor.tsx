/**
 * Monaco Editor wrapper.
 *
 * Auto-save: debounced 1.5 s → SQLite only (pending_push). GitHub via 「同步到 GitHub」.
 * Conflict detection: if a background sync updates the currently-open gist
 *   while the user has unsaved local edits, a banner appears with two choices:
 *   "Keep mine" (overwrite remote) or "Take remote" (discard local edits).
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard } from "../hooks/useKeyboard";
import MonacoEditor from "@monaco-editor/react";
import { useGistStore, useSelectedGist } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import { notify } from "../store/useNotificationStore";
import { useDebounce } from "../hooks/useDebounce";
import { TagInput } from "./TagInput";
import { MarkdownPreview } from "./MarkdownPreview";
import { RevisionBrowser } from "./RevisionBrowser";
import { AIPanel } from "./AIPanel";
import { RunPanel } from "./RunPanel";
import { SaveAsTemplateModal } from "./TemplatesModal";
import { ShareModal } from "./ShareModal";
import { PromptLibrary } from "./PromptLibrary";
import { CollectionPicker } from "./CollectionPicker";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";
import * as api from "../api/tauri";
import type { GistFile, Template } from "../api/tauri";
import { RUNNABLE_EXTENSIONS } from "../api/tauri";
import { useThemeStore, resolveMonacoTheme } from "../store/useThemeStore";
import { useEditorUIStore } from "../store/useEditorUIStore";

export type { GistFile };

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", rs: "rust",
    go: "go", java: "java", cs: "csharp",
    cpp: "cpp", c: "c", h: "c",
    html: "html", css: "css", scss: "scss",
    json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", md: "markdown", sh: "shell",
    sql: "sql", xml: "xml", php: "php",
  };
  return map[ext] ?? "plaintext";
}

function cloneFiles(files: GistFile[]): GistFile[] {
  return files.map((f) => ({ ...f }));
}

function isMarkdownFilename(filename: string | null): boolean {
  if (!filename) return false;
  return filename.split(".").pop()?.toLowerCase() === "md";
}

type MdViewMode = "source" | "preview" | "split";

// ── Conflict state ────────────────────────────────────────────────────────────

interface ConflictState {
  /** Files from the remote (as updated by sync) */
  remoteFiles: GistFile[];
  remoteDescription: string;
  /** The updated_at of the remote version that caused the conflict */
  remoteUpdatedAt: string;
}

// ── Editor component ──────────────────────────────────────────────────────────

export function Editor() {
  const gist = useSelectedGist();
  const {
    updateGist,
    saveGistDraft,
    pullGistRemote,
    deleteGist,
    allTags,
    gistTags,
    loadGistTags,
    setGistTags,
    createTag,
    publishGist,
    networkOnline,
    gists,
    selectedId,
    selectGist,
    openTabIds,
    closeTab,
  } = useGistStore();

  const t = useT();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<GistFile[]>([]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  // Ref-based mutex: prevents autoSave, pushToGitHub, and conflict resolution
  // from running concurrently (state updates are async and can't guard this).
  const isWriting = useRef(false);

  // True once the user has made any change in the current edit session.
  const [isDirty, setIsDirty] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [runTrigger, setRunTrigger] = useState(0);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showPromptLib, setShowPromptLib] = useState(false);
  const { presetId, editorFontSize, vimMode } = useThemeStore();
  const monacoTheme = resolveMonacoTheme(presetId);
  const { setCursor, setSelection, setActiveFilename } = useEditorUIStore();
  const editorRef = useRef<any>(null);
  const vimRef = useRef<{ dispose: () => void } | null>(null);
  const vimStatusRef = useRef<HTMLDivElement>(null);

  // Track filenames deleted locally so pushToGitHub can send null to the API.
  const [deletedFiles, setDeletedFiles] = useState<Set<string>>(new Set());

  // Drag-to-reorder state
  const [dragSrc, setDragSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Tab right-click context menu
  const [tabCtx, setTabCtx] = useState<{ filename: string; x: number; y: number } | null>(null);

  // Inline rename state
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  /** Markdown: 源码 / 预览 / 分栏（仅 .md 当前文件显示 Tab） */
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>("split");
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const prevMdPreviewKey = useRef<string | null>(null);

  // Non-null when a background sync updated the open gist while it was dirty.
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // ── Load state when gist selection changes ───────────────────────────────

  useEffect(() => {
    if (!gist) return;
    setLocalFiles(cloneFiles(gist.files));
    setDescription(gist.description);
    // Preserve active tab if it still exists in the new gist, else default to first.
    setActiveFile((prev) =>
      gist.files.some((f) => f.filename === prev)
        ? prev
        : (gist.files[0]?.filename ?? null)
    );
    setIsDirty(false);
    setConflict(null);
    setShowHistory(false);
    setDeletedFiles(new Set());
    setRenamingFile(null);
    // Load tags for the newly selected gist
    loadGistTags(gist.id);
    prevUpdatedAt.current = "";
  }, [gist?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Conflict detection: runs when remote gist.updated_at changes ─────────
  //
  // Same gist ID, but updated_at changed (background sync pulled a newer
  // version). If the user has unsaved edits, surface the conflict banner
  // instead of silently overwriting their work.

  const prevUpdatedAt = useRef<string>("");
  useEffect(() => {
    if (!gist) return;
    const cur = gist.updated_at;
    const prev = prevUpdatedAt.current;

    if (prev === "") {
      prevUpdatedAt.current = cur;
      return;
    }
    if (prev === cur) return;

    prevUpdatedAt.current = cur;

    const canSilentRefresh = !isDirty && !gist.pending_push;
    if (canSilentRefresh) {
      setLocalFiles(cloneFiles(gist.files));
      setDescription(gist.description);
      setConflict(null);
      return;
    }

    let cancelled = false;
    void api
      .fetchGistFromGitHub(gist.id)
      .then((remote) => {
        if (cancelled) return;
        setConflict({
          remoteFiles: remote.files,
          remoteDescription: remote.description,
          remoteUpdatedAt: remote.updated_at,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setConflict({
          remoteFiles: gist.files,
          remoteDescription: gist.description,
          remoteUpdatedAt: cur,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [gist?.id, gist?.updated_at, gist?.pending_push, isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save (debounced 1.5 s) → SQLite only ────────────────────────────

  const autoSaveLocal = useCallback(
    async (files: GistFile[], desc: string) => {
      if (!gist || conflict || isWriting.current) return;
      isWriting.current = true;
      setSaving(true);
      try {
        const pairs: [string, string][] = files.map((f) => [
          f.filename,
          f.content,
        ]);
        await saveGistDraft(gist.id, desc, pairs);
        setIsDirty(false);
      } catch (e) {
        notify(t.editor.publishFailed + " " + String(e));
      } finally {
        isWriting.current = false;
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gist?.id, conflict, saveGistDraft]
  );

  const debouncedSave = useDebounce(autoSaveLocal, 1500);

  // ── Explicit GitHub push ─────────────────────────────────────────────────

  const pushToGitHub = async () => {
    if (!gist || !gist.pending_push || conflict || isWriting.current) return;
    isWriting.current = true;
    setSaving(true);
    try {
      const fileMap: Record<string, [string, string | null] | null> = {};
      for (const f of localFiles) {
        fileMap[f.filename] = [f.content, null];
      }
      for (const name of deletedFiles) {
        if (!localFiles.some((f) => f.filename === name)) {
          fileMap[name] = null;
        }
      }
      await updateGist(gist.id, description, fileMap);
      setDeletedFiles(new Set());
      notify(t.editor.publishSuccess, "success");
    } catch (e) {
      notify(t.editor.publishFailed + " " + String(e));
    } finally {
      isWriting.current = false;
      setSaving(false);
    }
  };

  const handleContentChange = (value: string | undefined) => {
    if (!activeFile) return;
    const updated = localFiles.map((f) =>
      f.filename === activeFile ? { ...f, content: value ?? "" } : f
    );
    setLocalFiles(updated);
    setIsDirty(true);
    debouncedSave(updated, description);
  };

  const handleDescChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(e.target.value);
    setIsDirty(true);
    debouncedSave(localFiles, e.target.value);
  };

  // ── File add / delete / rename ──────────────────────────────────────────

  const handleAddFile = () => {
    const base = "untitled";
    const existing = new Set(localFiles.map((f) => f.filename));
    let name = base;
    let i = 1;
    while (existing.has(name)) {
      name = `${base}_${i}`;
      i++;
    }
    const newFile: GistFile = {
      filename: name,
      language: null,
      content: "",
      size: 0,
      raw_url: null,
    };
    const updated = [...localFiles, newFile];
    setLocalFiles(updated);
    setActiveFile(name);
    setIsDirty(true);
    // Enter rename mode immediately so user can set the real filename
    setRenamingFile(name);
    setRenameValue(name);
  };

  const handleDeleteFile = (filename: string) => {
    if (localFiles.length <= 1) return;
    const updated = localFiles.filter((f) => f.filename !== filename);
    setDeletedFiles((prev) => new Set(prev).add(filename));
    setLocalFiles(updated);
    if (activeFile === filename) {
      setActiveFile(updated[0]?.filename ?? null);
    }
    setIsDirty(true);
    debouncedSave(updated, description);
  };

  const handleReorderFiles = (fromName: string, toName: string) => {
    if (fromName === toName) return;
    const files = [...localFiles];
    const fromIdx = files.findIndex((f) => f.filename === fromName);
    const toIdx = files.findIndex((f) => f.filename === toName);
    if (fromIdx === -1 || toIdx === -1) return;
    const [item] = files.splice(fromIdx, 1);
    files.splice(toIdx, 0, item);
    setLocalFiles(files);
    setIsDirty(true);
    debouncedSave(files, description);
  };

  const handleCloseOthers = (filename: string) => {
    if (localFiles.length <= 1) return;
    const toDelete = localFiles.filter((f) => f.filename !== filename);
    setDeletedFiles((prev) => new Set([...prev, ...toDelete.map((f) => f.filename)]));
    const keep = [localFiles.find((f) => f.filename === filename)!];
    setLocalFiles(keep);
    setActiveFile(filename);
    setIsDirty(true);
    debouncedSave(keep, description);
  };

  const handleCloseToRight = (filename: string) => {
    const idx = localFiles.findIndex((f) => f.filename === filename);
    if (idx >= localFiles.length - 1) return;
    const toDelete = localFiles.slice(idx + 1);
    setDeletedFiles((prev) => new Set([...prev, ...toDelete.map((f) => f.filename)]));
    const keep = localFiles.slice(0, idx + 1);
    setLocalFiles(keep);
    if (!keep.some((f) => f.filename === activeFile)) {
      setActiveFile(keep[keep.length - 1]?.filename ?? null);
    }
    setIsDirty(true);
    debouncedSave(keep, description);
  };

  const startRename = (filename: string) => {
    setRenamingFile(filename);
    setRenameValue(filename);
  };

  const commitRename = () => {
    if (!renamingFile) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renamingFile) {
      // No change or empty — if this was a just-added placeholder with no content, keep it
      setRenamingFile(null);
      return;
    }
    if (localFiles.some((f) => f.filename !== renamingFile && f.filename === trimmed)) {
      notify(t.editor.fileExists + " " + trimmed);
      return;
    }
    // Only track old name as deleted for GitHub if it was synced from remote
    // (locally-added files have raw_url: null and were never pushed)
    const fileBeingRenamed = localFiles.find((f) => f.filename === renamingFile);
    if (fileBeingRenamed?.raw_url) {
      setDeletedFiles((prev) => new Set(prev).add(renamingFile));
    }
    const updated = localFiles.map((f) =>
      f.filename === renamingFile ? { ...f, filename: trimmed } : f
    );
    setLocalFiles(updated);
    if (activeFile === renamingFile) setActiveFile(trimmed);
    setRenamingFile(null);
    setIsDirty(true);
    debouncedSave(updated, description);
  };

  // ── Conflict resolution ──────────────────────────────────────────────────

  const handleKeepMine = async () => {
    if (!gist || !conflict || isWriting.current) return;
    isWriting.current = true;
    setSaving(true);
    try {
      const fileMap: Record<string, [string, string | null] | null> = {};
      for (const f of localFiles) {
        fileMap[f.filename] = [f.content, null];
      }
      for (const name of deletedFiles) {
        if (!localFiles.some((f) => f.filename === name)) {
          fileMap[name] = null;
        }
      }
      await updateGist(gist.id, description, fileMap);
      setDeletedFiles(new Set());
      setIsDirty(false);
      setConflict(null);
    } catch (e) {
      notify(t.editor.keepLocalFailed + " " + String(e));
    } finally {
      isWriting.current = false;
      setSaving(false);
    }
  };

  const handleTakeRemote = async () => {
    if (!gist || !conflict || isWriting.current) return;
    isWriting.current = true;
    setSaving(true);
    try {
      const fresh = await pullGistRemote(gist.id);
      setLocalFiles(cloneFiles(fresh.files));
      setDescription(fresh.description);
      setIsDirty(false);
      setConflict(null);
    } catch (e) {
      notify(t.editor.takeRemoteFailed + " " + String(e));
    } finally {
      isWriting.current = false;
      setSaving(false);
    }
  };

  // ── Markdown preview sync ────────────────────────────────────────────────

  const activeContent =
    localFiles.find((f) => f.filename === activeFile)?.content ?? "";

  const isMdActive = Boolean(gist) && isMarkdownFilename(activeFile);
  const mdPreviewKey = `${gist?.id ?? ""}:${activeFile ?? ""}`;

  // 换 gist / 换文件：立即刷新预览；同一 .md 文件内输入：防抖刷新
  useEffect(() => {
    const switched = prevMdPreviewKey.current !== mdPreviewKey;
    prevMdPreviewKey.current = mdPreviewKey;

    if (switched) {
      setPreviewMarkdown(activeContent);
      return;
    }

    if (!isMdActive) return;
    const id = window.setTimeout(() => setPreviewMarkdown(activeContent), 200);
    return () => window.clearTimeout(id);
  }, [mdPreviewKey, activeContent, isMdActive]);

  // ── History panel toggle (must be above early return) ────────────────────
  const toggleHistory = useCallback(() => {
    setShowHistory((v) => !v);
    setShowAI(false);
  }, []);
  useKeyboard("h", "meta+shift", toggleHistory);

  const toggleAI = useCallback(() => {
    setShowAI((v) => !v);
    setShowHistory(false);
  }, []);
  useKeyboard("a", "meta+shift", toggleAI);

  const openSaveAsTemplate = useCallback(() => setShowSaveAsTemplate(true), []);
  useKeyboard("t", "meta+shift", openSaveAsTemplate);

  const openShare = useCallback(() => setShowShare(true), []);
  useKeyboard("s", "meta+shift", openShare);

  // Whether the active file can be executed
  const activeExt = activeFile?.split(".").pop()?.toLowerCase() ?? "";
  const isRunnable = RUNNABLE_EXTENSIONS.has(activeExt);

  const handleRun = useCallback(() => {
    setShowRun(true);
    setShowHistory(false);
    setShowAI(false);
    setRunTrigger((n) => n + 1);
  }, []);
  useKeyboard("e", "meta+shift", handleRun);

  // ── Tab keyboard navigation (must be above early return) ─────────────────
  const gotoPrevTab = useCallback(() => {
    if (!localFiles.length || !activeFile) return;
    const idx = localFiles.findIndex((f) => f.filename === activeFile);
    setActiveFile(localFiles[(idx - 1 + localFiles.length) % localFiles.length].filename);
  }, [localFiles, activeFile]);
  const gotoNextTab = useCallback(() => {
    if (!localFiles.length || !activeFile) return;
    const idx = localFiles.findIndex((f) => f.filename === activeFile);
    setActiveFile(localFiles[(idx + 1) % localFiles.length].filename);
  }, [localFiles, activeFile]);
  useKeyboard("[", "alt", gotoPrevTab);
  useKeyboard("]", "alt", gotoNextTab);

  // ── Active file + vim mode (must be above early return) ──────────────────

  useEffect(() => {
    setActiveFilename(activeFile);
  }, [activeFile, setActiveFilename]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (vimMode && vimStatusRef.current) {
      const ed = editorRef.current;
      const statusEl = vimStatusRef.current;
      let disposed = false;
      import("monaco-vim").then(({ initVimMode: init }) => {
        if (disposed) return;
        vimRef.current = init(ed, statusEl);
      });
      return () => {
        disposed = true;
        vimRef.current?.dispose();
        vimRef.current = null;
      };
    } else {
      vimRef.current?.dispose();
      vimRef.current = null;
    }
  }, [vimMode, gist?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global Find / Replace shortcuts ─────────────────────────────────────
  // When Monaco is focused it handles ⌘F / ⌘H natively (and calls
  // preventDefault, so e.defaultPrevented will be true by the time this
  // window listener fires). We only act when Monaco is NOT focused.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "f" && key !== "h") return;
      if (!editorRef.current) return;
      e.preventDefault();
      editorRef.current.focus();
      const actionId =
        key === "h"
          ? "editor.action.startFindReplaceAction"
          : "actions.find";
      editorRef.current.getAction(actionId)?.run();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleEditorMount = useCallback(
    (editor: any) => {
      editorRef.current = editor;
      editor.onDidChangeCursorPosition((e: any) => {
        setCursor(e.position.lineNumber, e.position.column);
      });
      editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection();
        if (!sel || sel.isEmpty()) {
          setSelection(0, 0);
          return;
        }
        const model = editor.getModel();
        if (model) {
          const text = model.getValueInRange(sel);
          const lines = sel.endLineNumber - sel.startLineNumber + 1;
          setSelection(text.length, lines);
        }
      });
    },
    [setCursor, setSelection]
  );

  // ── Empty state ──────────────────────────────────────────────────────────

  if (!gist) {
    return (
      <div className="editor editor--empty">
        <p>Select a gist, or press <kbd>⌘N</kbd> to create one</p>
      </div>
    );
  }

  const openFind = () => {
    editorRef.current?.focus();
    editorRef.current?.getAction("actions.find")?.run();
  };

  const openReplace = () => {
    editorRef.current?.focus();
    editorRef.current?.getAction("editor.action.startFindReplaceAction")?.run();
  };

  const editorOptions = {
    fontSize: editorFontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on" as const,
    lineNumbers: "on" as const,
    renderLineHighlight: "line" as const,
    smoothScrolling: true,
    cursorBlinking: "smooth" as const,
    padding: { top: 16 },
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: "multiline" as const,
      seedSearchStringFromSelection: "always" as const,
    },
  };

  return (
    <div className="editor">

      {/* Gist tab bar — shown when ≥1 gist is explicitly opened in a tab */}
      {openTabIds.length > 0 && (
        <div className="editor__gist-tabs">
          {openTabIds.map((tabId) => {
            const g = gists.find((x) => x.id === tabId);
            const label = g
              ? (g.description?.trim() || g.files[0]?.filename || tabId.slice(0, 8))
              : tabId.slice(0, 8);
            const isActive = tabId === selectedId;
            return (
              <div
                key={tabId}
                className={`editor__gist-tab${isActive ? " editor__gist-tab--active" : ""}`}
                onClick={() => selectGist(tabId)}
                title={g?.description || label}
              >
                <span className="editor__gist-tab-label">{label}</span>
                <button
                  className="editor__gist-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(tabId); }}
                  title="Close tab"
                >×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Conflict banner */}
      {conflict && (
        <div className="conflict-banner">
          <span className="conflict-banner__msg">
            {t.editor.conflictBanner}
          </span>
          <div className="conflict-banner__actions">
            <button
              className="btn btn--primary conflict-banner__btn"
              onClick={handleKeepMine}
              disabled={saving}
            >
              {t.editor.keepMine}
            </button>
            <button
              className="btn conflict-banner__btn"
              onClick={handleTakeRemote}
            >
              {t.editor.takeRemote}
            </button>
          </div>
        </div>
      )}

      <div className="editor__toolbar">
        <input
          className="editor__description"
          value={description}
          onChange={handleDescChange}
          placeholder={t.editor.descriptionPlaceholder}
        />
        <div className="editor__actions">
          {isDirty && !saving && (
            <span
              className="editor__dirty"
              title={t.editor.typingNotSaved}
            >
              ●
            </span>
          )}
          {!isDirty && gist.pending_push && !saving && (
            <span
              className="editor__pending-push"
              title={t.editor.savedLocally}
            >
              ↑
            </span>
          )}
          {saving && (
            <span className="editor__saving">{t.common.saving}</span>
          )}
          {gist.local_only ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={async () => {
                if (!networkOnline) { notify(t.editor.offlineCannotPublish); return; }
                try {
                  await publishGist(gist.id);
                  notify(t.editor.publishSuccess, "success");
                } catch (e) {
                  notify(t.editor.publishFailed + " " + String(e));
                }
              }}
              disabled={saving || !networkOnline}
              title={networkOnline ? t.editor.publish : t.editor.offline}
            >
              {networkOnline ? t.editor.publish : t.editor.offline}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void pushToGitHub()}
              disabled={saving || !gist.pending_push || !!conflict || isDirty}
              title={isDirty ? t.editor.waitForSave : t.editor.syncToGitHubTitle}
            >
              {t.editor.syncToGitHub}
            </button>
          )}
          <button
            type="button"
            className="btn editor__find-btn"
            onClick={openFind}
            title={t.editor.findTitle}
          >
            {t.editor.find}
          </button>
          <button
            type="button"
            className="btn editor__find-btn"
            onClick={openReplace}
            title={t.editor.replaceTitle}
          >
            {t.editor.replace}
          </button>
          <button
            type="button"
            className={`btn ${showHistory ? "btn--primary" : ""}`}
            onClick={() => toggleHistory()}
            title={t.editor.historyTitle}
          >
            {t.editor.history}
          </button>
          <button
            type="button"
            className={`btn ${showAI ? "btn--primary" : ""}`}
            onClick={() => toggleAI()}
            title={t.editor.aiTitle}
          >
            {t.editor.ai}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowSaveAsTemplate(true)}
            title={t.editor.templateTitle}
          >
            {t.editor.template}
          </button>
          <button
            type="button"
            className={`btn editor__prompt-btn${gist.category === "prompt" ? " btn--prompt-active" : ""}`}
            onClick={async () => {
              if (gist.category === "prompt") {
                await api.setGistCategory(gist.id, "gist");
                notify(t.editor.promptRemoved, "success");
              } else {
                await api.setGistCategory(gist.id, "prompt");
                notify(t.editor.promptAdded, "success");
              }
              await useGistStore.getState().loadGists();
            }}
            title={gist.category === "prompt" ? t.editor.removeFromPrompt : t.editor.addToPrompt}
          >
            {gist.category === "prompt" ? t.editor.promptStar : t.editor.promptEmpty}
          </button>
          <button
            type="button"
            className="btn editor__prompt-lib-btn"
            onClick={() => setShowPromptLib(true)}
            title={t.editor.libraryTitle}
          >
            {t.editor.library}
          </button>
          <button
            type="button"
            className="btn editor__share-btn"
            onClick={() => setShowShare(true)}
            title={t.editor.shareTitle}
          >
            {t.editor.share}
          </button>
          {isRunnable && (
            <button
              type="button"
              className={`btn editor__run-btn ${showRun ? "btn--primary" : ""}`}
              onClick={handleRun}
              title={t.editor.runTitle}
            >
              {t.editor.run}
            </button>
          )}
          <a
            className="btn btn--ghost"
            href={gist.html_url}
            onClick={(e) => {
              e.preventDefault();
              import("@tauri-apps/plugin-shell").then(({ open }) =>
                open(gist.html_url)
              );
            }}
          >
            {t.editor.viewOnGitHub}
          </a>
          <button
            className="btn btn--danger"
            onClick={() => {
              if (confirm(t.editor.deleteConfirm))
                deleteGist(gist.id).catch((e) => notify(t.editor.deleteFailed + " " + String(e)));
            }}
          >
            {t.editor.delete}
          </button>
        </div>
      </div>

      {/* Local draft banner */}
      {gist.local_only && (
        <div className="editor__draft-banner">
          <span className="editor__draft-banner__icon">✎</span>
          <span className="editor__draft-banner__text">
            {t.editor.localDraft}
          </span>
          {!networkOnline && (
            <span className="editor__draft-banner__offline">{t.editor.offline}</span>
          )}
        </div>
      )}

      {/* Tag row */}
      <TagInput
        tags={gistTags[gist.id] ?? []}
        allTags={allTags}
        onAdd={async (tagId) => {
          const current = (gistTags[gist.id] ?? []).map((t) => t.id);
          await setGistTags(gist.id, [...current, tagId]);
        }}
        onRemove={async (tagId) => {
          const current = (gistTags[gist.id] ?? [])
            .filter((t) => t.id !== tagId)
            .map((t) => t.id);
          await setGistTags(gist.id, current);
        }}
        onCreateAndAdd={async (name, color) => {
          const tag = await createTag(name, color);
          const current = (gistTags[gist.id] ?? []).map((t) => t.id);
          await setGistTags(gist.id, [...current, tag.id]);
        }}
      />

      {/* Collection row */}
      <CollectionPicker gistId={gist.id} />

      {/* File tabs */}
      <div className="editor__tabs">
        {localFiles.map((f) => {
          const isActive = f.filename === activeFile;
          const isDragging = dragSrc === f.filename;
          const isDropTarget = dragOver === f.filename && dragSrc !== f.filename;
          return (
            <div
              key={f.filename}
              className={[
                "editor__tab",
                isActive ? "editor__tab--active" : "",
                isDragging ? "editor__tab--dragging" : "",
                isDropTarget ? "editor__tab--drop-target" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => { if (renamingFile !== f.filename) setActiveFile(f.filename); }}
              onDoubleClick={() => startRename(f.filename)}
              onMouseDown={(e) => {
                // Middle-click closes tab
                if (e.button === 1 && localFiles.length > 1) {
                  e.preventDefault();
                  handleDeleteFile(f.filename);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabCtx({ filename: f.filename, x: e.clientX, y: e.clientY });
              }}
              draggable={renamingFile !== f.filename}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragSrc(f.filename);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(f.filename);
              }}
              onDragLeave={() => setDragOver((v) => v === f.filename ? null : v)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragSrc) handleReorderFiles(dragSrc, f.filename);
                setDragSrc(null);
                setDragOver(null);
              }}
              onDragEnd={() => { setDragSrc(null); setDragOver(null); }}
            >
              {renamingFile === f.filename ? (
                <input
                  ref={renameInputRef}
                  className="editor__tab-rename"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingFile(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="editor__tab-name">{f.filename}</span>
              )}
              {isDirty && isActive && (
                <span className="editor__tab-dot">●</span>
              )}
              {localFiles.length > 1 && (
                <button
                  className="editor__tab-close"
                  title={`Close ${f.filename}`}
                  onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.filename); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="editor__tab editor__tab--add"
          onClick={handleAddFile}
          title={t.editor.newFile}
        >
          +
        </button>
      </div>

      {/* Tab context menu */}
      {tabCtx && (() => {
        const { filename, x, y } = tabCtx;
        const idx = localFiles.findIndex((f) => f.filename === filename);
        const items: ContextMenuEntry[] = [
          { label: t.editor.renameTab, shortcut: t.editor.renameShortcut, onClick: () => startRename(filename) },
          { separator: true },
          {
            label: t.editor.closeTab,
            onClick: () => handleDeleteFile(filename),
            disabled: localFiles.length <= 1,
          },
          {
            label: t.editor.closeOthers,
            onClick: () => handleCloseOthers(filename),
            disabled: localFiles.length <= 1,
          },
          {
            label: t.editor.closeToRight,
            onClick: () => handleCloseToRight(filename),
            disabled: idx >= localFiles.length - 1,
          },
        ];
        return (
          <ContextMenu x={x} y={y} items={items} onClose={() => setTabCtx(null)} />
        );
      })()}

      {/* Markdown view mode tabs (only for .md files) */}
      {isMdActive && (
        <div className="editor__md-tabs" role="tablist" aria-label={t.editor.mdViewLabel}>
          {(
            [
              ["source", t.editor.mdSource] as const,
              ["preview", t.editor.mdPreview] as const,
              ["split", t.editor.mdSplit] as const,
            ] satisfies readonly [MdViewMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mdViewMode === mode}
              className={`editor__md-tab ${mdViewMode === mode ? "editor__md-tab--active" : ""}`}
              onClick={() => setMdViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="editor__content-wrap">
        <div
          className={`editor__body ${isMdActive ? `editor__body--md editor__body--md-${mdViewMode}` : ""}`}
        >
          <div className="editor__pane editor__pane--monaco">
            <MonacoEditor
              height="100%"
              language={detectLanguage(activeFile ?? "")}
              value={activeContent}
              onChange={handleContentChange}
              onMount={handleEditorMount}
              theme={monacoTheme}
              options={editorOptions}
            />
          </div>
          {isMdActive && (
            <div className="editor__pane editor__pane--preview">
              <MarkdownPreview markdown={previewMarkdown} showCopyAll />
            </div>
          )}
        </div>

        {showRun && (
          <RunPanel
            filename={activeFile ?? ""}
            content={activeContent}
            runTrigger={runTrigger}
            onClose={() => setShowRun(false)}
          />
        )}
        {showHistory && (
          <RevisionBrowser
            gistId={gist.id}
            currentFiles={localFiles}
            onRestore={(files, desc) => {
              setLocalFiles(files.map((f) => ({ ...f })));
              setDescription(desc);
              setIsDirty(true);
            }}
            onClose={() => setShowHistory(false)}
          />
        )}
        {showAI && (
          <AIPanel
            gistId={gist.id}
            files={localFiles}
            description={description}
            onApplyDescription={(desc) => {
              setDescription(desc);
              setIsDirty(true);
            }}
            onClose={() => setShowAI(false)}
          />
        )}
      </div>

      {vimMode && <div className="editor__vim-status" ref={vimStatusRef} />}

      {showSaveAsTemplate && (
        <SaveAsTemplateModal
          gistId={gist.id}
          defaultName={gist.description || gist.files[0]?.filename || "My Template"}
          onClose={() => setShowSaveAsTemplate(false)}
        />
      )}
      {showShare && (
        <ShareModal gist={gist} onClose={() => setShowShare(false)} />
      )}
      {showPromptLib && (
        <PromptLibrary
          onNavigate={(id) => {
            useGistStore.getState().selectGist(id);
          }}
          onClose={() => setShowPromptLib(false)}
        />
      )}
    </div>
  );
}

// ── New Gist Modal ────────────────────────────────────────────────────────────

export function NewGistModal({
  onClose,
  onCreate,
  onCreateLocal,
  networkOnline = true,
  template,
}: {
  onClose: () => void;
  onCreate: (desc: string, pub: boolean, files: [string, string][]) => Promise<unknown>;
  onCreateLocal: (desc: string, pub: boolean, files: [string, string][]) => Promise<unknown>;
  networkOnline?: boolean;
  template?: Template;
}) {
  const t = useT();
  const isLocalMode = useGistStore((s) => s.githubLogin === "local");
  const [desc, setDesc] = useState(template?.description ?? "");
  const [filename, setFilename] = useState(
    template?.files[0]?.filename ?? `${t.editor.untitled}.md`
  );
  const [content, setContent] = useState(template?.files[0]?.content ?? "");
  const [isPublic, setIsPublic] = useState(template?.is_public ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const validate = () => {
    if (!template) {
      if (!filename.trim()) { setError(t.editor.filenameRequired); return false; }
      if (!content.trim()) { setError(t.editor.contentEmpty); return false; }
    }
    setError(null);
    return true;
  };

  const buildFiles = (): [string, string][] =>
    template
      ? template.files.map((f) => [f.filename, f.content] as [string, string])
      : [[filename, content]];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await onCreate(desc, isPublic, buildFiles());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await onCreateLocal(desc, isPublic, buildFiles());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const blockEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          {template ? t.editor.newGistFromTemplate(template.name) : t.editor.newGistTitle}
        </h2>
        {template && (
          <div className="modal__template-info">
            <span className="modal__template-label">{t.editor.templateFiles}</span>
            {template.files.map((f) => (
              <span key={f.filename} className="modal__template-file">
                {f.filename}
              </span>
            ))}
          </div>
        )}
        <form onSubmit={handleCreate}>
          <label>
            {t.editor.descriptionLabel}
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={blockEnter}
              placeholder={t.editor.descriptionOptional}
              autoFocus
            />
          </label>
          {!template && (
            <>
              <label>
                {t.editor.filenameLabel}
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  onKeyDown={blockEnter}
                />
              </label>
              <label>
                {t.editor.contentLabel}
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                />
              </label>
            </>
          )}
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            {t.editor.publicGist}
          </label>
          {error && <p className="modal__error">{error}</p>}
          {!networkOnline && (
            <p className="modal__offline-hint">
              {t.editor.offlineDraftOnly}
            </p>
          )}
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button
              type="button"
              className={`btn${isLocalMode ? " btn--primary" : ""}`}
              onClick={handleSaveDraft}
              disabled={loading || (!template && (!filename.trim() || !content.trim()))}
              title={t.editor.saveLocallyTitle}
            >
              {t.editor.saveDraft}
            </button>
            {!isLocalMode && (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={loading || !networkOnline || (!template && (!filename.trim() || !content.trim()))}
                title={networkOnline ? t.editor.createOnGitHubTitle : t.editor.offlineUseDraft}
              >
                {loading ? t.editor.creating : t.editor.createOnGitHub}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
