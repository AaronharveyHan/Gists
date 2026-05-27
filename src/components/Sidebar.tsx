import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore, type SortOrder } from "../store/useThemeStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { NewGistModal } from "./Editor";
import { BulkActionBar } from "./BulkActionBar";
import type { Gist, Tag } from "../api/tauri";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Date created" },
  { value: "name", label: "Name" },
  { value: "files", label: "File count" },
];

const CATEGORY_CHIPS: { id: string; label: string }[] = [
  { id: "config", label: "Config" },
  { id: "script", label: "Script" },
  { id: "document", label: "Docs" },
  { id: "media", label: "Media" },
  { id: "data", label: "Data" },
  { id: "multi", label: "Multi-file" },
  { id: "snippet", label: "Snippet" },
  { id: "library", label: "Library" },
  { id: "test", label: "Test" },
  { id: "gist", label: "General" },
];

function categoryCount(
  counts: { category: string; count: number }[],
  id: string
): number {
  const row = counts.find((c) => c.category === id);
  return row?.count ?? 0;
}

function CategoryFilterPanel({
  categoryCounts,
  activeCategoryId,
  onSelect,
}: {
  categoryCounts: { category: string; count: number }[];
  activeCategoryId: string | null;
  onSelect: (category: string | null) => void;
}) {
  return (
    <div className="sidebar__category-filter">
      <div className="sidebar__filter-heading">By category</div>
      <div className="sidebar__tag-filter">
        <button
          type="button"
          className={`sidebar__tag-chip ${activeCategoryId === null ? "sidebar__tag-chip--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          All
        </button>
        {CATEGORY_CHIPS.map(({ id, label }) => {
          const n = categoryCount(categoryCounts, id);
          return (
            <button
              key={id}
              type="button"
              className={`sidebar__tag-chip ${activeCategoryId === id ? "sidebar__tag-chip--active" : ""}`}
              onClick={() =>
                onSelect(activeCategoryId === id ? null : id)
              }
            >
              {label}
              <span className="sidebar__category-count">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function languageColor(lang: string | null): string {
  const map: Record<string, string> = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Rust: "#dea584",
    Go: "#00ADD8",
    Ruby: "#701516",
    CSS: "#563d7c",
    HTML: "#e34c26",
    Shell: "#89e051",
    Markdown: "#083fa1",
  };
  return lang ? (map[lang] ?? "#8b949e") : "#8b949e";
}

function GistItem({
  gist, selected, selectMode, checked, onCheck,
}: {
  gist: Gist; selected: boolean;
  selectMode: boolean; checked: boolean; onCheck: (id: string) => void;
}) {
  const { selectGist, togglePin } = useGistStore();
  const primaryFile = gist.files[0];

  return (
    <button
      data-gist-id={gist.id}
      className={`gist-item ${selected ? "gist-item--selected" : ""} ${checked ? "gist-item--checked" : ""}`}
      onClick={() => selectMode ? onCheck(gist.id) : selectGist(gist.id)}
    >
      <div className="gist-item__header">
        {selectMode && (
          <span className={`gist-item__checkbox ${checked ? "gist-item__checkbox--checked" : ""}`} aria-hidden>
            {checked ? "✓" : ""}
          </span>
        )}
        <span className="gist-item__filename">
          {gist.pinned && <span className="gist-item__pin-icon" title="Pinned">📌</span>}
          {primaryFile?.filename ?? "Untitled"}
        </span>
        <span className="gist-item__actions">
          <span
            className={`gist-item__pin ${gist.pinned ? "gist-item__pin--active" : ""}`}
            title={gist.pinned ? "Unpin" : "Pin to top"}
            onClick={(e) => { e.stopPropagation(); togglePin(gist.id); }}
            role="button"
          >
            ♦
          </span>
          <span
            className="gist-item__visibility"
            title={gist.public ? "Public" : "Secret"}
          >
            {gist.public ? "●" : "○"}
          </span>
        </span>
      </div>
      {gist.description && (
        <p className="gist-item__desc">{gist.description}</p>
      )}
      <div className="gist-item__meta">
        {primaryFile?.language && (
          <span className="gist-item__lang">
            <span
              style={{ background: languageColor(primaryFile.language) }}
              className="gist-item__lang-dot"
            />
            {primaryFile.language}
          </span>
        )}
        {gist.files.length > 1 && (
          <span className="gist-item__filecount">
            {gist.files.length} files
          </span>
        )}
      </div>
    </button>
  );
}

function TagFilterPanel({
  allTags,
  activeTagId,
  onSelect,
  onDelete,
}: {
  allTags: Tag[];
  activeTagId: number | null;
  onSelect: (id: number | null) => void;
  onDelete: (id: number) => void;
}) {
  const [hoverId, setHoverId] = useState<number | null>(null);
  if (allTags.length === 0) return null;

  return (
    <div className="sidebar__tag-filter">
      <button
        className={`sidebar__tag-chip ${activeTagId === null ? "sidebar__tag-chip--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {allTags.map((tag) => (
        <span
          key={tag.id}
          className="sidebar__tag-chip-wrap"
          onMouseEnter={() => setHoverId(tag.id)}
          onMouseLeave={() => setHoverId(null)}
        >
          <button
            className={`sidebar__tag-chip ${activeTagId === tag.id ? "sidebar__tag-chip--active" : ""}`}
            onClick={() => onSelect(activeTagId === tag.id ? null : tag.id)}
          >
            <span className="sidebar__tag-dot" style={{ background: tag.color }} />
            {tag.name}
          </button>
          {hoverId === tag.id && (
            <button
              className="sidebar__tag-delete"
              onClick={(e) => { e.stopPropagation(); onDelete(tag.id); }}
              title={`Delete tag "${tag.name}"`}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function sortGists(gists: Gist[], order: SortOrder): Gist[] {
  const sorted = [...gists];
  sorted.sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;

    switch (order) {
      case "updated":
        return b.updated_at.localeCompare(a.updated_at);
      case "created":
        return b.created_at.localeCompare(a.created_at);
      case "name": {
        const an = a.files[0]?.filename ?? "";
        const bn = b.files[0]?.filename ?? "";
        return an.localeCompare(bn);
      }
      case "files":
        return b.files.length - a.files.length;
      default:
        return 0;
    }
  });
  return sorted;
}

export function Sidebar({ style }: { style?: React.CSSProperties }) {
  const {
    gists, selectedId, searchQuery, setSearch, sync, syncStatus, createGist,
    allTags, activeTagId, setActiveTag, deleteTag,
    categoryCounts, activeCategoryId, setActiveCategory,
    selectGist,
  } = useGistStore();
  const { sortOrder, setSortOrder } = useThemeStore();
  const sortedGists = useMemo(() => sortGists(gists, sortOrder), [gists, sortOrder]);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [showNew, setShowNew] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const toggleCheck = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setCheckedIds(new Set());
  };

  // Exit select mode when the gist list changes (search/filter)
  useEffect(() => {
    if (selectMode) exitSelectMode();
  }, [sortedGists]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable refs so the keydown listener never needs re-registering
  const gistsRef = useRef(sortedGists);
  const selectedIdRef = useRef(selectedId);
  const selectGistRef = useRef(selectGist);
  useEffect(() => { gistsRef.current = sortedGists; }, [sortedGists]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { selectGistRef.current = selectGist; }, [selectGist]);

  // Scroll the selected item into view whenever it changes
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-gist-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // ↑ / ↓ / Enter keyboard navigation — fires only when no text input is focused
  // and no modal overlay is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;

      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement | null)?.isContentEditable;
      if (isTyping) return;

      if (document.querySelector(".modal-overlay")) return;

      const list = gistsRef.current;
      if (list.length === 0) return;

      if (e.key === "Enter") {
        // Re-focus the editor pane so the user can start typing immediately
        return;
      }

      e.preventDefault();
      const curId = selectedIdRef.current;
      const idx = list.findIndex((g) => g.id === curId);
      const next =
        e.key === "ArrowDown"
          ? Math.min(idx + 1, list.length - 1)
          : Math.max(idx - 1, 0);
      if (next !== idx) selectGistRef.current(list[next].id);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Cmd+K / Ctrl+K focuses search
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  useKeyboard("k", "meta", focusSearch);

  // Cmd+R refreshes
  const doSync = useCallback(() => sync(), [sync]);
  useKeyboard("r", "meta", doSync);

  // Cmd+N opens new gist modal
  const openNew = useCallback(() => setShowNew(true), []);
  useKeyboard("n", "meta", openNew);

  // Escape in search box clears query and blurs
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearch("");
      searchRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      // Hand off navigation to the list
      const first = listRef.current?.querySelector<HTMLElement>("[data-gist-id]");
      if (first) {
        const id = first.getAttribute("data-gist-id")!;
        selectGist(id);
        searchRef.current?.blur();
      }
    }
  };

  return (
    <aside className="sidebar" style={style}>
      <div className="sidebar__top">
        <div className="sidebar__search-wrap">
          <svg className="sidebar__search-icon" viewBox="0 0 16 16" width="14" height="14">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
          </svg>
          <input
            ref={searchRef}
            className="sidebar__search"
            type="text"
            placeholder="Search  ⌘K"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery && (
            <button className="sidebar__clear" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
        </div>
        <button
          className={`sidebar__refresh ${syncStatus === "syncing" ? "sidebar__refresh--spinning" : ""}`}
          onClick={() => sync()}
          title="Sync ⌘R"
          disabled={syncStatus === "syncing"}
        >
          ↻
        </button>
        <button
          className="sidebar__new"
          onClick={() => setShowNew(true)}
          title="New Gist ⌘N"
        >
          ＋
        </button>
      </div>

      <TagFilterPanel
        allTags={allTags}
        activeTagId={activeTagId}
        onSelect={setActiveTag}
        onDelete={deleteTag}
      />

      <CategoryFilterPanel
        categoryCounts={categoryCounts}
        activeCategoryId={activeCategoryId}
        onSelect={setActiveCategory}
      />

      <div className="sidebar__sort-bar">
        <select
          className="sidebar__sort-select"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          title="Sort order"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="sidebar__list" ref={listRef}>
        {sortedGists.length === 0 && syncStatus !== "syncing" && (
          <p className="sidebar__empty">
            {searchQuery ? "No results" : "No gists — press ⌘N to create one"}
          </p>
        )}
        {sortedGists.map((g) => (
          <GistItem
            key={g.id}
            gist={g}
            selected={g.id === selectedId}
            selectMode={selectMode}
            checked={checkedIds.has(g.id)}
            onCheck={toggleCheck}
          />
        ))}
      </div>

      {selectMode && checkedIds.size > 0 && (
        <BulkActionBar
          selectedIds={checkedIds}
          allTags={allTags}
          onClear={exitSelectMode}
        />
      )}

      <div className="sidebar__footer">
        <span>{sortedGists.length} gists</span>
        <span className="sidebar__nav-hint">↑↓ navigate</span>
        <button
          className={`sidebar__select-toggle ${selectMode ? "sidebar__select-toggle--active" : ""}`}
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          title={selectMode ? "Exit select mode" : "Select multiple gists"}
        >
          {selectMode ? `✓ ${checkedIds.size} selected` : "Select"}
        </button>
        {syncStatus === "syncing" && <span className="sidebar__syncing">Syncing…</span>}
      </div>

      {showNew && (
        <NewGistModal
          onClose={() => setShowNew(false)}
          onCreate={createGist}
        />
      )}
    </aside>
  );
}
