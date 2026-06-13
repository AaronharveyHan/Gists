import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Editor } from "./Editor";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Gist, GistFile } from "../api/tauri";

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
