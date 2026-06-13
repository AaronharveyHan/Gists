import { memo, useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import type { SortOrder } from "../store/useThemeStore";
import type { Gist } from "../api/tauri";
import type { Translations } from "../i18n/translations";

export function languageColor(lang: string | null): string {
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

export function sortGists(gists: Gist[], order: SortOrder): Gist[] {
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

export interface SidebarGistListProps {
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

// ── Virtual gist list ─────────────────────────────────────────────────────────
// Renders only the items visible in the scroll viewport plus a small overscan
// buffer. At 3,000 gists this keeps DOM nodes under ~30 instead of 3,000.
export function SidebarGistList({
  listRef, filteredGists, selectedId, selectMode, checkedIds,
  toggleCheck, openCtxMenu, gists, syncStatus, isLocallyFiltered,
  searchQuery, searchMode, semanticError, semanticBusy, semanticGists,
  semanticScoreMap, t,
}: SidebarGistListProps) {
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
