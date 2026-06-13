import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { DiffModal } from "./DiffModal";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { GistFile, GistRevisionView } from "../api/tauri";

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
    additions: 2,
    deletions: 0,
    ...overrides,
  };
}

const REV_DIFF = "--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n+rev-line";
const WORKING = "--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n+working-line";

describe("DiffModal", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    onClose = vi.fn();
    vi.mocked(api.getGistRevisions).mockResolvedValue([]);
    vi.mocked(api.computeGistDiff).mockResolvedValue("");
    vi.mocked(api.fetchRevDiff).mockResolvedValue(REV_DIFF);
  });
  afterEach(() => cleanup());

  /** Render and flush the on-open revisions + working-diff loads inside act. */
  async function renderModal(
    props: Partial<React.ComponentProps<typeof DiffModal>> = {},
    revs: GistRevisionView[] = [],
  ) {
    vi.mocked(api.getGistRevisions).mockResolvedValue(revs);
    const result = render(
      <DiffModal
        open
        onClose={onClose}
        gistId="g1"
        githubLogin="alice"
        gistUpdatedAt="2024-01-01T00:00:00Z"
        primaryFilename="main.ts"
        currentFiles={[makeFile()]}
        {...props}
      />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return result;
  }

  it("renders nothing when closed", async () => {
    const { container } = await renderModal({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders the gist header with login and primary filename", async () => {
    await renderModal();
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText("alice/main.ts")).toBeTruthy();
  });

  it("lists revisions with the revised-by line", async () => {
    await renderModal({}, [makeRev()]);
    expect(screen.getByText(/alice revised this gist/)).toBeTruthy();
    expect(screen.getByText("aaaaaaa")).toBeTruthy();
  });

  it("shows the empty message when there are no revisions", async () => {
    await renderModal({}, []);
    expect(screen.getByText("No revisions found.")).toBeTruthy();
  });

  it("expands a revision to load and show its diff", async () => {
    await renderModal({}, [makeRev()]);
    fireEvent.click(screen.getByText(/alice revised this gist/));
    expect(await screen.findByText("rev-line")).toBeTruthy();
    expect(api.fetchRevDiff).toHaveBeenCalledWith("g1", "aaaaaaaaaaaa", null);
  });

  it("shows the working-tree diff on the Working tree tab", async () => {
    vi.mocked(api.computeGistDiff).mockResolvedValue(WORKING);
    await renderModal({}, [makeRev()]);
    fireEvent.click(screen.getByText("Working tree"));
    expect(await screen.findByText("working-line")).toBeTruthy();
  });

  it("Close button calls onClose", async () => {
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay calls onClose", async () => {
    await renderModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose", async () => {
    await renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
