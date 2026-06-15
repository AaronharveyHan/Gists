import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore, type SortOrder } from "../store/useThemeStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { NewGistModal } from "./NewGistModal";
import { BulkActionBar } from "./BulkActionBar";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";
import type { Gist, Tag, SemanticResult, EmbeddingProgress } from "../api/tauri";
import { semanticSearch as apiSemanticSearch, startEmbeddingIndexer } from "../api/tauri";
import { SidebarCollectionsPanel } from "./SidebarCollectionsPanel";
import { SidebarGistList, sortGists, languageColor } from "./SidebarGistList";
import { SidebarSearchBar } from "./SidebarSearchBar";


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
      <SidebarSearchBar
        searchMode={searchMode}
        onToggleSearchMode={handleSearchModeToggle}
        searchQuery={searchQuery}
        onSearchChange={setSearch}
        onSearchKeyDown={handleSearchKeyDown}
        semanticBusy={semanticBusy}
        syncStatus={syncStatus}
        onSync={() => sync()}
        onNewGist={() => setShowNew(true)}
        inputRef={searchRef}
      />

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

      <SidebarCollectionsPanel
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

      <SidebarGistList
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
