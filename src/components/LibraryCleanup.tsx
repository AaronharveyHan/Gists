import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  aiComplete,
  findDuplicateGists,
  getEmbeddingStatus,
  startEmbeddingIndexer,
  listGistTagPairs,
  listTags,
  getGistTags,
  createTag,
  setGistTags,
  saveGistDraft,
} from "../api/tauri";
import type { Gist, SimilarPair } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import { notify } from "../store/useNotificationStore";

const TAG_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

const SENSITIVITY: Record<string, number> = { high: 0.92, medium: 0.86, low: 0.8 };

type RowStatus = "idle" | "running" | "done" | "error";

interface Props {
  onClose: () => void;
  onOpenGist: (id: string) => void;
}

function gistTitle(g: Gist | undefined): string {
  if (!g) return "(deleted)";
  return g.description.trim() || g.files[0]?.filename || "(untitled)";
}

/** Tolerantly pull a JSON object out of an AI reply (may be fenced/prefixed). */
function parseJsonObject(text: string): { description?: string; tags?: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}

export function LibraryCleanup({ onClose, onOpenGist }: Props) {
  const t = useT();
  const gists = useGistStore((s) => s.gists);
  const [tab, setTab] = useState<"duplicates" | "missing">("missing");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const byId = useMemo(() => {
    const m = new Map<string, Gist>();
    for (const g of gists) m.set(g.id, g);
    return m;
  }, [gists]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cleanup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cleanup__head">
          <span className="cleanup__title">{t.cleanup.title}</span>
          <div className="cleanup__tabs">
            <button
              className={`cleanup__tab${tab === "missing" ? " cleanup__tab--active" : ""}`}
              onClick={() => setTab("missing")}
            >
              {t.cleanup.tabMissing}
            </button>
            <button
              className={`cleanup__tab${tab === "duplicates" ? " cleanup__tab--active" : ""}`}
              onClick={() => setTab("duplicates")}
            >
              {t.cleanup.tabDuplicates}
            </button>
          </div>
          <button className="btn cleanup__close" onClick={onClose}>×</button>
        </div>

        {tab === "missing" ? (
          <MissingTab gists={gists} />
        ) : (
          <DuplicatesTab byId={byId} onOpenGist={onOpenGist} />
        )}
      </div>
    </div>
  );
}

// ── Missing metadata tab ────────────────────────────────────────────────────

function MissingTab({ gists }: { gists: Gist[] }) {
  const t = useT();
  const [hasTags, setHasTags] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const cancelRef = useRef(false);

  const loadTagPairs = useCallback(async () => {
    const pairs = await listGistTagPairs();
    setHasTags(new Set(pairs.map(([gistId]) => gistId)));
  }, []);

  useEffect(() => { void loadTagPairs(); }, [loadTagPairs]);

  const targets = useMemo(
    () =>
      gists.filter(
        (g) => !g.description.trim() || !hasTags.has(g.id)
      ),
    [gists, hasTags]
  );

  const organizeOne = useCallback(
    async (g: Gist) => {
      setStatus((s) => ({ ...s, [g.id]: "running" }));
      try {
        const ctx = buildGistContext(g);
        const reply = await aiComplete([
          {
            role: "system",
            content:
              "You organize a code snippet library. Reply with strict JSON only.",
          },
          {
            role: "user",
            content:
              `For the following gist produce a JSON object with "description" ` +
              `(one line, under 80 chars) and "tags" (3-5 short lowercase strings). ` +
              `Return ONLY the JSON object.\n\n${ctx}`,
          },
        ]);
        const parsed = parseJsonObject(reply);

        const files = g.files.map((f) => [f.filename, f.content] as [string, string]);
        // Only fill what's missing.
        if (!g.description.trim() && parsed.description) {
          await saveGistDraft(g.id, parsed.description.trim().slice(0, 120), files);
        }
        if (!hasTags.has(g.id) && Array.isArray(parsed.tags) && parsed.tags.length) {
          await applyTags(g.id, parsed.tags);
        }
        setStatus((s) => ({ ...s, [g.id]: "done" }));
      } catch (e) {
        setStatus((s) => ({ ...s, [g.id]: "error" }));
        notify(`${t.cleanup.failed}: ${String(e)}`);
      }
    },
    [hasTags, t]
  );

  const organizeAll = useCallback(async () => {
    setBatchRunning(true);
    cancelRef.current = false;
    const snapshot = [...targets];
    for (const g of snapshot) {
      if (cancelRef.current) break;
      await organizeOne(g);
      await new Promise((r) => setTimeout(r, 300)); // gentle on rate limits
    }
    await Promise.all([
      useGistStore.getState().loadGists(),
      loadTagPairs(),
    ]);
    setBatchRunning(false);
  }, [targets, organizeOne, loadTagPairs]);

  // Refresh the in-memory list after single-row edits when idle.
  const refreshAfterSingle = useCallback(async () => {
    await Promise.all([useGistStore.getState().loadGists(), loadTagPairs()]);
  }, [loadTagPairs]);

  if (targets.length === 0) {
    return <div className="cleanup__empty">{t.cleanup.allClean}</div>;
  }

  return (
    <>
      <div className="cleanup__bar">
        <span className="cleanup__hint">{t.cleanup.missingHint}</span>
        <button
          className="btn btn--primary"
          onClick={organizeAll}
          disabled={batchRunning}
        >
          {batchRunning ? t.cleanup.organizing : t.cleanup.organizeAll(targets.length)}
        </button>
      </div>
      <div className="cleanup__list">
        {targets.map((g) => {
          const st = status[g.id] ?? "idle";
          return (
            <div key={g.id} className="cleanup__row">
              <div className="cleanup__row-body">
                <div className="cleanup__row-title">{gistTitle(g)}</div>
                <div className="cleanup__badges">
                  {!g.description.trim() && (
                    <span className="cleanup__badge">{t.cleanup.missingDesc}</span>
                  )}
                  {!hasTags.has(g.id) && (
                    <span className="cleanup__badge">{t.cleanup.missingTags}</span>
                  )}
                </div>
              </div>
              <div className="cleanup__row-action">
                {st === "done" ? (
                  <span className="cleanup__ok">✓ {t.cleanup.organized}</span>
                ) : st === "error" ? (
                  <span className="cleanup__err">{t.cleanup.failed}</span>
                ) : (
                  <button
                    className="btn"
                    disabled={batchRunning || st === "running"}
                    onClick={async () => { await organizeOne(g); await refreshAfterSingle(); }}
                  >
                    {st === "running" ? t.cleanup.organizing : t.cleanup.organize}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Duplicates tab ──────────────────────────────────────────────────────────

function DuplicatesTab({
  byId,
  onOpenGist,
}: {
  byId: Map<string, Gist>;
  onOpenGist: (id: string) => void;
}) {
  const t = useT();
  const [indexed, setIndexed] = useState(0);
  const [total, setTotal] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [sensitivity, setSensitivity] = useState<keyof typeof SENSITIVITY>("medium");
  const [pairs, setPairs] = useState<SimilarPair[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getEmbeddingStatus();
      setIndexed(s.indexed);
      setTotal(s.total);
    } catch { /* AI not configured */ }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  // Listen to indexer progress while building.
  useEffect(() => {
    if (!indexing) return;
    let un: (() => void) | undefined;
    listen<{ indexed: number; total: number; running: boolean }>(
      "embedding-progress",
      (e) => {
        setIndexed(e.payload.indexed);
        if (!e.payload.running) {
          setIndexing(false);
          void refreshStatus();
        }
      }
    ).then((f) => { un = f; });
    return () => { un?.(); };
  }, [indexing, refreshStatus]);

  const buildIndex = async () => {
    setIndexing(true);
    try {
      await startEmbeddingIndexer();
    } catch (e) {
      setIndexing(false);
      notify(String(e));
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      setPairs(await findDuplicateGists(SENSITIVITY[sensitivity]));
    } catch (e) {
      notify(String(e));
    } finally {
      setScanning(false);
    }
  };

  const needsIndex = total > 0 && indexed < total;

  return (
    <>
      <div className="cleanup__bar">
        {(indexed < total || total === 0) && (
          <span className="cleanup__hint">
            {t.cleanup.indexBanner(indexed, total)}
          </span>
        )}
        {needsIndex && (
          <button className="btn" onClick={buildIndex} disabled={indexing}>
            {indexing ? `${t.cleanup.indexing} ${indexed}/${total}` : t.cleanup.buildIndex}
          </button>
        )}
        <label className="cleanup__sens">
          {t.cleanup.sensitivity}
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as keyof typeof SENSITIVITY)}
          >
            <option value="high">{t.cleanup.high}</option>
            <option value="medium">{t.cleanup.medium}</option>
            <option value="low">{t.cleanup.low}</option>
          </select>
        </label>
        <button
          className="btn btn--primary"
          onClick={scan}
          disabled={scanning || indexed === 0}
        >
          {scanning ? t.cleanup.searching : t.cleanup.findDuplicates}
        </button>
      </div>

      <div className="cleanup__list">
        {pairs === null ? (
          indexed === 0 && (
            <div className="cleanup__empty">{t.cleanup.noIndexHint}</div>
          )
        ) : pairs.length === 0 ? (
          <div className="cleanup__empty">{t.cleanup.noDuplicates}</div>
        ) : (
          pairs.map((p, i) => (
            <div key={i} className="cleanup__pair">
              <button className="cleanup__pair-side" onClick={() => onOpenGist(p.a)}>
                {gistTitle(byId.get(p.a))}
              </button>
              <span className="cleanup__pair-score">
                {t.cleanup.similar(Math.round(p.score * 100))}
              </span>
              <button className="cleanup__pair-side" onClick={() => onOpenGist(p.b)}>
                {gistTitle(byId.get(p.b))}
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildGistContext(g: Gist): string {
  const parts: string[] = [];
  if (g.description.trim()) parts.push(`Description: ${g.description}`);
  for (const f of g.files) {
    const body = f.content.length > 2500 ? f.content.slice(0, 2500) + "\n[…]" : f.content;
    parts.push(`File: ${f.filename}\n${body}`);
  }
  return parts.join("\n\n");
}

async function applyTags(gistId: string, names: string[]) {
  const [all, existing] = await Promise.all([listTags(), getGistTags(gistId)]);
  const ids = new Set(existing.map((tg) => tg.id));
  let colorIdx = all.length;
  for (const raw of names.slice(0, 6)) {
    const name = String(raw).trim().replace(/^#/, "").slice(0, 32);
    if (!name) continue;
    const found = all.find((tg) => tg.name.toLowerCase() === name.toLowerCase());
    if (found) {
      ids.add(found.id);
    } else {
      const nt = await createTag(name, TAG_PALETTE[colorIdx++ % TAG_PALETTE.length]);
      ids.add(nt.id);
    }
  }
  await setGistTags(gistId, [...ids]);
}
