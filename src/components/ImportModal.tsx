import { useEffect, useState } from "react";
import { importPreview, importExecute } from "../api/tauri";
import type { ImportPreviewItem } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";

type Phase = "loading" | "preview" | "importing" | "done" | "error";

export function ImportModal({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) {
  const { sync } = useGistStore();
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
      notify(`Imported ${count} gist${count !== 1 ? "s" : ""}`, "success");
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
        <h2>Import Gists</h2>

        {phase === "loading" && (
          <p className="import-modal__status">Reading backup file...</p>
        )}

        {phase === "error" && (
          <div className="import-modal__error">
            <p>Failed to process backup file:</p>
            <pre>{errorMsg}</pre>
            <div className="modal__actions">
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="import-modal__done">
            <p>Successfully imported {importedCount} gist{importedCount !== 1 ? "s" : ""}.</p>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {phase === "importing" && (
          <p className="import-modal__status">
            Creating gists on GitHub... ({selected.size} items)
          </p>
        )}

        {phase === "preview" && (
          <>
            <div className="import-modal__summary">
              <span>{items.length} gists in backup</span>
              {newCount > 0 && (
                <span className="import-modal__badge import-modal__badge--new">
                  {newCount} new
                </span>
              )}
              {existsCount > 0 && (
                <span className="import-modal__badge import-modal__badge--exists">
                  {existsCount} already exist
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
                Select all
              </label>
              {selected.size > 0 && (
                <span className="import-modal__sel-info">
                  {selected.size} selected
                  {selectedNew > 0 && ` (${selectedNew} new`}
                  {selectedExists > 0 && `, ${selectedExists} metadata-only`}
                  {(selectedNew > 0 || selectedExists > 0) && ")"}
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
                    {item.pinned && <span title="Pinned">pinned</span>}
                    <span
                      className={`import-modal__item-status import-modal__item-status--${item.status}`}
                    >
                      {item.status === "new" ? "New" : "Exists"}
                    </span>
                  </div>
                </label>
              ))}
            </div>

            <div className="import-modal__hint">
              <strong>New</strong> gists will be created on GitHub.{" "}
              <strong>Existing</strong> gists will only have tags, pins, and categories restored.
            </div>

            <div className="modal__actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={handleImport}
                disabled={selected.size === 0}
              >
                Import {selected.size} gist{selected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
