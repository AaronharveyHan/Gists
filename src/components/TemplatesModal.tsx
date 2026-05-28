import { useEffect, useRef, useState } from "react";
import { useTemplateStore } from "../store/useTemplateStore";
import { notify } from "../store/useNotificationStore";
import type { Template } from "../api/tauri";

// ── Save-as-template modal ────────────────────────────────────────────────────

export function SaveAsTemplateModal({
  gistId,
  defaultName,
  onClose,
}: {
  gistId: string;
  defaultName: string;
  onClose: () => void;
}) {
  const { saveGistAsTemplate } = useTemplateStore();
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveGistAsTemplate(gistId, name.trim());
      notify("Saved as template", "success");
      onClose();
    } catch (e) {
      notify("Failed to save template: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Save as Template</h2>
        <label>
          Template name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") onClose();
            }}
            placeholder="e.g. React Component"
            autoFocus
          />
        </label>
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template edit form ────────────────────────────────────────────────────────

interface EditState {
  name: string;
  description: string;
  isPublic: boolean;
  files: { filename: string; content: string }[];
}

function TemplateEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Template | null;
  onSave: (state: EditState) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false);
  const [files, setFiles] = useState<{ filename: string; content: string }[]>(
    initial?.files.length
      ? initial.files.map((f) => ({ filename: f.filename, content: f.content }))
      : [{ filename: "untitled.md", content: "" }]
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Refocus textarea when switching tabs
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeIdx]);

  const addFile = () => {
    const newFile = { filename: `file${files.length + 1}.txt`, content: "" };
    setFiles([...files, newFile]);
    setActiveIdx(files.length);
  };

  const removeFile = (idx: number) => {
    if (files.length <= 1) return;
    const updated = files.filter((_, i) => i !== idx);
    setFiles(updated);
    setActiveIdx(Math.min(activeIdx, updated.length - 1));
  };

  const updateFile = (
    idx: number,
    field: "filename" | "content",
    value: string
  ) => {
    setFiles(files.map((f, i) => (i === idx ? { ...f, [field]: value } : f)));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("Template name is required"); return; }
    if (files.some((f) => !f.filename.trim())) {
      setError("All files must have a filename");
      return;
    }
    if (files.some((f) => !f.content.trim())) {
      setError("All files must have content");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description, isPublic, files });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const activeFile = files[activeIdx] ?? files[0];

  return (
    <div className="template-form">
      <div className="template-form__meta">
        <label className="template-form__label">
          Template name
          <input
            className="template-form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. React Component"
            autoFocus
          />
        </label>
        <label className="template-form__label">
          Default description
          <input
            className="template-form__input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="template-form__checkbox">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          Public gist
        </label>
      </div>

      <div className="template-form__files">
        <div className="template-form__file-tabs">
          {files.map((f, i) => (
            <div
              key={i}
              className={`template-form__file-tab ${i === activeIdx ? "template-form__file-tab--active" : ""}`}
            >
              <button
                className="template-form__file-tab-name"
                onClick={() => setActiveIdx(i)}
              >
                {f.filename || "untitled"}
              </button>
              {files.length > 1 && (
                <button
                  className="template-form__file-tab-close"
                  onClick={() => removeFile(i)}
                  title="Remove file"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="template-form__file-tab template-form__file-tab--add"
            onClick={addFile}
            title="Add file"
          >
            +
          </button>
        </div>

        {activeFile && (
          <div className="template-form__file-body">
            <input
              className="template-form__filename"
              value={activeFile.filename}
              onChange={(e) => updateFile(activeIdx, "filename", e.target.value)}
              placeholder="filename.ext"
            />
            <textarea
              ref={textareaRef}
              className="template-form__content"
              value={activeFile.content}
              onChange={(e) => updateFile(activeIdx, "content", e.target.value)}
              placeholder="File content…"
              rows={12}
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {error && <p className="template-form__error">{error}</p>}

      <div className="template-form__actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : initial ? "Update Template" : "Create Template"}
        </button>
      </div>
    </div>
  );
}

// ── Templates modal ───────────────────────────────────────────────────────────

export function TemplatesModal({
  onClose,
  onUseTemplate,
}: {
  onClose: () => void;
  onUseTemplate: (template: Template) => void;
}) {
  const {
    templates, loadTemplates, createTemplate, updateTemplate, deleteTemplate,
  } = useTemplateStore();
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const editingTemplate =
    editingId !== null && editingId !== "new"
      ? (templates.find((t) => t.id === editingId) ?? null)
      : null;

  const handleSave = async (state: EditState) => {
    const files: [string, string][] = state.files.map((f) => [f.filename, f.content]);
    if (editingId === "new") {
      await createTemplate(state.name, state.description, state.isPublic, files);
      notify("Template created", "success");
    } else {
      await updateTemplate(
        editingId as number,
        state.name,
        state.description,
        state.isPublic,
        files
      );
      notify("Template updated", "success");
    }
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    await deleteTemplate(id);
    notify("Template deleted", "success");
    setConfirmDeleteId(null);
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="templates-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="templates-modal__head">
          <h2>Templates</h2>
          {editingId !== null && (
            <span className="templates-modal__breadcrumb">
              {editingId === "new" ? "New template" : "Edit template"}
            </span>
          )}
          <button className="templates-modal__close btn" onClick={onClose}>×</button>
        </div>

        {editingId !== null ? (
          <TemplateEditForm
            initial={editingTemplate}
            onSave={handleSave}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <>
            <div className="templates-modal__bar">
              <button
                className="btn btn--primary"
                onClick={() => setEditingId("new")}
              >
                + New Template
              </button>
              <span className="templates-modal__hint">
                Templates scaffold new gists with pre-filled content
              </span>
            </div>

            {templates.length === 0 ? (
              <p className="templates-modal__empty">
                No templates yet — create one to quickly scaffold new gists.
              </p>
            ) : (
              <div className="templates-modal__list">
                {templates.map((t) => (
                  <div key={t.id} className="template-card">
                    <div className="template-card__body">
                      <div className="template-card__name">{t.name}</div>
                      {t.description && (
                        <div className="template-card__desc">{t.description}</div>
                      )}
                      <div className="template-card__meta">
                        <span>{t.files.length} file{t.files.length !== 1 ? "s" : ""}</span>
                        <span className={`template-card__vis ${t.is_public ? "template-card__vis--public" : ""}`}>
                          {t.is_public ? "● Public" : "○ Secret"}
                        </span>
                        <span className="template-card__filelist">
                          {t.files.slice(0, 3).map((f) => f.filename).join(", ")}
                          {t.files.length > 3 && ` +${t.files.length - 3} more`}
                        </span>
                      </div>
                    </div>
                    <div className="template-card__actions">
                      <button
                        className="btn btn--primary"
                        onClick={() => { onUseTemplate(t); onClose(); }}
                        title="Create a new gist from this template"
                      >
                        Use
                      </button>
                      <button
                        className="btn"
                        onClick={() => setEditingId(t.id)}
                        title="Edit template"
                      >
                        Edit
                      </button>
                      {confirmDeleteId === t.id ? (
                        <>
                          <button
                            className="btn btn--danger"
                            onClick={() => handleDelete(t.id)}
                          >
                            Confirm
                          </button>
                          <button
                            className="btn"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn--danger"
                          onClick={() => setConfirmDeleteId(t.id)}
                          title="Delete template"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
