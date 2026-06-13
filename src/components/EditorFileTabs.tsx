import { useState, useRef, useEffect } from "react";
import { useT } from "../store/useI18nStore";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";
import type { GistFile } from "../api/tauri";

interface EditorFileTabsProps {
  files: GistFile[];
  activeFile: string | null;
  isDirty: boolean;
  onActivate: (filename: string) => void;
  /** Returns the filename of the newly added file so the tab can enter rename mode. */
  onAdd: () => string;
  onDelete: (filename: string) => void;
  /** Called when user commits a rename. Return false to reject (keeps input open). */
  onCommitRename: (oldName: string, newName: string) => boolean;
  onReorder: (from: string, to: string) => void;
  onCloseOthers: (filename: string) => void;
  onCloseToRight: (filename: string) => void;
}

export function EditorFileTabs({
  files,
  activeFile,
  isDirty,
  onActivate,
  onAdd,
  onDelete,
  onCommitRename,
  onReorder,
  onCloseOthers,
  onCloseToRight,
}: EditorFileTabsProps) {
  const t = useT();
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [dragSrc, setDragSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [tabCtx, setTabCtx] = useState<{ filename: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  const startRename = (filename: string) => {
    setRenamingFile(filename);
    setRenameValue(filename);
  };

  const commitRename = () => {
    if (!renamingFile) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renamingFile) {
      setRenamingFile(null);
      return;
    }
    const accepted = onCommitRename(renamingFile, trimmed);
    if (accepted) setRenamingFile(null);
  };

  return (
    <>
      <div className="editor__tabs">
        {files.map((f) => {
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
              onClick={() => { if (renamingFile !== f.filename) onActivate(f.filename); }}
              onDoubleClick={() => startRename(f.filename)}
              onMouseDown={(e) => {
                if (e.button === 1 && files.length > 1) {
                  e.preventDefault();
                  onDelete(f.filename);
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
                if (dragSrc) onReorder(dragSrc, f.filename);
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
              {files.length > 1 && (
                <button
                  className="editor__tab-close"
                  title={`Close ${f.filename}`}
                  onClick={(e) => { e.stopPropagation(); onDelete(f.filename); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="editor__tab editor__tab--add"
          onClick={() => { const name = onAdd(); startRename(name); }}
          title={t.editor.newFile}
        >
          +
        </button>
      </div>

      {tabCtx && (() => {
        const { filename, x, y } = tabCtx;
        const idx = files.findIndex((f) => f.filename === filename);
        const items: ContextMenuEntry[] = [
          { label: t.editor.renameTab, shortcut: t.editor.renameShortcut, onClick: () => startRename(filename) },
          { separator: true },
          {
            label: t.editor.closeTab,
            onClick: () => onDelete(filename),
            disabled: files.length <= 1,
          },
          {
            label: t.editor.closeOthers,
            onClick: () => onCloseOthers(filename),
            disabled: files.length <= 1,
          },
          {
            label: t.editor.closeToRight,
            onClick: () => onCloseToRight(filename),
            disabled: idx >= files.length - 1,
          },
        ];
        return (
          <ContextMenu x={x} y={y} items={items} onClose={() => setTabCtx(null)} />
        );
      })()}
    </>
  );
}
