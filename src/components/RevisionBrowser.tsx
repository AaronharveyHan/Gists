/**
 * Revision Browser — slides in as a right-side panel inside the editor.
 * Shows the GitHub commit timeline for the open gist, lets the user
 * expand any revision to read its diff, and restore the editor to that state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";
import { DiffTable } from "./DiffTable";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRel(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso || "—";
  const s = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
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
  const t = useT();
  const locale = t.common.rtfLocale;
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
      notify(t.diff.restored(sha.slice(0, 7)), "success");
    } catch (e) {
      notify(t.diff.restoreFailed(String(e)));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <aside className="revision-browser">
      {/* Header */}
      <div className="revision-browser__head">
        <span className="revision-browser__title">{t.diff.historyTitle}</span>
        <button className="revision-browser__close" onClick={onClose} title={t.diff.closeEsc}>✕</button>
      </div>

      {/* Tabs */}
      <div className="revision-browser__tabs">
        {(["revisions", "working"] as const).map((tb) => (
          <button
            key={tb}
            className={`revision-browser__tab ${tab === tb ? "revision-browser__tab--active" : ""}`}
            onClick={() => setTab(tb)}
          >
            {tb === "revisions" ? t.diff.tabRevisions : t.diff.tabWorking}
            {tb === "revisions" && revisions.length > 0 && (
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
            {revLoading && <p className="revision-browser__msg">{t.diff.loadingHistory}</p>}
            {revError && <p className="revision-browser__err">{revError}</p>}
            {!revLoading && !revError && revisions.length === 0 && (
              <p className="revision-browser__msg">{t.diff.noRevisions}</p>
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
                        <span className="rev-item__time">{fmtRel(rev.committed_at, locale)}</span>
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
                          <p className="revision-browser__msg">{t.diff.loadingDiff}</p>
                        )}
                        {revDiffError && (
                          <p className="revision-browser__err">{revDiffError}</p>
                        )}
                        {!revDiffLoading && !revDiffError && (
                          <DiffTable diff={revDiff || t.diff.noChangesInRevision} />
                        )}
                        <div className="rev-item__restore-row">
                          <button
                            className="btn btn--primary rev-item__restore-btn"
                            onClick={() => void handleRestore(rev.sha)}
                            disabled={restoring !== null}
                          >
                            {restoring === rev.sha ? t.diff.restoring : t.diff.restoreToVersion}
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
            {workingLoading && <p className="revision-browser__msg">{t.diff.computingDiff}</p>}
            {workingError && <p className="revision-browser__err">{workingError}</p>}
            {!workingLoading && !workingError && (
              <DiffTable
                diff={workingDiff.trim() || t.diff.noChangesWorking}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
