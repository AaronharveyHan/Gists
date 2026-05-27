import { useState, useCallback, useEffect, useRef } from "react";
import { useGistStore } from "../store/useGistStore";
import { listGists } from "../api/tauri";
import type { Gist } from "../api/tauri";

interface SearchHit {
  gistId: string;
  filename: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

function searchContent(
  gists: Gist[],
  query: string,
  maxResults = 200
): SearchHit[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];

  for (const gist of gists) {
    for (const file of gist.files) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        const idx = lower.indexOf(q);
        if (idx !== -1) {
          hits.push({
            gistId: gist.id,
            filename: file.filename,
            line: i + 1,
            text: lines[i],
            matchStart: idx,
            matchEnd: idx + query.length,
          });
          if (hits.length >= maxResults) return hits;
        }
      }
    }
  }
  return hits;
}

export function ContentSearch({ onClose }: { onClose: () => void }) {
  const { selectGist } = useGistStore();
  const [query, setQuery] = useState("");
  const [allGists, setAllGists] = useState<Gist[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listGists().then(setAllGists);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setHits(searchContent(allGists, query));
      setActiveIdx(0);
    }, 150);
    return () => clearTimeout(id);
  }, [query, allGists]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const go = useCallback(
    (hit: SearchHit) => {
      selectGist(hit.gistId);
      onClose();
    },
    [selectGist, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[activeIdx]) {
      go(hits[activeIdx]);
    }
  };

  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, hit) => {
    const key = `${hit.gistId}:${hit.filename}`;
    (acc[key] ??= []).push(hit);
    return acc;
  }, {});

  return (
    <div className="content-search" onKeyDown={handleKeyDown}>
      <div className="content-search__header">
        <svg viewBox="0 0 16 16" width="14" height="14" className="content-search__icon">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
        </svg>
        <input
          ref={inputRef}
          className="content-search__input"
          type="text"
          placeholder="Search in files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <span className="content-search__count">
            {hits.length}{hits.length >= 200 ? "+" : ""} results
          </span>
        )}
        <button
          className="content-search__close"
          onClick={onClose}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
      <div className="content-search__results" ref={listRef}>
        {query && hits.length === 0 && (
          <p className="content-search__empty">No results found</p>
        )}
        {Object.entries(grouped).map(([key, fileHits]) => {
          const first = fileHits[0];
          return (
            <div key={key} className="content-search__file-group">
              <div className="content-search__file-header">
                <span className="content-search__filename">
                  {first.filename}
                </span>
                <span className="content-search__hit-count">
                  {fileHits.length}
                </span>
              </div>
              {fileHits.map((hit, i) => {
                const flatIdx = hits.indexOf(hit);
                return (
                  <button
                    key={i}
                    className={`content-search__hit ${flatIdx === activeIdx ? "content-search__hit--active" : ""}`}
                    onClick={() => go(hit)}
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                  >
                    <span className="content-search__line-num">
                      {hit.line}
                    </span>
                    <span className="content-search__line-text">
                      {hit.text.slice(0, hit.matchStart)}
                      <mark className="content-search__match">
                        {hit.text.slice(hit.matchStart, hit.matchEnd)}
                      </mark>
                      {hit.text.slice(hit.matchEnd)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
