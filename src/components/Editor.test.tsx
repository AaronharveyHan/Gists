import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Editor } from "./Editor";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist, GistFile, MergeOutcome } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// jsdom lacks ResizeObserver (used by OverflowActions in the toolbar).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// Monaco stand-in: a plain textarea wired to value/onChange. We deliberately
// do NOT call onMount, so the editor ref stays null and the component's
// cursor/decoration/find effects no-op — keeping the test free of the full
// Monaco API surface while still exercising the dirty/save/tab state machine.
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "main.ts", language: "typescript", content: "hello", size: 5, raw_url: null, ...overrides };
}

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "my gist",
    public: false,
    html_url: "https://gist.github.com/u/g1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [makeFile()],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

let saveGistDraft: ReturnType<typeof vi.fn>;
let updateGist: ReturnType<typeof vi.fn>;

function seed(gist: Gist | null) {
  saveGistDraft = vi.fn().mockResolvedValue(undefined);
  updateGist = vi.fn().mockResolvedValue(undefined);
  useGistStore.setState({
    gists: gist ? [gist] : [],
    selectedId: gist?.id ?? null,
    openTabIds: [],
    allTags: [],
    gistTags: gist ? { [gist.id]: [] } : {},
    gistCollections: gist ? { [gist.id]: [] } : {},
    networkOnline: true,
    saveGistDraft,
    updateGist,
    loadGistTags: vi.fn().mockResolvedValue(undefined),
    setGistTags: vi.fn().mockResolvedValue(undefined),
    createTag: vi.fn().mockResolvedValue({ id: 1, name: "t", color: "#000" }),
    loadGistCollections: vi.fn().mockResolvedValue(undefined),
    addGistToCollection: vi.fn().mockResolvedValue(undefined),
    removeGistFromCollection: vi.fn().mockResolvedValue(undefined),
    publishGist: vi.fn().mockResolvedValue(undefined),
    pullGistRemote: vi.fn().mockResolvedValue(makeGist()),
    deleteGist: vi.fn().mockResolvedValue(undefined),
  } as never);
}

describe("Editor (shell)", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the empty state when no gist is selected", () => {
    seed(null);
    render(<Editor />);
    expect(screen.getByText("Open a Gist")).toBeTruthy();
  });

  it("renders the selected gist's description, content, and file tab", () => {
    seed(makeGist());
    render(<Editor />);
    expect(screen.getByDisplayValue("my gist")).toBeTruthy(); // description input
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("hello");
    expect(screen.getByText("main.ts")).toBeTruthy(); // file tab
  });

  it("marks the editor dirty when content changes", () => {
    seed(makeGist());
    render(<Editor />);
    expect(screen.queryByTitle("Typing, not yet saved to local DB")).toBeNull();
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "world" } });
    expect(screen.getByTitle("Typing, not yet saved to local DB")).toBeTruthy();
  });

  it("marks the editor dirty when the description changes", () => {
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByDisplayValue("my gist"), { target: { value: "renamed" } });
    expect(screen.getByTitle("Typing, not yet saved to local DB")).toBeTruthy();
  });

  it("debounced auto-save persists to the local DB after 1.5s", async () => {
    vi.useFakeTimers();
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    expect(saveGistDraft).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(saveGistDraft).toHaveBeenCalledOnce();
    expect(saveGistDraft).toHaveBeenCalledWith("g1", "my gist", [["main.ts", "edited"]]);
  });

  it("shows the pending-push chip for a synced-locally gist", () => {
    seed(makeGist({ pending_push: true }));
    render(<Editor />);
    expect(screen.getByTitle("Saved locally, not yet synced to GitHub")).toBeTruthy();
  });

  it("renders the markdown view tabs when the active file is .md", () => {
    seed(makeGist({ files: [makeFile({ filename: "notes.md", content: "# hi" })] }));
    render(<Editor />);
    expect(screen.getByTestId("md-tab-source")).toBeTruthy();
    expect(screen.getByTestId("md-tab-preview")).toBeTruthy();
    // default view mode is "split"
    expect(screen.getByTestId("md-tab-split").className).toContain("editor__md-tab--active");
  });

  it("does not render markdown tabs for a non-markdown file", () => {
    seed(makeGist());
    render(<Editor />);
    expect(screen.queryByTestId("md-tab-source")).toBeNull();
  });

  it("adding a file appends an untitled tab in rename mode", () => {
    seed(makeGist());
    render(<Editor />);
    fireEvent.click(screen.getByTitle("New file"));
    // The new file is activated and opened in inline-rename mode.
    expect(screen.getByDisplayValue("untitled")).toBeTruthy();
    expect(screen.getByTitle("Typing, not yet saved to local DB")).toBeTruthy();
  });

  it("shows the local-draft banner for local_only gists", () => {
    seed(makeGist({ local_only: true }));
    render(<Editor />);
    expect(screen.getByText(/local draft/i)).toBeTruthy();
  });

  it("switches the active file content when another tab is clicked", () => {
    seed(makeGist({
      files: [
        makeFile({ filename: "a.ts", content: "AAA" }),
        makeFile({ filename: "b.ts", content: "BBB" }),
      ],
    }));
    render(<Editor />);
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("AAA");
    fireEvent.click(screen.getByText("b.ts"));
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("BBB");
  });
});

// ── Conflict resolution flow ────────────────────────────────────────────────
//
// Drives the full background-sync conflict path: a newer remote arrives (the
// gist's updated_at changes in the store) while the user has unsaved edits, so
// the component fetches the remote, runs a three-way merge, and either silently
// applies it or surfaces the conflict banner for manual resolution.

const CONFLICT_CONTENT = "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> remote";

function remoteGist(overrides: Partial<Gist> = {}): Gist {
  return makeGist({
    description: "remote desc",
    updated_at: "2024-02-01T00:00:00Z",
    files: [makeFile({ filename: "main.ts", content: "remote content" })],
    ...overrides,
  });
}

function mergeOutcome(overrides: Partial<MergeOutcome> = {}): MergeOutcome {
  return {
    any_conflict: true,
    files: [{ filename: "main.ts", content: CONFLICT_CONTENT, had_conflict: true }],
    ...overrides,
  };
}

/**
 * Simulate a background sync replacing the open gist with a newer revision,
 * then flush the effect's async fetch→merge chain inside act so all resulting
 * state updates are settled before assertions run.
 */
async function arriveRemote(next: Partial<Gist>) {
  await act(async () => {
    const cur = useGistStore.getState().gists[0];
    useGistStore.setState({ gists: [{ ...cur, ...next }] } as never);
    // Let the fetchGistFromGitHub → mergeGistConflict → setState chain settle.
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Editor (conflict flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("silently refreshes (no fetch, no banner) when the user is not dirty", async () => {
    seed(makeGist());
    render(<Editor />);
    await arriveRemote({
      updated_at: "2024-02-01T00:00:00Z",
      files: [makeFile({ filename: "main.ts", content: "remote-fresh" })],
    });
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("remote-fresh");
    expect(api.fetchGistFromGitHub).not.toHaveBeenCalled();
    expect(screen.queryByText(/Merge conflict/)).toBeNull();
  });

  it("auto-merges cleanly when there is no conflict — no banner, persists result", async () => {
    vi.mocked(api.fetchGistFromGitHub).mockResolvedValue(remoteGist());
    vi.mocked(api.mergeGistConflict).mockResolvedValue(
      mergeOutcome({
        any_conflict: false,
        files: [{ filename: "main.ts", content: "clean-merged", had_conflict: false }],
      }),
    );
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    await arriveRemote({ updated_at: "2024-02-01T00:00:00Z" });

    // Merged content applied; no banner.
    await vi.waitFor(() =>
      expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("clean-merged")
    );
    expect(screen.queryByText(/Merge conflict/)).toBeNull();
    expect(api.mergeGistConflict).toHaveBeenCalledOnce();
    expect(saveGistDraft).toHaveBeenCalledWith("g1", "remote desc", [["main.ts", "clean-merged"]]);
  });

  it("surfaces the conflict banner with markers when the merge conflicts", async () => {
    vi.mocked(api.fetchGistFromGitHub).mockResolvedValue(remoteGist());
    vi.mocked(api.mergeGistConflict).mockResolvedValue(mergeOutcome());
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    await arriveRemote({ updated_at: "2024-02-01T00:00:00Z" });

    expect(await screen.findByText(/Merge conflict/)).toBeTruthy();
    // Conflict markers injected into the editor.
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toContain("<<<<<<<");
    // Resolve is blocked while markers remain.
    expect(screen.getByRole("button", { name: /Conflicts resolved/ })).toHaveProperty("disabled", true);
  });

  it("enables resolve once markers are removed, then pushes and clears the banner", async () => {
    vi.mocked(api.fetchGistFromGitHub).mockResolvedValue(remoteGist());
    vi.mocked(api.mergeGistConflict).mockResolvedValue(mergeOutcome());
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    await arriveRemote({ updated_at: "2024-02-01T00:00:00Z" });
    await screen.findByText(/Merge conflict/);

    // User resolves by hand: replace the marker content with clean text.
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "resolved" } });
    const resolveBtn = screen.getByRole("button", { name: /Conflicts resolved/ });
    expect(resolveBtn).toHaveProperty("disabled", false);

    await act(async () => { fireEvent.click(resolveBtn); });
    expect(updateGist).toHaveBeenCalledOnce();
    expect(updateGist).toHaveBeenCalledWith("g1", "my gist", { "main.ts": ["resolved", null] });
    expect(screen.queryByText(/Merge conflict/)).toBeNull();
  });

  it("discard mine pulls the remote and clears the banner", async () => {
    vi.mocked(api.fetchGistFromGitHub).mockResolvedValue(remoteGist());
    vi.mocked(api.mergeGistConflict).mockResolvedValue(mergeOutcome());
    seed(makeGist());
    // pullGistRemote returns the fresh remote revision.
    const pull = vi.fn().mockResolvedValue(
      makeGist({ files: [makeFile({ filename: "main.ts", content: "pulled-remote" })] }),
    );
    useGistStore.setState({ pullGistRemote: pull } as never);

    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    await arriveRemote({ updated_at: "2024-02-01T00:00:00Z" });
    await screen.findByText(/Merge conflict/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Discard my changes/ }));
    });
    expect(pull).toHaveBeenCalledWith("g1");
    expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe("pulled-remote");
    expect(screen.queryByText(/Merge conflict/)).toBeNull();
  });

  it("falls back to an offline banner when the remote fetch fails", async () => {
    vi.mocked(api.fetchGistFromGitHub).mockRejectedValue(new Error("network down"));
    seed(makeGist());
    render(<Editor />);
    fireEvent.change(screen.getByTestId("monaco"), { target: { value: "edited" } });
    await arriveRemote({ updated_at: "2024-02-01T00:00:00Z" });

    // Banner shows with no auto-merged count (plain "⚠ Merge conflict").
    expect(await screen.findByText("⚠ Merge conflict")).toBeTruthy();
    expect(api.mergeGistConflict).not.toHaveBeenCalled();
  });
});
