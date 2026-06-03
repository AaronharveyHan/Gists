import { useEffect, useMemo, useState } from "react";
import * as api from "../api/tauri";
import type { VscodeSnippet } from "../api/tauri";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";

export function VscodeSnippetsImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useT();
  const [path, setPath] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<VscodeSnippet[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const loadFrom = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.vscodeSnippetsPreview(p);
      setSnippets(list);
      setSelected(new Set(list.map((_, i) => i)));
      setPath(p);
      if (list.length === 0) {
        setError(t.vscodeImport.noSnippets(p));
      }
    } catch (e) {
      setError(String(e));
      setSnippets([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  // Try the default VS Code path on first mount.
  useEffect(() => {
    (async () => {
      try {
        const def = await api.vscodeSnippetsDefaultPath();
        if (def) {
          await loadFrom(def);
        } else {
          setLoading(false);
          setError(t.vscodeImport.autoDetectFailed);
        }
      } catch (e) {
        setLoading(false);
        setError(String(e));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      title: t.vscodeImport.pickFolderTitle,
      directory: true,
      multiple: false,
    });
    if (typeof picked === "string") await loadFrom(picked);
  };

  const pickFile = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      title: t.vscodeImport.pickFileTitle,
      multiple: false,
      filters: [
        { name: "VS Code snippets", extensions: ["json", "code-snippets"] },
      ],
    });
    if (typeof picked === "string") await loadFrom(picked);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snippets.map((s, i) => ({ s, i }));
    return snippets
      .map((s, i) => ({ s, i }))
      .filter(({ s }) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.prefix.toLowerCase().includes(q) ||
        s.language.toLowerCase().includes(q)
      );
  }, [snippets, search]);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (filtered.every(({ i }) => selected.has(i))) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach(({ i }) => next.delete(i));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach(({ i }) => next.add(i));
        return next;
      });
    }
  };

  const handleImport = async () => {
    const items = Array.from(selected).map((i) => snippets[i]).filter(Boolean);
    if (items.length === 0) return;
    setImporting(true);
    try {
      const n = await api.vscodeSnippetsImport(items);
      notify(t.vscodeImport.imported(n), "success");
      onImported();
      onClose();
    } catch (e) {
      notify(t.vscodeImport.importFailed(String(e)));
    } finally {
      setImporting(false);
    }
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(({ i }) => selected.has(i));

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="vsc-import"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vsc-import__head">
          <h2>{t.vscodeImport.title}</h2>
          <button className="btn vsc-import__close" onClick={onClose}>×</button>
        </div>

        <div className="vsc-import__source">
          <span className="vsc-import__source-label">{t.vscodeImport.sourceLabel}</span>
          <code className="vsc-import__source-path">{path ?? "—"}</code>
          <button className="btn" onClick={pickFolder}>{t.vscodeImport.pickFolder}</button>
          <button className="btn" onClick={pickFile}>{t.vscodeImport.pickFile}</button>
        </div>

        {loading && <p className="vsc-import__status">{t.vscodeImport.loadingSnippets}</p>}
        {error && !loading && <p className="vsc-import__error">{error}</p>}

        {!loading && snippets.length > 0 && (
          <>
            <div className="vsc-import__toolbar">
              <input
                className="vsc-import__search"
                placeholder={t.vscodeImport.filterPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="vsc-import__check-all">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                />
                {allFilteredSelected ? t.vscodeImport.deselectAll : t.vscodeImport.selectAll}
              </label>
              <span className="vsc-import__count">
                {t.vscodeImport.selectedCount(selected.size, snippets.length)}
              </span>
            </div>

            <div className="vsc-import__list">
              {filtered.map(({ s, i }) => (
                <label key={i} className="vsc-import__row">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <div className="vsc-import__row-body">
                    <div className="vsc-import__row-head">
                      <span className="vsc-import__name">{s.name}</span>
                      {s.language && (
                        <span className="vsc-import__lang">{s.language}</span>
                      )}
                      {s.prefix && (
                        <span className="vsc-import__prefix">⌨ {s.prefix}</span>
                      )}
                      <span className="vsc-import__lines">
                        {t.vscodeImport.linesCount(s.body.split("\n").length)}
                      </span>
                    </div>
                    {s.description && (
                      <div className="vsc-import__desc">{s.description}</div>
                    )}
                    <pre className="vsc-import__preview">
                      {s.body.split("\n").slice(0, 5).join("\n")}
                      {s.body.split("\n").length > 5 && "\n…"}
                    </pre>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="vsc-import__actions">
          <span className="vsc-import__hint">
            {t.vscodeImport.tabstopHint}
          </span>
          <button className="btn" onClick={onClose}>{t.vscodeImport.cancel}</button>
          <button
            className="btn btn--primary"
            onClick={handleImport}
            disabled={importing || selected.size === 0}
          >
            {importing ? t.vscodeImport.importing : t.vscodeImport.importBtn(selected.size)}
          </button>
        </div>
      </div>
    </div>
  );
}
