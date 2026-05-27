import { useEffect, useRef, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import type { Gist } from "../api/tauri";

// Simple but effective fuzzy scorer: returns match score > 0 if all query
// chars appear in order (case-insensitive), boosting prefix / word-boundary hits.
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
  const fileScore = Math.max(
    0,
    ...gist.files.map((f) => fuzzyScore(query, f.filename))
  );
  const descScore = gist.description ? fuzzyScore(query, gist.description) : 0;
  return Math.max(fileScore, descScore);
}

// Highlight matching characters in a string for a given query
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Fast path: substring match → bold the matching portion
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

  // Fuzzy path: highlight matched characters individually
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
        ) : (
          p.char
        )
      )}
    </>
  );
}

interface PaletteItem {
  gist: Gist;
  score: number;
  primaryFile: string;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { gists, selectGist } = useGistStore();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filtered + ranked list
  const items: PaletteItem[] = gists
    .map((g) => ({ gist: g, score: scoreGist(query, g), primaryFile: g.files[0]?.filename ?? "Untitled" }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.gist.updated_at.localeCompare(a.gist.updated_at);
    })
    .slice(0, 50);

  // Reset active index when query changes
  useEffect(() => setActiveIdx(0), [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    selectGist(item.gist.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
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
        <div className="palette__input-wrap">
          <svg className="palette__icon" viewBox="0 0 16 16" width="15" height="15">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
          </svg>
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Jump to gist…"
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

        {items.length > 0 ? (
          <ul className="palette__list" ref={listRef} role="listbox">
            {items.map((item, i) => (
              <li
                key={item.gist.id}
                role="option"
                aria-selected={i === activeIdx}
                className={`palette__item ${i === activeIdx ? "palette__item--active" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); commit(i); }}
              >
                <span className="palette__item-file">
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
            ))}
          </ul>
        ) : (
          <p className="palette__empty">
            {query ? "No matching gists" : "No gists"}
          </p>
        )}

        <div className="palette__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
