/**
 * Diff modal: Revisions timeline (GitHub API) + Working-tree diff (SQLite snapshot).
 * No git CLI dependency — diffs computed by the `similar` Rust crate.
 */
import { useEffect, useRef, useState } from "react";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";
import { useT } from "../store/useI18nStore";
import { DiffTable } from "./DiffTable";

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
