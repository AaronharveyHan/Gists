import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore } from "../store/useThemeStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// NewGistModal is the only heavy child — stub it.
vi.mock("./NewGistModal", () => ({
  NewGistModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="new-gist-modal"><button onClick={onClose}>close-new</button></div>
  ),
}));

type EventHandler = (e: { payload: unknown }) => void;
const eventHandlers: Record<string, EventHandler> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: EventHandler) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => { delete eventHandlers[name]; });
  }),
}));
function fireIpcEvent(name: string, payload: unknown) {
  eventHandlers[name]?.({ payload });
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeGist(over: Partial<Gist> = {}): Gist {
  return {
    id: "g1", description: "Gist one", public: true, html_url: "https://gist/g1",
    created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-02T00:00:00Z",
    files: [{ filename: "a.ts", language: "TypeScript", content: "x", size: 1, raw_url: null }],
    ...over,
  };
}

const actions = {
  setSearch: vi.fn(), sync: vi.fn(), createGist: vi.fn(), setActiveTag: vi.fn(),
  deleteTag: vi.fn(), setActiveCategory: vi.fn(), setActiveCollection: vi.fn(),
  createCollection: vi.fn(), updateCollection: vi.fn(), deleteCollection: vi.fn(),
  selectGist: vi.fn(), createLocalGist: vi.fn(),
  togglePin: vi.fn(), deleteGist: vi.fn().mockResolvedValue(undefined), openInTab: vi.fn(),
};

function seedStore(over: Record<string, unknown> = {}) {
  useGistStore.setState({
    gists: [], selectedId: null, searchQuery: "", syncStatus: "idle",
    allTags: [], activeTagId: null, categoryCounts: [], activeCategoryId: null,
    allCollections: [], activeCollectionId: null, networkOnline: true,
    openTabIds: [],
    ...actions,
    ...over,
  } as never);
}

function renderSidebar() {
  return render(<Sidebar />);
}

/** The footer count region. */
function footer() {
  return document.querySelector(".sidebar__footer") as HTMLElement;
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useThemeStore.setState({ sortOrder: "updated", setSortOrder: vi.fn() } as never);
    vi.mocked(api.startEmbeddingIndexer).mockResolvedValue(undefined);
    vi.mocked(api.semanticSearch).mockResolvedValue([]);
    seedStore();
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => cleanup());

  // ── A. Render + counts ──────────────────────────────────────────────────────

  it("renders the search bar", () => {
    renderSidebar();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows the total gist count in the footer", () => {
    seedStore({ gists: [makeGist({ id: "g1" }), makeGist({ id: "g2" })] });
    renderSidebar();
    expect(within(footer()).getByText("2 gists")).toBeTruthy();
  });

  it("starts the embedding indexer on mount", () => {
    renderSidebar();
    expect(api.startEmbeddingIndexer).toHaveBeenCalled();
  });

  // ── B. Client-side filters ──────────────────────────────────────────────────

  it("the public visibility filter narrows the list and shows filtered/total", () => {
    seedStore({ gists: [makeGist({ id: "g1", public: true }), makeGist({ id: "g2", public: false })] });
    renderSidebar();
    fireEvent.click(screen.getByTitle("Public"));
    // 1 public of 2 total
    expect(within(footer()).getByText("1")).toBeTruthy();
    expect(within(footer()).getByText(/\/ 2/)).toBeTruthy();
  });

  it("the pinned filter keeps only pinned gists", () => {
    seedStore({ gists: [makeGist({ id: "g1", pinned: true }), makeGist({ id: "g2" }), makeGist({ id: "g3" })] });
    renderSidebar();
    fireEvent.click(screen.getByTitle("Pinned"));
    expect(within(footer()).getByText("1")).toBeTruthy();
  });

  it("marks the active visibility chip", () => {
    seedStore({ gists: [makeGist()] });
    renderSidebar();
    const secret = screen.getByTitle("Secret");
    fireEvent.click(secret);
    expect(secret.className).toContain("sidebar__vis-chip--active");
  });

  it("renders the language chip row only when ≥2 languages exist", () => {
    seedStore({ gists: [
      makeGist({ id: "g1", files: [{ filename: "a.ts", language: "TypeScript", content: "x", size: 1, raw_url: null }] }),
      makeGist({ id: "g2", files: [{ filename: "b.py", language: "Python", content: "y", size: 1, raw_url: null }] }),
    ] });
    renderSidebar();
    expect(screen.getByTitle("Python")).toBeTruthy();
    expect(screen.getByTitle("TypeScript")).toBeTruthy();
  });

  it("changing the sort order calls setSortOrder", () => {
    const setSortOrder = vi.fn();
    useThemeStore.setState({ sortOrder: "updated", setSortOrder } as never);
    seedStore({ gists: [makeGist()] });
    renderSidebar();
    fireEvent.change(screen.getByTitle("Sort order"), { target: { value: "name" } });
    expect(setSortOrder).toHaveBeenCalledWith("name");
  });

  // ── C. Search + semantic ────────────────────────────────────────────────────

  it("typing in the search box calls setSearch", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(actions.setSearch).toHaveBeenCalledWith("hello");
  });

  it("toggling search mode switches to the semantic placeholder", () => {
    renderSidebar();
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    expect(screen.getByPlaceholderText("Semantic search…")).toBeTruthy();
  });

  it("a semantic query (debounced) calls semanticSearch", async () => {
    seedStore({ searchQuery: "vector" });
    renderSidebar();
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    await waitFor(
      () => expect(api.semanticSearch).toHaveBeenCalledWith("vector", 25),
      { timeout: 2000 },
    );
  });

  it("renders semantic results and the semantic footer count", async () => {
    seedStore({ searchQuery: "vector", gists: [makeGist({ id: "g1", description: "Vector match" })] });
    vi.mocked(api.semanticSearch).mockResolvedValue([{ gist_id: "g1", score: 0.9 }]);
    renderSidebar();
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy(), { timeout: 2000 });
    expect(within(footer()).getByText(/semantic results/)).toBeTruthy();
  });

  it("surfaces a semantic search error", async () => {
    seedStore({ searchQuery: "boom" });
    vi.mocked(api.semanticSearch).mockRejectedValue("index missing");
    renderSidebar();
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    await waitFor(() => expect(screen.getByText("index missing")).toBeTruthy(), { timeout: 2000 });
  });

  // ── D. Select mode + bulk ───────────────────────────────────────────────────

  it("entering select mode shows the bulk action bar", () => {
    seedStore({ gists: [makeGist()] });
    renderSidebar();
    fireEvent.click(within(footer()).getByText("Select"));
    expect(document.querySelector(".bulk-action-bar, .bulk-bar, [class*='bulk']")).toBeTruthy();
  });

  it("the select toggle shows the checked count once active", () => {
    seedStore({ gists: [makeGist()] });
    renderSidebar();
    fireEvent.click(within(footer()).getByText("Select"));
    expect(within(footer()).getByText(/0 selected/)).toBeTruthy();
  });

  it("exiting select mode hides the bulk bar", () => {
    seedStore({ gists: [makeGist()] });
    renderSidebar();
    fireEvent.click(within(footer()).getByText("Select"));
    expect(within(footer()).getByText(/selected/)).toBeTruthy();
    fireEvent.click(within(footer()).getByText(/selected/));
    expect(within(footer()).getByText("Select")).toBeTruthy();
  });

  // ── E. Row interactions (semantic mode renders rows directly) ────────────────

  async function renderWithSemanticRows() {
    seedStore({ searchQuery: "q", gists: [makeGist({ id: "g1", description: "Row gist" })] });
    vi.mocked(api.semanticSearch).mockResolvedValue([{ gist_id: "g1", score: 0.8 }]);
    renderSidebar();
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy(), { timeout: 2000 });
  }

  it("right-clicking a row opens the context menu", async () => {
    await renderWithSemanticRows();
    fireEvent.contextMenu(screen.getByText("a.ts"));
    expect(screen.getByText("Open in Tab")).toBeTruthy();
  });

  it("the context menu pin entry calls togglePin", async () => {
    await renderWithSemanticRows();
    fireEvent.contextMenu(screen.getByText("a.ts"));
    fireEvent.click(screen.getByText("Pin to top"));
    expect(actions.togglePin).toHaveBeenCalledWith("g1");
  });

  it("the context menu delete entry calls deleteGist after confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderWithSemanticRows();
    fireEvent.contextMenu(screen.getByText("a.ts"));
    fireEvent.click(screen.getByText("Delete"));
    expect(actions.deleteGist).toHaveBeenCalledWith("g1");
  });

  // ── F. Keyboard + events + modal ─────────────────────────────────────────────

  it("ArrowDown on the window selects the next gist", () => {
    seedStore({ gists: [makeGist({ id: "g1" }), makeGist({ id: "g2" })], selectedId: "g1" });
    renderSidebar();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })); });
    expect(actions.selectGist).toHaveBeenCalledWith("g2");
  });

  it("ArrowUp on the window selects the previous gist", () => {
    seedStore({ gists: [makeGist({ id: "g1" }), makeGist({ id: "g2" })], selectedId: "g2" });
    renderSidebar();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })); });
    expect(actions.selectGist).toHaveBeenCalledWith("g1");
  });

  it("an embedding-progress running event renders the progress bar", async () => {
    renderSidebar();
    await waitFor(() => expect(eventHandlers["embedding-progress"]).toBeTruthy());
    act(() => { fireIpcEvent("embedding-progress", { indexed: 5, total: 10, running: true }); });
    expect(document.querySelector(".sidebar__embed-bar")).toBeTruthy();
  });

  it("an embedding-progress error event renders the error banner", async () => {
    renderSidebar();
    await waitFor(() => expect(eventHandlers["embedding-progress"]).toBeTruthy());
    act(() => { fireIpcEvent("embedding-progress", { indexed: 0, total: 0, running: false, error: "no api key" }); });
    expect(document.querySelector(".sidebar__embed-error")).toBeTruthy();
  });

  it("the new-gist button opens the new gist modal", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("new-gist-btn"));
    expect(screen.getByTestId("new-gist-modal")).toBeTruthy();
  });
});
