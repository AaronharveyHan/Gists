/**
 * Diff modal: Revisions timeline (GitHub API) + Working-tree diff (SQLite snapshot).
 * No git CLI dependency — diffs computed by the `similar` Rust crate.
 */
import { useEffect, useRef, useState } from "react";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";

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

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || "—";
  const diffSec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  const a = Math.abs(diffSec);
  if (a < 60) return rtf.format(Math.round(diffSec), "second");
  if (a < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

function formatLastActive(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffSec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const a = Math.abs(diffSec);
  let rel: string;
  if (a < 60) rel = rtf.format(Math.round(diffSec), "second");
  else if (a < 3600) rel = rtf.format(Math.round(diffSec / 60), "minute");
  else if (a < 86400) rel = rtf.format(Math.round(diffSec / 3600), "hour");
  else if (a < 86400 * 30) rel = rtf.format(Math.round(diffSec / 86400), "day");
  else if (a < 86400 * 365) rel = rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  else rel = rtf.format(Math.round(diffSec / (86400 * 365)), "year");
  return `Last active ${rel}`;
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
  const trimmed = diff.trim();
  if (!trimmed) return <p className="modal__muted">(no changes)</p>;

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
                <th className="diff-table__col-old">Old</th>
                <th className="diff-table__col-new">New</th>
                <th className="diff-table__col-code">Change</th>
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

  const login = githubLogin ?? "…";
  const lastActive = gistUpdatedAt ? formatLastActive(gistUpdatedAt) : null;

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
          {(["revisions", "working"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`git-diff-panel__tab ${tab === t ? "git-diff-panel__tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "revisions" ? "Revisions" : "Working tree"}
            </button>
          ))}
        </div>

        {/* Revisions tab */}
        {tab === "revisions" && (
          <div className="git-diff-panel__body">
            {revisionsError && <p className="modal__error">{revisionsError}</p>}
            {revisionsLoading ? (
              <p className="modal__muted">加载修订历史…</p>
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
                        title={isSelected ? "收起" : "展开 diff"}
                      >
                        <div className="revision-card__title">
                          @{rev.author_login} revised this gist {formatRelativeTime(rev.committed_at)}
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
                          {revDiffLoading && <p className="modal__muted">加载 diff…</p>}
                          {revDiffError && <p className="modal__error">{revDiffError}</p>}
                          {!revDiffLoading && !revDiffError && (
                            <DiffTable
                              diff={revDiff.trim() || "(No changes in this revision.)"}
                            />
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!revisionsLoading && revisions.length === 0 && !revisionsError && (
                  <p className="modal__muted">暂无提交记录。</p>
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
              <p className="modal__muted">计算 diff…</p>
            ) : (
              <DiffTable
                diff={
                  workingDiff.trim()
                    ? workingDiff
                    : "(No changes — working tree matches remote snapshot.)"
                }
              />
            )}
          </div>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
