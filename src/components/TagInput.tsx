/**
 * TagInput — displays tag chips for the current gist and provides an
 * autocomplete dropdown for adding/creating tags.
 */
import { useState, useRef, useEffect } from "react";
import type { Tag } from "../api/tauri";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";

// Auto-assign a deterministic color based on the tag name.
const PALETTE = [
  "#f85149", "#f0a500", "#3fb950", "#58a6ff",
  "#bc8cff", "#ff7b72", "#79c0ff", "#ffa657",
];

function autoColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

interface TagInputProps {
  /** Tags currently applied to this gist. */
  tags: Tag[];
  /** All tags in the system (for autocomplete). */
  allTags: Tag[];
  onAdd: (tagId: number) => Promise<void>;
  onRemove: (tagId: number) => Promise<void>;
  /** Create a new tag AND add it to the gist. */
  onCreateAndAdd: (name: string, color: string) => Promise<void>;
}

export function TagInput({ tags, allTags, onAdd, onRemove, onCreateAndAdd }: TagInputProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const tagIds = new Set(tags.map((t) => t.id));
  const query = input.trim().toLowerCase();

  const available = allTags.filter(
    (t) => !tagIds.has(t.id) && (query === "" || t.name.toLowerCase().includes(query))
  );
  const canCreate =
    query.length > 0 && !allTags.some((t) => t.name.toLowerCase() === query);

  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((e) => notify(t.tags.tagOpFailed + " " + String(e)))
      .finally(() => setBusy(false));
  };

  const handleAdd = (tagId: number) => {
    run(async () => {
      await onAdd(tagId);
      setInput("");
      setOpen(false);
    });
  };

  const handleCreate = () => {
    if (!canCreate || busy) return;
    const name = input.trim();
    run(async () => {
      await onCreateAndAdd(name, autoColor(name));
      setInput("");
      setOpen(false);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (available.length > 0) handleAdd(available[0].id);
      else if (canCreate) handleCreate();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="tag-input">
      <div className="tag-input__chips">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="tag-chip"
            style={{ "--tag-color": tag.color } as React.CSSProperties}
          >
            {tag.name}
            <button
              className="tag-chip__remove"
              onClick={() => onRemove(tag.id)}
              title={t.tags.removeTag(tag.name)}
              disabled={busy}
            >
              ×
            </button>
          </span>
        ))}

        <div className="tag-input__add-wrap" ref={wrapRef}>
          <button
            className="tag-input__add-btn"
            onClick={() => setOpen((o) => !o)}
            title={t.tags.addTagTitle}
            disabled={busy}
          >
            {t.tags.addTag}
          </button>

          {open && (
            <div className="tag-dropdown">
              <input
                ref={inputRef}
                className="tag-dropdown__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.tags.searchOrCreate}
              />
              <div className="tag-dropdown__list">
                {available.map((tag) => (
                  <button
                    key={tag.id}
                    className="tag-dropdown__item"
                    onClick={() => handleAdd(tag.id)}
                  >
                    <span
                      className="tag-dropdown__dot"
                      style={{ background: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))}
                {canCreate && (
                  <button
                    className="tag-dropdown__item tag-dropdown__create"
                    onClick={handleCreate}
                  >
                    {t.tags.createTag(input.trim())}
                  </button>
                )}
                {available.length === 0 && !canCreate && (
                  <div className="tag-dropdown__empty">
                    {query ? t.tags.noMatchingTags : t.tags.noTagsYet}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
