import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore, type SortOrder } from "../store/useThemeStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { NewGistModal } from "./Editor";
import { BulkActionBar } from "./BulkActionBar";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";
import type { CollectionCount, Gist, Tag, SemanticResult, EmbeddingProgress } from "../api/tauri";
import { semanticSearch as apiSemanticSearch, startEmbeddingIndexer } from "../api/tauri";

const COLLECTION_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6",
  "#f97316","#84cc16",
];

function CollectionsPanel({
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

const SORT_VALUES: SortOrder[] = ["updated", "created", "name", "files"];

const CATEGORY_IDS: { id: string; icon?: string }[] = [
  { id: "prompt", icon: "★" },
  { id: "config" },
  { id: "script" },
  { id: "document" },
  { id: "media" },
  { id: "data" },
  { id: "multi" },
  { id: "snippet" },
  { id: "library" },
  { id: "test" },
  { id: "gist" },
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
  const t = useT();
  const catLabel: Record<string, string> = {
    prompt: t.sidebar.catPrompts,
    config: t.sidebar.catConfig,
    script: t.sidebar.catScript,
    document: t.sidebar.catDocs,
    media: t.sidebar.catMedia,
    data: t.sidebar.catData,
    multi: t.sidebar.catMultiFile,
    snippet: t.sidebar.catSnippet,
    library: t.sidebar.catLibrary,
    test: t.sidebar.catTest,
    gist: t.sidebar.catGeneral,
  };
  return (
    <div className="sidebar__category-filter">
      <div className="sidebar__filter-heading">{t.sidebar.byCategory}</div>
      <div className="sidebar__tag-filter">
        <button
          type="button"
          className={`sidebar__tag-chip ${activeCategoryId === null ? "sidebar__tag-chip--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          {t.sidebar.catAll}
        </button>
        {CATEGORY_IDS.map(({ id, icon }) => {
          const n = categoryCount(categoryCounts, id);
          const isPrompt = id === "prompt";
          return (
            <button
              key={id}
              type="button"
              className={`sidebar__tag-chip${activeCategoryId === id ? " sidebar__tag-chip--active" : ""}${isPrompt ? " sidebar__tag-chip--prompt" : ""}`}
              onClick={() =>
                onSelect(activeCategoryId === id ? null : id)
              }
            >
              {icon && <span className="sidebar__chip-icon">{icon}</span>}
              {catLabel[id]}
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

// Memoized so a parent re-render (typing in search, select-mode toggle, a
// background-sync tick) only reconciles rows whose props actually changed,
// not every row in the list. For this to hold, all props must be stable:
// `gist` keeps its object identity until it changes, the callbacks are
// useCallback'd by the parent, and the store actions below are selected
// individually (action references are stable, so no whole-store subscription).
const GistItem = memo(function GistItem({
  gist, selected, selectMode, checked, onCheck, onContextMenu,
}: {
  gist: Gist; selected: boolean;
  selectMode: boolean; checked: boolean;
  onCheck: (id: string) => void;
  onContextMenu: (gist: Gist, x: number, y: number) => void;
}) {
  const t = useT();
  const selectGist = useGistStore((s) => s.selectGist);
  const togglePin = useGistStore((s) => s.togglePin);
  const primaryFile = gist.files[0];

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(gist, e.clientX, e.clientY);
  };

  return (
    <button
      data-gist-id={gist.id}
      className={`gist-item ${selected ? "gist-item--selected" : ""} ${checked ? "gist-item--checked" : ""}`}
      onClick={() => selectMode ? onCheck(gist.id) : selectGist(gist.id)}
      onContextMenu={handleContextMenu}
      style={{ "--lang-color": languageColor(primaryFile?.language ?? null) } as React.CSSProperties}
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
            title={gist.pinned ? t.sidebar.unpin : t.sidebar.pinToTop}
            onClick={(e) => { e.stopPropagation(); togglePin(gist.id); }}
            role="button"
          >
            ♦
          </span>
          <span
            className="gist-item__visibility"
            title={gist.public ? t.common.public : t.common.secret}
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
            {t.sidebar.fileCount(gist.files.length)}
          </span>
        )}
        {gist.local_only && (
          <span className="gist-item__draft-badge" title={t.editor.localDraft}>
            {t.common.draft}
          </span>
        )}
      </div>
    </button>
  );
});

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
  const t = useT();
  const [hoverId, setHoverId] = useState<number | null>(null);
  if (allTags.length === 0) return null;

  return (
    <div className="sidebar__tag-filter">
      <button
        className={`sidebar__tag-chip ${activeTagId === null ? "sidebar__tag-chip--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        {t.sidebar.filterAll}
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
              title={t.tags.removeTag(tag.name)}
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

// ── Virtual gist list ─────────────────────────────────────────────────────────
// Renders only the items visible in the scroll viewport plus a small overscan
// buffer. At 3,000 gists this keeps DOM nodes under ~30 instead of 3,000.

import type { Translations } from "../i18n/translations";

interface GistListProps {
  listRef: React.RefObject<HTMLDivElement>;
  filteredGists: Gist[];
  selectedId: string | null;
  selectMode: boolean;
  checkedIds: Set<string>;
  toggleCheck: (id: string) => void;
  openCtxMenu: (gist: Gist, x: number, y: number) => void;
  // skeleton / empty-state deps
  gists: Gist[];
  syncStatus: string;
  isLocallyFiltered: boolean;
  searchQuery: string;
  // semantic mode
  searchMode: "keyword" | "semantic";
  semanticError: string | null;
  semanticBusy: boolean;
  semanticGists: Gist[];
  semanticScoreMap: Map<string, number>;
  t: Translations;
}

function GistList({
  listRef, filteredGists, selectedId, selectMode, checkedIds,
  toggleCheck, openCtxMenu, gists, syncStatus, isLocallyFiltered,
  searchQuery, searchMode, semanticError, semanticBusy, semanticGists,
  semanticScoreMap, t,
}: GistListProps) {
  // False positive: eslint-plugin-react-hooks 7.x flags @tanstack/react-virtual,
  // which is hook-safe.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filteredGists.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  // Scroll the selected item into view via the virtualizer (works even when the
  // item is outside the rendered window, unlike a DOM querySelector).
  const selectedIndex = useMemo(
    () => filteredGists.findIndex((g) => g.id === selectedId),
    [filteredGists, selectedId]
  );
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // ── Semantic search mode ──────────────────────────────────────────────────
  if (searchMode === "semantic" && searchQuery.trim()) {
    return (
      <div className="sidebar__list" data-testid="gist-list" ref={listRef}>
        {semanticError && (
          <p className="sidebar__empty sidebar__empty--error">{semanticError}</p>
        )}
        {!semanticBusy && !semanticError && semanticGists.length === 0 && (
          <p className="sidebar__empty">{t.sidebar.noSemanticMatches}</p>
        )}
        {semanticGists.map((g) => (
          <div key={g.id} className="sidebar__semantic-item-wrap">
            <GistItem
              gist={g}
              selected={g.id === selectedId}
              selectMode={selectMode}
              checked={checkedIds.has(g.id)}
              onCheck={toggleCheck}
              onContextMenu={openCtxMenu}
            />
            <div
              className="sidebar__score-bar"
              title={`Similarity: ${Math.round((semanticScoreMap.get(g.id) ?? 0) * 100)}%`}
            >
              <div
                className="sidebar__score-bar__fill"
                style={{ width: `${Math.round((semanticScoreMap.get(g.id) ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Keyword / normal mode with virtualization ─────────────────────────────
  return (
    <div className="sidebar__list" data-testid="gist-list" ref={listRef}>
      {gists.length === 0 && syncStatus === "syncing" && (
        <>
          {[70, 50, 85, 55, 65].map((w, i) => (
            <div key={i} className="skeleton-item">
              <div className="skeleton skeleton-item__title" style={{ width: `${w}%` }} />
              <div className="skeleton skeleton-item__sub" style={{ width: `${w * 0.6}%` }} />
              <div className="skeleton skeleton-item__meta" style={{ width: `${w * 0.45}%` }} />
            </div>
          ))}
        </>
      )}
      {filteredGists.length === 0 && syncStatus !== "syncing" && (
        <p className="sidebar__empty">
          {isLocallyFiltered
            ? t.sidebar.noGistsFilter
            : searchQuery
            ? t.sidebar.noResults
            : t.sidebar.noGists}
        </p>
      )}
      {filteredGists.length > 0 && (
        <div style={{ height: totalHeight, position: "relative" }}>
          {items.map((vItem) => {
            const g = filteredGists[vItem.index];
            return (
              <div
                key={g.id}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                <GistItem
                  gist={g}
                  selected={g.id === selectedId}
                  selectMode={selectMode}
                  checked={checkedIds.has(g.id)}
                  onCheck={toggleCheck}
                  onContextMenu={openCtxMenu}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ style }: { style?: React.CSSProperties }) {
  const {
    gists, selectedId, searchQuery, setSearch, sync, syncStatus, createGist,
    allTags, activeTagId, setActiveTag, deleteTag,
    categoryCounts, activeCategoryId, setActiveCategory,
    allCollections, activeCollectionId, setActiveCollection,
    createCollection, updateCollection, deleteCollection,
    selectGist, createLocalGist, networkOnline,
  } = useGistStore();
  const t = useT();
  const { sortOrder, setSortOrder } = useThemeStore();
  const sortedGists = useMemo(() => sortGists(gists, sortOrder), [gists, sortOrder]);

  // ── Semantic search ───────────────────────────────────────────────────────
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [semanticResults, setSemanticResults] = useState<SemanticResult[] | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [embedProgress, setEmbedProgress] = useState<EmbeddingProgress | null>(null);
  const semanticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start the background indexer once on mount and listen for progress events.
  // The command returns Ok when embeddings are unconfigured, so a rejection is a
  // genuine start failure. Runtime indexing errors arrive via "embedding-progress"
  // (shown in the error banner below), so for the rare start failure we log for
  // diagnostics rather than firing a toast on every mount.
  useEffect(() => {
    startEmbeddingIndexer().catch((e) =>
      console.error("[sidebar] failed to start embedding indexer:", e)
    );
    const unlisten = listen<EmbeddingProgress>("embedding-progress", (e) => {
      setEmbedProgress(e.payload);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  // Debounced semantic search
  useEffect(() => {
    if (searchMode !== "semantic") {
      setSemanticResults(null);
      setSemanticError(null);
      return;
    }
    if (!searchQuery.trim()) {
      setSemanticResults(null);
      return;
    }
    if (semanticTimerRef.current) clearTimeout(semanticTimerRef.current);
    semanticTimerRef.current = setTimeout(async () => {
      setSemanticBusy(true);
      setSemanticError(null);
      try {
        const results = await apiSemanticSearch(searchQuery.trim(), 25);
        setSemanticResults(results);
      } catch (e) {
        setSemanticError(String(e));
        setSemanticResults([]);
      } finally {
        setSemanticBusy(false);
      }
    }, 450);
    return () => { if (semanticTimerRef.current) clearTimeout(semanticTimerRef.current); };
  }, [searchQuery, searchMode]);

  // Clear semantic results when switching to keyword mode
  const handleSearchModeToggle = () => {
    const next = searchMode === "keyword" ? "semantic" : "keyword";
    setSearchMode(next);
    setSemanticResults(null);
    setSemanticError(null);
  };

  // Build ordered gist list from semantic results
  const gistById = useMemo(() => {
    const m = new Map<string, Gist>();
    for (const g of gists) m.set(g.id, g);
    return m;
  }, [gists]);

  const semanticGists: Gist[] = useMemo(() => {
    if (!semanticResults) return [];
    return semanticResults
      .map((r) => gistById.get(r.gist_id))
      .filter((g): g is Gist => g !== undefined);
  }, [semanticResults, gistById]);

  const semanticScoreMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of semanticResults ?? []) m.set(r.gist_id, r.score);
    return m;
  }, [semanticResults]);

  // ── Client-side filters (layered on top of backend sort/search/tag/category) ─
  const [visFilter, setVisFilter] = useState<"all" | "public" | "secret" | "pinned">("all");
  const [langFilter, setLangFilter] = useState<string | null>(null);

  // Unique languages present in the current backend-filtered list
  const availableLangs = useMemo(() => {
    const seen = new Set<string>();
    for (const g of sortedGists)
      for (const f of g.files)
        if (f.language) seen.add(f.language);
    return [...seen].sort();
  }, [sortedGists]);

  // Filtered list used for rendering
  const filteredGists = useMemo(() => {
    let list = sortedGists;
    if (visFilter === "public")  list = list.filter((g) => g.public);
    else if (visFilter === "secret")  list = list.filter((g) => !g.public);
    else if (visFilter === "pinned")  list = list.filter((g) => g.pinned);
    if (langFilter) list = list.filter((g) => g.files.some((f) => f.language === langFilter));
    return list;
  }, [sortedGists, visFilter, langFilter]);

  // Reset local filters when the backend filter changes (search / tag / category)
  useEffect(() => {
    setVisFilter("all");
    setLangFilter(null);
  }, [searchQuery, activeTagId, activeCategoryId]);

  const isLocallyFiltered = visFilter !== "all" || langFilter !== null;

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [showNew, setShowNew] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── Context menu state ──────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    gist: Gist; x: number; y: number;
  } | null>(null);

  const openCtxMenu = useCallback(
    (gist: Gist, x: number, y: number) => setCtxMenu({ gist, x, y }),
    []
  );
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const buildMenuItems = (g: Gist): ContextMenuEntry[] => {
    const { togglePin, deleteGist, openInTab, openTabIds } = useGistStore.getState();
    return [
      {
        label: openTabIds.includes(g.id) ? t.sidebar.switchToTab : t.sidebar.openInTab,
        icon: "⊞",
        onClick: () => openInTab(g.id),
      },
      { separator: true },
      {
        label: g.pinned ? t.sidebar.unpin : t.sidebar.pinToTop,
        icon: g.pinned ? "♦" : "♦",
        onClick: () => togglePin(g.id),
      },
      {
        label: t.sidebar.copyUrl,
        icon: "⎘",
        onClick: () => {
          navigator.clipboard.writeText(g.html_url).then(() =>
            notify("URL copied", "success")
          );
        },
      },
      {
        label: t.sidebar.openInBrowser,
        icon: "↗",
        onClick: () =>
          import("@tauri-apps/plugin-shell").then(({ open }) => open(g.html_url)),
      },
      { separator: true },
      {
        label: checkedIds.has(g.id) ? t.sidebar.deselect : t.sidebar.select,
        icon: "✓",
        onClick: () => {
          if (!selectMode) setSelectMode(true);
          setCheckedIds((prev) => {
            const next = new Set(prev);
            next.has(g.id) ? next.delete(g.id) : next.add(g.id);
            return next;
          });
        },
      },
      { separator: true },
      {
        label: t.common.delete,
        icon: "✕",
        danger: true,
        onClick: () => {
          if (confirm(t.sidebar.deleteGistConfirm(g.files[0]?.filename ?? ""))) {
            deleteGist(g.id).catch((e) => notify(t.sidebar.deleteFailed + " " + String(e)));
          }
        },
      },
    ];
  };

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = () => {
    setSelectMode(false);
    setCheckedIds(new Set());
  };

  const selectAll = useCallback(
    () => setCheckedIds(new Set(filteredGists.map((g) => g.id))),
    [filteredGists]
  );

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

  // Scroll the selected item into view — handled via virtualizer.scrollToIndex below.

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
      const firstId = filteredGists[0]?.id;
      if (firstId) {
        selectGist(firstId);
        searchRef.current?.blur();
      }
    }
  };

  return (
    <aside className="sidebar" style={style}>
      <div className="sidebar__top">
        <div className="sidebar__search-wrap">
          {searchMode === "semantic" ? (
            <span className="sidebar__search-icon sidebar__search-icon--semantic" title={t.sidebar.semanticActive}>≈</span>
          ) : (
            <svg className="sidebar__search-icon" viewBox="0 0 16 16" width="14" height="14">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
            </svg>
          )}
          <input
            ref={searchRef}
            className="sidebar__search"
            type="text"
            placeholder={searchMode === "semantic" ? t.sidebar.semanticPlaceholder : t.sidebar.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchMode === "semantic" && semanticBusy && (
            <span className="sidebar__search-spinner" title={t.sidebar.searching}>⋯</span>
          )}
          {searchQuery && !semanticBusy && (
            <button className="sidebar__clear" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
          <button
            className={`sidebar__mode-toggle ${searchMode === "semantic" ? "sidebar__mode-toggle--active" : ""}`}
            onClick={handleSearchModeToggle}
            title={searchMode === "semantic" ? t.sidebar.switchToKeyword : t.sidebar.switchToSemantic}
          >
            {searchMode === "semantic" ? "⌨" : "≈"}
          </button>
        </div>
        <button
          className={`sidebar__refresh ${syncStatus === "syncing" ? "sidebar__refresh--spinning" : ""}`}
          onClick={() => sync()}
          title={t.sidebar.sync}
          disabled={syncStatus === "syncing"}
        >
          ↻
        </button>
        <button
          className="sidebar__new"
          data-testid="new-gist-btn"
          onClick={() => setShowNew(true)}
          title={t.sidebar.newGist}
        >
          ＋
        </button>
      </div>

      {/* Embedding index progress bar */}
      {embedProgress && embedProgress.running && embedProgress.total > 0 && (
        <div className="sidebar__embed-bar" title={t.sidebar.indexing(embedProgress.indexed, embedProgress.total)}>
          <div
            className="sidebar__embed-bar__fill"
            style={{ width: `${Math.round((embedProgress.indexed / embedProgress.total) * 100)}%` }}
          />
          <span className="sidebar__embed-bar__label">
            {t.sidebar.indexing(embedProgress.indexed, embedProgress.total)}
          </span>
        </div>
      )}

      {/* Embedding error banner */}
      {embedProgress && !embedProgress.running && embedProgress.error && (
        <div className="sidebar__embed-error" title={embedProgress.error}>
          <span className="sidebar__embed-error__icon">⚠</span>
          <span className="sidebar__embed-error__text">
            {t.sidebar.embeddingFailed}{" "}
            <em>{embedProgress.error.slice(0, 120)}{embedProgress.error.length > 120 ? "…" : ""}</em>
          </span>
          <a
            className="sidebar__embed-error__fix"
            href="#"
            onClick={(e) => { e.preventDefault(); /* settings are opened by parent */ }}
            title={t.sidebar.fixInSettingsTitle}
          >
            {t.sidebar.fixInSettings}
          </a>
        </div>
      )}

      <CollectionsPanel
        collections={allCollections}
        activeCollectionId={activeCollectionId}
        onSelect={setActiveCollection}
        onCreate={async (name, color) => { await createCollection(name, "", color, "folder"); }}
        onDelete={deleteCollection}
        onRename={async (id, name, color) => { await updateCollection(id, name, "", color, "folder"); }}
      />

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

      {/* ── Sort + visibility filter row ─────────────────────────────── */}
      <div className="sidebar__filter-bar">
        <div className="sidebar__sort-row">
          <select
            className="sidebar__sort-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            title="Sort order"
          >
            {SORT_VALUES.map((v) => {
              const labels: Record<SortOrder, string> = {
                updated: t.sidebar.sortLastUpdated,
                created: t.sidebar.sortCreated,
                name: t.sidebar.sortName,
                files: t.sidebar.sortFileCount,
              };
              return <option key={v} value={v}>{labels[v]}</option>;
            })}
          </select>

          <div className="sidebar__vis-chips" role="group" aria-label="Visibility filter">
            {(
              [
                { id: "all",     label: t.sidebar.filterAll },
                { id: "public",  label: "●",  title: t.sidebar.filterPublic },
                { id: "secret",  label: "○",  title: t.sidebar.filterSecret },
                { id: "pinned",  label: "♦",  title: t.sidebar.filterPinned },
              ] as { id: string; label: string; title?: string }[]
            ).map(({ id, label, title }) => (
              <button
                key={id}
                className={`sidebar__vis-chip ${visFilter === id ? "sidebar__vis-chip--active" : ""}`}
                onClick={() => setVisFilter(id as typeof visFilter)}
                title={title ?? id}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Language chip row (only when ≥2 languages exist) ─────── */}
        {availableLangs.length >= 2 && (
          <div className="sidebar__lang-row">
            <button
              className={`sidebar__lang-chip ${!langFilter ? "sidebar__lang-chip--active" : ""}`}
              onClick={() => setLangFilter(null)}
            >
              {t.sidebar.filterAll}
            </button>
            {availableLangs.map((lang) => (
              <button
                key={lang}
                className={`sidebar__lang-chip ${langFilter === lang ? "sidebar__lang-chip--active" : ""}`}
                onClick={() => setLangFilter(langFilter === lang ? null : lang)}
                title={lang}
              >
                <span
                  className="sidebar__lang-dot"
                  style={{ background: languageColor(lang) }}
                />
                {lang}
              </button>
            ))}
          </div>
        )}
      </div>

      <GistList
        listRef={listRef}
        filteredGists={filteredGists}
        selectedId={selectedId}
        selectMode={selectMode}
        checkedIds={checkedIds}
        toggleCheck={toggleCheck}
        openCtxMenu={openCtxMenu}
        gists={gists}
        syncStatus={syncStatus}
        isLocallyFiltered={isLocallyFiltered}
        searchQuery={searchQuery}
        searchMode={searchMode}
        semanticError={semanticError}
        semanticBusy={semanticBusy}
        semanticGists={semanticGists}
        semanticScoreMap={semanticScoreMap}
        t={t}
      />

      {selectMode && (
        <BulkActionBar
          selectedIds={checkedIds}
          allTags={allTags}
          sortedGists={filteredGists}
          onClear={exitSelectMode}
          onSelectAll={selectAll}
        />
      )}

      <div className="sidebar__footer">
        {searchMode === "semantic" && searchQuery.trim() ? (
          <span>
            <strong>{semanticGists.length}</strong>
            <span className="sidebar__footer-total"> {t.sidebar.semanticResults(semanticGists.length)}</span>
          </span>
        ) : isLocallyFiltered ? (
          <span>
            <strong>{filteredGists.length}</strong>
            <span className="sidebar__footer-total"> / {sortedGists.length}</span>
          </span>
        ) : (
          <span>{sortedGists.length} gists</span>
        )}
        <span className="sidebar__nav-hint">{t.sidebar.navigate}</span>
        <button
          className={`sidebar__select-toggle ${selectMode ? "sidebar__select-toggle--active" : ""}`}
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          title={selectMode ? t.sidebar.exitSelect : t.sidebar.selectMultiple}
        >
          {selectMode ? `✓ ${checkedIds.size} selected` : t.sidebar.select}
        </button>
        {syncStatus === "syncing" && <span className="sidebar__syncing">{t.sidebar.syncing}</span>}
      </div>

      {showNew && (
        <NewGistModal
          onClose={() => setShowNew(false)}
          onCreate={createGist}
          onCreateLocal={createLocalGist}
          networkOnline={networkOnline}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems(ctxMenu.gist)}
          onClose={closeCtxMenu}
        />
      )}
    </aside>
  );
}
