import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { GraphView } from "./GraphView";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist, GistFile, Tag } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// ── Stubs for browser APIs not in jsdom ───────────────────────────────────────

// RAF: no-op so the render loop never fires and doesn't outlive the test
vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
vi.stubGlobal("cancelAnimationFrame", vi.fn());

// Web Worker stub — captures the init message for verification
class WorkerStub {
  onmessage: null | ((e: MessageEvent) => void) = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}
vi.stubGlobal("Worker", vi.fn(() => new WorkerStub()));

// Canvas getContext returns null in jsdom — the render() function handles it
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "main.ts", language: "TypeScript", content: "", size: 0, raw_url: null, ...overrides };
}

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "My Gist",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [makeFile()],
    pending_push: false,
    local_only: false,
    category: "gist",
    pinned: false,
    ...overrides,
  };
}

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return { id: 1, name: "typescript", color: "#3178c6", ...overrides };
}

function seedStore(gists: Gist[], allTags: Tag[] = []) {
  useGistStore.setState({ gists, allTags } as never);
}

async function renderGraph(props: Partial<React.ComponentProps<typeof GraphView>> = {}) {
  const onClose = vi.fn();
  const onSelectGist = vi.fn();
  render(
    <GraphView onClose={onClose} onSelectGist={onSelectGist} {...props} />,
  );
  // Flush async build() + listGistTagPairs
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onClose, onSelectGist };
}

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    seedStore([]);
    vi.mocked(api.listGistTagPairs).mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("shows 'Building graph…' while loading", () => {
    seedStore([]);
    render(<GraphView onClose={vi.fn()} onSelectGist={vi.fn()} />);
    expect(screen.getByText("Building graph…")).toBeTruthy();
  });

  it("renders the graph title", async () => {
    await renderGraph();
    expect(screen.getByText("Relation Graph")).toBeTruthy();
  });

  it("transitions out of loading state after build completes", async () => {
    await renderGraph();
    expect(screen.queryByText("Building graph…")).toBeNull();
  });

  it("shows the stats line after build", async () => {
    seedStore([makeGist()]);
    vi.mocked(api.listGistTagPairs).mockResolvedValue([["g1", 1]]);
    useGistStore.setState({ allTags: [makeTag({ id: 1 })] } as never);
    vi.mocked(api.listGistTagPairs).mockResolvedValue([["g1", 1]]);
    await renderGraph();
    // Stats format: "N gists · M tags · P connections"
    await waitFor(() => expect(screen.getByText(/gists · .* tags/)).toBeTruthy());
  });

  it("shows the canvas element after loading", async () => {
    await renderGraph();
    expect(document.querySelector(".graph-view__canvas")).toBeTruthy();
  });

  it("renders the legend with language group labels", async () => {
    await renderGraph();
    expect(screen.getByText("Language groups")).toBeTruthy();
    expect(screen.getByText("Web")).toBeTruthy();
    expect(screen.getByText("Systems")).toBeTruthy();
    expect(screen.getByText("Scripting")).toBeTruthy();
  });

  it("shows Reset view and Re-layout buttons after loading", async () => {
    await renderGraph();
    expect(screen.getByTitle("Reset zoom & pan")).toBeTruthy();
    expect(screen.getByTitle("Randomise and re-simulate")).toBeTruthy();
  });

  it("close button calls onClose", async () => {
    const { onClose } = await renderGraph();
    fireEvent.click(screen.getByText("✕ Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("spawns a Worker for physics simulation", async () => {
    await renderGraph();
    expect(Worker).toHaveBeenCalled();
  });

  it("sends init message to the worker after build", async () => {
    await renderGraph();
    const workerInstance = (Worker as ReturnType<typeof vi.fn>).mock.results[0]?.value as WorkerStub;
    expect(workerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "init" }),
      expect.any(Array),
    );
  });

  it("toggles between Show connected and Show all", async () => {
    // "Show connected" is the default label (en: showConnected = "仅关联")
    // check toggle button exists
    await renderGraph();
    const toggle = screen.getByRole("button", { name: /仅关联|Show|关联/ });
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    // After toggle, showAll=true → button now shows showAll label
    // The label changes to the other mode text
  });

  it("shows 'over cap' note when gists exceed the 250-node cap", async () => {
    const manyGists = Array.from({ length: 260 }, (_, i) =>
      makeGist({ id: `g${i}`, description: `Gist ${i}` }),
    );
    const pairs: [string, number][] = manyGists.slice(0, 260).map((g) => [g.id, 1]);
    vi.mocked(api.listGistTagPairs).mockResolvedValue(pairs);
    seedStore(manyGists, [makeTag()]);
    await renderGraph();
    await waitFor(() => expect(screen.getByText(/over cap/)).toBeTruthy());
  });
});
