/**
 * Diff modal: Revisions timeline (GitHub API) + Working-tree diff (SQLite snapshot).
 * No git CLI dependency — diffs computed by the `similar` Rust crate.
 */
import { useEffect, useRef, useState } from "react";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";
import { useT } from "../store/useI18nStore";

// ── Unified diff parser ───────────────────────────────────────────────────────
// Handles output from `similar` crate: starts with "--- a/…" / "+++ b/…",
// NOT the "diff --git a/… b/…" header used by git.

type DiffLineKind = "hunk" | "add" | "remove" | "context" | "meta";

interface ParsedDiffLine {
  oldNum: number | null;
  newNum: number | null;
  kind: DiffLineKind;
  text: string;
}

interface ParsedDiffFile {
  path: string;
  lines: ParsedDiffLine[];
}

function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const rawLines = diff.split(/\r?\n/);
  const files: ParsedDiffFile[] = [];
  let file: ParsedDiffFile | null = null;
  let i = 0;

  while (i < rawLines.length) {
    const raw = rawLines[i];

    // File boundary: "--- a/path" (or "--- /dev/null" for new files)
    if (raw.startsWith("--- ")) {
      const next = rawLines[i + 1] ?? "";
      let path: string;
      if (next.startsWith("+++ b/")) {
        path = next.slice("+++ b/".length);
        i += 2; // consume both --- and +++ lines
      } else if (next.startsWith("+++ /dev/null")) {
        path = raw.startsWith("--- a/") ? raw.slice("--- a/".length) : raw.slice(4);
        i += 2;
      } else {
        path = raw.startsWith("--- a/") ? raw.slice("--- a/".length) : raw.slice(4);
        i += 1;
      }
      file = { path, lines: [] };
      files.push(file);
      continue;
    }

    if (!file) { i++; continue; }

    if (raw.startsWith("+++ ")) { i++; continue; } // already consumed in --- branch

    if (raw.startsWith("@@")) {
      file.lines.push({ oldNum: null, newNum: null, kind: "hunk", text: raw });
      i++; continue;
    }

    const c = raw[0] ?? " ";
    const rest = raw.slice(1);
    if (c === "+") {
      file.lines.push({ oldNum: null, newNum: 0, kind: "add", text: rest });
    } else if (c === "-") {
      file.lines.push({ oldNum: 0, newNum: null, kind: "remove", text: rest });
    } else if (c === " ") {
      file.lines.push({ oldNum: 0, newNum: 0, kind: "context", text: rest });
    } else {
      file.lines.push({ oldNum: null, newNum: null, kind: "meta", text: raw });
    }
    i++;
  }

  // Assign actual line numbers from hunk headers.
  for (const f of files) {
    let oldLine = 0;
    let newLine = 0;
    for (const row of f.lines) {
      if (row.kind === "hunk") {
        const m = row.text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
        continue;
      }
      if (row.kind === "context") { row.oldNum = oldLine++; row.newNum = newLine++; }
      else if (row.kind === "remove") { row.oldNum = oldLine++; }
      else if (row.kind === "add") { row.newNum = newLine++; }
    }
  }

  return files;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatRelativeTime(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso || "—";
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const a = Math.abs(diffSec);
  if (a < 60) return rtf.format(Math.round(diffSec), "second");
  if (a < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

function formatLastActive(iso: string, locale: string, label: (rel: string) => string): string | null {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const a = Math.abs(diffSec);
  let rel: string;
  if (a < 60) rel = rtf.format(Math.round(diffSec), "second");
  else if (a < 3600) rel = rtf.format(Math.round(diffSec / 60), "minute");
  else if (a < 86400) rel = rtf.format(Math.round(diffSec / 3600), "hour");
  else if (a < 86400 * 30) rel = rtf.format(Math.round(diffSec / 86400), "day");
  else if (a < 86400 * 365) rel = rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  else rel = rtf.format(Math.round(diffSec / (86400 * 365)), "year");
  return label(rel);
}

// ── Diff table renderer ───────────────────────────────────────────────────────

function lineClass(kind: DiffLineKind): string {
  if (kind === "add") return "diff-line diff-line--add";
  if (kind === "remove") return "diff-line diff-line--remove";
  if (kind === "context") return "diff-line diff-line--ctx";
  if (kind === "hunk") return "diff-line diff-line--hunk";
  return "diff-line diff-line--meta";
}

function DiffTable({ diff }: { diff: string }) {
  const t = useT();
  const trimmed = diff.trim();
  if (!trimmed) return <p className="modal__muted">{t.diff.noChanges}</p>;

  const files = parseUnifiedDiff(diff);
  if (files.length === 0) {
    return <pre className="git-diff-pre git-diff-pre--raw">{diff}</pre>;
  }

  return (
    <div className="diff-table-wrap">
      {files.map((f) => (
        <div key={f.path} className="diff-file">
          <div className="diff-file__header">{f.path}</div>
          <table className="diff-table">
            <thead>
              <tr>
                <th className="diff-table__col-old">{t.diff.colOld}</th>
                <th className="diff-table__col-new">{t.diff.colNew}</th>
                <th className="diff-table__col-code">{t.diff.colChange}</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((row, i) => (
                <tr key={i} className={lineClass(row.kind)}>
                  <td className="diff-table__num">
                    {row.oldNum != null && row.oldNum > 0 ? row.oldNum : ""}
                  </td>
                  <td className="diff-table__num">
                    {row.newNum != null && row.newNum > 0 ? row.newNum : ""}
                  </td>
                  <td className="diff-table__code">
                    {row.kind === "hunk" ? (
                      <code className="diff-table__hunk">{row.text}</code>
                    ) : row.kind === "meta" ? (
                      <span className="diff-table__meta">{row.text}</span>
                    ) : (
                      <span className="diff-table__text">{row.text}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── Main modal component ──────────────────────────────────────────────────────

export interface DiffModalProps {
  open: boolean;
  onClose: () => void;
  gistId: string;
  githubLogin: string | null;
  gistUpdatedAt: string;
  primaryFilename: string;
  currentFiles: GistFile[];
}

export function DiffModal({
  open,
  onClose,
  gistId,
  githubLogin,
  gistUpdatedAt,
  primaryFilename,
  currentFiles,
}: DiffModalProps) {
  const t = useT();
  const [tab, setTab] = useState<"revisions" | "working">("revisions");

  // Revision list
  const [revisions, setRevisions] = useState<GistRevisionView[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);

  // Per-revision diff (loaded on demand when a revision is expanded)
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const revDiffCache = useRef<Record<string, string>>({});
  const [revDiffLoading, setRevDiffLoading] = useState(false);
  const [revDiffError, setRevDiffError] = useState<string | null>(null);
  const [revDiff, setRevDiff] = useState<string>("");

  // Working-tree diff
  const [workingDiff, setWorkingDiff] = useState("");
  const [workingLoading, setWorkingLoading] = useState(false);
  const [workingError, setWorkingError] = useState<string | null>(null);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // On open: load revisions + working diff
  useEffect(() => {
    if (!open) return;
    setTab("revisions");
    setRevisions([]);
    setRevisionsError(null);
    setSelectedSha(null);
    setRevDiff("");
    setRevDiffError(null);
    revDiffCache.current = {};

    let cancelled = false;

    // Load revision list
    setRevisionsLoading(true);
    void api.getGistRevisions(gistId)
      .then((rows) => { if (!cancelled) setRevisions(rows); })
      .catch((e) => { if (!cancelled) setRevisionsError(String(e)); })
      .finally(() => { if (!cancelled) setRevisionsLoading(false); });

    // Compute working-tree diff
    setWorkingLoading(true);
    setWorkingError(null);
    setWorkingDiff("");
    const pairs: [string, string][] = currentFiles.map((f) => [f.filename, f.content]);
    void api.computeGistDiff(gistId, pairs)
      .then((d) => { if (!cancelled) setWorkingDiff(d); })
      .catch((e) => { if (!cancelled) setWorkingError(String(e)); })
      .finally(() => { if (!cancelled) setWorkingLoading(false); });

    return () => { cancelled = true; };
  }, [open, gistId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load diff for a revision when selected
  const selectRevision = (sha: string, prevSha: string | null) => {
    if (selectedSha === sha) { setSelectedSha(null); return; }
    setSelectedSha(sha);

    const cached = revDiffCache.current[sha];
    if (cached !== undefined) { setRevDiff(cached); setRevDiffError(null); return; }

    setRevDiffLoading(true);
    setRevDiffError(null);
    setRevDiff("");
    void api.fetchRevDiff(gistId, sha, prevSha)
      .then((d) => {
        revDiffCache.current[sha] = d;
        setRevDiff(d);
      })
      .catch((e) => setRevDiffError(String(e)))
      .finally(() => setRevDiffLoading(false));
  };

  if (!open) return null;

  const locale = t.common.rtfLocale;
  const login = githubLogin ?? "…";
  const lastActive = gistUpdatedAt ? formatLastActive(gistUpdatedAt, locale, t.diff.lastActive) : null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal--git-diff" onMouseDown={(e) => e.stopPropagation()}>

        {/* Gist header */}
        <div className="git-diff-panel__gist-head">
          <div className="git-diff-panel__user">@{login}</div>
          <div className="git-diff-panel__path">{login}/{primaryFilename || "—"}</div>
          {lastActive && (
            <div className="git-diff-panel__last-active">{lastActive}</div>
          )}
        </div>

        {/* Tabs */}
        <div className="git-diff-panel__tabs">
          {(["revisions", "working"] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              className={`git-diff-panel__tab ${tab === tb ? "git-diff-panel__tab--active" : ""}`}
              onClick={() => setTab(tb)}
            >
              {tb === "revisions" ? t.diff.tabRevisions : t.diff.tabWorking}
            </button>
          ))}
        </div>

        {/* Revisions tab */}
        {tab === "revisions" && (
          <div className="git-diff-panel__body">
            {revisionsError && <p className="modal__error">{revisionsError}</p>}
            {revisionsLoading ? (
              <p className="modal__muted">{t.diff.loadingRevisions}</p>
            ) : (
              <div className="revision-timeline">
                {revisions.map((rev, idx) => {
                  const prevSha = revisions[idx + 1]?.sha ?? null;
                  const isSelected = selectedSha === rev.sha;
                  const add = rev.additions;
                  const del = rev.deletions;
                  return (
                    <article key={rev.sha} className="revision-card">
                      <header
                        className="revision-card__head revision-card__head--clickable"
                        onClick={() => selectRevision(rev.sha, prevSha)}
                        title={isSelected ? t.diff.collapse : t.diff.expandDiff}
                      >
                        <div className="revision-card__title">
                          {t.diff.revisedBy(rev.author_login, formatRelativeTime(rev.committed_at, locale))}
                        </div>
                        <div className="revision-card__counts">
                          <span className="revision-card__sha">{rev.short_sha}</span>
                          {" · "}
                          <span className="revision-card__add">+{add}</span>
                          {" "}
                          <span className="revision-card__del">−{del}</span>
                        </div>
                        <div className="revision-card__chevron">
                          {isSelected ? "▲" : "▼"}
                        </div>
                      </header>
                      {isSelected && (
                        <div className="revision-card__diff">
                          {revDiffLoading && <p className="modal__muted">{t.diff.loadingDiff}</p>}
                          {revDiffError && <p className="modal__error">{revDiffError}</p>}
                          {!revDiffLoading && !revDiffError && (
                            <DiffTable
                              diff={revDiff.trim() || t.diff.noChangesInRevision}
                            />
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!revisionsLoading && revisions.length === 0 && !revisionsError && (
                  <p className="modal__muted">{t.diff.noRevisions}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Working tree tab */}
        {tab === "working" && (
          <div className="git-diff-panel__body">
            {workingError && <p className="modal__error">{workingError}</p>}
            {workingLoading ? (
              <p className="modal__muted">{t.diff.computingDiff}</p>
            ) : (
              <DiffTable
                diff={workingDiff.trim() ? workingDiff : t.diff.noChangesWorking}
              />
            )}
          </div>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t.diff.close}
          </button>
        </div>
      </div>
    </div>
  );
}
