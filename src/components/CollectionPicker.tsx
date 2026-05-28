/**
 * CollectionPicker — shows a gist's current collection memberships and lets
 * the user toggle them. Rendered as an inline row in the Editor body.
 */
import { useState, useEffect, useRef } from "react";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import type { Collection } from "../api/tauri";

const COLOR_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6",
  "#f97316","#84cc16",
];

interface Props {
  gistId: string;
}

export function CollectionPicker({ gistId }: Props) {
  const t = useT();
  const {
    allCollections,
    gistCollections,
    loadGistCollections,
    addGistToCollection,
    removeGistFromCollection,
    createCollection,
  } = useGistStore();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load on mount
  useEffect(() => {
    loadGistCollections(gistId);
  }, [gistId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 30);
  }, [creating]);

  const membership = gistCollections[gistId] ?? [];
  const memberIds = new Set(membership.map((c) => c.id));

  const handleToggle = async (collectionId: string) => {
    if (memberIds.has(collectionId)) {
      await removeGistFromCollection(collectionId, gistId);
    } else {
      await addGistToCollection(collectionId, gistId);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const col = await createCollection(newName.trim(), "", newColor, "folder");
      await addGistToCollection(col.id, gistId);
      setNewName(""); setNewColor(COLOR_PALETTE[0]);
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="col-picker">
      {/* Current memberships as chips */}
      <div className="col-picker__chips">
        {membership.map((c: Collection) => (
          <span key={c.id} className="col-picker__chip" style={{ borderColor: c.color }}>
            <span className="col-picker__chip-dot" style={{ background: c.color }} />
            {c.name}
            <button
              className="col-picker__chip-remove"
              onClick={() => removeGistFromCollection(c.id, gistId)}
              title={t.collection.removeFrom(c.name)}
            >×</button>
          </span>
        ))}
        <div className="col-picker__add-wrap" ref={dropRef}>
          <button
            className="col-picker__add-btn"
            onClick={() => { setOpen((v) => !v); setCreating(false); }}
            title={t.collection.addToCollection}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z"/>
            </svg>
            {membership.length === 0 ? t.collection.addToCollection : "+"}
          </button>

          {open && (
            <div className="col-picker__dropdown">
              {allCollections.length === 0 && !creating ? (
                <div className="col-picker__dropdown-empty">{t.collection.noCollections}</div>
              ) : (
                <ul className="col-picker__list">
                  {allCollections.map((c) => (
                    <li key={c.id}>
                      <button
                        className={`col-picker__list-item ${memberIds.has(c.id) ? "col-picker__list-item--checked" : ""}`}
                        onClick={() => handleToggle(c.id)}
                      >
                        <span className="col-picker__list-dot" style={{ background: c.color }} />
                        <span className="col-picker__list-name">{c.name}</span>
                        {memberIds.has(c.id) && <span className="col-picker__list-check">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {creating ? (
                <div className="col-picker__create-form">
                  <input
                    ref={inputRef}
                    className="col-picker__create-input"
                    placeholder={t.collection.collectionNamePlaceholder}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") setCreating(false);
                    }}
                  />
                  <div className="col-picker__swatches">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        className={`col-picker__swatch${newColor === c ? " col-picker__swatch--active" : ""}`}
                        style={{ background: c }}
                        onClick={() => setNewColor(c)}
                      />
                    ))}
                  </div>
                  <div className="col-picker__create-actions">
                    <button
                      className="btn btn--primary"
                      onClick={handleCreate}
                      disabled={!newName.trim() || saving}
                      style={{ fontSize: 11, padding: "3px 10px" }}
                    >
                      {saving ? "…" : t.collection.create}
                    </button>
                    <button
                      className="btn"
                      onClick={() => setCreating(false)}
                      style={{ fontSize: 11, padding: "3px 8px" }}
                    >
                      {t.collection.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="col-picker__new-link"
                  onClick={() => setCreating(true)}
                >
                  {t.collection.newCollection}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
