import { describe, it, expect } from "vitest";
import { parseUnifiedDiff, lineClass, type ParsedDiffFile } from "./DiffTable";

function only(files: ParsedDiffFile[]): ParsedDiffFile {
  expect(files).toHaveLength(1);
  return files[0];
}

describe("parseUnifiedDiff", () => {
  it("returns [] for an empty string", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("returns [] when there is no '--- ' file header", () => {
    // DiffTable renders such input as a raw <pre>; the parser yields nothing.
    expect(parseUnifiedDiff("just some text\nwith no header")).toEqual([]);
  });

  it("extracts the path from the '+++ b/…' header and consumes both lines", () => {
    const f = only(parseUnifiedDiff("--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-a\n+b"));
    expect(f.path).toBe("foo.ts");
    // The +++ line must not appear as a content row.
    expect(f.lines.some((l) => l.text.startsWith("+++"))).toBe(false);
  });

  it("handles a deleted file ('+++ /dev/null'), taking the path from '--- a/'", () => {
    const f = only(parseUnifiedDiff("--- a/gone.ts\n+++ /dev/null\n@@ -1 +0 @@\n-x"));
    expect(f.path).toBe("gone.ts");
  });

  it("falls back to the '--- ' line path when no '+++' header follows", () => {
    const f = only(parseUnifiedDiff("--- a/solo.ts\n context-line"));
    expect(f.path).toBe("solo.ts");
    // The following line is parsed as content of that file.
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0].kind).toBe("context");
  });

  it("skips lines that appear before any file header", () => {
    const f = only(parseUnifiedDiff("preamble noise\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+added"));
    expect(f.path).toBe("x.ts");
    expect(f.lines.map((l) => l.kind)).toEqual(["hunk", "add"]);
  });

  it("classifies hunk / add / remove / context / meta lines", () => {
    const diff = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");
    const f = only(parseUnifiedDiff(diff));
    expect(f.lines.map((l) => l.kind)).toEqual(["hunk", "context", "remove", "add", "meta"]);
    // add/remove/context strip the leading marker; meta keeps the whole raw line.
    expect(f.lines[1].text).toBe("keep");
    expect(f.lines[2].text).toBe("old");
    expect(f.lines[3].text).toBe("new");
    expect(f.lines[4].text).toBe("\\ No newline at end of file");
  });

  it("assigns line numbers from the hunk header", () => {
    const diff = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-line2old",
      "+line2new",
      "+line3added",
      " line4",
    ].join("\n");
    const f = only(parseUnifiedDiff(diff));
    const body = f.lines.filter((l) => l.kind !== "hunk");
    expect(body.map((l) => [l.kind, l.oldNum, l.newNum])).toEqual([
      ["context", 1, 1],
      ["remove", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
  });

  it("resets line numbers at each new hunk header", () => {
    const diff = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "@@ -10,1 +20,1 @@",
      "-c",
      "+d",
    ].join("\n");
    const f = only(parseUnifiedDiff(diff));
    const removes = f.lines.filter((l) => l.kind === "remove");
    const adds = f.lines.filter((l) => l.kind === "add");
    expect(removes.map((l) => l.oldNum)).toEqual([1, 10]);
    expect(adds.map((l) => l.newNum)).toEqual([1, 20]);
  });

  it("parses multiple files in one diff", () => {
    const diff = [
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@",
      "+1",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1 @@",
      "+2",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.path)).toEqual(["one.ts", "two.ts"]);
    expect(files[1].lines.find((l) => l.kind === "add")?.text).toBe("2");
  });

  it("handles CRLF line endings", () => {
    const f = only(parseUnifiedDiff("--- a/x.ts\r\n+++ b/x.ts\r\n@@ -1 +1 @@\r\n-a\r\n+b"));
    expect(f.path).toBe("x.ts");
    expect(f.lines.map((l) => l.kind)).toEqual(["hunk", "remove", "add"]);
  });
});

describe("lineClass", () => {
  it("maps each diff line kind to its CSS class", () => {
    expect(lineClass("add")).toBe("diff-line diff-line--add");
    expect(lineClass("remove")).toBe("diff-line diff-line--remove");
    expect(lineClass("context")).toBe("diff-line diff-line--ctx");
    expect(lineClass("hunk")).toBe("diff-line diff-line--hunk");
    expect(lineClass("meta")).toBe("diff-line diff-line--meta");
  });
});
