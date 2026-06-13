import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { StatsPanel } from "./StatsPanel";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { CategoryCount, Gist, GistFile, TagCount } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "f.ts", language: "TypeScript", content: "", size: 0, raw_url: null, ...overrides };
}

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g",
    description: "",
    public: false,
    html_url: "",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    files: [makeFile()],
    pending_push: false,
    local_only: false,
    category: "gist",
    pinned: false,
    ...overrides,
  };
}

function cardValue(label: string): HTMLElement {
  return screen.getByText(label).closest(".stats-card") as HTMLElement;
}

/** Render and flush the on-mount listTagCounts() promise inside act. */
async function renderStats(onClose: () => void) {
  render(<StatsPanel onClose={onClose} />);
  await act(async () => { await Promise.resolve(); });
}

describe("StatsPanel", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    onClose = vi.fn();
    vi.mocked(api.listTagCounts).mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  function seed(gists: Gist[], categoryCounts: CategoryCount[] = []) {
    useGistStore.setState({ gists, categoryCounts } as never);
  }

  it("renders the panel title", async () => {
    seed([]);
    await renderStats(onClose);
    expect(screen.getByText("Statistics")).toBeTruthy();
  });

  it("computes the summary cards from the gist list", async () => {
    seed([
      makeGist({ id: "a", public: true, pinned: true, files: [makeFile({ size: 1024 }), makeFile({ size: 1024 })] }),
      makeGist({ id: "b", public: false, files: [makeFile({ size: 1024 })] }),
    ]);
    await renderStats(onClose);

    expect(within(cardValue("Total Gists")).getByText("2")).toBeTruthy();
    // 1 public of 2 → 50%
    expect(within(cardValue("Public")).getByText("1")).toBeTruthy();
    expect(within(cardValue("Public")).getByText("50%")).toBeTruthy();
    // 1 pinned
    expect(within(cardValue("Pinned")).getByText("1")).toBeTruthy();
    // 3 files total, size 3 KB
    expect(within(cardValue("Files")).getByText("3")).toBeTruthy();
    expect(within(cardValue("Total Size")).getByText("3.0 KB")).toBeTruthy();
  });

  it("shows the average files per gist", async () => {
    seed([
      makeGist({ id: "a", files: [makeFile(), makeFile(), makeFile()] }),
      makeGist({ id: "b", files: [makeFile()] }),
    ]);
    await renderStats(onClose);
    // 4 files / 2 gists = 2.0
    expect(screen.getByText("avg 2.0/gist")).toBeTruthy();
  });

  it("renders a language bar per distinct file language", async () => {
    seed([
      makeGist({ id: "a", files: [makeFile({ language: "TypeScript" }), makeFile({ language: "Python" })] }),
      makeGist({ id: "b", files: [makeFile({ language: "TypeScript" })] }),
    ]);
    await renderStats(onClose);
    expect(screen.getByText("TypeScript")).toBeTruthy();
    expect(screen.getByText("Python")).toBeTruthy();
  });

  it("shows the no-language placeholder when files have no language", async () => {
    seed([makeGist({ files: [makeFile({ language: null })] })]);
    await renderStats(onClose);
    expect(screen.getByText("No language data yet")).toBeTruthy();
  });

  it("renders category bars from the store's categoryCounts", async () => {
    seed([makeGist()], [{ category: "script", count: 5 }, { category: "config", count: 2 }]);
    await renderStats(onClose);
    expect(screen.getByText("Script")).toBeTruthy();
    expect(screen.getByText("Config")).toBeTruthy();
  });

  it("renders the tags section from listTagCounts", async () => {
    const tags: TagCount[] = [{ id: 1, name: "urgent", color: "#f00", count: 4 }];
    vi.mocked(api.listTagCounts).mockResolvedValue(tags);
    seed([makeGist()]);
    render(<StatsPanel onClose={onClose} />);
    expect(await screen.findByText("urgent")).toBeTruthy();
  });

  it("handles an empty store (zero totals, 0% percentages)", async () => {
    seed([]);
    await renderStats(onClose);
    expect(within(cardValue("Total Gists")).getByText("0")).toBeTruthy();
    expect(within(cardValue("Public")).getByText("0%")).toBeTruthy();
  });

  it("close button calls onClose", async () => {
    seed([]);
    await renderStats(onClose);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose", async () => {
    seed([]);
    await renderStats(onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
