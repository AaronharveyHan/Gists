import { useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";
import type { Gist, Tag } from "../api/tauri";
import { useT } from "../store/useI18nStore";

interface Props {
  selectedIds: Set<string>;
  allTags: Tag[];
  /** All gists currently visible in the sidebar (after search/filter/sort). */
  sortedGists: Gist[];
  onClear: () => void;
  onSelectAll: () => void;
}

// ── Progress tracker ──────────────────────────────────────────────────────────

interface Progress { done: number; total: number; label: string }

export function BulkActionBar({
  selectedIds, allTags, sortedGists, onClear, onSelectAll,
}: Props) {
  const { deleteGist, setGistTags, loadGistTags, gistTags, gists } = useGistStore();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const count = selectedIds.size;
  const totalVisible = sortedGists.length;
  const allSelected = count === totalVisible && totalVisible > 0;

  // Auto-load tags for selected gists that haven't been opened in the editor yet.
  useEffect(() => {
    const missing = [...selectedIds].filter((id) => !(id in gistTags));
    for (const id of missing) loadGistTags(id);
  }, [selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close tag picker on outside click.
  useEffect(() => {
    if (!tagPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!tagPickerRef.current?.contains(e.target as Node)) setTagPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tagPickerOpen]);

  // ── Derived tag sets ──────────────────────────────────────────────────────

  const selectedGists = gists.filter((g) => selectedIds.has(g.id));

  // Tags that appear on ALL selected gists.
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

  // Tags not yet on every selected gist (can be added).
  const addableTags = allTags.filter((t) =>
    [...selectedIds].some((gistId) => !(gistTags[gistId] ?? []).some((tag) => tag.id === t.id))
  );

  const publicCount = selectedGists.filter((g) => g.public).length;
  const secretCount = count - publicCount;

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!confirm(t.bulk.confirmDelete(count))) return;
    setBusy(true);
    setProgress({ done: 0, total: count, label: t.bulk.deleting });
    let done = 0;
    try {
      for (const id of selectedIds) {
        await deleteGist(id);
        done++;
        setProgress({ done, total: count, label: t.bulk.deleting });
      }
      notify(t.bulk.deleted(count), "success");
      onClear();
    } catch (e) {
      notify(t.bulk.deleteFailed(String(e)));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleAddTag = async (tagId: number) => {
    setTagPickerOpen(false);
    const targets = [...selectedIds].filter(
      (gistId) => !(gistTags[gistId] ?? []).some((t) => t.id === tagId)
    );
    if (targets.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: targets.length, label: t.bulk.tagging });
    let done = 0;
    try {
      for (const gistId of targets) {
        const current = (gistTags[gistId] ?? []).map((tg) => tg.id);
        await setGistTags(gistId, [...current, tagId]);
        done++;
        setProgress({ done, total: targets.length, label: t.bulk.tagging });
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    setBusy(true);
    setProgress({ done: 0, total: count, label: t.bulk.removingTag });
    let done = 0;
    try {
      for (const gistId of selectedIds) {
        const current = (gistTags[gistId] ?? []).map((tg) => tg.id).filter((id) => id !== tagId);
        await setGistTags(gistId, current);
        done++;
        setProgress({ done, total: count, label: t.bulk.removingTag });
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleExport = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({
      title: t.bulk.exportDialogTitle,
      defaultPath: `gists-selection-${count}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(dest, JSON.stringify(selectedGists, null, 2));
      notify(t.bulk.exported(count), "success");
    } catch (e) {
      notify(t.bulk.exportFailed(String(e)));
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bulk-bar">
      {/* Top row: count + select-all + progress */}
      <div className="bulk-bar__top">
        <span className="bulk-bar__info">
          <strong>{count}</strong>
          {" / "}
          <span className="bulk-bar__total">{totalVisible}</span>
          {" "}{t.bulk.selected}
          {count > 0 && publicCount > 0 && secretCount > 0 && (
            <span className="bulk-bar__meta">
              {" · "}{publicCount} {t.bulk.public} · {secretCount} {t.bulk.secret}
            </span>
          )}
        </span>

        <div className="bulk-bar__selectors">
          {!allSelected && totalVisible > 0 && (
            <button className="bulk-bar__link" onClick={onSelectAll} disabled={busy}>
              {t.bulk.selectAll(totalVisible)}
            </button>
          )}
          {count > 0 && (
            <button className="bulk-bar__link" onClick={onClear} disabled={busy}>
              {t.common.clear}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="bulk-bar__progress-wrap">
          <div
            className="bulk-bar__progress-fill"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
          <span className="bulk-bar__progress-label">
            {progress.label} {progress.done}/{progress.total}…
          </span>
        </div>
      )}

      {/* Action buttons — only shown when ≥1 gist selected */}
      {count > 0 && (
        <div className="bulk-bar__actions">
          {/* Tag add picker */}
          {addableTags.length > 0 && (
            <div className="bulk-bar__tag-wrap" ref={tagPickerRef}>
              <button
                className="bulk-bar__btn"
                onClick={() => setTagPickerOpen((o) => !o)}
                disabled={busy}
                title={t.bulk.addTagTitle}
              >
                {t.bulk.addTag}
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
                title={t.bulk.removeTagTitle(tag.name)}
              >
                <span className="bulk-bar__tag-dot" style={{ background: tag.color }} />
                {tag.name} ×
              </button>
            );
          })}

          <button
            className="bulk-bar__btn"
            onClick={handleExport}
            disabled={busy}
            title={t.bulk.exportBtnTitle(count)}
          >
            {t.bulk.exportBtn}
          </button>

          <button
            className="bulk-bar__btn bulk-bar__btn--danger"
            onClick={handleDelete}
            disabled={busy}
          >
            {t.bulk.deleteBtn(count)}
          </button>
        </div>
      )}
    </div>
  );
}
