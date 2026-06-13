import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  isMarkdownFilename,
  cloneFiles,
  nextUntitledName,
  emptyFile,
  reorderFiles,
  closeOthers,
  closeToRight,
  buildFileMap,
  mergeOutcomeToFiles,
  filesWithConflictMarkers,
  hasConflictMarkers,
  isRenameCollision,
  CONFLICT_MARKER,
} from "./editorFiles";
import type { GistFile, MergedFile } from "../api/tauri";

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "file.ts", language: null, content: "", size: 0, raw_url: null, ...overrides };
}

function names(files: GistFile[]): string[] {
  return files.map((f) => f.filename);
}

// ── detectLanguage ──────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("maps known extensions to Monaco language ids", () => {
    expect(detectLanguage("a.ts")).toBe("typescript");
    expect(detectLanguage("a.tsx")).toBe("typescript");
    expect(detectLanguage("a.py")).toBe("python");
    expect(detectLanguage("a.rs")).toBe("rust");
    expect(detectLanguage("a.md")).toBe("markdown");
    expect(detectLanguage("a.yml")).toBe("yaml");
  });

  it("is case-insensitive on the extension", () => {
    expect(detectLanguage("README.MD")).toBe("markdown");
    expect(detectLanguage("Main.TS")).toBe("typescript");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(detectLanguage("a.unknownext")).toBe("plaintext");
    expect(detectLanguage("Dockerfile")).toBe("plaintext");
    expect(detectLanguage("")).toBe("plaintext");
  });

  it("uses the last segment for multi-dot filenames", () => {
    expect(detectLanguage("component.test.ts")).toBe("typescript");
    expect(detectLanguage("archive.tar.gz")).toBe("plaintext");
  });
});

// ── isMarkdownFilename ──────────────────────────────────────────────────────

describe("isMarkdownFilename", () => {
  it("is true only for .md files", () => {
    expect(isMarkdownFilename("notes.md")).toBe(true);
    expect(isMarkdownFilename("NOTES.MD")).toBe(true);
    expect(isMarkdownFilename("notes.markdown")).toBe(false);
    expect(isMarkdownFilename("notes.txt")).toBe(false);
  });

  it("is null-safe", () => {
    expect(isMarkdownFilename(null)).toBe(false);
  });
});

// ── cloneFiles ──────────────────────────────────────────────────────────────

describe("cloneFiles", () => {
  it("returns new object references (no shared mutation)", () => {
    const src = [makeFile({ filename: "a.ts", content: "x" })];
    const out = cloneFiles(src);
    expect(out).toEqual(src);
    expect(out[0]).not.toBe(src[0]);
    out[0].content = "mutated";
    expect(src[0].content).toBe("x");
  });
});

// ── nextUntitledName ────────────────────────────────────────────────────────

describe("nextUntitledName", () => {
  it("returns the base when nothing is taken", () => {
    expect(nextUntitledName([])).toBe("untitled");
    expect(nextUntitledName(["a.ts", "b.ts"])).toBe("untitled");
  });

  it("appends _1, _2, … skipping taken names", () => {
    expect(nextUntitledName(["untitled"])).toBe("untitled_1");
    expect(nextUntitledName(["untitled", "untitled_1"])).toBe("untitled_2");
    expect(nextUntitledName(["untitled", "untitled_2"])).toBe("untitled_1");
  });

  it("honors a custom base", () => {
    expect(nextUntitledName(["snippet"], "snippet")).toBe("snippet_1");
  });
});

// ── emptyFile ───────────────────────────────────────────────────────────────

describe("emptyFile", () => {
  it("builds a blank, never-pushed file", () => {
    expect(emptyFile("new.ts")).toEqual({
      filename: "new.ts",
      language: null,
      content: "",
      size: 0,
      raw_url: null,
    });
  });
});

// ── reorderFiles ────────────────────────────────────────────────────────────

describe("reorderFiles", () => {
  const files = [
    makeFile({ filename: "a" }),
    makeFile({ filename: "b" }),
    makeFile({ filename: "c" }),
  ];

  it("moves a file forward to the target's position", () => {
    expect(names(reorderFiles(files, "a", "c"))).toEqual(["b", "c", "a"]);
  });

  it("moves a file backward to the target's position", () => {
    expect(names(reorderFiles(files, "c", "a"))).toEqual(["c", "a", "b"]);
  });

  it("returns the same reference when from === to", () => {
    expect(reorderFiles(files, "b", "b")).toBe(files);
  });

  it("returns the same reference when a name is missing", () => {
    expect(reorderFiles(files, "a", "zzz")).toBe(files);
    expect(reorderFiles(files, "zzz", "a")).toBe(files);
  });

  it("does not mutate the input array", () => {
    const before = names(files);
    reorderFiles(files, "a", "c");
    expect(names(files)).toEqual(before);
  });
});

// ── closeOthers ─────────────────────────────────────────────────────────────

describe("closeOthers", () => {
  const files = [
    makeFile({ filename: "a" }),
    makeFile({ filename: "b" }),
    makeFile({ filename: "c" }),
  ];

  it("keeps only the target and reports the rest as removed", () => {
    const { keep, removed } = closeOthers(files, "b");
    expect(names(keep)).toEqual(["b"]);
    expect(removed.sort()).toEqual(["a", "c"]);
  });

  it("no-ops for a single-file list", () => {
    const single = [makeFile({ filename: "only" })];
    const { keep, removed } = closeOthers(single, "only");
    expect(keep).toBe(single);
    expect(removed).toEqual([]);
  });

  it("no-ops when the target is missing", () => {
    const { keep, removed } = closeOthers(files, "zzz");
    expect(keep).toBe(files);
    expect(removed).toEqual([]);
  });
});

// ── closeToRight ────────────────────────────────────────────────────────────

describe("closeToRight", () => {
  const files = [
    makeFile({ filename: "a" }),
    makeFile({ filename: "b" }),
    makeFile({ filename: "c" }),
    makeFile({ filename: "d" }),
  ];

  it("keeps the prefix up to and including the target", () => {
    const { keep, removed } = closeToRight(files, "b");
    expect(names(keep)).toEqual(["a", "b"]);
    expect(removed).toEqual(["c", "d"]);
  });

  it("no-ops when the target is the last file", () => {
    const { keep, removed } = closeToRight(files, "d");
    expect(keep).toBe(files);
    expect(removed).toEqual([]);
  });

  it("no-ops when the target is missing", () => {
    const { keep, removed } = closeToRight(files, "zzz");
    expect(keep).toBe(files);
    expect(removed).toEqual([]);
  });
});

// ── buildFileMap ────────────────────────────────────────────────────────────

describe("buildFileMap", () => {
  it("maps each current file to [content, null]", () => {
    const files = [
      makeFile({ filename: "a.ts", content: "AAA" }),
      makeFile({ filename: "b.ts", content: "BBB" }),
    ];
    expect(buildFileMap(files, [])).toEqual({
      "a.ts": ["AAA", null],
      "b.ts": ["BBB", null],
    });
  });

  it("maps tracked deletions (absent from current files) to null", () => {
    const files = [makeFile({ filename: "a.ts", content: "AAA" })];
    expect(buildFileMap(files, ["old.ts"])).toEqual({
      "a.ts": ["AAA", null],
      "old.ts": null,
    });
  });

  it("does not emit a deletion for a name still present (e.g. rename re-add)", () => {
    const files = [makeFile({ filename: "a.ts", content: "AAA" })];
    // "a.ts" was marked deleted but is back in the list → must not be nulled.
    expect(buildFileMap(files, ["a.ts"])).toEqual({
      "a.ts": ["AAA", null],
    });
  });

  it("accepts a Set as the deletions iterable", () => {
    const files = [makeFile({ filename: "a.ts", content: "AAA" })];
    expect(buildFileMap(files, new Set(["gone.ts"]))).toEqual({
      "a.ts": ["AAA", null],
      "gone.ts": null,
    });
  });
});

// ── mergeOutcomeToFiles ─────────────────────────────────────────────────────

describe("mergeOutcomeToFiles", () => {
  const outcome: MergedFile[] = [
    { filename: "a.ts", content: "merged-a", had_conflict: false },
    { filename: "b.ts", content: "merged-b", had_conflict: true },
  ];
  const remote = [
    makeFile({ filename: "a.ts", language: "typescript" }),
    makeFile({ filename: "b.ts", language: "typescript" }),
  ];

  it("carries language from the matching remote file and recomputes size", () => {
    const out = mergeOutcomeToFiles(outcome, remote);
    expect(out).toEqual([
      { filename: "a.ts", language: "typescript", content: "merged-a", size: 8, raw_url: null },
      { filename: "b.ts", language: "typescript", content: "merged-b", size: 8, raw_url: null },
    ]);
  });

  it("uses null language when no remote file matches", () => {
    const out = mergeOutcomeToFiles(
      [{ filename: "new.ts", content: "x", had_conflict: false }],
      remote,
    );
    expect(out[0].language).toBeNull();
    expect(out[0].size).toBe(1);
    expect(out[0].raw_url).toBeNull();
  });
});

// ── conflict markers ────────────────────────────────────────────────────────

describe("conflict markers", () => {
  const files = [
    makeFile({ filename: "clean.ts", content: "all good" }),
    makeFile({ filename: "bad.ts", content: `top\n${CONFLICT_MARKER} HEAD\nx` }),
  ];

  it("filesWithConflictMarkers lists only files containing the marker", () => {
    expect(filesWithConflictMarkers(files)).toEqual(["bad.ts"]);
  });

  it("hasConflictMarkers reflects presence of any marker", () => {
    expect(hasConflictMarkers(files)).toBe(true);
    expect(hasConflictMarkers([makeFile({ content: "clean" })])).toBe(false);
  });

  it("treats fully-resolved content as marker-free", () => {
    const resolved = [makeFile({ filename: "bad.ts", content: "resolved" })];
    expect(filesWithConflictMarkers(resolved)).toEqual([]);
    expect(hasConflictMarkers(resolved)).toBe(false);
  });
});

// ── isRenameCollision ───────────────────────────────────────────────────────

describe("isRenameCollision", () => {
  const files = [makeFile({ filename: "a.ts" }), makeFile({ filename: "b.ts" })];

  it("is true when the new name belongs to a different file", () => {
    expect(isRenameCollision(files, "a.ts", "b.ts")).toBe(true);
  });

  it("is false when renaming to a brand-new name", () => {
    expect(isRenameCollision(files, "a.ts", "c.ts")).toBe(false);
  });

  it("is false for a no-op rename to the same name", () => {
    expect(isRenameCollision(files, "a.ts", "a.ts")).toBe(false);
  });
});
