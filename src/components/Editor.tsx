/**
 * Monaco Editor wrapper.
 *
 * Auto-save: debounced 1.5 s → SQLite only (pending_push). GitHub via 「同步到 GitHub」.
 * Conflict detection: if a background sync updates the currently-open gist
 *   while the user has unsaved local edits, a banner appears with two choices:
 *   "Keep mine" (overwrite remote) or "Take remote" (discard local edits).
 */
import { useState, useCallback, useEffect, useRef } from "react";
import MonacoEditor from "@monaco-editor/react";
import { useGistStore, useSelectedGist } from "../store/useGistStore";
import { useDebounce } from "../hooks/useDebounce";
import { TagInput } from "./TagInput";
import { MarkdownPreview } from "./MarkdownPreview";
import { DiffModal } from "./DiffModal";
import * as api from "../api/tauri";
import type { GistFile } from "../api/tauri";
import { notify } from "../store/useNotificationStore";
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
    githubLogin,
  } = useGistStore();

  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<GistFile[]>([]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  // Ref-based mutex: prevents autoSave, pushToGitHub, and conflict resolution
  // from running concurrently (state updates are async and can't guard this).
  const isWriting = useRef(false);

  // True once the user has made any change in the current edit session.
  const [isDirty, setIsDirty] = useState(false);

  const [diffOpen, setDiffOpen] = useState(false);
  const { presetId, editorFontSize, vimMode } = useThemeStore();
  const monacoTheme = resolveMonacoTheme(presetId);
  const { setCursor, setSelection, setActiveFilename } = useEditorUIStore();
  const editorRef = useRef<any>(null);
  const vimRef = useRef<{ dispose: () => void } | null>(null);
  const vimStatusRef = useRef<HTMLDivElement>(null);

  // Track filenames deleted locally so pushToGitHub can send null to the API.
  const [deletedFiles, setDeletedFiles] = useState<Set<string>>(new Set());

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
    setDiffOpen(false);
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
        notify("草稿保存失败: " + String(e));
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
      notify("已同步到 GitHub", "success");
    } catch (e) {
      notify("同步到 GitHub 失败: " + String(e));
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
      notify("文件名已存在: " + trimmed);
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
      notify("保留本地版本失败: " + String(e));
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
      notify("拉取远端版本失败: " + String(e));
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
  };

  return (
    <div className="editor">

      {/* Conflict banner */}
      {conflict && (
        <div className="conflict-banner">
          <span className="conflict-banner__msg">
            ⚠ Remote version updated while you were editing
          </span>
          <div className="conflict-banner__actions">
            <button
              className="btn btn--primary conflict-banner__btn"
              onClick={handleKeepMine}
              disabled={saving}
            >
              Keep mine
            </button>
            <button
              className="btn conflict-banner__btn"
              onClick={handleTakeRemote}
            >
              Take remote
            </button>
          </div>
        </div>
      )}

      <div className="editor__toolbar">
        <input
          className="editor__description"
          value={description}
          onChange={handleDescChange}
          placeholder="Gist description…"
        />
        <div className="editor__actions">
          {isDirty && !saving && (
            <span
              className="editor__dirty"
              title="正在输入，尚未写入本地数据库"
            >
              ●
            </span>
          )}
          {!isDirty && gist.pending_push && !saving && (
            <span
              className="editor__pending-push"
              title="已保存到本地，尚未同步到 GitHub"
            >
              ↑
            </span>
          )}
          {saving && (
            <span className="editor__saving">保存中…</span>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void pushToGitHub()}
            disabled={
              saving || !gist.pending_push || !!conflict || isDirty
            }
            title={
              isDirty
                ? "请先等待本地自动保存完成"
                : "将当前内容 PATCH 到 GitHub（产生新版本）"
            }
          >
            同步到 GitHub
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setDiffOpen(true)}
            title="Revisions 时间线与 Working tree diff"
          >
            Diff
          </button>
          <a
            className="btn btn--ghost"
            href={gist.html_url}
            onClick={(e) => {
              e.preventDefault();
              import("@tauri-apps/api/shell").then(({ open }) =>
                open(gist.html_url)
              );
            }}
          >
            View on GitHub ↗
          </a>
          <button
            className="btn btn--danger"
            onClick={() => {
              if (confirm("Delete this gist?"))
                deleteGist(gist.id).catch((e) => notify("删除失败: " + String(e)));
            }}
          >
            Delete
          </button>
        </div>
      </div>

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

      {/* File tabs */}
      <div className="editor__tabs">
        {localFiles.map((f) => (
          <div
            key={f.filename}
            className={`editor__tab ${f.filename === activeFile ? "editor__tab--active" : ""}`}
            onClick={() => { if (renamingFile !== f.filename) setActiveFile(f.filename); }}
            onDoubleClick={() => startRename(f.filename)}
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
            {isDirty && f.filename === activeFile && (
              <span className="editor__tab-dot">●</span>
            )}
            {localFiles.length > 1 && (
              <button
                className="editor__tab-close"
                title={`删除 ${f.filename}`}
                onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.filename); }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="editor__tab editor__tab--add"
          onClick={handleAddFile}
          title="新增文件"
        >
          +
        </button>
      </div>

      {/* Markdown view mode tabs (only for .md files) */}
      {isMdActive && (
        <div className="editor__md-tabs" role="tablist" aria-label="Markdown 视图">
          {(
            [
              ["source", "源码"] as const,
              ["preview", "预览"] as const,
              ["split", "分栏"] as const,
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

      {vimMode && <div className="editor__vim-status" ref={vimStatusRef} />}

      <DiffModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        gistId={gist.id}
        githubLogin={githubLogin}
        gistUpdatedAt={gist.updated_at}
        primaryFilename={activeFile ?? localFiles[0]?.filename ?? ""}
        currentFiles={localFiles}
      />
    </div>
  );
}

// ── New Gist Modal ────────────────────────────────────────────────────────────

export function NewGistModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (
    desc: string,
    pub: boolean,
    files: [string, string][]
  ) => Promise<unknown>;
}) {
  const [desc, setDesc] = useState("");
  const [filename, setFilename] = useState("untitled.md");
  const [content, setContent] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filename.trim()) { setError("Filename is required"); return; }
    if (!content.trim()) { setError("Content cannot be empty"); return; }
    setError(null);
    setLoading(true);
    try {
      await onCreate(desc, isPublic, [[filename, content]]);
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
        <h2>New Gist</h2>
        <form onSubmit={handleCreate}>
          <label>
            Description
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={blockEnter}
              placeholder="Optional description"
              autoFocus
            />
          </label>
          <label>
            Filename
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onKeyDown={blockEnter}
            />
          </label>
          <label>
            Content
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
            />
          </label>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Public gist
          </label>
          {error && <p className="modal__error">{error}</p>}
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !filename.trim() || !content.trim()}
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
