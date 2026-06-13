import { useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { useRecentStore } from "../store/useRecentStore";
import { useT } from "../store/useI18nStore";
import { buildRows } from "./commandPaletteRows";

// ── Highlight matching chars ────────────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) {
    return (
      <>
        {text.slice(0, idx)}
        <mark className="palette__match">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }
  const parts: { char: string; matched: boolean }[] = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    const matched = qi < q.length && t[i] === q[qi];
    if (matched) qi++;
    parts.push({ char: text[i], matched });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.matched ? (
          <mark key={i} className="palette__match">{p.char}</mark>
        ) : p.char
      )}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { gists, selectGist } = useGistStore();
  const recentIds = useRecentStore((s) => s.ids);
  const t = useT();

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Build the set of valid recent IDs (filter deleted gists)
  const gistMap = new Map(gists.map((g) => [g.id, g]));
  const validRecentIds = recentIds.filter((id) => gistMap.has(id));

  // ── Build display rows ────────────────────────────────────────────────

  const { rows, totalItems } = buildRows(query, gists, gistMap, validRecentIds, t);

  // Reset active index on query change
  useEffect(() => setActiveIdx(0), [query]);

  // Scroll active item into view using data-flat-idx attribute
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-flat-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = (flatIdx: number) => {
    const row = rows.find(
      (r) => r.kind === "item" && r.item.flatIdx === flatIdx
    );
    if (!row || row.kind !== "item") return;
    selectGist(row.item.gist.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIdx);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="modal-overlay palette-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>

        {/* Search input */}
        <div className="palette__input-wrap">
          <svg className="palette__icon" viewBox="0 0 16 16" width="15" height="15">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
          </svg>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={
              validRecentIds.length > 0
                ? t.palette.placeholderWithRecent
                : t.palette.placeholder
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button className="palette__clear" onClick={() => setQuery("")} tabIndex={-1}>
              ✕
            </button>
          )}
        </div>

        {/* Results */}
        {totalItems > 0 ? (
          <ul className="palette__list" ref={listRef} role="listbox">
            {rows.map((row, i) => {
              if (row.kind === "section") {
                return (
                  <li key={`s-${i}`} className="palette__section" role="presentation">
                    {row.label}
                    {row.count !== undefined && (
                      <span className="palette__section-count">{row.count}</span>
                    )}
                  </li>
                );
              }
              const { item } = row;
              const active = item.flatIdx === activeIdx;
              return (
                <li
                  key={item.gist.id}
                  role="option"
                  aria-selected={active}
                  data-flat-idx={item.flatIdx}
                  className={`palette__item ${active ? "palette__item--active" : ""}`}
                  onMouseEnter={() => setActiveIdx(item.flatIdx)}
                  onMouseDown={(e) => { e.preventDefault(); commit(item.flatIdx); }}
                >
                  <span className="palette__item-file">
                    {item.isRecent && !query && (
                      <span className="palette__recent-icon" title={t.palette.recentlyVisited}>↺</span>
                    )}
                    <HighlightMatch text={item.primaryFile} query={query} />
                    {item.gist.files.length > 1 && (
                      <span className="palette__item-count">+{item.gist.files.length - 1}</span>
                    )}
                  </span>
                  {item.gist.description && (
                    <span className="palette__item-desc">
                      <HighlightMatch text={item.gist.description} query={query} />
                    </span>
                  )}
                  <span className="palette__item-meta">
                    {item.gist.public ? t.palette.public : t.palette.secret}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="palette__empty">
            {query ? t.palette.noMatchingGists : t.palette.noGistsYet}
          </p>
        )}

        <div className="palette__footer">
          <span><kbd>↑↓</kbd> {t.palette.footerNavigate}</span>
          <span><kbd>↵</kbd> {t.palette.footerOpen}</span>
          <span><kbd>Esc</kbd> {t.palette.footerClose}</span>
          {!query && validRecentIds.length > 0 && (
            <span className="palette__footer-hint">{t.palette.footerRecentHint}</span>
          )}
        </div>
      </div>
    </div>
  );
}
