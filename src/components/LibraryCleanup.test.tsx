import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { LibraryCleanup } from "./LibraryCleanup";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist } from "../api/tauri";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

type EventHandler = (e: { payload: unknown }) => void;
const eventHandlers: Record<string, EventHandler> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: EventHandler) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => { delete eventHandlers[name]; });
  }),
}));

/** Flush pending microtasks (listGistTagPairs + getEmbeddingStatus). */
async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [{ filename: "main.py", language: "Python", content: "print(1)", size: 8, raw_url: null }],
    ...overrides,
  };
}

function seedGists(gists: Gist[]) {
  useGistStore.setState({ gists } as never);
}

function renderModal(props: Partial<React.ComponentProps<typeof LibraryCleanup>> = {}) {
  const onClose = vi.fn();
  const onOpenGist = vi.fn();
  render(<LibraryCleanup onClose={onClose} onOpenGist={onOpenGist} {...props} />);
  return { onClose, onOpenGist };
}

describe("LibraryCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    seedGists([]);
    vi.mocked(api.listGistTagPairs).mockResolvedValue([]);
    vi.mocked(api.getEmbeddingStatus).mockResolvedValue({ indexed: 0, total: 0, running: false } as never);
    vi.mocked(api.findDuplicateGists).mockResolvedValue([]);
    vi.mocked(api.aiComplete).mockResolvedValue('{"description":"a script","tags":["util","cli"]}');
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  });
  afterEach(() => cleanup());

  it("renders the modal title", async () => {
    renderModal();
    await flush();
    expect(screen.getByText("Library Cleanup")).toBeTruthy();
  });

  it("renders both tabs", async () => {
    renderModal();
    await flush();
    expect(screen.getByText("Missing metadata")).toBeTruthy();
    expect(screen.getByText("Duplicates")).toBeTruthy();
  });

  it("lists gists with missing metadata as targets", async () => {
    seedGists([makeGist({ id: "g1", description: "" })]);
    renderModal();
    await flush();
    // missing description + missing tags badges
    expect(screen.getByText("no description")).toBeTruthy();
    expect(screen.getByText("no tags")).toBeTruthy();
  });

  it("shows the all-clean message when no gist needs metadata", async () => {
    seedGists([makeGist({ id: "g1", description: "Has a description" })]);
    vi.mocked(api.listGistTagPairs).mockResolvedValue([["g1", 1]] as never);
    renderModal();
    await flush();
    expect(screen.getByText(/Every gist has a description and tags/)).toBeTruthy();
  });

  it("clicking Organize on a row calls aiComplete", async () => {
    seedGists([makeGist({ id: "g1", description: "" })]);
    renderModal();
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByText("Organize"));
    });
    expect(api.aiComplete).toHaveBeenCalled();
  });

  it("Organize all button triggers aiComplete for the targets", async () => {
    seedGists([makeGist({ id: "g1", description: "" })]);
    renderModal();
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByText(/Organize all/));
    });
    await flush();
    expect(api.aiComplete).toHaveBeenCalled();
  });

  it("switches to the Duplicates tab", async () => {
    renderModal();
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Duplicates")); });
    expect(screen.getByText("Sensitivity")).toBeTruthy();
    expect(screen.getByText("Find duplicates")).toBeTruthy();
  });

  it("Find duplicates calls findDuplicateGists when an index exists", async () => {
    vi.mocked(api.getEmbeddingStatus).mockResolvedValue({ indexed: 5, total: 5, running: false } as never);
    renderModal();
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Duplicates")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Find duplicates")); });
    await flush();
    expect(api.findDuplicateGists).toHaveBeenCalled();
  });

  it("renders duplicate pairs and opens a gist on click", async () => {
    seedGists([
      makeGist({ id: "g1", description: "Alpha" }),
      makeGist({ id: "g2", description: "Beta" }),
    ]);
    vi.mocked(api.getEmbeddingStatus).mockResolvedValue({ indexed: 2, total: 2, running: false } as never);
    vi.mocked(api.findDuplicateGists).mockResolvedValue([{ a: "g1", b: "g2", score: 0.95 }] as never);
    const { onOpenGist } = renderModal();
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Duplicates")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Find duplicates")); });
    await flush();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("95% similar")).toBeTruthy();
    fireEvent.click(screen.getByText("Alpha"));
    expect(onOpenGist).toHaveBeenCalledWith("g1");
  });

  it("Escape key closes the modal", async () => {
    const { onClose } = renderModal();
    await flush();
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(onClose).toHaveBeenCalled();
  });

  it("close (×) button calls onClose", async () => {
    const { onClose } = renderModal();
    await flush();
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the overlay backdrop closes the modal", async () => {
    const { onClose } = renderModal();
    await flush();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the no-duplicates message after an empty scan", async () => {
    vi.mocked(api.getEmbeddingStatus).mockResolvedValue({ indexed: 3, total: 3, running: false } as never);
    vi.mocked(api.findDuplicateGists).mockResolvedValue([]);
    renderModal();
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Duplicates")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Find duplicates")); });
    await waitFor(() =>
      expect(screen.getByText(/No near-duplicates found/)).toBeTruthy(),
    );
  });
});
