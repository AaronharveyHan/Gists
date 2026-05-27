import { useState } from "react";
import { useGistStore } from "../store/useGistStore";
import type { Tag } from "../api/tauri";

interface Props {
  selectedIds: Set<string>;
  allTags: Tag[];
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, allTags, onClear }: Props) {
  const { deleteGist, setGistTags, gistTags, gists } = useGistStore();
  const [busy, setBusy] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const count = selectedIds.size;

  const handleDelete = async () => {
    if (!confirm(`Delete ${count} gist${count > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      // Delete sequentially to avoid hammering the GitHub API
      for (const id of selectedIds) {
        await deleteGist(id);
      }
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const handleAddTag = async (tagId: number) => {
    setTagPickerOpen(false);
    setBusy(true);
    try {
      for (const gistId of selectedIds) {
        const current = (gistTags[gistId] ?? []).map((t) => t.id);
        if (!current.includes(tagId)) {
          await setGistTags(gistId, [...current, tagId]);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // Tags that appear on ALL selected gists (for bulk-remove candidates)
  const commonTagIds: number[] = (() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return [];
    const first = new Set((gistTags[ids[0]] ?? []).map((t) => t.id));
    for (let i = 1; i < ids.length; i++) {
      const cur = new Set((gistTags[ids[i]] ?? []).map((t) => t.id));
      for (const id of first) { if (!cur.has(id)) first.delete(id); }
    }
    return [...first];
  })();

  const handleRemoveTag = async (tagId: number) => {
    setBusy(true);
    try {
      for (const gistId of selectedIds) {
        const current = (gistTags[gistId] ?? []).map((t) => t.id).filter((id) => id !== tagId);
        await setGistTags(gistId, current);
      }
    } finally {
      setBusy(false);
    }
  };

  // Tags not yet on all selected gists (available to add)
  const addableTags = allTags.filter((t) => {
    const ids = [...selectedIds];
    return ids.some((gistId) => !(gistTags[gistId] ?? []).some((tag) => tag.id === t.id));
  });

  const selectedGists = gists.filter((g) => selectedIds.has(g.id));
  const publicCount = selectedGists.filter((g) => g.public).length;
  const secretCount = count - publicCount;

  return (
    <div className="bulk-bar">
      <div className="bulk-bar__info">
        <strong>{count}</strong> selected
        {publicCount > 0 && secretCount > 0 && (
          <span className="bulk-bar__meta">
            {publicCount} public · {secretCount} secret
          </span>
        )}
      </div>

      <div className="bulk-bar__actions">
        {/* Tag add picker */}
        {addableTags.length > 0 && (
          <div className="bulk-bar__tag-wrap">
            <button
              className="bulk-bar__btn"
              onClick={() => setTagPickerOpen((o) => !o)}
              disabled={busy}
              title="Add tag to selected gists"
            >
              + Tag
            </button>
            {tagPickerOpen && (
              <div className="bulk-bar__tag-dropdown">
                {addableTags.map((tag) => (
                  <button
                    key={tag.id}
                    className="bulk-bar__tag-item"
                    onClick={() => handleAddTag(tag.id)}
                  >
                    <span className="bulk-bar__tag-dot" style={{ background: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Remove common tags */}
        {commonTagIds.map((tagId) => {
          const tag = allTags.find((t) => t.id === tagId);
          if (!tag) return null;
          return (
            <button
              key={tagId}
              className="bulk-bar__btn bulk-bar__btn--tag"
              style={{ "--tag-color": tag.color } as React.CSSProperties}
              onClick={() => handleRemoveTag(tagId)}
              disabled={busy}
              title={`Remove tag "${tag.name}" from all selected`}
            >
              <span className="bulk-bar__tag-dot" style={{ background: tag.color }} />
              {tag.name} ×
            </button>
          );
        })}

        <button
          className="bulk-bar__btn bulk-bar__btn--danger"
          onClick={handleDelete}
          disabled={busy}
        >
          {busy ? "Deleting…" : `Delete ${count}`}
        </button>

        <button
          className="bulk-bar__btn bulk-bar__btn--cancel"
          onClick={onClear}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
