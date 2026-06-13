import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { RevisionBrowser } from "./RevisionBrowser";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist, GistFile, GistRevisionView } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "main.ts", language: "typescript", content: "x", size: 1, raw_url: null, ...overrides };
}

function makeRev(overrides: Partial<GistRevisionView> = {}): GistRevisionView {
  return {
    sha: "aaaaaaaaaaaa",
    short_sha: "aaaaaaa",
    author_login: "alice",
    committed_at: "2024-01-01T00:00:00Z",
    files_changed: 1,
    additions: 3,
    deletions: 1,
    ...overrides,
  };
}

const DIFF = "--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n+hello-rev";
const WORKING = "--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n+working-change";

describe("RevisionBrowser", () => {
  let onRestore: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    onRestore = vi.fn();
    onClose = vi.fn();
    vi.mocked(api.getGistRevisions).mockResolvedValue([]);
    vi.mocked(api.computeGistDiff).mockResolvedValue("");
    vi.mocked(api.fetchRevDiff).mockResolvedValue(DIFF);
  });
  afterEach(() => cleanup());

  /** Render and flush the on-mount revisions + working-diff loads inside act. */
  async function renderBrowser(revs: GistRevisionView[] = []) {
    vi.mocked(api.getGistRevisions).mockResolvedValue(revs);
    render(
      <RevisionBrowser
        gistId="g1"
        currentFiles={[makeFile()]}
        onRestore={onRestore}
        onClose={onClose}
      />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("renders the history title", async () => {
    await renderBrowser();
    expect(screen.getByText("History")).toBeTruthy();
  });

  it("shows the empty message when there are no revisions", async () => {
    await renderBrowser([]);
    expect(screen.getByText("No revisions found.")).toBeTruthy();
  });

  it("lists revisions with sha, author and counts", async () => {
    await renderBrowser([makeRev()]);
    expect(screen.getByText("aaaaaaa")).toBeTruthy();
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
  });

  it("expands a revision to load and show its diff", async () => {
    await renderBrowser([makeRev()]);
    fireEvent.click(screen.getByText("aaaaaaa"));
    expect(await screen.findByText("hello-rev")).toBeTruthy();
    expect(api.fetchRevDiff).toHaveBeenCalledWith("g1", "aaaaaaaaaaaa", null);
  });

  it("passes the previous sha when expanding a non-oldest revision", async () => {
    await renderBrowser([
      makeRev({ sha: "new", short_sha: "newrev" }),
      makeRev({ sha: "old", short_sha: "oldrev" }),
    ]);
    fireEvent.click(screen.getByText("newrev"));
    await waitFor(() => expect(api.fetchRevDiff).toHaveBeenCalledWith("g1", "new", "old"));
  });

  it("collapses an expanded revision when clicked again", async () => {
    await renderBrowser([makeRev()]);
    const head = screen.getByText("aaaaaaa");
    fireEvent.click(head);
    expect(await screen.findByText("hello-rev")).toBeTruthy();
    fireEvent.click(head);
    await waitFor(() => expect(screen.queryByText("hello-rev")).toBeNull());
  });

  it("restores a revision via fetchGistAtRev → onRestore", async () => {
    const restored = {
      files: [makeFile({ filename: "main.ts", content: "restored" })],
      description: "old desc",
    } as Gist;
    vi.mocked(api.fetchGistAtRev).mockResolvedValue(restored);
    await renderBrowser([makeRev()]);
    fireEvent.click(screen.getByText("aaaaaaa"));
    fireEvent.click(await screen.findByText("Restore to this version"));
    await waitFor(() => expect(api.fetchGistAtRev).toHaveBeenCalledWith("g1", "aaaaaaaaaaaa"));
    expect(onRestore).toHaveBeenCalledWith(restored.files, "old desc");
  });

  it("shows the working-tree diff on the Working tree tab", async () => {
    vi.mocked(api.computeGistDiff).mockResolvedValue(WORKING);
    await renderBrowser([makeRev()]);
    fireEvent.click(screen.getByText("Working tree"));
    expect(await screen.findByText("working-change")).toBeTruthy();
    expect(api.computeGistDiff).toHaveBeenCalledWith("g1", [["main.ts", "x"]]);
  });

  it("Escape closes the panel", async () => {
    await renderBrowser();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
