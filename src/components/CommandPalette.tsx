import { useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { useRecentStore } from "../store/useRecentStore";
import type { Gist } from "../api/tauri";

// ── Scoring ────────────────────────────────────────────────────────────────

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 2 + (t.startsWith(q) ? 1 : 0);
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : 0;
}

function scoreGist(query: string, gist: Gist): number {
  if (!query) return 1;
  const fileScore = Math.max(0, ...gist.files.map((f) => fuzzyScore(query, f.filename)));
  const descScore = gist.description ? fuzzyScore(query, gist.description) : 0;
  return Math.max(fileScore, descScore);
}

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

// ── Types ──────────────────────────────────────────────────────────────────

interface PaletteItem {
  gist: Gist;
  primaryFile: string;
  isRecent: boolean;
  /** flat selectable index (excludes section headers) */
  flatIdx: number;
}

type DisplayRow =
  | { kind: "section"; label: string; count?: number }
  | { kind: "item"; item: PaletteItem };

// ── Component ──────────────────────────────────────────────────────────────

const RECENT_SHOWN = 8;
const ALL_SHOWN = 50;

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { gists, selectGist } = useGistStore();
  const recentIds = useRecentStore((s) => s.ids);

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Build the set of valid recent IDs (filter deleted gists)
  const gistMap = new Map(gists.map((g) => [g.id, g]));
  const validRecentIds = recentIds.filter((id) => gistMap.has(id));

  // ── Build display rows ────────────────────────────────────────────────

  const { rows, totalItems } = buildRows(query, gists, gistMap, validRecentIds);

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
                ? "Jump to gist… (showing recent)"
                : "Jump to gist…"
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
                      <span className="palette__recent-icon" title="Recently visited">↺</span>
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
                    {item.gist.public ? "public" : "secret"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="palette__empty">
            {query ? "No matching gists" : "No gists yet"}
          </p>
        )}

        <div className="palette__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          {!query && validRecentIds.length > 0 && (
            <span className="palette__footer-hint">↺ recently visited</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Row builder (pure, outside component) ─────────────────────────────────

function buildRows(
  query: string,
  gists: Gist[],
  gistMap: Map<string, Gist>,
  recentIds: string[]
): { rows: DisplayRow[]; totalItems: number } {
  const recentSet = new Set(recentIds);
  let flatIdx = 0;
  const rows: DisplayRow[] = [];

  if (!query) {
    // ── Empty state: Recent section + All Gists section ──────────────────
    const recentGists = recentIds
      .slice(0, RECENT_SHOWN)
      .map((id) => gistMap.get(id))
      .filter((g): g is Gist => !!g);

    if (recentGists.length > 0) {
      rows.push({ kind: "section", label: "Recent" });
      for (const g of recentGists) {
        rows.push({
          kind: "item",
          item: {
            gist: g,
            primaryFile: g.files[0]?.filename ?? "Untitled",
            isRecent: true,
            flatIdx: flatIdx++,
          },
        });
      }
    }

    const recentShownIds = new Set(recentGists.map((g) => g.id));
    const rest = gists
      .filter((g) => !recentShownIds.has(g.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, ALL_SHOWN);

    if (rest.length > 0) {
      rows.push({ kind: "section", label: "All Gists", count: gists.length });
      for (const g of rest) {
        rows.push({
          kind: "item",
          item: {
            gist: g,
            primaryFile: g.files[0]?.filename ?? "Untitled",
            isRecent: false,
            flatIdx: flatIdx++,
          },
        });
      }
    }
  } else {
    // ── Search: fuzzy rank, recently-visited items get +0.5 boost ────────
    const scored = gists
      .map((g) => {
        const base = scoreGist(query, g);
        if (base === 0) return null;
        return {
          gist: g,
          score: base + (recentSet.has(g.id) ? 0.5 : 0),
          isRecent: recentSet.has(g.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.gist.updated_at.localeCompare(a.gist.updated_at);
      })
      .slice(0, ALL_SHOWN);

    for (const s of scored) {
      rows.push({
        kind: "item",
        item: {
          gist: s.gist,
          primaryFile: s.gist.files[0]?.filename ?? "Untitled",
          isRecent: s.isRecent,
          flatIdx: flatIdx++,
        },
      });
    }
  }

  return { rows, totalItems: flatIdx };
}
