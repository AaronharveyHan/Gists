import { useEffect, useState } from "react";
import { importPreview, importExecute } from "../api/tauri";
import type { ImportPreviewItem } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";

type Phase = "loading" | "preview" | "importing" | "done" | "error";

export function ImportModal({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) {
  const { sync } = useGistStore();
  const t = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ImportPreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState("");
  const [importedCount, setImportedCount] = useState(0);

  // Load preview on mount
  useEffect(() => {
    importPreview(filePath)
      .then((list) => {
        setItems(list);
        // Default: select all "new" items
        setSelected(new Set(list.filter((i) => i.status === "new").map((i) => i.id)));
        setPhase("preview");
      })
      .catch((e) => {
        setErrorMsg(String(e));
        setPhase("error");
      });
  }, [filePath]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setPhase("importing");
    try {
      const count = await importExecute(filePath, [...selected]);
      setImportedCount(count);
      setPhase("done");
      notify(t.importModal.imported(count), "success");
      // Refresh the list
      await sync(false);
    } catch (e) {
      setErrorMsg(String(e));
      setPhase("error");
    }
  };

  const newCount = items.filter((i) => i.status === "new").length;
  const existsCount = items.filter((i) => i.status === "exists").length;
  const selectedNew = items.filter((i) => selected.has(i.id) && i.status === "new").length;
  const selectedExists = items.filter((i) => selected.has(i.id) && i.status === "exists").length;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t.importModal.title}</h2>

        {phase === "loading" && (
          <p className="import-modal__status">{t.importModal.readingFile}</p>
        )}

        {phase === "error" && (
          <div className="import-modal__error">
            <p>{t.importModal.processError}</p>
            <pre>{errorMsg}</pre>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>{t.diff.close}</button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="import-modal__done">
            <p>{t.importModal.successMsg(importedCount)}</p>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={onClose}>{t.common.done}</button>
            </div>
          </div>
        )}

        {phase === "importing" && (
          <p className="import-modal__status">
            {t.importModal.creating(selected.size)}
          </p>
        )}

        {phase === "preview" && (
          <>
            <div className="import-modal__summary">
              <span>{t.importModal.inBackup(items.length)}</span>
              {newCount > 0 && (
                <span className="import-modal__badge import-modal__badge--new">
                  {t.importModal.newBadge(newCount)}
                </span>
              )}
              {existsCount > 0 && (
                <span className="import-modal__badge import-modal__badge--exists">
                  {t.importModal.existsBadge(existsCount)}
                </span>
              )}
            </div>

            <div className="import-modal__list-header">
              <label className="import-modal__select-all">
                <input
                  type="checkbox"
                  checked={selected.size === items.length && items.length > 0}
                  onChange={toggleAll}
                />
                {t.importModal.selectAll}
              </label>
              {selected.size > 0 && (
                <span className="import-modal__sel-info">
                  {t.importModal.selectedInfo(selected.size, selectedNew, selectedExists)}
                </span>
              )}
            </div>

            <div className="import-modal__list">
              {items.map((item) => (
                <label
                  key={item.id}
                  className={`import-modal__item ${selected.has(item.id) ? "import-modal__item--selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <div className="import-modal__item-body">
                    <span className="import-modal__item-file">
                      {item.primary_filename}
                      {item.file_count > 1 && (
                        <span className="import-modal__item-count">
                          +{item.file_count - 1}
                        </span>
                      )}
                    </span>
                    {item.description && (
                      <span className="import-modal__item-desc">{item.description}</span>
                    )}
                  </div>
                  <div className="import-modal__item-meta">
                    {item.tags.length > 0 && (
                      <span className="import-modal__item-tags">
                        {item.tags.join(", ")}
                      </span>
                    )}
                    {item.pinned && <span title={t.importModal.pinned}>{t.importModal.pinned}</span>}
                    <span
                      className={`import-modal__item-status import-modal__item-status--${item.status}`}
                    >
                      {item.status === "new" ? t.importModal.statusNew : t.importModal.statusExists}
                    </span>
                  </div>
                </label>
              ))}
            </div>

            <div className="import-modal__hint">
              <strong>{t.importModal.hintNewLabel}</strong>{t.importModal.hintNewDetail}{" "}
              <strong>{t.importModal.hintExistingLabel}</strong>{t.importModal.hintExistingDetail}
            </div>

            <div className="modal__actions">
              <button className="btn" onClick={onClose}>{t.importModal.cancel}</button>
              <button
                className="btn btn--primary"
                onClick={handleImport}
                disabled={selected.size === 0}
              >
                {t.importModal.importBtn(selected.size)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
