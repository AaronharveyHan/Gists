import { useState, useEffect, useRef } from "react";
import { useT } from "../store/useI18nStore";
import type { CollectionCount } from "../api/tauri";

export const COLLECTION_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6",
  "#f97316","#84cc16",
];

export function SidebarCollectionsPanel({
  collections,
  activeCollectionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: {
  collections: CollectionCount[];
  activeCollectionId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, color: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string, color: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_PALETTE[0]);
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) setTimeout(() => inputRef.current?.focus(), 30); }, [creating]);
  useEffect(() => { if (editingId) setTimeout(() => editInputRef.current?.select(), 30); }, [editingId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreate(newName.trim(), newColor);
      setNewName(""); setNewColor(COLLECTION_PALETTE[0]); setCreating(false);
    } finally { setSaving(false); }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    await onRename(id, editName.trim(), editColor);
    setEditingId(null);
  };

  return (
    <div className="sidebar__collections">
      <div className="sidebar__filter-heading">
        {t.sidebar.collections}
        <button
          className="sidebar__collections-add-btn"
          onClick={() => { setCreating((v) => !v); setEditingId(null); }}
          title={t.sidebar.newCollection}
        >＋</button>
      </div>

      {creating && (
        <div className="sidebar__col-form">
          <input
            ref={inputRef}
            className="sidebar__col-form-input"
            placeholder={t.sidebar.collectionNamePlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <div className="sidebar__col-form-swatches">
            {COLLECTION_PALETTE.map((c) => (
              <button
                key={c}
                className={`sidebar__col-swatch${newColor === c ? " sidebar__col-swatch--active" : ""}`}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
          <div className="sidebar__col-form-actions">
            <button className="btn btn--primary" style={{ fontSize: 11 }} onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? "…" : t.common.create}
            </button>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setCreating(false)}>{t.common.cancel}</button>
          </div>
        </div>
      )}

      <div className="sidebar__col-list">
        <button
          className={`sidebar__col-item${activeCollectionId === null ? " sidebar__col-item--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          <span className="sidebar__col-dot" style={{ background: "var(--text-2)" }} />
          <span className="sidebar__col-name">{t.sidebar.allGists}</span>
        </button>

        {collections.map((c) => (
          <div key={c.id} className="sidebar__col-row" onMouseEnter={() => setHovered(c.id)} onMouseLeave={() => setHovered(null)}>
            {editingId === c.id ? (
              <div className="sidebar__col-form sidebar__col-form--inline">
                <input
                  ref={editInputRef}
                  className="sidebar__col-form-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="sidebar__col-form-swatches">
                  {COLLECTION_PALETTE.map((col) => (
                    <button
                      key={col}
                      className={`sidebar__col-swatch${editColor === col ? " sidebar__col-swatch--active" : ""}`}
                      style={{ background: col }}
                      onClick={() => setEditColor(col)}
                    />
                  ))}
                </div>
                <div className="sidebar__col-form-actions">
                  <button className="btn btn--primary" style={{ fontSize: 11 }} onClick={() => handleRename(c.id)}>{t.common.save}</button>
                  <button className="btn" style={{ fontSize: 11 }} onClick={() => setEditingId(null)}>{t.common.cancel}</button>
                </div>
              </div>
            ) : (
              <button
                className={`sidebar__col-item${activeCollectionId === c.id ? " sidebar__col-item--active" : ""}`}
                onClick={() => onSelect(activeCollectionId === c.id ? null : c.id)}
              >
                <span className="sidebar__col-dot" style={{ background: c.color }} />
                <span className="sidebar__col-name">{c.name}</span>
                <span className="sidebar__col-count">{c.count}</span>
                {hovered === c.id && (
                  <span className="sidebar__col-actions">
                    <button
                      className="sidebar__col-action-btn"
                      title={t.common.rename}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(c.id); setEditName(c.name); setEditColor(c.color);
                      }}
                    >✎</button>
                    <button
                      className="sidebar__col-action-btn sidebar__col-action-btn--danger"
                      title={t.common.delete}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(t.sidebar.deleteCollectionConfirm(c.name))) await onDelete(c.id);
                      }}
                    >✕</button>
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
