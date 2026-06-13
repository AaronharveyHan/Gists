import { describe, it, expect } from "vitest";
import { sortGists } from "./SidebarGistList";
import type { Gist, GistFile } from "../api/tauri";

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "file.ts", language: null, content: "", size: 0, raw_url: null, ...overrides };
}

function g(overrides: Partial<Gist> & { id: string }): Gist {
  return {
    description: "",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

describe("sortGists", () => {
  it("pinned gists sort before unpinned", () => {
    const gists = [
      g({ id: "a", updated_at: "2024-01-01T00:00:00Z" }),
      g({ id: "b", updated_at: "2024-01-02T00:00:00Z", pinned: true }),
    ];
    const result = sortGists(gists, "updated");
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("does not mutate the input array", () => {
    const input = [g({ id: "a" }), g({ id: "b" })];
    const before = [...input];
    sortGists(input, "updated");
    expect(input).toEqual(before);
  });

  it("sorts by updated_at descending", () => {
    const gists = [
      g({ id: "old", updated_at: "2023-01-01T00:00:00Z" }),
      g({ id: "new", updated_at: "2024-06-01T00:00:00Z" }),
    ];
    const result = sortGists(gists, "updated");
    expect(result[0].id).toBe("new");
    expect(result[1].id).toBe("old");
  });

  it("sorts by created_at descending", () => {
    const gists = [
      g({ id: "first", created_at: "2022-01-01T00:00:00Z" }),
      g({ id: "second", created_at: "2023-01-01T00:00:00Z" }),
    ];
    const result = sortGists(gists, "created");
    expect(result[0].id).toBe("second");
    expect(result[1].id).toBe("first");
  });

  it("sorts by filename ascending", () => {
    const gists = [
      g({ id: "z", files: [makeFile({ filename: "z.ts" })] }),
      g({ id: "a", files: [makeFile({ filename: "a.ts" })] }),
    ];
    const result = sortGists(gists, "name");
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("z");
  });

  it("sorts by file count descending", () => {
    const file = makeFile();
    const gists = [
      g({ id: "one",   files: [file] }),
      g({ id: "three", files: [file, file, file] }),
      g({ id: "two",   files: [file, file] }),
    ];
    const result = sortGists(gists, "files");
    expect(result.map((x) => x.id)).toEqual(["three", "two", "one"]);
  });

  it("pinned gists stay at top regardless of sort order", () => {
    const file = makeFile();
    const gists = [
      g({ id: "unpinned-many", files: [file, file, file] }),
      g({ id: "pinned-one",    files: [file], pinned: true }),
    ];
    const result = sortGists(gists, "files");
    expect(result[0].id).toBe("pinned-one");
  });
});
