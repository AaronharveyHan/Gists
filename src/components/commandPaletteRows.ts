/**
 * Pure ranking / row-building logic for the CommandPalette.
 *
 * Extracted from CommandPalette.tsx so the fuzzy-scoring and the
 * recent-vs-all section layout can be unit-tested without rendering the
 * modal (which requires the gist + recent stores and DOM focus effects).
 *
 * None of these functions touch React, the stores, or the DOM.
 */
import type { Gist } from "../api/tauri";
import type { Translations } from "../i18n/translations";

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Fuzzy score for a single string:
 *   3 → query is a prefix of target   (substring + startsWith bonus)
 *   2 → query is a substring          (anywhere in target)
 *   1 → query chars appear as an in-order subsequence, OR query is empty
 *   0 → no subsequence match
 * All comparisons are case-insensitive.
 */
export function fuzzyScore(query: string, target: string): number {
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

/** Best score across a gist's filenames and its description. */
export function scoreGist(query: string, gist: Gist): number {
  if (!query) return 1;
  const fileScore = Math.max(0, ...gist.files.map((f) => fuzzyScore(query, f.filename)));
  const descScore = gist.description ? fuzzyScore(query, gist.description) : 0;
  return Math.max(fileScore, descScore);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaletteItem {
  gist: Gist;
  primaryFile: string;
  isRecent: boolean;
  /** flat selectable index (excludes section headers) */
  flatIdx: number;
}

export type DisplayRow =
  | { kind: "section"; label: string; count?: number }
  | { kind: "item"; item: PaletteItem };

// ── Row builder ─────────────────────────────────────────────────────────────

export const RECENT_SHOWN = 8;
export const ALL_SHOWN = 50;

export function buildRows(
  query: string,
  gists: Gist[],
  gistMap: Map<string, Gist>,
  recentIds: string[],
  t: Translations,
): { rows: DisplayRow[]; totalItems: number } {
  const recentSet = new Set(recentIds);
  let flatIdx = 0;
  const rows: DisplayRow[] = [];

  if (!query) {
    // ── Empty state: Recent section + All Gists section ──────────────────
    const recentGists = recentIds
      .slice(0, RECENT_SHOWN)
      .map((id) => gistMap.get(id))
      .filter((g): g is Gist => !!g);

    if (recentGists.length > 0) {
      rows.push({ kind: "section", label: t.palette.sectionRecent });
      for (const g of recentGists) {
        rows.push({
          kind: "item",
          item: {
            gist: g,
            primaryFile: g.files[0]?.filename ?? "Untitled",
            isRecent: true,
            flatIdx: flatIdx++,
          },
        });
      }
    }

    const recentShownIds = new Set(recentGists.map((g) => g.id));
    const rest = gists
      .filter((g) => !recentShownIds.has(g.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, ALL_SHOWN);

    if (rest.length > 0) {
      rows.push({ kind: "section", label: t.palette.sectionAllGists, count: gists.length });
      for (const g of rest) {
        rows.push({
          kind: "item",
          item: {
            gist: g,
            primaryFile: g.files[0]?.filename ?? "Untitled",
            isRecent: false,
            flatIdx: flatIdx++,
          },
        });
      }
    }
  } else {
    // ── Search: fuzzy rank, recently-visited items get +0.5 boost ────────
    const scored = gists
      .map((g) => {
        const base = scoreGist(query, g);
        if (base === 0) return null;
        return {
          gist: g,
          score: base + (recentSet.has(g.id) ? 0.5 : 0),
          isRecent: recentSet.has(g.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.gist.updated_at.localeCompare(a.gist.updated_at);
      })
      .slice(0, ALL_SHOWN);

    for (const s of scored) {
      rows.push({
        kind: "item",
        item: {
          gist: s.gist,
          primaryFile: s.gist.files[0]?.filename ?? "Untitled",
          isRecent: s.isRecent,
          flatIdx: flatIdx++,
        },
      });
    }
  }

  return { rows, totalItems: flatIdx };
}
