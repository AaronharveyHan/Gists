import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  scoreGist,
  buildRows,
  RECENT_SHOWN,
  ALL_SHOWN,
  type DisplayRow,
} from "./commandPaletteRows";
import { translations } from "../i18n/translations";
import type { Gist, GistFile } from "../api/tauri";

// Pure-function tests — no DOM, no stores, no mocks.

const t = translations["en"];

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "file.ts", language: null, content: "", size: 0, raw_url: null, ...overrides };
}

function makeGist(overrides: Partial<Gist> & { id: string }): Gist {
  return {
    description: "",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [makeFile()],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

function mapOf(gists: Gist[]): Map<string, Gist> {
  return new Map(gists.map((g) => [g.id, g]));
}

/** Pull just the item rows out of a buildRows result. */
function items(rows: DisplayRow[]) {
  return rows.filter((r): r is Extract<DisplayRow, { kind: "item" }> => r.kind === "item");
}

function sections(rows: DisplayRow[]) {
  return rows.filter((r): r is Extract<DisplayRow, { kind: "section" }> => r.kind === "section");
}

// ── fuzzyScore ────────────────────────────────────────────────────────────────

describe("fuzzyScore", () => {
  it("returns 1 for an empty query (everything matches)", () => {
    expect(fuzzyScore("", "anything")).toBe(1);
  });

  it("returns 3 when the query is a prefix of the target", () => {
    expect(fuzzyScore("ap", "app.ts")).toBe(3);
  });

  it("returns 2 when the query is a substring but not a prefix", () => {
    expect(fuzzyScore("pp", "app.ts")).toBe(2);
  });

  it("returns 1 for an in-order subsequence that is not a substring", () => {
    expect(fuzzyScore("at", "app.ts")).toBe(1);
  });

  it("returns 0 when chars cannot be matched in order", () => {
    expect(fuzzyScore("ta", "app.ts")).toBe(0); // 't' appears after 'a' positions exhausted
    expect(fuzzyScore("xz", "app.ts")).toBe(0);
  });

  it("is case-insensitive for prefix and substring", () => {
    expect(fuzzyScore("APP", "app.ts")).toBe(3);
    expect(fuzzyScore("PP", "app.ts")).toBe(2);
  });
});

// ── scoreGist ─────────────────────────────────────────────────────────────────

describe("scoreGist", () => {
  it("returns 1 for an empty query", () => {
    expect(scoreGist("", makeGist({ id: "g" }))).toBe(1);
  });

  it("scores a filename match", () => {
    const g = makeGist({ id: "g", files: [makeFile({ filename: "server.py" })], description: "" });
    expect(scoreGist("server", g)).toBe(3); // prefix
  });

  it("scores a description match", () => {
    const g = makeGist({ id: "g", files: [makeFile({ filename: "x.txt" })], description: "deploy script" });
    expect(scoreGist("deploy", g)).toBe(3);
  });

  it("takes the max of filename and description scores", () => {
    // filename only a subsequence (1), description a prefix (3) → 3
    const g = makeGist({ id: "g", files: [makeFile({ filename: "dpy.txt" })], description: "deploy notes" });
    expect(scoreGist("deploy", g)).toBe(3);
  });

  it("takes the best score across multiple files", () => {
    const g = makeGist({
      id: "g",
      files: [makeFile({ filename: "readme.md" }), makeFile({ filename: "main.rs" })],
      description: "",
    });
    expect(scoreGist("main", g)).toBe(3);
  });

  it("returns 0 when nothing matches", () => {
    const g = makeGist({ id: "g", files: [makeFile({ filename: "a.txt" })], description: "hello" });
    expect(scoreGist("zzz", g)).toBe(0);
  });

  it("does not throw on a gist with no files and no description", () => {
    const g = makeGist({ id: "g", files: [], description: "" });
    expect(scoreGist("anything", g)).toBe(0);
  });
});

// ── buildRows: empty query ──────────────────────────────────────────────────

describe("buildRows (empty query / browse mode)", () => {
  it("returns no rows and zero items for an empty gist list", () => {
    const result = buildRows("", [], mapOf([]), [], t);
    expect(result.rows).toHaveLength(0);
    expect(result.totalItems).toBe(0);
  });

  it("shows only an 'All Gists' section when there are no recents", () => {
    const gists = [makeGist({ id: "a" }), makeGist({ id: "b" })];
    const { rows } = buildRows("", gists, mapOf(gists), [], t);
    const secs = sections(rows);
    expect(secs).toHaveLength(1);
    expect(secs[0].label).toBe(t.palette.sectionAllGists);
    expect(secs[0].count).toBe(2); // count is the full gist total
  });

  it("puts the Recent section first, then All Gists", () => {
    const gists = [makeGist({ id: "a" }), makeGist({ id: "b" }), makeGist({ id: "c" })];
    const { rows } = buildRows("", gists, mapOf(gists), ["b"], t);
    const secs = sections(rows);
    expect(secs.map((s) => s.label)).toEqual([t.palette.sectionRecent, t.palette.sectionAllGists]);
    // first row is the Recent section header
    expect(rows[0]).toMatchObject({ kind: "section", label: t.palette.sectionRecent });
  });

  it("does not duplicate a recent gist in the All Gists section", () => {
    const gists = [makeGist({ id: "a" }), makeGist({ id: "b" }), makeGist({ id: "c" })];
    const { rows } = buildRows("", gists, mapOf(gists), ["b"], t);
    const all = items(rows);
    const ids = all.map((r) => r.item.gist.id);
    expect(ids.filter((id) => id === "b")).toHaveLength(1); // appears once, in Recent only
    const recentItem = all.find((r) => r.item.gist.id === "b")!;
    expect(recentItem.item.isRecent).toBe(true);
  });

  it("caps the Recent section at RECENT_SHOWN items", () => {
    const gists = Array.from({ length: 12 }, (_, i) => makeGist({ id: `g${i}` }));
    const recentIds = gists.map((g) => g.id); // all 12 are recent
    const { rows } = buildRows("", gists, mapOf(gists), recentIds, t);
    const recentItems = items(rows).filter((r) => r.item.isRecent);
    expect(recentItems).toHaveLength(RECENT_SHOWN);
  });

  it("caps the All Gists section at ALL_SHOWN items", () => {
    const gists = Array.from({ length: ALL_SHOWN + 10 }, (_, i) =>
      makeGist({ id: `g${i}`, updated_at: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const { rows } = buildRows("", gists, mapOf(gists), [], t);
    expect(items(rows)).toHaveLength(ALL_SHOWN);
  });

  it("sorts the All Gists section by updated_at descending", () => {
    const gists = [
      makeGist({ id: "old", updated_at: "2023-01-01T00:00:00Z" }),
      makeGist({ id: "new", updated_at: "2024-06-01T00:00:00Z" }),
      makeGist({ id: "mid", updated_at: "2024-01-01T00:00:00Z" }),
    ];
    const { rows } = buildRows("", gists, mapOf(gists), [], t);
    expect(items(rows).map((r) => r.item.gist.id)).toEqual(["new", "mid", "old"]);
  });

  it("assigns contiguous flatIdx across both sections and reports totalItems", () => {
    const gists = [makeGist({ id: "a" }), makeGist({ id: "b" }), makeGist({ id: "c" })];
    const { rows, totalItems } = buildRows("", gists, mapOf(gists), ["a"], t);
    const all = items(rows);
    expect(all.map((r) => r.item.flatIdx)).toEqual([0, 1, 2]);
    expect(totalItems).toBe(3); // section headers excluded
  });

  it("falls back to 'Untitled' when a gist has no files", () => {
    const gists = [makeGist({ id: "a", files: [] })];
    const { rows } = buildRows("", gists, mapOf(gists), [], t);
    expect(items(rows)[0].item.primaryFile).toBe("Untitled");
  });
});

// ── buildRows: search query ─────────────────────────────────────────────────

describe("buildRows (search mode)", () => {
  it("filters out gists that do not match at all", () => {
    const gists = [
      makeGist({ id: "match", files: [makeFile({ filename: "server.py" })] }),
      makeGist({ id: "nomatch", files: [makeFile({ filename: "readme.md" })], description: "" }),
    ];
    const { rows, totalItems } = buildRows("server", gists, mapOf(gists), [], t);
    expect(totalItems).toBe(1);
    expect(items(rows)[0].item.gist.id).toBe("match");
  });

  it("emits no section headers in search mode", () => {
    const gists = [makeGist({ id: "a", files: [makeFile({ filename: "app.ts" })] })];
    const { rows } = buildRows("app", gists, mapOf(gists), [], t);
    expect(sections(rows)).toHaveLength(0);
  });

  it("ranks prefix > substring > subsequence", () => {
    const gists = [
      makeGist({ id: "sub", files: [makeFile({ filename: "xappy.ts" })] }),     // substring (2)
      makeGist({ id: "pre", files: [makeFile({ filename: "app.ts" })] }),       // prefix (3)
      makeGist({ id: "seq", files: [makeFile({ filename: "a_p_p.ts" })] }),     // subsequence (1)
    ];
    const { rows } = buildRows("app", gists, mapOf(gists), [], t);
    expect(items(rows).map((r) => r.item.gist.id)).toEqual(["pre", "sub", "seq"]);
  });

  it("gives recently-visited gists a +0.5 boost over equal-scored gists", () => {
    // Both are exact prefixes (base 3). g-newer is NOT recent but updated more
    // recently; g-recent IS recent. The boost must put g-recent first despite
    // the older timestamp.
    const gists = [
      makeGist({ id: "g-newer", files: [makeFile({ filename: "app.ts" })], updated_at: "2024-12-01T00:00:00Z" }),
      makeGist({ id: "g-recent", files: [makeFile({ filename: "app.ts" })], updated_at: "2020-01-01T00:00:00Z" }),
    ];
    const { rows } = buildRows("app", gists, mapOf(gists), ["g-recent"], t);
    expect(items(rows).map((r) => r.item.gist.id)).toEqual(["g-recent", "g-newer"]);
  });

  it("breaks score ties by updated_at descending", () => {
    const gists = [
      makeGist({ id: "older", files: [makeFile({ filename: "app.ts" })], updated_at: "2023-01-01T00:00:00Z" }),
      makeGist({ id: "newer", files: [makeFile({ filename: "app.ts" })], updated_at: "2024-01-01T00:00:00Z" }),
    ];
    const { rows } = buildRows("app", gists, mapOf(gists), [], t);
    expect(items(rows).map((r) => r.item.gist.id)).toEqual(["newer", "older"]);
  });

  it("caps search results at ALL_SHOWN", () => {
    const gists = Array.from({ length: ALL_SHOWN + 5 }, (_, i) =>
      makeGist({ id: `g${i}`, files: [makeFile({ filename: "app.ts" })] })
    );
    const { rows, totalItems } = buildRows("app", gists, mapOf(gists), [], t);
    expect(totalItems).toBe(ALL_SHOWN);
    expect(items(rows)).toHaveLength(ALL_SHOWN);
  });

  it("sets isRecent on matching results that are in the recent set", () => {
    const gists = [
      makeGist({ id: "r", files: [makeFile({ filename: "app.ts" })] }),
      makeGist({ id: "n", files: [makeFile({ filename: "app.js" })] }),
    ];
    const { rows } = buildRows("app", gists, mapOf(gists), ["r"], t);
    const byId = Object.fromEntries(items(rows).map((r) => [r.item.gist.id, r.item.isRecent]));
    expect(byId["r"]).toBe(true);
    expect(byId["n"]).toBe(false);
  });

  it("assigns contiguous flatIdx to search results", () => {
    const gists = [
      makeGist({ id: "a", files: [makeFile({ filename: "app1.ts" })] }),
      makeGist({ id: "b", files: [makeFile({ filename: "app2.ts" })] }),
    ];
    const { rows } = buildRows("app", gists, mapOf(gists), [], t);
    expect(items(rows).map((r) => r.item.flatIdx)).toEqual([0, 1]);
  });
});
