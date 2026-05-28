import { useState, useEffect, useMemo, useRef } from "react";
import { writeText } from "@tauri-apps/api/clipboard";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";
import * as api from "../api/tauri";
import type { Gist } from "../api/tauri";

// ── Variable helpers ──────────────────────────────────────────────────────────

/** Extract unique {{var}} names from a template string, in order of appearance. */
function extractVars(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

/** Replace all {{var}} occurrences with values from the map. */
function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? `{{${name}}}`);
}

// ── Prompt form (new prompt creation) ────────────────────────────────────────

function NewPromptForm({ onCreated }: { onCreated: (gist: Gist) => void }) {
  const [name, setName]       = useState("");
  const [body, setBody]       = useState("");
  const [saving, setSaving]   = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleCreate = async () => {
    const n = name.trim();
    if (!n || !body.trim()) return;
    setSaving(true);
    try {
      const gist = await api.createLocalGist(n, false, [["prompt.md", body]]);
      await api.setGistCategory(gist.id, "prompt");
      onCreated(gist);
    } catch (e) {
      notify("Failed to create prompt: " + String(e));
    } finally {
      setSaving(false);
    }
  };

  const vars = useMemo(() => extractVars(body), [body]);

  return (
    <div className="prompt-lib__new-form">
      <div className="prompt-lib__new-row">
        <input
          ref={nameRef}
          className="prompt-lib__new-name"
          placeholder="Prompt name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
        />
      </div>
      <textarea
        className="prompt-lib__new-body"
        placeholder={"Write your prompt here.\nUse {{variable}} for placeholders."}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        spellCheck={false}
      />
      {vars.length > 0 && (
        <div className="prompt-lib__new-vars">
          <span className="prompt-lib__new-vars__label">Variables: </span>
          {vars.map((v) => (
            <code key={v} className="prompt-lib__var-pill">{`{{${v}}}`}</code>
          ))}
        </div>
      )}
      <div className="prompt-lib__new-actions">
        <button
          className="btn btn--primary"
          onClick={handleCreate}
          disabled={!name.trim() || !body.trim() || saving}
        >
          {saving ? "Saving…" : "Create Prompt"}
        </button>
      </div>
    </div>
  );
}

// ── Variable fill panel ───────────────────────────────────────────────────────

function VarFillPanel({
  template,
  vars,
  values,
  onChange,
}: {
  template: string;
  vars: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const preview = useMemo(() => renderTemplate(template, values), [template, values]);

  return (
    <div className="prompt-lib__vars">
      {vars.length > 0 && (
        <div className="prompt-lib__var-inputs">
          <div className="prompt-lib__section-label">Fill variables</div>
          {vars.map((v) => (
            <div key={v} className="prompt-lib__var-row">
              <label className="prompt-lib__var-label">
                <code>{`{{${v}}}`}</code>
              </label>
              <input
                className="prompt-lib__var-input"
                placeholder={v}
                value={values[v] ?? ""}
                onChange={(e) => onChange(v, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="prompt-lib__preview">
        <div className="prompt-lib__section-label">Preview</div>
        <pre className="prompt-lib__preview-text">{preview}</pre>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  /** If provided, shows "Insert into Chat" button. */
  onInsert?: (text: string) => void;
  /** If provided, "Edit" navigates to that gist in the main editor. */
  onNavigate?: (gistId: string) => void;
  onClose: () => void;
}

export function PromptLibrary({ onInsert, onNavigate, onClose }: Props) {
  const { gists, loadGists } = useGistStore();

  const prompts = useMemo(
    () => gists.filter((g) => g.category === "prompt"),
    [gists]
  );

  const [filter, setFilter]       = useState("");
  const [selected, setSelected]   = useState<Gist | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [copied, setCopied]       = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // Focus filter on open
  useEffect(() => { filterRef.current?.focus(); }, []);

  // Derive the rendered content for the selected prompt
  const template = selected?.files[0]?.content ?? "";
  const vars = useMemo(() => extractVars(template), [template]);
  const rendered = useMemo(() => renderTemplate(template, varValues), [template, varValues]);

  // Reset var values when selection changes
  useEffect(() => { setVarValues({}); }, [selected?.id]);

  // Default-select first prompt
  useEffect(() => {
    if (!selected && prompts.length > 0) setSelected(prompts[0]);
  }, [prompts, selected]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return q
      ? prompts.filter((p) =>
          (p.description ?? "").toLowerCase().includes(q) ||
          p.files[0]?.content?.toLowerCase().includes(q)
        )
      : prompts;
  }, [prompts, filter]);

  const handleCreated = async (gist: Gist) => {
    await loadGists();
    setSelected(gist);
    setShowNew(false);
  };

  const handleCopy = async () => {
    await writeText(rendered);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Keyboard: Escape closes, ↑↓ navigate list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = filtered.findIndex((p) => p.id === selected?.id);
      if (idx < filtered.length - 1) setSelected(filtered[idx + 1]);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = filtered.findIndex((p) => p.id === selected?.id);
      if (idx > 0) setSelected(filtered[idx - 1]);
    }
  };

  return (
    <div className="prompt-lib__overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-lib" onKeyDown={handleKeyDown}>

        {/* Header */}
        <div className="prompt-lib__header">
          <span className="prompt-lib__title">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 6 }}>
              <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/>
            </svg>
            Prompt Library
          </span>
          <button className="prompt-lib__close" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        <div className="prompt-lib__body">

          {/* Left: list */}
          <div className="prompt-lib__list-pane">
            <div className="prompt-lib__search-row">
              <input
                ref={filterRef}
                className="prompt-lib__search"
                placeholder="Search prompts…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                className="btn btn--primary prompt-lib__new-btn"
                onClick={() => { setShowNew(true); setSelected(null); }}
                title="New prompt"
              >
                +
              </button>
            </div>

            {showNew ? (
              <NewPromptForm onCreated={handleCreated} />
            ) : filtered.length === 0 ? (
              <div className="prompt-lib__empty">
                {prompts.length === 0
                  ? "No prompts yet. Create one or mark a gist as a prompt."
                  : "No matching prompts."}
              </div>
            ) : (
              <ul className="prompt-lib__list">
                {filtered.map((p) => {
                  const v = extractVars(p.files[0]?.content ?? "");
                  return (
                    <li
                      key={p.id}
                      className={`prompt-lib__item ${selected?.id === p.id ? "prompt-lib__item--active" : ""}`}
                      onClick={() => { setSelected(p); setShowNew(false); }}
                    >
                      <div className="prompt-lib__item-name">
                        {p.description || p.files[0]?.filename || p.id}
                      </div>
                      <div className="prompt-lib__item-meta">
                        {v.length > 0 && (
                          <span className="prompt-lib__item-vars">{v.length} var{v.length !== 1 ? "s" : ""}</span>
                        )}
                        {p.local_only && (
                          <span className="prompt-lib__item-local">local</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right: detail + vars */}
          {!showNew && selected && (
            <div className="prompt-lib__detail-pane">
              <div className="prompt-lib__detail-name">
                {selected.description || selected.files[0]?.filename}
              </div>

              {vars.length > 0 || true ? (
                <VarFillPanel
                  template={template}
                  vars={vars}
                  values={varValues}
                  onChange={(name, val) => setVarValues((v) => ({ ...v, [name]: val }))}
                />
              ) : null}

              <div className="prompt-lib__detail-actions">
                {onInsert && (
                  <button
                    className="btn btn--primary"
                    onClick={() => { onInsert(rendered); onClose(); }}
                    title="Insert rendered prompt into chat"
                  >
                    Insert into Chat
                  </button>
                )}
                <button className="btn" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </button>
                {onNavigate && (
                  <button
                    className="btn btn--ghost"
                    onClick={() => { onNavigate(selected.id); onClose(); }}
                    title="Open in editor"
                  >
                    Edit ↗
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Placeholder when no selection and not in new-form mode */}
          {!showNew && !selected && prompts.length > 0 && (
            <div className="prompt-lib__detail-pane prompt-lib__detail-pane--empty">
              <div className="prompt-lib__empty">Select a prompt to preview.</div>
            </div>
          )}
        </div>

        <div className="prompt-lib__footer">
          <span className="prompt-lib__footer-hint">
            <kbd>↑↓</kbd> navigate &nbsp;·&nbsp;
            <kbd>Esc</kbd> close
          </span>
          {onNavigate && (
            <span className="prompt-lib__footer-hint">
              Tip: mark any gist as a prompt via the editor toolbar.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
