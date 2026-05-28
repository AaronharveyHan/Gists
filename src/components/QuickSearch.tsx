import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { readText, writeText } from "@tauri-apps/api/clipboard";
import { emit, listen } from "@tauri-apps/api/event";
import { appWindow, WebviewWindow } from "@tauri-apps/api/window";
import type { Gist } from "../api/tauri";

// ── Language helpers ──────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Rust: "#dea584", Go: "#00ADD8", Ruby: "#701516", Java: "#b07219",
  "C++": "#f34b7d", C: "#555555", Shell: "#89e051", HTML: "#e34c26",
  CSS: "#563d7c", Markdown: "#083fa1", JSON: "#292929",
  YAML: "#cb171e", SQL: "#e38c00", PHP: "#4F5D95",
};

function langColor(lang: string | null): string {
  return lang ? (LANG_COLORS[lang] ?? "#7a7a7a") : "#555";
}

function langAbbr(lang: string | null): string {
  if (!lang) return "?";
  if (lang.length <= 4) return lang;
  const shorts: Record<string, string> = {
    JavaScript: "JS", TypeScript: "TS", Python: "PY", Markdown: "MD",
    "C++": "C++", Shell: "SH", HTML: "HTM", YAML: "YML", PHP: "PHP",
  };
  return shorts[lang] ?? lang.slice(0, 3).toUpperCase();
}

function langToExt(lang: string | null): string {
  const map: Record<string, string> = {
    Python: "py", JavaScript: "js", TypeScript: "ts", Rust: "rs",
    Go: "go", Ruby: "rb", Shell: "sh", HTML: "html", CSS: "css",
    Markdown: "md", JSON: "json", YAML: "yaml", SQL: "sql", PHP: "php",
    Java: "java", "C++": "cpp", C: "c",
  };
  return lang ? (map[lang] ?? "txt") : "txt";
}

/** Heuristic language detection from content. */
function detectLang(text: string): string | null {
  const t = text.slice(0, 2000);
  if (/^#!.*python/i.test(t))                                  return "Python";
  if (/^#!.*node/i.test(t))                                    return "JavaScript";
  if (/^#!.*\/(ba|z|k|fi)?sh\b/.test(t))                      return "Shell";
  if (/^package\s+\w+\s*\n/.test(t) && /func\s+\w+/.test(t)) return "Go";
  if (/^<\?php/.test(t))                                        return "PHP";
  if (/^\s*<!DOCTYPE html/i.test(t) || /^\s*<html/i.test(t))  return "HTML";
  if (/\binterface\s+\w/.test(t) || /type\s+\w+\s*=/.test(t) || /:\s*(string|number|boolean|void)\b/.test(t)) return "TypeScript";
  if (/\bfn\s+\w+\s*[(<]/.test(t) && /\blet\s+(mut\s+)?\w+/.test(t)) return "Rust";
  if (/^\s*SELECT\b/im.test(t) || /\bCREATE\s+TABLE\b/i.test(t))      return "SQL";
  if (/\bimport\s+\w/.test(t) && /\bdef\s+\w+\(/.test(t))    return "Python";
  if (/\bdef\s+\w+\(/.test(t) || /^\s*class\s+\w+:/m.test(t)) return "Python";
  if (/\b(const|let|var)\s+\w+\s*=/.test(t) || /=>\s*\{/.test(t) || /require\(/.test(t)) return "JavaScript";
  if (/^\s*[a-zA-Z-]+:\s+.+/m.test(t) && /\n\s{2,}/.test(t)) return "YAML";
  if (/^\s*[\[{]/.test(t.trim())) { try { JSON.parse(text); return "JSON"; } catch {} }
  if (/^#{1,6}\s/.test(t) || /\[.*\]\(https?:\/\//.test(t))   return "Markdown";
  if (/\|\s*grep\b/.test(t) || /\bsudo\b/.test(t) || /^\$\s/.test(t)) return "Shell";
  if (/<[a-zA-Z][^>]*>/.test(t) && /<\/[a-zA-Z]+>/.test(t))  return "HTML";
  if (/[.#][a-zA-Z][-\w]*\s*\{/.test(t))                      return "CSS";
  return null;
}

/** Generate a safe filename from title + detected language. */
function makeFilename(title: string, lang: string | null): string {
  const t = title.trim();
  if (!t) return `snippet.${langToExt(lang)}`;
  if (/\.\w+$/.test(t)) return t.replace(/\s+/g, "_");
  return `${t.replace(/\s+/g, "_").replace(/[^\w.-]/g, "")}.${langToExt(lang)}`;
}

// ── Search mode ───────────────────────────────────────────────────────────────

function SearchMode({ onSwitchCapture }: { onSwitchCapture: () => void }) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<Gist[]>([]);
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState<"copied" | "opened" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + reset on window focus
  useEffect(() => {
    const unlisten = appWindow.listen("tauri://focus", () => {
      setQuery(""); setSelected(0); setFeedback(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
    inputRef.current?.focus();
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Search with debounce
  useEffect(() => {
    const q = query.trim();
    const load = () => {
      if (!q) {
        invoke<Gist[]>("list_gists").then((all) => { setResults(all.slice(0, 10)); setSelected(0); });
      } else {
        invoke<Gist[]>("search_gists", { query: q }).then((r) => { setResults(r.slice(0, 10)); setSelected(0); });
      }
    };
    const t = setTimeout(load, q ? 150 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const hide = useCallback(() => appWindow.hide(), []);

  const handleCopy = useCallback(async (g: Gist) => {
    const f = g.files[0];
    if (!f?.content) return;
    await writeText(f.content);
    setFeedback("copied");
    setTimeout(hide, 900);
  }, [hide]);

  const handleOpen = useCallback(async (g: Gist) => {
    await emit("open-gist", { id: g.id });
    const main = WebviewWindow.getByLabel("main");
    await main?.show(); await main?.setFocus();
    setFeedback("opened");
    setTimeout(hide, 400);
  }, [hide]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape": hide(); break;
      case "ArrowDown": e.preventDefault(); setSelected((v) => Math.min(v + 1, results.length - 1)); break;
      case "ArrowUp":   e.preventDefault(); setSelected((v) => Math.max(v - 1, 0)); break;
      case "Enter":
        if (results[selected]) {
          e.metaKey || e.ctrlKey ? handleOpen(results[selected]) : handleCopy(results[selected]);
        }
        break;
      case "Tab":
        // Tab → switch to capture mode
        e.preventDefault();
        onSwitchCapture();
        break;
    }
  }, [results, selected, hide, handleCopy, handleOpen, onSwitchCapture]);

  const gistTitle = (g: Gist) => g.description?.trim() || g.files[0]?.filename || g.id;

  return (
    <>
      <div className="qs__input-row">
        <svg className="qs__search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <line x1="13" y1="13" x2="18" y2="18" />
        </svg>
        <input
          ref={inputRef}
          className="qs__input"
          placeholder="Search gists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {feedback === "copied" && <span className="qs__badge qs__badge--green">Copied!</span>}
        {feedback === "opened" && <span className="qs__badge qs__badge--blue">Opened</span>}
      </div>

      {results.length > 0 ? (
        <ul className="qs__list">
          {results.map((g, i) => {
            const file = g.files[0];
            return (
              <li
                key={g.id}
                className={`qs__item${i === selected ? " qs__item--active" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => handleOpen(g)}
              >
                <div className="qs__item-top">
                  <span className="qs__item-title">{gistTitle(g)}</span>
                  <div className="qs__item-meta">
                    {!g.public && <span className="qs__item-secret">secret</span>}
                    {file?.language && (
                      <span className="qs__item-lang" style={{ background: langColor(file.language) }}>
                        {langAbbr(file.language)}
                      </span>
                    )}
                  </div>
                </div>
                {g.files.length > 1
                  ? <div className="qs__item-sub">{g.files.map((f) => f.filename).join("  ·  ")}</div>
                  : file?.filename && <div className="qs__item-sub">{file.filename}</div>
                }
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="qs__empty">{query ? "No results" : "Start typing to search…"}</div>
      )}

      <div className="qs__footer">
        <span className="qs__hint"><kbd>↑↓</kbd> navigate</span>
        <span className="qs__hint"><kbd>↵</kbd> copy</span>
        <span className="qs__hint"><kbd>⌘↵</kbd> open</span>
        <span className="qs__hint"><kbd>Tab</kbd> capture</span>
        <span className="qs__hint"><kbd>⎋</kbd> close</span>
      </div>
    </>
  );
}

// ── Capture mode ──────────────────────────────────────────────────────────────

function CaptureMode({ onSwitchSearch }: { onSwitchSearch: () => void }) {
  const [title,    setTitle]   = useState("");
  const [content,  setContent] = useState("");
  const [language, setLang]    = useState<string | null>(null);
  const [saving,   setSaving]  = useState(false);
  const [saved,    setSaved]   = useState(false);
  const [error,    setError]   = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const readClipboard = useCallback(async () => {
    try {
      const text = await readText();
      if (text?.trim()) {
        setContent(text);
        setLang(detectLang(text));
      }
    } catch { /* clipboard unavailable */ }
  }, []);

  // Read clipboard on mount + window focus
  useEffect(() => {
    readClipboard();
    setTimeout(() => titleRef.current?.focus(), 60);
  }, [readClipboard]);

  useEffect(() => {
    const unlisten = appWindow.listen("tauri://focus", readClipboard);
    return () => { unlisten.then((f) => f()); };
  }, [readClipboard]);

  // Listen for the shortcut-triggered "switch-to-capture" event
  useEffect(() => {
    const unlisten = listen("switch-to-capture", () => {
      readClipboard();
      setTimeout(() => titleRef.current?.focus(), 60);
    });
    return () => { unlisten.then((f) => f()); };
  }, [readClipboard]);

  const filename = useMemo(() => makeFilename(title, language), [title, language]);

  const handleSave = async (openAfter: boolean) => {
    if (!content.trim()) return;
    setSaving(true); setError(null);
    try {
      const desc = title.trim() || filename;
      const gist = await invoke<Gist>("create_local_gist", {
        description: desc,
        public: false,
        files: [[filename, content]],
      });
      setSaved(true);
      if (openAfter) {
        await emit("open-gist", { id: gist.id });
        const main = WebviewWindow.getByLabel("main");
        await main?.show(); await main?.setFocus();
      }
      setTimeout(() => { setSaved(false); appWindow.hide(); }, openAfter ? 300 : 1000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { appWindow.hide(); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") { handleSave(true); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { handleSave(false); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); onSwitchSearch(); }
  };

  if (saved) {
    return (
      <div className="qs__capture-saved">
        <div className="qs__capture-saved__icon">✓</div>
        <div className="qs__capture-saved__label">Saved as draft</div>
      </div>
    );
  }

  const preview = content.slice(0, 1600) + (content.length > 1600 ? "\n…" : "");

  return (
    <div className="qs__capture" onKeyDown={handleKeyDown}>

      {/* Title + language badge */}
      <div className="qs__capture-row">
        <input
          ref={titleRef}
          className="qs__capture-title"
          placeholder="Description or title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          spellCheck={false}
        />
        <span
          className="qs__capture-lang-badge"
          style={{ background: langColor(language) }}
          title={language ?? "Unknown language"}
        >
          {langAbbr(language)}
        </span>
      </div>

      {/* Filename hint */}
      <div className="qs__capture-filename">
        <span className="qs__capture-filename__label">File:</span>
        <code className="qs__capture-filename__name">{filename}</code>
      </div>

      {/* Content preview */}
      <div className="qs__capture-preview">
        {content ? (
          <pre className="qs__capture-pre">{preview}</pre>
        ) : (
          <div className="qs__capture-no-content">
            <div className="qs__capture-no-content__icon">⎘</div>
            <div>Copy code or text to clipboard,</div>
            <div>then press <kbd>Alt+Shift+Space</kbd></div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && <div className="qs__capture-error">{error}</div>}

      {/* Action buttons */}
      <div className="qs__capture-actions">
        <button
          className="qs__capture-btn qs__capture-btn--primary"
          onClick={() => handleSave(false)}
          disabled={!content.trim() || saving}
          title="Save as local draft  ⌘↵"
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
        <button
          className="qs__capture-btn"
          onClick={() => handleSave(true)}
          disabled={!content.trim() || saving}
          title="Save and open in editor  ⌘⇧↵"
        >
          Save &amp; Open
        </button>
        <button
          className="qs__capture-btn qs__capture-btn--ghost"
          onClick={onSwitchSearch}
          title="Switch to search  ⇧Tab"
        >
          ← Search
        </button>
      </div>

      <div className="qs__footer">
        <span className="qs__hint"><kbd>⌘↵</kbd> save draft</span>
        <span className="qs__hint"><kbd>⌘⇧↵</kbd> save &amp; open</span>
        <span className="qs__hint"><kbd>⇧Tab</kbd> search</span>
        <span className="qs__hint"><kbd>⎋</kbd> close</span>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function QuickSearch() {
  const [mode, setMode] = useState<"search" | "capture">("search");

  // The Alt+Shift+Space shortcut emits "switch-to-capture" from Rust.
  useEffect(() => {
    const unlisten = listen("switch-to-capture", () => setMode("capture"));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Reset to search mode each time the window is hidden (so next Alt+Space opens search).
  useEffect(() => {
    const unlisten = appWindow.listen("tauri://blur", () => {
      appWindow.hide();
      // Small delay so the next open starts fresh in search mode.
      setTimeout(() => setMode("search"), 200);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  return (
    <div className="qs">
      <div className="qs__drag" data-tauri-drag-region />

      {/* Tab bar */}
      <div className="qs__tabs">
        <button
          className={`qs__tab ${mode === "search" ? "qs__tab--active" : ""}`}
          onClick={() => setMode("search")}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 5 }}>
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM6.5 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
          </svg>
          Search
        </button>
        <button
          className={`qs__tab ${mode === "capture" ? "qs__tab--active" : ""}`}
          onClick={() => setMode("capture")}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 5 }}>
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm1 6V4H7v3H4v2h3v3h2V9h3V7H9z" />
          </svg>
          Capture
        </button>
        <div className="qs__tabs-spacer" />
        <kbd className="qs__tab-hint">Alt+Space</kbd>
      </div>

      {mode === "search"
        ? <SearchMode  onSwitchCapture={() => setMode("capture")} />
        : <CaptureMode onSwitchSearch={() => setMode("search")} />
      }
    </div>
  );
}
