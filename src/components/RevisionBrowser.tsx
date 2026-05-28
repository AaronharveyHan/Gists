/**
 * Revision Browser — slides in as a right-side panel inside the editor.
 * Shows the GitHub commit timeline for the open gist, lets the user
 * expand any revision to read its diff, and restore the editor to that state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";
import { notify } from "../store/useNotificationStore";

// ── Diff parser (mirrors DiffModal) ──────────────────────────────────────────

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
    if (raw.startsWith("--- ")) {
      const next = rawLines[i + 1] ?? "";
      let path: string;
      if (next.startsWith("+++ b/")) {
        path = next.slice("+++ b/".length);
        i += 2;
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
    if (raw.startsWith("+++ ")) { i++; continue; }
    if (raw.startsWith("@@")) {
      file.lines.push({ oldNum: null, newNum: null, kind: "hunk", text: raw });
      i++; continue;
    }
    const c = raw[0] ?? " ";
    const rest = raw.slice(1);
    if (c === "+") file.lines.push({ oldNum: null, newNum: 0, kind: "add", text: rest });
    else if (c === "-") file.lines.push({ oldNum: 0, newNum: null, kind: "remove", text: rest });
    else if (c === " ") file.lines.push({ oldNum: 0, newNum: 0, kind: "context", text: rest });
    else file.lines.push({ oldNum: null, newNum: null, kind: "meta", text: raw });
    i++;
  }
  for (const f of files) {
    let oldLine = 0, newLine = 0;
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

function lineClass(kind: DiffLineKind) {
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
  if (files.length === 0) return <pre className="git-diff-pre git-diff-pre--raw">{diff}</pre>;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || "—";
  const s = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(Math.round(s), "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

// ── Main component ────────────────────────────────────────────────────────────

export interface RevisionBrowserProps {
  gistId: string;
  currentFiles: GistFile[];
  onRestore: (files: GistFile[], description: string) => void;
  onClose: () => void;
}

export function RevisionBrowser({
  gistId, currentFiles, onRestore, onClose,
}: RevisionBrowserProps) {
  const [tab, setTab] = useState<"revisions" | "working">("revisions");

  const [revisions, setRevisions] = useState<GistRevisionView[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState<string | null>(null);

  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const diffCache = useRef<Record<string, string>>({});
  const [revDiff, setRevDiff] = useState("");
  const [revDiffLoading, setRevDiffLoading] = useState(false);
  const [revDiffError, setRevDiffError] = useState<string | null>(null);

  const [workingDiff, setWorkingDiff] = useState("");
  const [workingLoading, setWorkingLoading] = useState(false);
  const [workingError, setWorkingError] = useState<string | null>(null);

  const [restoring, setRestoring] = useState<string | null>(null);

  // Escape closes the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Load revision list + working-tree diff on mount / gistId change
  useEffect(() => {
    setRevisions([]);
    setRevError(null);
    setSelectedSha(null);
    setRevDiff("");
    diffCache.current = {};

    setRevLoading(true);
    void api.getGistRevisions(gistId)
      .then(setRevisions)
      .catch((e) => setRevError(String(e)))
      .finally(() => setRevLoading(false));

    setWorkingLoading(true);
    setWorkingError(null);
    const pairs: [string, string][] = currentFiles.map((f) => [f.filename, f.content]);
    void api.computeGistDiff(gistId, pairs)
      .then(setWorkingDiff)
      .catch((e) => setWorkingError(String(e)))
      .finally(() => setWorkingLoading(false));
  }, [gistId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRevision = useCallback(
    (sha: string, prevSha: string | null) => {
      if (selectedSha === sha) { setSelectedSha(null); return; }
      setSelectedSha(sha);
      const cached = diffCache.current[sha];
      if (cached !== undefined) { setRevDiff(cached); setRevDiffError(null); return; }
      setRevDiffLoading(true);
      setRevDiffError(null);
      setRevDiff("");
      void api.fetchRevDiff(gistId, sha, prevSha)
        .then((d) => { diffCache.current[sha] = d; setRevDiff(d); })
        .catch((e) => setRevDiffError(String(e)))
        .finally(() => setRevDiffLoading(false));
    },
    [gistId, selectedSha]
  );

  const handleRestore = async (sha: string) => {
    setRestoring(sha);
    try {
      const gist = await api.fetchGistAtRev(gistId, sha);
      onRestore(gist.files, gist.description);
      notify(`Restored to ${sha.slice(0, 7)}`, "success");
    } catch (e) {
      notify("Restore failed: " + String(e));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <aside className="revision-browser">
      {/* Header */}
      <div className="revision-browser__head">
        <span className="revision-browser__title">History</span>
        <button className="revision-browser__close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>

      {/* Tabs */}
      <div className="revision-browser__tabs">
        {(["revisions", "working"] as const).map((t) => (
          <button
            key={t}
            className={`revision-browser__tab ${tab === t ? "revision-browser__tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "revisions" ? "Revisions" : "Working tree"}
            {t === "revisions" && revisions.length > 0 && (
              <span className="revision-browser__tab-count">{revisions.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="revision-browser__body">

        {/* ── Revisions tab ────────────────────────────────────────── */}
        {tab === "revisions" && (
          <>
            {revLoading && <p className="revision-browser__msg">Loading history…</p>}
            {revError && <p className="revision-browser__err">{revError}</p>}
            {!revLoading && !revError && revisions.length === 0 && (
              <p className="revision-browser__msg">No revisions found.</p>
            )}
            <div className="rev-list">
              {revisions.map((rev, idx) => {
                const prevSha = revisions[idx + 1]?.sha ?? null;
                const isOpen = selectedSha === rev.sha;
                return (
                  <div key={rev.sha} className={`rev-item ${isOpen ? "rev-item--open" : ""}`}>
                    <button
                      className="rev-item__head"
                      onClick={() => selectRevision(rev.sha, prevSha)}
                    >
                      <div className="rev-item__row1">
                        <span className="rev-item__sha">{rev.short_sha}</span>
                        <span className="rev-item__time">{fmtRel(rev.committed_at)}</span>
                      </div>
                      <div className="rev-item__row2">
                        <span className="rev-item__author">@{rev.author_login}</span>
                        <span className="rev-item__stats">
                          <span className="rev-item__add">+{rev.additions}</span>
                          {" "}
                          <span className="rev-item__del">−{rev.deletions}</span>
                          {rev.files_changed > 0 && (
                            <span className="rev-item__files">
                              {" · "}{rev.files_changed} file{rev.files_changed !== 1 ? "s" : ""}
                            </span>
                          )}
                        </span>
                        <span className="rev-item__chevron">{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="rev-item__diff">
                        {revDiffLoading && (
                          <p className="revision-browser__msg">Loading diff…</p>
                        )}
                        {revDiffError && (
                          <p className="revision-browser__err">{revDiffError}</p>
                        )}
                        {!revDiffLoading && !revDiffError && (
                          <DiffTable diff={revDiff || "(no changes in this revision)"} />
                        )}
                        <div className="rev-item__restore-row">
                          <button
                            className="btn btn--primary rev-item__restore-btn"
                            onClick={() => void handleRestore(rev.sha)}
                            disabled={restoring !== null}
                          >
                            {restoring === rev.sha ? "Restoring…" : "Restore to this version"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Working tree tab ─────────────────────────────────────── */}
        {tab === "working" && (
          <>
            {workingLoading && <p className="revision-browser__msg">Computing diff…</p>}
            {workingError && <p className="revision-browser__err">{workingError}</p>}
            {!workingLoading && !workingError && (
              <DiffTable
                diff={workingDiff.trim() || "(No changes — working tree matches remote snapshot.)"}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
