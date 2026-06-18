/**
 * New Gist panel.
 *
 * Rendered as a *floating, draggable* panel rather than a blocking modal:
 *   - The overlay is non-interactive (pointer-events: none) and has no dark
 *     backdrop, so the editor behind stays fully visible and usable.
 *   - The header acts as a drag handle so the panel can be moved out of the way.
 *
 * Two creation paths:
 *   - "Publish to GitHub" → onCreate (requires network, hidden in local mode)
 *   - "Save Draft"        → onCreateLocal (always available, offline-friendly)
 *
 * When a `template` is supplied the filename/content fields are hidden and the
 * template's own files are submitted verbatim.
 */
import { useState, useEffect, useRef } from "react";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import type { Template } from "../api/tauri";

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

  // Drag-to-move: offset applied to the centred panel via a CSS translate.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({ x: d.ox + ev.clientX - d.px, y: d.oy + ev.clientY - d.py });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

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
    <div className="modal-overlay modal-overlay--floating">
      <div
        className="modal modal--floating"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <h2 className="modal__drag-handle" onMouseDown={startDrag}>
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
