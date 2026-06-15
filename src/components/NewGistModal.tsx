/**
 * New Gist modal.
 *
 * Two creation paths:
 *   - "Publish to GitHub" → onCreate (requires network, hidden in local mode)
 *   - "Save Draft"        → onCreateLocal (always available, offline-friendly)
 *
 * When a `template` is supplied the filename/content fields are hidden and the
 * template's own files are submitted verbatim.
 */
import { useState, useEffect } from "react";
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
